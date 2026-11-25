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
--   repeat_too_far, repeat_before_start, location_archived, invalid_prof,
--   missing_field, default_location_archived.
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
  name       text unique not null check (char_length(name) <= 60),
  address    text not null default '' check (char_length(address) <= 200),
  maps_url   text not null default '' check (maps_url = '' or maps_url ~ '^https://'),
  is_default bool not null default false,
  archived   bool not null default false,
  created_at timestamptz not null default now()
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
-- autres lieux. Le lieu par défaut ne peut pas être archivé.
-- ---------------------------------------------------------------------------
create function public.admin_upsert_location(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.locations;
  v_id uuid;
  v_default bool;
  v_archived bool;
begin
  if not public.is_admin() then
    raise exception 'admin_upsert_location: admin required' using errcode = '42501';
  end if;

  if p->>'id' is not null then
    select * into v_old from public.locations where id = (p->>'id')::uuid for update;
    if v_old.id is null then
      raise exception 'admin_upsert_location: location not found' using errcode = 'P0002';
    end if;
  elsif coalesce(p->>'name', '') = '' then
    raise exception 'admin_upsert_location: name is required'
      using errcode = '22023', hint = 'missing_field';
  end if;

  v_default := coalesce((p->>'is_default')::bool, v_old.is_default, false);
  v_archived := coalesce((p->>'archived')::bool, v_old.archived, false);
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
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_course(p, p_repeat_until) : crée un cours, ou une occurrence par
-- semaine de local_date à p_repeat_until inclus (dans une nouvelle série).
-- Clés de p : sport, level, local_date (YYYY-MM-DD), start_time (HH:MI),
-- end_time (HH:MI) obligatoires ; kind, is_private, location_id (défaut :
-- lieu par défaut), prof_id, places, price_member, price_non_member.
-- Limite de récurrence : prof → 31.12 de l'année courante (Europe/Zurich) ;
-- admin → local_date + 5 ans.
-- Retourne les id créés, dans l'ordre chronologique.
-- ---------------------------------------------------------------------------
create function public.create_course(p jsonb, p_repeat_until date default null) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  v_admin bool := public.is_admin();
  v_me uuid := public.current_profile_id();
  v_prof uuid;
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
  if coalesce((p->>'is_private')::bool, false) and not v_admin then
    raise exception 'create_course: only an admin can create a private course' using errcode = '42501';
  end if;

  -- prof du cours
  v_prof := (p->>'prof_id')::uuid;
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

  if p->>'sport' is null or p->>'level' is null or p->>'local_date' is null
     or p->>'start_time' is null or p->>'end_time' is null then
    raise exception 'create_course: sport, level, local_date, start_time and end_time are required'
      using errcode = '22023', hint = 'missing_field';
  end if;
  v_date := (p->>'local_date')::date;
  v_start := (p->>'start_time')::time;
  v_end := (p->>'end_time')::time;

  -- lieu
  if p->>'location_id' is null then
    select * into v_location from public.locations where is_default;
  else
    select * into v_location from public.locations where id = (p->>'location_id')::uuid;
  end if;
  if v_location.id is null then
    raise exception 'create_course: location not found' using errcode = 'P0002';
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
      else make_date(extract(year from now() at time zone 'Europe/Zurich')::int, 12, 31)
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
      v_series,
      (p->>'sport')::public.sport,
      (p->>'level')::public.course_level,
      coalesce((p->>'kind')::public.course_kind, 'normal'),
      coalesce((p->>'is_private')::bool, false),
      v_location.id,
      (d + v_start) at time zone 'Europe/Zurich',
      (d + v_end) at time zone 'Europe/Zurich',
      v_prof,
      coalesce((p->>'places')::int, 20),
      coalesce((p->>'price_member')::numeric, 0),
      coalesce((p->>'price_non_member')::numeric, 0),
      v_me
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
-- Droits d'exécution : jamais anon
-- ---------------------------------------------------------------------------
revoke all on function public.admin_upsert_location(jsonb) from public, anon;
revoke all on function public.create_course(jsonb, date) from public, anon;
grant execute on function public.admin_upsert_location(jsonb) to authenticated;
grant execute on function public.create_course(jsonb, date) to authenticated;
