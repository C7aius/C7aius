-- =============================================================================
-- 0005_courses : lieux, séries et cours ; création (récurrente) par RPC
--
--  * locations : lisibles par tout compte actif ; écriture admin seulement
--    (RLS) ; admin_upsert_location garantit un seul lieu par défaut.
--  * courses / course_series : lisibles par tout compte actif ; AUCUNE
--    écriture directe (pas de policy ni de grant d'écriture) : tout passe par
--    les RPC SECURITY DEFINER.
--  * create_course : les instants sont calculés en heure locale
--    Europe/Zurich, (local_date + start_time) at time zone 'Europe/Zurich',
--    donc un cours hebdomadaire reste à la même heure locale à travers les
--    changements d'heure.
--
-- HINTs stables (lus par l'application) :
--   repeat_too_far, repeat_before_start, date_in_past, location_archived,
--   no_default_location, invalid_prof, missing_field, invalid_field,
--   default_location_archived, default_required, course_started,
--   course_cancelled, slot_taken.
--
--  * bookings : créée ici (cancel_course notifie les inscriptions actives) ;
--    RLS activée SANS policy ni grant : policies, vue et RPC à la tâche 3.
--  * update_course / cancel_course / assign_prof / take_slot / leave_slot :
--    cancel_course écrit dans notification_outbox via notify_profile
--    (migration 0006) ; plpgsql résout ces noms à l'exécution.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.course_level as enum ('adulte', 'enfant');
create type public.course_kind as enum ('normal', 'competition');
create type public.course_status as enum ('prevu', 'open_mat', 'annule');

-- ---------------------------------------------------------------------------
-- Lieux
-- ---------------------------------------------------------------------------
create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null check (char_length(name) <= 60 and char_length(btrim(name)) > 0),
  address    text not null default '' check (char_length(address) <= 200),
  maps_url   text not null default '' check (maps_url = '' or maps_url ~ '^https://'),
  is_default bool not null default false,
  archived   bool not null default false,
  created_at timestamptz not null default now(),
  -- le lieu par défaut n'est jamais archivé (aussi pour un UPDATE admin direct)
  constraint locations_default_not_archived check (not (is_default and archived))
);

-- un seul lieu par défaut
create unique index locations_one_default_idx on public.locations (is_default) where is_default;

insert into public.locations (name, is_default) values
  ('Conthey', true),
  ('Sion', false),
  ('Martigny', false);

-- ---------------------------------------------------------------------------
-- Séries et cours
-- ---------------------------------------------------------------------------
create table public.course_series (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.courses (
  id                  uuid primary key default gen_random_uuid(),
  series_id           uuid null references public.course_series (id) on delete set null,
  sport               public.sport not null,
  level               public.course_level not null,
  kind                public.course_kind not null default 'normal',
  is_private          bool not null default false,
  location_id         uuid not null references public.locations (id),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  prof_id             uuid null references public.profiles (id) on delete set null,
  places              int not null default 20 check (places between 1 and 100),
  price_member        numeric(8,2) not null default 0 check (price_member >= 0),
  price_non_member    numeric(8,2) not null default 0 check (price_non_member >= 0),
  status              public.course_status not null default 'prevu',
  created_by          uuid not null references public.profiles (id),
  vacancy_notified_at timestamptz null,
  created_at          timestamptz not null default now(),
  constraint courses_ends_after_starts check (ends_at > starts_at)
);

create index courses_starts_at_idx on public.courses (starts_at);
create index courses_series_id_idx on public.courses (series_id);
create index courses_prof_id_idx on public.courses (prof_id);
create index courses_location_id_idx on public.courses (location_id);

-- ---------------------------------------------------------------------------
-- Inscriptions (policies, vue et RPC : tâche 3)
-- ---------------------------------------------------------------------------
create table public.bookings (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  booked_by    uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz null
);

-- une seule inscription active par profil et par cours
create unique index bookings_one_active_idx on public.bookings (course_id, profile_id)
  where cancelled_at is null;
create index bookings_profile_id_idx on public.bookings (profile_id);
create index bookings_booked_by_idx on public.bookings (booked_by);

alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.course_series enable row level security;
alter table public.courses enable row level security;

create policy locations_select on public.locations
  for select to authenticated
  using (public.current_account_active());

create policy locations_insert on public.locations
  for insert to authenticated
  with check (public.is_admin());

create policy locations_update on public.locations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy locations_delete on public.locations
  for delete to authenticated
  using (public.is_admin());

create policy course_series_select on public.course_series
  for select to authenticated
  using (public.current_account_active());

create policy courses_select on public.courses
  for select to authenticated
  using (public.current_account_active());

-- Pas de policy INSERT / UPDATE / DELETE sur courses et course_series.

revoke all on public.locations from anon, authenticated;
revoke all on public.course_series from anon, authenticated;
revoke all on public.courses from anon, authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select on public.course_series to authenticated;
grant select on public.courses to authenticated;

-- ---------------------------------------------------------------------------
-- admin_upsert_location(p) : crée (sans id) ou modifie (avec id) un lieu.
-- Clés : id, name, address, maps_url, is_default, archived. En modification,
-- une clé absente garde sa valeur. is_default = true retire le défaut des
-- autres lieux. Le lieu par défaut ne peut pas être archivé, et il reste
-- toujours un lieu par défaut. Valeur illisible → 22023 invalid_field.
-- ---------------------------------------------------------------------------
create function public.admin_upsert_location(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.locations;
  v_id uuid;
  v_in_id uuid;
  v_in_default bool;
  v_in_archived bool;
  v_default bool;
  v_archived bool;
begin
  if not public.is_admin() then
    raise exception 'admin_upsert_location: admin required' using errcode = '42501';
  end if;

  begin
    v_in_id := (p->>'id')::uuid;
    v_in_default := (p->>'is_default')::bool;
    v_in_archived := (p->>'archived')::bool;
  exception when data_exception then
    raise exception 'admin_upsert_location: invalid value (%)', sqlerrm
      using errcode = '22023', hint = 'invalid_field';
  end;

  -- sérialise les changements de lieu par défaut
  perform 1 from public.locations where is_default for update;

  if v_in_id is not null then
    select * into v_old from public.locations where id = v_in_id for update;
    if v_old.id is null then
      raise exception 'admin_upsert_location: location not found' using errcode = 'P0002';
    end if;
  elsif coalesce(btrim(p->>'name'), '') = '' then
    raise exception 'admin_upsert_location: name is required'
      using errcode = '22023', hint = 'missing_field';
  end if;

  v_default := coalesce(v_in_default, v_old.is_default, false);
  v_archived := coalesce(v_in_archived, v_old.archived, false);
  if v_default and v_archived then
    raise exception 'admin_upsert_location: the default location cannot be archived'
      using errcode = '22023', hint = 'default_location_archived';
  end if;

  if v_default then
    update public.locations set is_default = false
     where is_default and id is distinct from v_old.id;
  end if;

  if v_old.id is null then
    insert into public.locations (name, address, maps_url, is_default, archived)
    values (p->>'name', coalesce(p->>'address', ''), coalesce(p->>'maps_url', ''), v_default, v_archived)
    returning id into v_id;
  else
    update public.locations
       set name       = coalesce(p->>'name', v_old.name),
           address    = coalesce(p->>'address', v_old.address),
           maps_url   = coalesce(p->>'maps_url', v_old.maps_url),
           is_default = v_default,
           archived   = v_archived
     where id = v_old.id
    returning id into v_id;
  end if;

  if not exists (select 1 from public.locations where is_default) then
    raise exception 'admin_upsert_location: a default location is required'
      using errcode = '22023', hint = 'default_required';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_course(p, p_repeat_until) : crée un cours, ou une occurrence par
-- semaine de local_date à p_repeat_until inclus (dans une nouvelle série).
-- Clés de p : sport, level, local_date (YYYY-MM-DD), start_time (HH:MI),
-- end_time (HH:MI) obligatoires ; kind, is_private, location_id (défaut :
-- lieu par défaut), prof_id, places, price_member, price_non_member.
-- Dates (Europe/Zurich) : prof → local_date ≥ aujourd'hui ; admin → au plus
-- 7 jours dans le passé (date_in_past).
-- Limite de récurrence : prof → 31.12 de l'année courante ; admin →
-- local_date + 5 ans (repeat_too_far).
-- Valeur illisible ou mal formée → 22023 invalid_field.
-- Retourne les id créés, dans l'ordre chronologique.
-- ---------------------------------------------------------------------------
create function public.create_course(p jsonb, p_repeat_until date default null) returns uuid[]
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
-- Portée commune à update_course et cancel_course :
--   'one'       : le cours ciblé ;
--   'following' : les cours de la même série dont starts_at >= celui du cours
--                 ciblé (le cours ciblé compris) ; les cours annulés sont
--                 toujours exclus. Le cours ciblé n'étant pas commencé, la
--                 portée ne contient jamais de cours passé.
-- Droits : admin, ou prof actif créateur d'un cours non privé.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- update_course(p_course, p, p_scope) : modifie le cours ciblé (ou la suite
-- de sa série). Clés de p (toutes facultatives, une clé absente ou null garde
-- la valeur de chaque cours) : sport, level, kind, location_id,
-- start_time (HH:MI), end_time (HH:MI), places, price_member,
-- price_non_member. Les heures sont appliquées en Europe/Zurich au jour local
-- de chaque cours. Autre clé, valeur illisible ou portée inconnue → 22023
-- invalid_field. Cours commencé → course_started ; cours ciblé annulé →
-- course_cancelled ; un cours ne peut pas être déplacé dans le passé
-- (date_in_past). Retourne le nombre de cours modifiés.
-- ---------------------------------------------------------------------------
create function public.update_course(p_course uuid, p jsonb, p_scope text) returns int
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

  if v_location_id is not null then
    select * into v_location from public.locations where id = v_location_id;
    if v_location.id is null then
      raise exception 'update_course: location not found' using errcode = 'P0002';
    end if;
    if v_location.archived then
      raise exception 'update_course: location is archived'
        using errcode = '22023', hint = 'location_archived';
    end if;
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
-- cancel_course(p_course, p_scope) : met status = 'annule' sur les cours de
-- la portée non encore annulés et écrit une notification course_cancelled
-- par inscription active de chaque cours annulé (notify_profile : un enfant
-- sans login → son parent). Les inscriptions elles-mêmes ne sont pas
-- modifiées. Cours ciblé annulé → course_cancelled ; commencé →
-- course_started. Retourne le nombre de cours annulés par cet appel.
-- ---------------------------------------------------------------------------
create function public.cancel_course(p_course uuid, p_scope text) returns int
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

  perform public.notify_profile(b.profile_id, 'course_cancelled', b.course_id)
     from public.bookings b
    where b.course_id = any (coalesce(v_ids, '{}'))
      and b.cancelled_at is null;

  return coalesce(cardinality(v_ids), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- assign_prof(p_course, p_prof) : admin seulement. p_prof null libère le
-- créneau. La cible doit être un prof validé ou un admin (invalid_prof).
-- Cours annulé → course_cancelled ; commencé → course_started.
-- Remet vacancy_notified_at à null ; un open mat qui reçoit un prof repasse
-- à prevu (comme take_slot).
-- ---------------------------------------------------------------------------
create function public.assign_prof(p_course uuid, p_prof uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.courses;
begin
  if not public.is_admin() then
    raise exception 'assign_prof: admin required' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'assign_prof: course not found' using errcode = 'P0002';
  end if;
  if v_c.status = 'annule' then
    raise exception 'assign_prof: course is cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'assign_prof: course has already started'
      using errcode = '22023', hint = 'course_started';
  end if;

  if p_prof is not null and not exists (
    select 1 from public.profiles
     where id = p_prof
       and (role = 'admin' or (role = 'prof' and prof_status = 'valide'))
  ) then
    raise exception 'assign_prof: p_prof must be a validated prof or an admin'
      using errcode = '22023', hint = 'invalid_prof';
  end if;

  update public.courses
     set prof_id = p_prof,
         vacancy_notified_at = null,
         status = case when p_prof is not null and status = 'open_mat' then 'prevu'::public.course_status
                       else status end
   where id = p_course;
end;
$$;

-- ---------------------------------------------------------------------------
-- take_slot(p_course) : un prof actif prend un créneau vacant (prof_id null)
-- d'un cours non privé, prevu ou open_mat, pas commencé. Atomique : l'UPDATE
-- ne réussit que si prof_id est encore null ; sinon 22023 slot_taken. Un
-- open mat repasse à prevu.
-- ---------------------------------------------------------------------------
create function public.take_slot(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_c public.courses;
  v_id uuid;
begin
  if not public.is_active_prof() then
    raise exception 'take_slot: active prof required' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course;
  if v_c.id is null then
    raise exception 'take_slot: course not found' using errcode = 'P0002';
  end if;
  if v_c.is_private then
    raise exception 'take_slot: private course' using errcode = '42501';
  end if;
  if v_c.status = 'annule' then
    raise exception 'take_slot: course is cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'take_slot: course has already started'
      using errcode = '22023', hint = 'course_started';
  end if;

  update public.courses
     set prof_id = v_me,
         vacancy_notified_at = null,
         status = case when status = 'open_mat' then 'prevu'::public.course_status else status end
   where id = p_course
     and prof_id is null
     and status in ('prevu', 'open_mat')
     and not is_private
     and starts_at > now()
  returning id into v_id;

  if v_id is null then
    raise exception 'take_slot: slot already taken'
      using errcode = '22023', hint = 'slot_taken';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- leave_slot(p_course) : le prof assigné (compte actif) quitte un cours non
-- privé pas commencé ; prof_id et vacancy_notified_at repassent à null. Le
-- prof d'un cours privé n'est géré que par l'admin (assign_prof).
-- ---------------------------------------------------------------------------
create function public.leave_slot(p_course uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_c public.courses;
begin
  if v_me is null or not public.current_account_active() then
    raise exception 'leave_slot: active account required' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'leave_slot: course not found' using errcode = 'P0002';
  end if;
  if v_c.prof_id is distinct from v_me then
    raise exception 'leave_slot: only the assigned prof' using errcode = '42501';
  end if;
  if v_c.is_private then
    raise exception 'leave_slot: private course (admin only)' using errcode = '42501';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'leave_slot: course has already started'
      using errcode = '22023', hint = 'course_started';
  end if;

  update public.courses
     set prof_id = null,
         vacancy_notified_at = null
   where id = p_course;
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution : jamais anon
-- ---------------------------------------------------------------------------
revoke all on function public.admin_upsert_location(jsonb) from public, anon;
revoke all on function public.create_course(jsonb, date) from public, anon;
grant execute on function public.admin_upsert_location(jsonb) to authenticated;
grant execute on function public.create_course(jsonb, date) to authenticated;
revoke all on function public.update_course(uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_course(uuid, text) from public, anon;
revoke all on function public.assign_prof(uuid, uuid) from public, anon;
revoke all on function public.take_slot(uuid) from public, anon;
revoke all on function public.leave_slot(uuid) from public, anon;
grant execute on function public.update_course(uuid, jsonb, text) to authenticated;
grant execute on function public.cancel_course(uuid, text) to authenticated;
grant execute on function public.assign_prof(uuid, uuid) to authenticated;
grant execute on function public.take_slot(uuid) to authenticated;
grant execute on function public.leave_slot(uuid) to authenticated;
