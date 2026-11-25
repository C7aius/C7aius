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
--  * claim_outbox (service_role) : réserve les lignes à envoyer (SKIP LOCKED,
--    réservation valable 5 min), plafond de 5 tentatives (max_attempts),
--    notifications de cours déjà commencé expirées (expired).
--  * admin_set_role (0004) redéfinie : promotion en prof validé →
--    prof_validated.
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
  error      text null,
  attempts   int not null default 0,   -- réservations par claim_outbox
  claimed_at timestamptz null          -- dernière réservation (send-push en cours)
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
-- connu change de propriétaire (appareil passé à un autre compte). Préfixes
-- ExponentPushToken[ et ExpoPushToken[. Au plus 10 jetons par profil.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'register_push_token: profile required' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) > 255 or right(p_token, 1) <> ']'
     or not (starts_with(p_token, 'ExponentPushToken[') or starts_with(p_token, 'ExpoPushToken[')) then
    raise exception 'register_push_token: invalid Expo push token'
      using errcode = '22023', hint = 'invalid_push_token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'register_push_token: platform must be ios or android'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  -- clock_timestamp() : ordre exact même dans une seule transaction
  insert into public.push_tokens (token, profile_id, platform, updated_at)
  values (p_token, v_me, p_platform, clock_timestamp())
  on conflict (token) do update
    set profile_id = excluded.profile_id,
        platform   = excluded.platform,
        updated_at = excluded.updated_at;

  -- au plus 10 jetons par profil : les plus anciens sont supprimés
  delete from public.push_tokens
   where profile_id = v_me
     and token not in (select token from public.push_tokens
                        where profile_id = v_me
                        order by updated_at desc, token desc
                        limit 10);
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
-- admin_set_role (0004) : en plus, passage à l'état « prof validé » (role prof
-- et prof_status valide, alors qu'il ne l'était pas) → ligne prof_validated.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role(p_profile uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
  v_after  public.profiles;
begin
  if not public.is_admin() then
    raise exception 'admin_set_role: admin required' using errcode = '42501';
  end if;
  -- verrouille les admins : deux rétrogradations concurrentes ne peuvent pas
  -- supprimer ensemble les deux derniers admins
  perform 1 from public.profiles where role = 'admin' for update;
  select * into v_target from public.profiles where id = p_profile for update;
  if v_target.id is null then
    raise exception 'admin_set_role: profile not found' using errcode = 'P0002';
  end if;
  if v_target.auth_user_id is null then
    raise exception 'admin_set_role: a child profile has no login and no role'
      using errcode = '42501', hint = 'child_profile_role';
  end if;
  if v_target.role = 'admin' and p_role <> 'admin'
     and not exists (select 1 from public.profiles where role = 'admin' and id <> p_profile) then
    raise exception 'admin_set_role: cannot demote the last admin'
      using errcode = '42501', hint = 'last_admin';
  end if;
  update public.profiles
     set role = p_role,
         prof_status = case
           when p_role = 'prof' then coalesce(prof_status, 'valide')
           when p_role = 'eleve' then null
           else prof_status
         end
   where id = p_profile
  returning * into v_after;
  if v_after.role = 'prof' and v_after.prof_status = 'valide'
     and not (v_target.role = 'prof' and v_target.prof_status = 'valide') then
    perform public.notify_profile(p_profile, 'prof_validated', null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_outbox(p_limit) : appelée par send-push (service_role). Parmi les
-- lignes ni envoyées ni en erreur, et non réservées (ou réservation de plus
-- de 5 min, send-push interrompue) :
--  * 5 tentatives déjà faites → error 'max_attempts' ;
--  * slot_vacant / course_cancelled d'un cours déjà commencé → error 'expired' ;
--  * les p_limit plus anciennes restantes sont réservées (claimed_at = now(),
--    attempts + 1 ; FOR UPDATE SKIP LOCKED : deux appels concurrents ne
--    réservent jamais la même ligne) et renvoyées avec la langue du
--    destinataire, le sport et le début du cours, le prénom de l'enfant.
-- ---------------------------------------------------------------------------
create function public.claim_outbox(p_limit int)
returns table (
  id bigint, profile_id uuid, kind text, course_id uuid, payload jsonb, attempts int,
  language text, sport text, starts_at timestamptz, child_first_name text
)
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_outbox o
     set error = 'max_attempts'
   where o.sent_at is null and o.error is null
     and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     and o.attempts >= 5;

  update public.notification_outbox o
     set error = 'expired'
    from public.courses c
   where c.id = o.course_id
     and o.sent_at is null and o.error is null
     and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     and o.kind in ('slot_vacant', 'course_cancelled')
     and c.starts_at <= now();

  return query
  with picked as (
    select o.id from public.notification_outbox o
     where o.sent_at is null and o.error is null
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.created_at, o.id
     limit greatest(coalesce(p_limit, 0), 0)
     for update skip locked
  ), claimed as (
    update public.notification_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
      from picked
     where o.id = picked.id
    returning o.*
  )
  select cl.id, cl.profile_id, cl.kind, cl.course_id, cl.payload, cl.attempts,
         p.language::text, c.sport::text, c.starts_at, ch.first_name
    from claimed cl
    join public.profiles p on p.id = cl.profile_id
    left join public.courses c on c.id = cl.course_id
    left join public.profiles ch on ch.id = (cl.payload->>'child_profile_id')::uuid
   order by cl.created_at, cl.id;
end;
$$;

revoke all on function public.claim_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int) to service_role;

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
