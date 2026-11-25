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
-- inconnu : rien.
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

  if v_p.auth_user_id is null and v_p.parent_profile_id is not null then
    insert into public.notification_outbox (profile_id, kind, course_id, payload)
    values (v_p.parent_profile_id, p_kind, p_course, jsonb_build_object('child_profile_id', v_p.id));
  else
    insert into public.notification_outbox (profile_id, kind, course_id)
    values (v_p.id, p_kind, p_course);
  end if;
end;
$$;

revoke all on function public.notify_profile(uuid, text, uuid) from public, anon, authenticated;
