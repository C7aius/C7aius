-- =============================================================================
-- 0016_stats : statistiques de présence et d'enseignement (Plan 4, tâche 1)
--
-- Source unique : attendance.present = true sur un cours non annulé
-- (status <> 'annule') déjà commencé (starts_at <= now()). Heures = durée du
-- cours (ends_at - starts_at), en heures, numeric arrondi à 2 décimales
-- (l'app affiche 1 décimale). Toutes les bornes en heure de Zurich.
--
--  * attendance_ranking(p_period, p_limit) : classement de régularité.
--    Appelant : compte actif (42501 sinon). Lignes : comptes actifs avec au
--    moins une présence ; prénom, nom, ceinture, nombre de présences
--    uniquement. Rang dense (5, 5, 2 → 1, 1, 2), tri sessions desc, nom,
--    prénom. p_period 'all' (toujours) ou 'year' (année civile en cours,
--    Europe/Zurich). p_limit (≥ 1, null = tous) : top N avec ex aequo —
--    les lignes dont le rang standard (rank()) est ≤ p_limit, donc tous les
--    ex aequo de la dernière place retenue sont gardés.
--  * my_ranking(p_period) : rang et nombre de présences de l'appelant (rang
--    null et 0 s'il n'a aucune présence sur la période).
--  * admin_teaching_hours(p_from, p_to) : heures d'enseignement par prof
--    (cours avec prof_id renseigné ; un open mat sans prof ne compte pour
--    personne). Dates Zurich, bornes incluses. Tri heures desc.
--  * admin_member_hours(p_from, p_to) : présences et heures par membre
--    (profils avec au moins une présence sur la période). Tri heures desc, nom.
--  * admin_member_segments() : une ligne par profil ; visits_total,
--    visits_90d (cours commencés depuis now() - 90 jours), segment
--    ('jamais' = 0, 'essai' = 1 au total, 'regulier' = ≥ 12 sur 90 jours,
--    sinon 'occasionnel'), last_visit (date Zurich de la dernière présence).
--  * Les admin_* : admin au compte actif (42501 sinon). anon : jamais.
--
-- HINTs stables : invalid_field (période inconnue, p_limit < 1, bornes nulles
-- ou inversées).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------
create index attendance_present_profile_idx on public.attendance (profile_id) where present;
create index courses_prof_starts_idx on public.courses (prof_id, starts_at);
-- couvert par courses_prof_starts_idx (colonne de tête)
drop index public.courses_prof_id_idx;

-- ---------------------------------------------------------------------------
-- Aides internes (non exposées)
-- ---------------------------------------------------------------------------
-- Début de la période du classement : 'all' → null, 'year' → 1er janvier 0 h
-- (Zurich) de l'année en cours ; sinon 22023 invalid_field.
create function public.stats_period_start(p_period text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p_period = 'all' then
    return null;
  elsif p_period = 'year' then
    return date_trunc('year', now(), 'Europe/Zurich');
  end if;
  raise exception 'stats: p_period must be all or year'
    using errcode = '22023', hint = 'invalid_field';
end;
$$;

-- Bornes [début, fin[ d'un intervalle de dates Zurich incluses.
create function public.stats_range(p_from date, p_to date, out r_from timestamptz, out r_to timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'stats: p_from and p_to are required and p_from <= p_to'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  r_from := p_from::timestamp at time zone 'Europe/Zurich';
  r_to := (p_to + 1)::timestamp at time zone 'Europe/Zurich';
end;
$$;

-- Présences qui comptent (cochées, cours non annulé déjà commencé), cours
-- commencés dans [p_from, p_to[ (null = sans borne).
create function public.counted_attendance(p_from timestamptz default null, p_to timestamptz default null)
returns table (profile_id uuid, course_id uuid, starts_at timestamptz, hours numeric)
language sql stable security definer set search_path = '' as $$
  select a.profile_id, c.id, c.starts_at,
         extract(epoch from c.ends_at - c.starts_at) / 3600
    from public.attendance a
    join public.courses c on c.id = a.course_id
   where a.present
     and c.status <> 'annule'
     and c.starts_at <= now()
     and (p_from is null or c.starts_at >= p_from)
     and (p_to is null or c.starts_at < p_to);
$$;

-- ---------------------------------------------------------------------------
-- Classement
-- ---------------------------------------------------------------------------
create function public.attendance_ranking(p_period text default 'all', p_limit int default null)
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
      window w as (order by s.n desc)
    )
    select r.dr, r.id, r.fn, r.ln, r.belt, r.n
      from r
     where p_limit is null or r.cut <= p_limit
     order by r.n desc, r.ln, r.fn, r.id;
end;
$$;

create function public.my_ranking(p_period text default 'all')
returns table (rank int, sessions int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rank int;
  v_sessions int;
begin
  if not public.current_account_active() then
    raise exception 'my_ranking: active account required' using errcode = '42501';
  end if;
  select r.rank, r.sessions into v_rank, v_sessions
    from public.attendance_ranking(p_period) r
   where r.profile_id = public.current_profile_id();
  return query select v_rank, coalesce(v_sessions, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Statistiques admin
-- ---------------------------------------------------------------------------
create function public.admin_teaching_hours(p_from date, p_to date)
returns table (prof_id uuid, first_name text, last_name text, courses int, hours numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r record;
begin
  if not (public.is_admin() and public.current_account_active()) then
    raise exception 'admin_teaching_hours: admin only' using errcode = '42501';
  end if;
  v_r := public.stats_range(p_from, p_to);
  return query
    select p.id, p.first_name, p.last_name, count(*)::int,
           round(sum(extract(epoch from c.ends_at - c.starts_at)) / 3600, 2)
      from public.courses c
      join public.profiles p on p.id = c.prof_id
     where c.status <> 'annule'
       and c.starts_at <= now()
       and c.starts_at >= v_r.r_from and c.starts_at < v_r.r_to
     group by p.id
     order by 5 desc, p.last_name, p.first_name, p.id;
end;
$$;

create function public.admin_member_hours(p_from date, p_to date)
returns table (profile_id uuid, first_name text, last_name text, sessions int, hours numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r record;
begin
  if not (public.is_admin() and public.current_account_active()) then
    raise exception 'admin_member_hours: admin only' using errcode = '42501';
  end if;
  v_r := public.stats_range(p_from, p_to);
  return query
    select p.id, p.first_name, p.last_name, count(*)::int, round(sum(ca.hours), 2)
      from public.counted_attendance(v_r.r_from, v_r.r_to) ca
      join public.profiles p on p.id = ca.profile_id
     group by p.id
     order by 5 desc, p.last_name, p.first_name, p.id;
end;
$$;

create function public.admin_member_segments()
returns table (profile_id uuid, visits_total int, visits_90d int, segment text, last_visit date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() and public.current_account_active()) then
    raise exception 'admin_member_segments: admin only' using errcode = '42501';
  end if;
  return query
    with v as (
      select ca.profile_id as pid,
             count(*)::int as total,
             (count(*) filter (where ca.starts_at >= now() - interval '90 days'))::int as recent,
             max(ca.starts_at) as last_at
        from public.counted_attendance() ca
       group by ca.profile_id
    )
    select p.id,
           coalesce(v.total, 0),
           coalesce(v.recent, 0),
           case
             when coalesce(v.total, 0) = 0 then 'jamais'
             when v.recent >= 12 then 'regulier'
             when v.total = 1 then 'essai'
             else 'occasionnel'
           end,
           (v.last_at at time zone 'Europe/Zurich')::date
      from public.profiles p
      left join v on v.pid = p.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
revoke all on function public.stats_period_start(text) from public, anon, authenticated;
revoke all on function public.stats_range(date, date) from public, anon, authenticated;
revoke all on function public.counted_attendance(timestamptz, timestamptz) from public, anon, authenticated;

revoke all on function public.attendance_ranking(text, int) from public, anon;
revoke all on function public.my_ranking(text) from public, anon;
revoke all on function public.admin_teaching_hours(date, date) from public, anon;
revoke all on function public.admin_member_hours(date, date) from public, anon;
revoke all on function public.admin_member_segments() from public, anon;

grant execute on function public.attendance_ranking(text, int) to authenticated;
grant execute on function public.my_ranking(text) to authenticated;
grant execute on function public.admin_teaching_hours(date, date) to authenticated;
grant execute on function public.admin_member_hours(date, date) to authenticated;
grant execute on function public.admin_member_segments() to authenticated;
