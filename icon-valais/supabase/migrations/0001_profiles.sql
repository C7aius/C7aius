-- =============================================================================
-- 0001_profiles : profils, droits (RLS), RPC admin
--
-- Toutes les règles de droits sont appliquées ici, côté base.
-- Les valeurs des enums correspondent exactement aux unions TS de
-- src/domain/types.ts (Sport, Role, ProfStatus, Belt).
--
-- Mécanisme de protection des colonnes sensibles : le trigger
-- protect_profile_columns refuse la modification de ces colonnes lorsque la
-- requête s'exécute sous un rôle client (anon / authenticated) et que
-- l'appelant n'est pas admin. Les RPC ci-dessous sont SECURITY DEFINER
-- (propriétaire postgres) : à l'intérieur, current_user = postgres, donc le
-- trigger les laisse passer. Aucun paramètre de session n'est utilisé : un
-- client ne peut donc pas contourner la protection avec set_config(), et il ne
-- peut pas changer current_user (pas de SET ROLE via l'API).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('eleve', 'prof', 'admin');
create type public.prof_status as enum ('en_attente', 'valide', 'refuse');
create type public.sport as enum ('jjb', 'grappling', 'mma');
create type public.belt as enum (
  'blanche', 'grise', 'jaune', 'orange', 'verte',
  'bleue', 'violette', 'marron', 'noire'
);
create type public.student_status as enum ('aucun', 'en_attente', 'valide', 'refuse');
create type public.lang as enum ('fr', 'de', 'en', 'ru');

-- ---------------------------------------------------------------------------
-- Table profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique null references auth.users (id) on delete cascade,
  parent_profile_id  uuid null references public.profiles (id) on delete cascade,
  role               public.user_role not null default 'eleve',
  prof_status        public.prof_status null,
  first_name         text not null,
  last_name          text not null,
  email              text null,
  phone              text null,
  age                int not null check (age between 0 and 100),
  sports             public.sport[] not null,
  bjj_belt           public.belt null,
  years_grappling    int null check (years_grappling >= 0),
  years_mma          int null check (years_mma >= 0),
  coach_years        int null check (coach_years >= 0),
  training_places    text null,
  competition_awards text null,
  cv                 text null,
  is_student         bool not null default false,
  student_status     public.student_status not null default 'aucun',
  paid_until         date null,
  parent_email       text null,
  parent_consent_at  timestamptz null,
  language           public.lang not null default 'fr',
  created_at         timestamptz not null default now(),
  -- un profil a soit un login, soit un parent (profil enfant sans login)
  constraint profiles_login_or_parent check (auth_user_id is not null or parent_profile_id is not null),
  -- ceintures enfant (grise, jaune, orange, verte) réservées aux moins de 18 ans
  -- (même règle que beltOptions() dans src/domain/belts.ts) ; s'applique à
  -- l'inscription, à set_belt, à create_child_profile et aux changements d'âge.
  constraint profiles_kid_belt_age check (
    bjj_belt is null or age < 18 or bjj_belt not in ('grise', 'jaune', 'orange', 'verte')
  )
);

create index profiles_parent_profile_id_idx on public.profiles (parent_profile_id);

-- ---------------------------------------------------------------------------
-- Fonctions d'aide (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------------
create function public.current_profile_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where auth_user_id = auth.uid();
$$;

create function public.is_admin() returns bool
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role = 'admin' from public.profiles where auth_user_id = auth.uid()),
    false);
$$;

create function public.is_active_prof() returns bool
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select role = 'prof' and prof_status = 'valide'
       from public.profiles where auth_user_id = auth.uid()),
    false);
$$;

-- Compte actif ?
--  * profil enfant créé par un parent : toujours actif (pas de consentement)
--  * prof : uniquement si prof_status = 'valide'
--  * moins de 16 ans inscrit seul : uniquement après consentement parental
-- Utilisable comme colonne calculée PostgREST : profiles?select=*,is_account_active
create function public.is_account_active(p public.profiles) returns bool
language sql stable set search_path = '' as $$
  select case
    when p.parent_profile_id is not null then true
    when p.role = 'prof' and p.prof_status is distinct from 'valide' then false
    when p.age < 16 and p.parent_consent_at is null then false
    else true
  end;
$$;

-- Le compte de l'appelant est-il actif ? (false sans profil)
create function public.current_account_active() returns bool
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select public.is_account_active(p) from public.profiles p where p.auth_user_id = auth.uid()),
    false);
$$;

-- ---------------------------------------------------------------------------
-- Trigger handle_new_user : crée le profil à la création d'un auth.users
--
-- Clés lues dans raw_user_meta_data (envoyées par l'inscription, tâche 5) :
--   first_name text, last_name text, age int (obligatoire),
--   sports text[] ('jjb'|'grappling'|'mma'), bjj_belt text (enum belt),
--   years_grappling int, years_mma int, coach_years int,
--   training_places text, competition_awards text, cv text,
--   phone text, parent_email text,
--   role text ('eleve'|'prof' ; 'admin' ou autre → 'eleve'),
--   language text ('fr'|'de'|'en'|'ru', défaut 'fr').
-- Jamais lues : prof_status, paid_until, student_status, parent_consent_at.
-- email provient de auth.users.email.
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role public.user_role := case when m->>'role' = 'prof' then 'prof' else 'eleve' end;
begin
  if m->>'age' is null then
    raise exception 'handle_new_user: metadata "age" is required' using errcode = '22023';
  end if;

  insert into public.profiles (
    auth_user_id, role, prof_status, first_name, last_name, email, phone, age,
    sports, bjj_belt, years_grappling, years_mma, coach_years, training_places,
    competition_awards, cv, parent_email, language
  ) values (
    new.id,
    v_role,
    case when v_role = 'prof' then 'en_attente'::public.prof_status end,
    coalesce(m->>'first_name', ''),
    coalesce(m->>'last_name', ''),
    new.email,
    m->>'phone',
    (m->>'age')::int,
    coalesce(
      array(select jsonb_array_elements_text(coalesce(m->'sports', '[]'::jsonb)))::public.sport[],
      '{}'),
    (m->>'bjj_belt')::public.belt,
    (m->>'years_grappling')::int,
    (m->>'years_mma')::int,
    (m->>'coach_years')::int,
    m->>'training_places',
    m->>'competition_awards',
    m->>'cv',
    m->>'parent_email',
    coalesce((m->>'language')::public.lang, 'fr')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trigger protect_profile_columns (SECURITY INVOKER : current_user = appelant)
-- ---------------------------------------------------------------------------
create function public.protect_profile_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Rôles serveur (postgres via les RPC SECURITY DEFINER, service_role, ...) : autorisé.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.role              is distinct from old.role
  or new.prof_status       is distinct from old.prof_status
  or new.paid_until        is distinct from old.paid_until
  or new.student_status    is distinct from old.student_status
  or new.parent_consent_at is distinct from old.parent_consent_at
  or new.bjj_belt          is distinct from old.bjj_belt
  or new.id                is distinct from old.id
  or new.auth_user_id      is distinct from old.auth_user_id
  or new.parent_profile_id is distinct from old.parent_profile_id
  or new.email             is distinct from old.email
  or new.created_at        is distinct from old.created_at
  then
    raise exception 'protected profile column' using errcode = '42501';
  end if;
  -- un mineur inscrit seul, sans consentement parental, ne peut pas
  -- contourner le consentement en se déclarant âgé de 16 ans ou plus
  if old.parent_profile_id is null and old.age < 16 and old.parent_consent_at is null
     and new.age >= 16 then
    raise exception 'age change requires parental consent' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- lecture : son profil, ses enfants ; admin : tout
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or parent_profile_id = public.current_profile_id()
    or public.is_admin()
  );

-- modification : son profil, ses enfants ; admin : tout
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    auth_user_id = auth.uid()
    or parent_profile_id = public.current_profile_id()
    or public.is_admin()
  )
  with check (
    auth_user_id = auth.uid()
    or parent_profile_id = public.current_profile_id()
    or public.is_admin()
  );

-- suppression : ses enfants ; admin : tout.
-- (Suppression de son propre compte : Edge Function delete-account, tâche 4.)
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (
    parent_profile_id = public.current_profile_id()
    or public.is_admin()
  );

-- Pas de policy INSERT : les profils sont créés par handle_new_user et
-- create_child_profile uniquement.

revoke all on public.profiles from anon, authenticated;
grant select, update, delete on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Vue publique (propriétaire postgres, sans security_invoker : contourne la
-- RLS volontairement et n'expose que des colonnes non sensibles).
-- Vide si le compte de l'appelant n'est pas actif (prof en attente, mineur
-- sans consentement). display_role = 'prof' seulement pour l'admin et les
-- profs validés.
-- ---------------------------------------------------------------------------
create view public.public_profiles as
  select
    id,
    first_name,
    last_name,
    bjj_belt,
    sports,
    (case
       when role = 'admin' or (role = 'prof' and prof_status = 'valide') then 'prof'
       else 'eleve'
     end)::text as display_role
  from public.profiles
  where public.current_account_active();

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- RPC (SECURITY DEFINER, vérifient l'appelant)
-- ---------------------------------------------------------------------------
create function public.set_belt(p_profile uuid, p_belt public.belt) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_active_prof() or public.is_admin()) then
    raise exception 'set_belt: active prof or admin required' using errcode = '42501';
  end if;
  if p_profile = public.current_profile_id() and not public.is_admin() then
    raise exception 'set_belt: a prof cannot set their own belt' using errcode = '42501';
  end if;
  update public.profiles set bjj_belt = p_belt where id = p_profile;
  if not found then
    raise exception 'set_belt: profile not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.admin_set_prof_status(p_profile uuid, p_status public.prof_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin_set_prof_status: admin required' using errcode = '42501';
  end if;
  update public.profiles set prof_status = p_status
   where id = p_profile and role = 'prof';
  if not found then
    raise exception 'admin_set_prof_status: prof profile not found' using errcode = 'P0002';
  end if;
end;
$$;

-- prof ↔ élève (ou admin). Passage à prof par l'admin = prof validé.
create function public.admin_set_role(p_profile uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin_set_role: admin required' using errcode = '42501';
  end if;
  update public.profiles
     set role = p_role,
         prof_status = case
           when p_role = 'prof' then coalesce(prof_status, 'valide')
           when p_role = 'eleve' then null
           else prof_status
         end
   where id = p_profile;
  if not found then
    raise exception 'admin_set_role: profile not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.admin_mark_paid_current_year(p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin_mark_paid_current_year: admin required' using errcode = '42501';
  end if;
  update public.profiles
     set paid_until = make_date(extract(year from now() at time zone 'Europe/Zurich')::int, 12, 31)
   where id = p_profile;
  if not found then
    raise exception 'admin_mark_paid_current_year: profile not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Crée un profil enfant (sans login) rattaché à l'appelant, qui doit être
-- majeur (sinon un mineur sans consentement contournerait le consentement)
-- et dont le compte doit être actif.
-- Clés lues dans p : first_name, last_name, age (obligatoires), sports,
-- bjj_belt, years_grappling, years_mma, phone, language.
-- Le rôle est toujours 'eleve' ; les colonnes protégées ne sont jamais lues.
create function public.create_child_profile(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.profiles;
  v_id uuid;
begin
  select * into v_parent from public.profiles where auth_user_id = auth.uid();
  if v_parent.id is null or v_parent.age < 18 then
    raise exception 'create_child_profile: adult account required' using errcode = '42501';
  end if;
  if not public.is_account_active(v_parent) then
    raise exception 'create_child_profile: active account required' using errcode = '42501';
  end if;
  if coalesce(p->>'first_name', '') = '' or coalesce(p->>'last_name', '') = '' or p->>'age' is null then
    raise exception 'create_child_profile: first_name, last_name and age are required' using errcode = '22023';
  end if;

  insert into public.profiles (
    parent_profile_id, role, first_name, last_name, phone, age, sports, bjj_belt,
    years_grappling, years_mma, language
  ) values (
    v_parent.id,
    'eleve',
    p->>'first_name',
    p->>'last_name',
    p->>'phone',
    (p->>'age')::int,
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p->'sports', '[]'::jsonb)))::public.sport[],
      '{}'),
    (p->>'bjj_belt')::public.belt,
    (p->>'years_grappling')::int,
    (p->>'years_mma')::int,
    coalesce((p->>'language')::public.lang, v_parent.language)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution : jamais anon ; triggers non appelables
-- ---------------------------------------------------------------------------
revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active_prof() from public, anon;
revoke all on function public.is_account_active(public.profiles) from public, anon;
revoke all on function public.current_account_active() from public, anon;
revoke all on function public.set_belt(uuid, public.belt) from public, anon;
revoke all on function public.admin_set_prof_status(uuid, public.prof_status) from public, anon;
revoke all on function public.admin_set_role(uuid, public.user_role) from public, anon;
revoke all on function public.admin_mark_paid_current_year(uuid) from public, anon;
revoke all on function public.create_child_profile(jsonb) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;

grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_prof() to authenticated;
grant execute on function public.is_account_active(public.profiles) to authenticated;
grant execute on function public.current_account_active() to authenticated;
grant execute on function public.set_belt(uuid, public.belt) to authenticated;
grant execute on function public.admin_set_prof_status(uuid, public.prof_status) to authenticated;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_mark_paid_current_year(uuid) to authenticated;
grant execute on function public.create_child_profile(jsonb) to authenticated;
