-- =============================================================================
-- 0014_admin_member_overview : vue d'ensemble adhésion / essais (Plan 3, tâche 8)
--
--  * admin_member_overview() : une ligne par profil actif (profile_id,
--    member_until, trial_used) pour la liste admin, en un seul appel au lieu
--    de N (my_membership / my_trial_status refusent un non-propriétaire).
--    member_until : fin de la couverture en cours (cotisation « payé pour
--    l'année » ou adhésion active / résiliée), null si non adhérent.
--    Admin actif uniquement (42501 sinon).
-- =============================================================================
create function public.admin_member_overview()
returns table (profile_id uuid, member_until date, trial_used int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Zurich')::date;
begin
  if not (public.is_admin() and public.current_account_active()) then
    raise exception 'admin_member_overview: admin only' using errcode = '42501';
  end if;
  return query
    select p.id,
           nullif(greatest(
             case when p.paid_until >= v_today then p.paid_until end,
             (select max(m.ends_on) from public.memberships m
               where m.profile_id = p.id
                 and m.status in ('active', 'cancelled')
                 and m.starts_on <= v_today and m.ends_on >= v_today)
           ), null),
           public.trial_used(p.id)
      from public.profiles p;
end;
$$;

revoke all on function public.admin_member_overview() from public, anon;
grant execute on function public.admin_member_overview() to authenticated;
