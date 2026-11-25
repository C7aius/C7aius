-- =============================================================================
-- 0008_plan2_review_fixes : corrections de la revue finale du plan 2 (cours)
--
--  * courses.created_by / course_series.created_by : nullable, ON DELETE SET
--    NULL. Supprimer le compte d'un prof ou d'un admin qui a créé des cours
--    (Edge Function delete-account) ne bloque plus ; les cours restent. Un
--    cours sans créateur n'est plus modifiable / annulable que par un admin
--    (created_by = v_me est faux pour null).
--  * courses_reset_vacancy (trigger) : quand prof_id passe de non null à null
--    sur un cours à venir (y compris par ON DELETE SET NULL à la suppression
--    du profil du prof), vacancy_notified_at repasse à null : le créneau sera
--    de nouveau signalé par process_course_schedule.
--  * process_course_schedule : un cours privé vacant n'est signalé qu'aux
--    admins (les profs ne peuvent pas le prendre) ; une seule fois, comme les
--    autres (vacancy_notified_at).
--  * admin_set_role / admin_set_prof_status : un profil qui perd le droit de
--    donner des cours (n'est plus admin ni prof validé) est retiré de ses
--    cours à venir non annulés (prof_id = null, vacancy_notified_at = null).
--  * update_course : place, prix et fin > début (pour chaque cours de la
--    portée) vérifiés avant l'UPDATE → 22023 invalid_field (plus de 23514 brut,
--    que l'application traduirait en erreur de ceinture). Le lieu actuel du
--    cours ciblé, même archivé, est accepté (équivaut à « inchangé »).
--  * create_course : mêmes contrôles (fin > début, places, prix) → invalid_field.
--  * cancel_course : supprime aussi l'appel (attendance) des cours annulés
--    (l'appel est ouvert 30 min avant le début).
--  * locations : plus d'écriture directe (policies et grants INSERT / UPDATE /
--    DELETE retirés) ; tout passe par admin_upsert_location. Lecture inchangée.
--
-- HINTs stables : inchangés (invalid_field, location_archived, ...).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Créateur d'un cours / d'une série : ON DELETE SET NULL
-- ---------------------------------------------------------------------------
alter table public.courses alter column created_by drop not null;
alter table public.courses drop constraint courses_created_by_fkey;
alter table public.courses add constraint courses_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.course_series drop constraint course_series_created_by_fkey;
alter table public.course_series add constraint course_series_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

create index if not exists courses_created_by_idx on public.courses (created_by);
create index if not exists course_series_created_by_idx on public.course_series (created_by);

-- ---------------------------------------------------------------------------
-- 7. prof_id devient null sur un cours à venir → vacancy_notified_at = null
-- ---------------------------------------------------------------------------
create function public.courses_reset_vacancy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.prof_id is not null and new.prof_id is null and new.starts_at > now() then
    new.vacancy_notified_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.courses_reset_vacancy() from public, anon, authenticated;

create trigger courses_reset_vacancy
  before update of prof_id on public.courses
  for each row execute function public.courses_reset_vacancy();

-- ---------------------------------------------------------------------------
-- 6. Retire un profil de ses cours à venir (interne, non exposée)
-- ---------------------------------------------------------------------------
create function public.release_future_courses(p_profile uuid) returns void
language sql security definer set search_path = '' as $$
  update public.courses
     set prof_id = null,
         vacancy_notified_at = null
   where prof_id = p_profile
     and status <> 'annule'
     and starts_at > now();
$$;

revoke all on function public.release_future_courses(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. process_course_schedule : cours privé vacant → admins seulement
-- ---------------------------------------------------------------------------
create or replace function public.process_course_schedule() returns void
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
    returning id, is_private
  )
  insert into public.notification_outbox (profile_id, kind, course_id)
  select p.id, 'slot_vacant', v.id
    from vacant v
   cross join public.profiles p
   where p.auth_user_id is not null
     and (p.role = 'admin' or (p.role = 'prof' and p.prof_status = 'valide' and not v.is_private))
     and public.is_account_active(p);

  update public.courses
     set status = 'open_mat'
   where status = 'prevu'
     and prof_id is null
     and starts_at <= now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. admin_set_prof_status (0006) : un prof validé qui ne l'est plus (refuse,
-- en_attente) est retiré de ses cours à venir.
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
  if v_old = 'valide' and p_status is distinct from 'valide' then
    perform public.release_future_courses(p_profile);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. admin_set_role (0006) : un profil qui n'est plus admin ni prof validé
-- (ex. prof rétrogradé en élève) est retiré de ses cours à venir.
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
  if (v_target.role = 'admin' or (v_target.role = 'prof' and v_target.prof_status = 'valide'))
     and not (v_after.role = 'admin' or (v_after.role = 'prof' and v_after.prof_status = 'valide')) then
    perform public.release_future_courses(p_profile);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4, 5. update_course (0005) : contrôles explicites avant l'UPDATE ; le lieu
-- actuel (archivé) du cours ciblé est accepté.
-- ---------------------------------------------------------------------------
create or replace function public.update_course(p_course uuid, p jsonb, p_scope text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_admin bool := public.is_admin();
  v_me uuid := public.current_profile_id();
  v_c public.courses;
  v_sport public.sport;
  v_level public.course_level;
  v_kind public.course_kind;
  v_location_id uuid;
  v_location public.locations;
  v_start time;
  v_end time;
  v_places int;
  v_price_member numeric(8,2);
  v_price_non_member numeric(8,2);
  v_ids uuid[];
  v_past bool;
begin
  if not (v_admin or public.is_active_prof()) then
    raise exception 'update_course: active prof or admin required' using errcode = '42501';
  end if;

  if p_scope is null or p_scope not in ('one', 'following') then
    raise exception 'update_course: p_scope must be one or following'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or exists (
    select 1 from jsonb_object_keys(p) k
     where k not in ('sport', 'level', 'kind', 'location_id', 'start_time', 'end_time',
                     'places', 'price_member', 'price_non_member')
  ) then
    raise exception 'update_course: unknown or non-modifiable key'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'update_course: course not found' using errcode = 'P0002';
  end if;
  -- created_by null (créateur supprimé) : admin seulement
  if not v_admin and (v_c.created_by is distinct from v_me or v_c.is_private) then
    raise exception 'update_course: only the creator of a non-private course or an admin'
      using errcode = '42501';
  end if;
  if v_c.status = 'annule' then
    raise exception 'update_course: course is cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'update_course: course has already started'
      using errcode = '22023', hint = 'course_started';
  end if;

  begin
    if (p->>'start_time' is not null and (char_length(p->>'start_time') <> 5
          or p->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]'))
       or (p->>'end_time' is not null and (char_length(p->>'end_time') <> 5
          or p->>'end_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]')) then
      raise exception 'bad time format' using errcode = '22007';
    end if;
    v_start := (p->>'start_time')::time;
    v_end := (p->>'end_time')::time;
    v_sport := (p->>'sport')::public.sport;
    v_level := (p->>'level')::public.course_level;
    v_kind := (p->>'kind')::public.course_kind;
    v_location_id := (p->>'location_id')::uuid;
    v_places := (p->>'places')::int;
    v_price_member := (p->>'price_member')::numeric(8,2);
    v_price_non_member := (p->>'price_non_member')::numeric(8,2);
  exception when data_exception then
    raise exception 'update_course: invalid value (%)', sqlerrm
      using errcode = '22023', hint = 'invalid_field';
  end;

  if v_places is not null and v_places not between 1 and 100 then
    raise exception 'update_course: places must be between 1 and 100'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  if v_price_member < 0 or v_price_non_member < 0 then
    raise exception 'update_course: prices must be >= 0'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  if v_location_id is not null then
    select * into v_location from public.locations where id = v_location_id;
    if v_location.id is null then
      raise exception 'update_course: location not found' using errcode = 'P0002';
    end if;
    if v_location.archived then
      if v_location.id = v_c.location_id then
        -- lieu actuel (archivé depuis) renvoyé tel quel : chaque cours garde le sien
        v_location_id := null;
      else
        raise exception 'update_course: location is archived'
          using errcode = '22023', hint = 'location_archived';
      end if;
    end if;
  end if;

  -- fin après début, pour chaque cours de la portée (heures appliquées au jour local)
  if (v_start is not null or v_end is not null) and exists (
    select 1 from public.courses c
     where c.status <> 'annule'
       and (v_admin or (c.created_by = v_me and not c.is_private))
       and (c.id = v_c.id
            or (p_scope = 'following' and c.series_id = v_c.series_id and c.starts_at >= v_c.starts_at))
       and (case when v_end is null then c.ends_at
                 else ((c.starts_at at time zone 'Europe/Zurich')::date + v_end) at time zone 'Europe/Zurich' end)
           <= (case when v_start is null then c.starts_at
                    else ((c.starts_at at time zone 'Europe/Zurich')::date + v_start) at time zone 'Europe/Zurich' end)
  ) then
    raise exception 'update_course: end_time must be after start_time'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  with upd as (
    update public.courses c
       set sport            = coalesce(v_sport, c.sport),
           level            = coalesce(v_level, c.level),
           kind             = coalesce(v_kind, c.kind),
           location_id      = coalesce(v_location_id, c.location_id),
           starts_at        = case when v_start is null then c.starts_at
                                   else ((c.starts_at at time zone 'Europe/Zurich')::date + v_start)
                                        at time zone 'Europe/Zurich' end,
           ends_at          = case when v_end is null then c.ends_at
                                   else ((c.starts_at at time zone 'Europe/Zurich')::date + v_end)
                                        at time zone 'Europe/Zurich' end,
           places           = coalesce(v_places, c.places),
           price_member     = coalesce(v_price_member, c.price_member),
           price_non_member = coalesce(v_price_non_member, c.price_non_member)
     where c.status <> 'annule'
       and (v_admin or (c.created_by = v_me and not c.is_private))
       and (c.id = v_c.id
            or (p_scope = 'following' and c.series_id = v_c.series_id and c.starts_at >= v_c.starts_at))
    returning c.id, c.starts_at
  )
  select array_agg(id), coalesce(bool_or(starts_at <= now()), false)
    into v_ids, v_past
    from upd;
  if v_past then
    raise exception 'update_course: a course cannot be moved into the past'
      using errcode = '22023', hint = 'date_in_past';
  end if;
  return coalesce(cardinality(v_ids), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. cancel_course (0005) : supprime aussi l'appel des cours annulés.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_course(p_course uuid, p_scope text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_admin bool := public.is_admin();
  v_me uuid := public.current_profile_id();
  v_c public.courses;
  v_ids uuid[];
begin
  if not (v_admin or public.is_active_prof()) then
    raise exception 'cancel_course: active prof or admin required' using errcode = '42501';
  end if;

  if p_scope is null or p_scope not in ('one', 'following') then
    raise exception 'cancel_course: p_scope must be one or following'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'cancel_course: course not found' using errcode = 'P0002';
  end if;
  -- created_by null (créateur supprimé) : admin seulement
  if not v_admin and (v_c.created_by is distinct from v_me or v_c.is_private) then
    raise exception 'cancel_course: only the creator of a non-private course or an admin'
      using errcode = '42501';
  end if;
  if v_c.status = 'annule' then
    raise exception 'cancel_course: course is already cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'cancel_course: course has already started'
      using errcode = '22023', hint = 'course_started';
  end if;

  with upd as (
    update public.courses c
       set status = 'annule'
     where c.status <> 'annule'
       and c.starts_at > now()
       and (v_admin or (c.created_by = v_me and not c.is_private))
       and (c.id = v_c.id
            or (p_scope = 'following' and c.series_id = v_c.series_id and c.starts_at >= v_c.starts_at))
    returning c.id
  )
  select array_agg(id) into v_ids from upd;

  delete from public.attendance a
   where a.course_id = any (coalesce(v_ids, '{}'));

  perform public.notify_profile(b.profile_id, 'course_cancelled', b.course_id)
     from public.bookings b
    where b.course_id = any (coalesce(v_ids, '{}'))
      and b.cancelled_at is null;

  return coalesce(cardinality(v_ids), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. create_course (0005) : fin > début, places et prix → invalid_field.
-- ---------------------------------------------------------------------------
create or replace function public.create_course(p jsonb, p_repeat_until date default null) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  v_admin bool := public.is_admin();
  v_me uuid := public.current_profile_id();
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_sport public.sport;
  v_level public.course_level;
  v_kind public.course_kind;
  v_private bool;
  v_location_id uuid;
  v_prof uuid;
  v_places int;
  v_price_member numeric(8,2);
  v_price_non_member numeric(8,2);
  v_location public.locations;
  v_date date;
  v_start time;
  v_end time;
  v_limit date;
  v_series uuid;
  v_ids uuid[];
begin
  if not (v_admin or public.is_active_prof()) then
    raise exception 'create_course: active prof or admin required' using errcode = '42501';
  end if;

  if p->>'sport' is null or p->>'level' is null or p->>'local_date' is null
     or p->>'start_time' is null or p->>'end_time' is null then
    raise exception 'create_course: sport, level, local_date, start_time and end_time are required'
      using errcode = '22023', hint = 'missing_field';
  end if;

  -- lecture des valeurs : toute valeur illisible → invalid_field
  begin
    -- formats stricts YYYY-MM-DD et HH:MI (longueur fixe + motif ancré au début)
    if char_length(p->>'local_date') <> 10
       or p->>'local_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
       or char_length(p->>'start_time') <> 5
       or p->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]'
       or char_length(p->>'end_time') <> 5
       or p->>'end_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]' then
      raise exception 'bad date or time format' using errcode = '22007';
    end if;
    v_date := (p->>'local_date')::date;
    v_start := (p->>'start_time')::time;
    v_end := (p->>'end_time')::time;
    v_sport := (p->>'sport')::public.sport;
    v_level := (p->>'level')::public.course_level;
    v_kind := coalesce((p->>'kind')::public.course_kind, 'normal');
    v_private := coalesce((p->>'is_private')::bool, false);
    v_location_id := (p->>'location_id')::uuid;
    v_prof := (p->>'prof_id')::uuid;
    v_places := coalesce((p->>'places')::int, 20);
    v_price_member := coalesce((p->>'price_member')::numeric(8,2), 0);
    v_price_non_member := coalesce((p->>'price_non_member')::numeric(8,2), 0);
  exception when data_exception then
    raise exception 'create_course: invalid value (%)', sqlerrm
      using errcode = '22023', hint = 'invalid_field';
  end;

  -- contrôles explicites : jamais de 23514 brut (courses_ends_after_starts,
  -- places, prix) renvoyé par cette RPC
  if v_end <= v_start or v_places not between 1 and 100
     or v_price_member < 0 or v_price_non_member < 0 then
    raise exception 'create_course: end_time must be after start_time, places between 1 and 100, prices >= 0'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  if v_private and not v_admin then
    raise exception 'create_course: only an admin can create a private course' using errcode = '42501';
  end if;

  -- prof du cours
  if v_prof is null and not v_admin then
    v_prof := v_me;
  end if;
  if v_prof is not null and v_prof is distinct from v_me then
    if not v_admin then
      raise exception 'create_course: only an admin can assign another prof' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.profiles
       where id = v_prof
         and (role = 'admin' or (role = 'prof' and prof_status = 'valide'))
    ) then
      raise exception 'create_course: prof_id must be a validated prof or an admin'
        using errcode = '22023', hint = 'invalid_prof';
    end if;
  end if;

  -- date : pas dans le passé (admin : 7 jours au plus)
  if v_date < v_today - (case when v_admin then 7 else 0 end) then
    raise exception 'create_course: local_date is in the past'
      using errcode = '22023', hint = 'date_in_past';
  end if;

  -- lieu
  if v_location_id is null then
    select * into v_location from public.locations where is_default;
    if v_location.id is null then
      raise exception 'create_course: no default location'
        using errcode = '22023', hint = 'no_default_location';
    end if;
  else
    select * into v_location from public.locations where id = v_location_id;
    if v_location.id is null then
      raise exception 'create_course: location not found' using errcode = 'P0002';
    end if;
  end if;
  if v_location.archived then
    raise exception 'create_course: location is archived'
      using errcode = '22023', hint = 'location_archived';
  end if;

  -- récurrence
  if p_repeat_until is not null then
    if p_repeat_until < v_date then
      raise exception 'create_course: p_repeat_until is before local_date'
        using errcode = '22023', hint = 'repeat_before_start';
    end if;
    v_limit := case
      when v_admin then (v_date + interval '5 years')::date
      else make_date(extract(year from v_today)::int, 12, 31)
    end;
    if p_repeat_until > v_limit then
      raise exception 'create_course: p_repeat_until is too far'
        using errcode = '22023', hint = 'repeat_too_far';
    end if;
    insert into public.course_series (created_by) values (v_me) returning id into v_series;
  end if;

  with ins as (
    insert into public.courses (
      series_id, sport, level, kind, is_private, location_id, starts_at, ends_at,
      prof_id, places, price_member, price_non_member, created_by
    )
    select
      v_series, v_sport, v_level, v_kind, v_private, v_location.id,
      (d + v_start) at time zone 'Europe/Zurich',
      (d + v_end) at time zone 'Europe/Zurich',
      v_prof, v_places, v_price_member, v_price_non_member, v_me
    from (
      select g::date as d
        from generate_series(v_date::timestamp, coalesce(p_repeat_until, v_date)::timestamp, interval '1 week') g
    ) days
    returning id, starts_at
  )
  select array_agg(id order by starts_at) into v_ids from ins;
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. locations : écriture uniquement par admin_upsert_location
-- ---------------------------------------------------------------------------
drop policy locations_insert on public.locations;
drop policy locations_update on public.locations;
drop policy locations_delete on public.locations;
revoke insert, update, delete on public.locations from authenticated;
