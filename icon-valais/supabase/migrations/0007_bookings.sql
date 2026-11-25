-- =============================================================================
-- 0007_bookings : réservations (bookings, table créée en 0005) et appel
--
--  * bookings / attendance : lecture par RLS, AUCUNE écriture directe (pas de
--    policy ni de grant d'écriture) : tout passe par les RPC SECURITY DEFINER.
--      - bookings   : ses réservations et celles de ses enfants ; toutes
--                     celles du cours pour le prof assigné et l'admin.
--      - attendance : sa présence et celle de ses enfants ; tout l'appel du
--                     cours pour le prof assigné et l'admin.
--    Lecture réservée aux comptes actifs (comme courses).
--  * course_booking_counts : nombre de réservations actives par cours, sans
--    nom ; vide pour un compte inactif (même garde que public_profiles).
--  * Les places sont indicatives : une réservation n'est jamais refusée faute
--    de place.
--  * Doublons : l'index unique partiel bookings_one_active_idx (0005) +
--    INSERT ... ON CONFLICT DO NOTHING ; sous concurrence, le second appel
--    attend le premier puis relit la réservation existante.
--  * book / unbook / set_attendance prennent un verrou FOR SHARE sur le cours :
--    sérialisés avec cancel_course (FOR UPDATE), une réservation est soit
--    refusée (cours annulé), soit vue et notifiée par cancel_course.
--  * « Enfant » : profil avec parent_profile_id = l'appelant et sans login.
--  * Invariant : toute ligne d'appel a une réservation active (set_attendance
--    crée la réservation d'un présent non inscrit ; unbook_course retire la
--    ligne d'appel).
--
-- HINTs stables (lus par l'application) :
--   course_closed, too_early, not_booked, missing_field, course_cancelled.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Appel
-- ---------------------------------------------------------------------------
create table public.attendance (
  course_id  uuid not null references public.courses (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  present    bool not null,
  marked_by  uuid null references public.profiles (id) on delete set null,
  marked_at  timestamptz not null default now(),
  primary key (course_id, profile_id)
);

create index attendance_profile_id_idx on public.attendance (profile_id);
create index attendance_marked_by_idx on public.attendance (marked_by);
create index bookings_course_id_idx on public.bookings (course_id);

alter table public.attendance enable row level security;

-- ---------------------------------------------------------------------------
-- Fonctions d'aide (SECURITY DEFINER : pas de récursion RLS)
-- ---------------------------------------------------------------------------
-- p_profile est-il l'appelant ou un de ses enfants (sans login) ?
create function public.is_self_or_child(p_profile uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.id = me.id or (p.parent_profile_id = me.id and p.auth_user_id is null)
       from public.profiles p, public.profiles me
      where p.id = p_profile and me.auth_user_id = auth.uid()),
    false);
$$;

-- l'appelant est-il l'admin, ou le prof assigné (compte actif) du cours ?
create function public.is_course_staff(p_course uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (
    public.current_account_active()
    and exists (select 1 from public.courses
                 where id = p_course and prof_id = public.current_profile_id())
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS : lecture seule
-- ---------------------------------------------------------------------------
create policy bookings_select on public.bookings
  for select to authenticated
  using (
    public.current_account_active()
    and (public.is_self_or_child(profile_id) or public.is_course_staff(course_id))
  );

create policy attendance_select on public.attendance
  for select to authenticated
  using (
    public.current_account_active()
    and (public.is_self_or_child(profile_id) or public.is_course_staff(course_id))
  );

-- Pas de policy INSERT / UPDATE / DELETE sur bookings et attendance.

revoke all on public.bookings from anon, authenticated;
revoke all on public.attendance from anon, authenticated;
grant select on public.bookings to authenticated;
grant select on public.attendance to authenticated;

-- ---------------------------------------------------------------------------
-- course_booking_counts : réservations actives par cours, sans nom
-- ---------------------------------------------------------------------------
create view public.course_booking_counts as
  select
    c.id as course_id,
    (select count(*) from public.bookings b
      where b.course_id = c.id and b.cancelled_at is null)::int as booked
  from public.courses c
  where public.current_account_active();

revoke all on public.course_booking_counts from anon, authenticated;
grant select on public.course_booking_counts to authenticated;

-- ---------------------------------------------------------------------------
-- book_course(p_course, p_profile) : réserve pour soi (p_profile null ou soi)
-- ou pour un de ses enfants. Cours annulé ou commencé → 22023 course_closed.
-- Déjà réservé → renvoie la réservation existante. booked_by = l'appelant.
-- ---------------------------------------------------------------------------
create function public.book_course(p_course uuid, p_profile uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_profile uuid;
  v_c public.courses;
  v_id uuid;
begin
  if v_me is null or not public.current_account_active() then
    raise exception 'book_course: active account required' using errcode = '42501';
  end if;
  v_profile := coalesce(p_profile, v_me);
  if not public.is_self_or_child(v_profile) then
    raise exception 'book_course: only for yourself or your children' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course for share;
  if v_c.id is null then
    raise exception 'book_course: course not found' using errcode = 'P0002';
  end if;
  if v_c.status = 'annule' or v_c.starts_at <= now() then
    raise exception 'book_course: course is cancelled or has started'
      using errcode = '22023', hint = 'course_closed';
  end if;

  insert into public.bookings (course_id, profile_id, booked_by)
  values (p_course, v_profile, v_me)
  on conflict (course_id, profile_id) where cancelled_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.bookings
     where course_id = p_course and profile_id = v_profile and cancelled_at is null;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- unbook_course(p_course, p_profile) : mêmes règles de propriété ; annule la
-- réservation active (cancelled_at = now()) et retire la ligne d'appel
-- éventuelle. Sans réservation active : sans effet. Cours commencé → 22023
-- course_closed (un cours annulé peut être quitté).
-- ---------------------------------------------------------------------------
create function public.unbook_course(p_course uuid, p_profile uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_profile uuid;
  v_c public.courses;
begin
  if v_me is null or not public.current_account_active() then
    raise exception 'unbook_course: active account required' using errcode = '42501';
  end if;
  v_profile := coalesce(p_profile, v_me);
  if not public.is_self_or_child(v_profile) then
    raise exception 'unbook_course: only for yourself or your children' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course for share;
  if v_c.id is null then
    raise exception 'unbook_course: course not found' using errcode = 'P0002';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'unbook_course: course has started'
      using errcode = '22023', hint = 'course_closed';
  end if;

  update public.bookings set cancelled_at = now()
   where course_id = p_course and profile_id = v_profile and cancelled_at is null;
  delete from public.attendance where course_id = p_course and profile_id = v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- course_participants(p_course) : prof assigné ou admin. Réservations
-- actives, avec âge, ceinture et présence (null : pas encore coché).
-- ---------------------------------------------------------------------------
create function public.course_participants(p_course uuid)
returns table (profile_id uuid, first_name text, last_name text, age int, bjj_belt public.belt, present bool)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() or public.is_active_prof()) then
    raise exception 'course_participants: assigned prof or admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courses where id = p_course) then
    raise exception 'course_participants: course not found' using errcode = 'P0002';
  end if;
  if not public.is_course_staff(p_course) then
    raise exception 'course_participants: assigned prof or admin required' using errcode = '42501';
  end if;

  return query
    select p.id, p.first_name, p.last_name, p.age, p.bjj_belt, a.present
      from public.bookings b
      join public.profiles p on p.id = b.profile_id
      left join public.attendance a on a.course_id = b.course_id and a.profile_id = b.profile_id
     where b.course_id = p_course and b.cancelled_at is null
     order by p.last_name, p.first_name, p.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_attendance(p_course, p_profile, p_present) : prof assigné ou admin, à
-- partir de starts_at - 30 min (avant → 22023 too_early), sans limite de fin
-- (corrections après le cours). Cours annulé → course_cancelled. Présent non
-- inscrit : la réservation est créée (booked_by = l'appelant) ; absent non
-- inscrit → 22023 not_booked. p_present null → 22023 missing_field.
-- ---------------------------------------------------------------------------
create function public.set_attendance(p_course uuid, p_profile uuid, p_present bool) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_c public.courses;
begin
  if not (public.is_admin() or public.is_active_prof()) then
    raise exception 'set_attendance: assigned prof or admin required' using errcode = '42501';
  end if;
  if p_present is null then
    raise exception 'set_attendance: p_present is required'
      using errcode = '22023', hint = 'missing_field';
  end if;

  select * into v_c from public.courses where id = p_course for share;
  if v_c.id is null then
    raise exception 'set_attendance: course not found' using errcode = 'P0002';
  end if;
  if not public.is_course_staff(p_course) then
    raise exception 'set_attendance: assigned prof or admin required' using errcode = '42501';
  end if;
  if v_c.status = 'annule' then
    raise exception 'set_attendance: course is cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if now() < v_c.starts_at - interval '30 minutes' then
    raise exception 'set_attendance: too early'
      using errcode = '22023', hint = 'too_early';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'set_attendance: profile not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.bookings
                  where course_id = p_course and profile_id = p_profile and cancelled_at is null) then
    if not p_present then
      raise exception 'set_attendance: not booked'
        using errcode = '22023', hint = 'not_booked';
    end if;
    insert into public.bookings (course_id, profile_id, booked_by)
    values (p_course, p_profile, v_me)
    on conflict (course_id, profile_id) where cancelled_at is null do nothing;
  end if;

  insert into public.attendance (course_id, profile_id, present, marked_by, marked_at)
  values (p_course, p_profile, p_present, v_me, now())
  on conflict (course_id, profile_id) do update
    set present = excluded.present, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution : jamais anon
-- ---------------------------------------------------------------------------
revoke all on function public.is_self_or_child(uuid) from public, anon;
revoke all on function public.is_course_staff(uuid) from public, anon;
revoke all on function public.book_course(uuid, uuid) from public, anon;
revoke all on function public.unbook_course(uuid, uuid) from public, anon;
revoke all on function public.course_participants(uuid) from public, anon;
revoke all on function public.set_attendance(uuid, uuid, bool) from public, anon;
grant execute on function public.is_self_or_child(uuid) to authenticated;
grant execute on function public.is_course_staff(uuid) to authenticated;
grant execute on function public.book_course(uuid, uuid) to authenticated;
grant execute on function public.unbook_course(uuid, uuid) to authenticated;
grant execute on function public.course_participants(uuid) to authenticated;
grant execute on function public.set_attendance(uuid, uuid, bool) to authenticated;
