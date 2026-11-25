-- =============================================================================
-- 0006_notifications : file d'attente des notifications (outbox)
--
--  * notification_outbox : lue et écrite par service_role uniquement (l'envoi
--    est fait côté serveur) ; RLS activée sans policy, aucun grant à anon /
--    authenticated.
--  * notify_profile : interne (non exposée), appelée par les RPC SECURITY
--    DEFINER (cancel_course, ...). Un profil sans login (enfant créé par un
--    parent) est notifié via son parent ; payload.child_profile_id indique
--    alors l'enfant concerné.
--  * push_tokens : jetons Expo, un propriétaire par jeton ; chacun voit et
--    supprime les siens (RLS) ; écriture via register_push_token uniquement.
--  * process_course_schedule (service_role / cron) : notifie les créneaux
--    vacants des prochaines 24 h aux profs actifs, passe en open_mat les cours
--    vacants commencés.
--  * admin_set_prof_status (0001) redéfinie : passage à 'valide' → ligne
--    prof_validated.
--  * pg_cron : process-course-schedule (*/5 min) et send-push (chaque minute,
--    via pg_net ; URL et clé lues dans Vault : functions_url,
--    service_role_key ; absentes → rien).
--
-- HINTs stables : invalid_push_token, invalid_field.
-- =============================================================================

create table public.notification_outbox (
  id         bigserial primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('course_cancelled', 'slot_vacant', 'prof_validated')),
  course_id  uuid null references public.courses (id) on delete cascade,
  payload    jsonb not null default '{}',
  created_at timestamptz default now(),
  sent_at    timestamptz null,
  error      text null
);

create index notification_outbox_pending_idx on public.notification_outbox (created_at) where sent_at is null;
create index notification_outbox_profile_id_idx on public.notification_outbox (profile_id);
create index notification_outbox_course_id_idx on public.notification_outbox (course_id);

alter table public.notification_outbox enable row level security;

revoke all on public.notification_outbox from anon, authenticated;
revoke all on sequence public.notification_outbox_id_seq from anon, authenticated;
grant select, insert, update, delete on public.notification_outbox to service_role;
grant usage, select on sequence public.notification_outbox_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- notify_profile(p_profile, p_kind, p_course) : écrit une ligne d'outbox pour
-- p_profile, ou pour son parent si p_profile n'a pas de login. Profil
-- inconnu, ou sans login ni parent : rien.
-- ---------------------------------------------------------------------------
create function public.notify_profile(p_profile uuid, p_kind text, p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_profile;
  if v_p.id is null then
    return;
  end if;

  if v_p.auth_user_id is null then
    if v_p.parent_profile_id is null then
      return;  -- ni login ni parent : personne à notifier
    end if;
    insert into public.notification_outbox (profile_id, kind, course_id, payload)
    values (v_p.parent_profile_id, p_kind, p_course, jsonb_build_object('child_profile_id', v_p.id));
  else
    insert into public.notification_outbox (profile_id, kind, course_id)
    values (v_p.id, p_kind, p_course);
  end if;
end;
$$;

revoke all on function public.notify_profile(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Jetons push (Expo)
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  token      text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create index push_tokens_profile_id_idx on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (profile_id = public.current_profile_id());

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated
  using (profile_id = public.current_profile_id());

revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;

-- register_push_token(p_token, p_platform) : compte connecté (même inactif :
-- un prof en attente doit recevoir prof_validated). Upsert : un jeton déjà
-- connu change de propriétaire (appareil passé à un autre compte).
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'register_push_token: profile required' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) > 255
     or left(p_token, 18) <> 'ExponentPushToken[' or right(p_token, 1) <> ']' then
    raise exception 'register_push_token: invalid Expo push token'
      using errcode = '22023', hint = 'invalid_push_token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'register_push_token: platform must be ios or android'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  insert into public.push_tokens (token, profile_id, platform, updated_at)
  values (p_token, v_me, p_platform, now())
  on conflict (token) do update
    set profile_id = excluded.profile_id,
        platform   = excluded.platform,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- process_course_schedule() : appelée par pg_cron (ou service_role).
--  1. cours prevu sans prof, pas encore signalé, commençant dans les 24 h →
--     une ligne slot_vacant par prof actif (prof validé ou admin, avec login,
--     compte actif), puis vacancy_notified_at = now(). L'UPDATE ... RETURNING
--     ne renvoie une ligne qu'une fois : idempotent, y compris en concurrence.
--  2. cours prevu sans prof déjà commencé → open_mat, sans notification.
-- ---------------------------------------------------------------------------
create function public.process_course_schedule() returns void
language plpgsql security definer set search_path = '' as $$
begin
  with vacant as (
    update public.courses
       set vacancy_notified_at = now()
     where status = 'prevu'
       and prof_id is null
       and vacancy_notified_at is null
       and starts_at > now()
       and starts_at <= now() + interval '24 hours'
    returning id
  )
  insert into public.notification_outbox (profile_id, kind, course_id)
  select p.id, 'slot_vacant', v.id
    from vacant v
   cross join public.profiles p
   where p.auth_user_id is not null
     and (p.role = 'admin' or (p.role = 'prof' and p.prof_status = 'valide'))
     and public.is_account_active(p);

  update public.courses
     set status = 'open_mat'
   where status = 'prevu'
     and prof_id is null
     and starts_at <= now();
end;
$$;

revoke all on function public.process_course_schedule() from public, anon, authenticated;
grant execute on function public.process_course_schedule() to service_role;

-- ---------------------------------------------------------------------------
-- admin_set_prof_status (0001) : en plus, passage à 'valide' (depuis un autre
-- statut) → ligne prof_validated pour ce prof. Droits inchangés (create or
-- replace conserve les grants).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_prof_status(p_profile uuid, p_status public.prof_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.prof_status;
begin
  if not public.is_admin() then
    raise exception 'admin_set_prof_status: admin required' using errcode = '42501';
  end if;
  select prof_status into v_old from public.profiles
   where id = p_profile and role = 'prof'
   for update;
  if not found then
    raise exception 'admin_set_prof_status: prof profile not found' using errcode = 'P0002';
  end if;
  update public.profiles set prof_status = p_status where id = p_profile;
  if p_status = 'valide' and v_old is distinct from 'valide' then
    perform public.notify_profile(p_profile, 'prof_validated', null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- invoke_send_push() : appelée par pg_cron chaque minute. S'il reste des
-- lignes non envoyées et que les secrets Vault functions_url (base des
-- fonctions, ex. https://<ref>.supabase.co/functions/v1) et service_role_key
-- existent, appelle POST <functions_url>/send-push via pg_net (asynchrone).
-- Retourne l'id de requête pg_net, ou null si rien n'a été fait. Ne lève
-- jamais faute de secrets.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create function public.invoke_send_push() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.notification_outbox where sent_at is null and error is null) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return null;
  end if;
  return net.http_post(
    url     := rtrim(v_url, '/') || '/send-push',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.invoke_send_push() from public, anon, authenticated;
grant execute on function public.invoke_send_push() to service_role;

-- cron.schedule(nom, ...) remplace une tâche existante du même nom.
select cron.schedule('process-course-schedule', '*/5 * * * *', 'select public.process_course_schedule()');
select cron.schedule('send-push', '* * * * *', 'select public.invoke_send_push()');
