-- =============================================================================
-- 0017_ranking_hide_minors : moins de 16 ans masqués du classement
--
--  * attendance_ranking (0016) : les profils de moins de 16 ans (inscrits
--    seuls avec accord parental, ou enfants sans login) n'apparaissent pas et
--    ne prennent pas de rang ; les rangs des autres sont calculés sans eux.
--    Ils peuvent toujours ouvrir le classement (compte actif).
--  * my_ranking (0016) : pour tout appelant, rang = 1 + nombre de totaux de
--    présences distincts, parmi les lignes visibles, supérieurs au sien
--    (= le rang dense qu'il aurait s'il était inclus) ; pour un appelant
--    visible, identique à son rang dans attendance_ranking. Aucune présence
--    → (null, 0).
-- =============================================================================

create or replace function public.attendance_ranking(p_period text default 'all', p_limit int default null)
returns table (rank int, profile_id uuid, first_name text, last_name text, bjj_belt public.belt, sessions int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_from timestamptz;
begin
  if not public.current_account_active() then
    raise exception 'attendance_ranking: active account required' using errcode = '42501';
  end if;
  v_from := public.stats_period_start(p_period);
  if p_limit is not null and p_limit < 1 then
    raise exception 'attendance_ranking: p_limit must be >= 1'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  return query
    with s as (
      select ca.profile_id as pid, count(*)::int as n
        from public.counted_attendance(v_from) ca
       group by ca.profile_id
    ), r as (
      select (dense_rank() over w)::int as dr, rank() over w as cut,
             p.id, p.first_name as fn, p.last_name as ln, p.bjj_belt as belt, s.n
        from s
        join public.profiles p on p.id = s.pid
       where public.is_account_active(p)
         and p.age >= 16
      window w as (order by s.n desc)
    )
    select r.dr, r.id, r.fn, r.ln, r.belt, r.n
      from r
     where p_limit is null or r.cut <= p_limit
     order by r.n desc, r.ln, r.fn, r.id;
end;
$$;

create or replace function public.my_ranking(p_period text default 'all')
returns table (rank int, sessions int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_sessions int;
  v_rank int;
begin
  if not public.current_account_active() then
    raise exception 'my_ranking: active account required' using errcode = '42501';
  end if;
  select count(*)::int into v_sessions
    from public.counted_attendance(public.stats_period_start(p_period)) ca
   where ca.profile_id = v_me;
  if v_sessions > 0 then
    select 1 + count(distinct r.sessions)::int into v_rank
      from public.attendance_ranking(p_period) r
     where r.sessions > v_sessions;
  end if;
  return query select v_rank, v_sessions;
end;
$$;

revoke all on function public.attendance_ranking(text, int) from public, anon;
revoke all on function public.my_ranking(text) from public, anon;
grant execute on function public.attendance_ranking(text, int) to authenticated;
grant execute on function public.my_ranking(text) to authenticated;
