-- =============================================================================
-- 0009_memberships : tarifs et adhésions (Plan 3, tâche 1)
--
--  * pricing_settings : ligne unique (id = true) des tarifs d'adhésion, des
--    réductions (étudiant, enfant) et du prix par défaut d'un cours pour un
--    non-adhérent. Lisible par tout compte actif ; AUCUNE écriture directe :
--    l'admin passe par admin_update_pricing.
--  * memberships : adhésions (abonnement Stripe, paiement unique, « payé pour
--    l'année » de l'admin). Lisibles par le profil, son parent et l'admin ;
--    AUCUNE écriture client (Edge Functions / RPC serveur uniquement).
--  * profiles.stripe_customer_id : colonne protégée (protect_profile_columns).
--  * is_member(p_profile, p_on) : fonction interne (RPC SECURITY DEFINER,
--    service_role) ; les clients lisent leur statut via my_membership.
--  * membership_price(p_profile, p_months) : seul calcul du prix d'une
--    adhésion (le montant n'est jamais fourni par le client) ; réductions non
--    cumulables (la plus avantageuse), arrondi au centime.
--  * can_pay_for(p_profile) : soi ou son enfant, compte appelant actif.
--  * create_course (0008) : price_non_member absent →
--    pricing_settings.default_course_price.
--
-- HINTs stables : invalid_field.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tarifs (singleton)
-- ---------------------------------------------------------------------------
create table public.pricing_settings (
  id                   bool primary key default true check (id),
  price_1m             numeric(8,2) not null check (price_1m > 0),
  price_3m             numeric(8,2) not null check (price_3m > 0),
  price_6m             numeric(8,2) not null check (price_6m > 0),
  price_12m            numeric(8,2) not null check (price_12m > 0),
  student_discount_pct int not null default 30 check (student_discount_pct between 0 and 90),
  child_discount_pct   int not null default 50 check (child_discount_pct between 0 and 90),
  child_max_age        int not null default 15 check (child_max_age between 0 and 100),
  default_course_price numeric(8,2) not null default 20 check (default_course_price >= 0),
  updated_at           timestamptz not null default now()
);

insert into public.pricing_settings (price_1m, price_3m, price_6m, price_12m,
                                     student_discount_pct, child_discount_pct,
                                     child_max_age, default_course_price)
values (100, 250, 450, 650, 30, 50, 15, 20);

alter table public.pricing_settings enable row level security;

create policy pricing_settings_select on public.pricing_settings
  for select to authenticated
  using (public.current_account_active());

revoke all on public.pricing_settings from anon, authenticated;
grant select on public.pricing_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Adhésions
-- ---------------------------------------------------------------------------
create type public.membership_source as enum ('stripe_subscription', 'one_time', 'admin_year');
create type public.membership_status as enum ('pending', 'active', 'cancelled', 'ended');

create table public.memberships (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  paid_by                uuid null references public.profiles (id) on delete set null,
  source                 public.membership_source not null,
  months                 int not null check (months in (1, 3, 6, 12)),
  starts_on              date null,
  ends_on                date null,
  status                 public.membership_status not null default 'pending',
  auto_renew             bool not null default false,
  cancel_at_period_end   bool not null default false,
  stripe_subscription_id text unique null,
  amount                 numeric(8,2) not null check (amount >= 0),
  created_at             timestamptz not null default now(),
  constraint memberships_period check (starts_on is null or ends_on is null or ends_on >= starts_on),
  -- une adhésion qui compte (active / résiliée) a une période
  constraint memberships_counted_has_period check (
    status not in ('active', 'cancelled') or (starts_on is not null and ends_on is not null)
  )
);

create index memberships_profile_id_idx on public.memberships (profile_id);
create index memberships_paid_by_idx on public.memberships (paid_by);

alter table public.memberships enable row level security;

-- lecture : soi, son parent (profil enfant), admin
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    profile_id = public.current_profile_id()
    or exists (
      select 1 from public.profiles c
       where c.id = memberships.profile_id
         and c.parent_profile_id = public.current_profile_id()
    )
    or public.is_admin()
  );

-- Pas de policy INSERT / UPDATE / DELETE.
revoke all on public.memberships from anon, authenticated;
grant select on public.memberships to authenticated;

-- ---------------------------------------------------------------------------
-- 3. profiles.stripe_customer_id (protégée)
-- ---------------------------------------------------------------------------
alter table public.profiles add column stripe_customer_id text unique null;

-- protect_profile_columns (remplace la version de 0004 ; ajoute stripe_customer_id)
create or replace function public.protect_profile_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Rôles serveur (postgres via les RPC SECURITY DEFINER, service_role, ...) : autorisé.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.is_admin() then
    -- l'admin peut tout modifier, sauf se retirer le dernier rôle admin
    -- et donner un rôle à un profil enfant (sans login)
    if old.role = 'admin' and new.role is distinct from 'admin'
       and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
      raise exception 'cannot demote the last admin' using errcode = '42501', hint = 'last_admin';
    end if;
    if old.auth_user_id is null and new.role is distinct from 'eleve' then
      raise exception 'a child profile has no role' using errcode = '42501', hint = 'child_profile_role';
    end if;
    return new;
  end if;
  if new.role               is distinct from old.role
  or new.prof_status        is distinct from old.prof_status
  or new.paid_until         is distinct from old.paid_until
  or new.student_status     is distinct from old.student_status
  or new.parent_consent_at  is distinct from old.parent_consent_at
  or new.bjj_belt           is distinct from old.bjj_belt
  or new.id                 is distinct from old.id
  or new.auth_user_id       is distinct from old.auth_user_id
  or new.parent_profile_id  is distinct from old.parent_profile_id
  or new.email              is distinct from old.email
  or new.created_at         is distinct from old.created_at
  or new.stripe_customer_id is distinct from old.stripe_customer_id
  then
    raise exception 'protected profile column' using errcode = '42501';
  end if;
  -- un mineur inscrit seul, sans consentement parental, ne peut pas
  -- contourner le consentement en se déclarant âgé de 16 ans ou plus
  if old.parent_profile_id is null and old.age < 16 and old.parent_consent_at is null
     and new.age >= 16 then
    raise exception 'age change requires parental consent' using errcode = '42501';
  end if;
  -- à l'inverse, un inscrit seul de 16 ans ou plus sans consentement ne peut
  -- pas descendre sous 16 ans (son compte deviendrait inactif, bloqué en
  -- attente d'un consentement qu'il ne peut plus demander depuis l'inscription)
  if old.parent_profile_id is null and old.age >= 16 and old.parent_consent_at is null
     and new.age < 16 then
    raise exception 'lowering age below 16 requires parental consent'
      using errcode = '42501', hint = 'age_lower_requires_consent';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fonctions
-- ---------------------------------------------------------------------------

-- Le profil est-il adhérent à la date p_on (Europe/Zurich) ?
-- Interne : appelée par les RPC SECURITY DEFINER et le service, pas par les
-- clients (qui utilisent my_membership).
create function public.is_member(
  p_profile uuid,
  p_on date default (now() at time zone 'Europe/Zurich')::date
) returns bool
language sql stable security definer set search_path = '' as $$
  select coalesce((select paid_until >= p_on from public.profiles where id = p_profile), false)
      or exists (
        select 1 from public.memberships
         where profile_id = p_profile
           and status in ('active', 'cancelled')
           and starts_on <= p_on and p_on <= ends_on
      );
$$;

-- L'appelant peut-il payer pour ce profil ? (lui-même ou son enfant ; compte actif)
create function public.can_pay_for(p_profile uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select public.current_account_active()
     and exists (
       select 1 from public.profiles p
        where p.id = p_profile
          and (p.id = public.current_profile_id()
               or p.parent_profile_id = public.current_profile_id())
     );
$$;

-- Prix d'une adhésion de p_months mois pour p_profile (calcul serveur seul).
-- Client : soi, son enfant ou admin actif. Service (JWT non client) : libre.
create function public.membership_price(p_profile uuid, p_months int)
returns table (base numeric, discount_pct int, reason text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.pricing_settings;
  v_p public.profiles;
  v_child int := 0;
  v_student int := 0;
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and not (public.can_pay_for(p_profile) or (public.is_admin() and public.current_account_active())) then
    raise exception 'membership_price: not allowed for this profile' using errcode = '42501';
  end if;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    raise exception 'membership_price: months must be 1, 3, 6 or 12'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  select * into v_p from public.profiles where id = p_profile;
  if v_p.id is null then
    raise exception 'membership_price: profile not found' using errcode = 'P0002';
  end if;
  select * into v_s from public.pricing_settings where id;

  base := case p_months
    when 1 then v_s.price_1m
    when 3 then v_s.price_3m
    when 6 then v_s.price_6m
    else v_s.price_12m
  end;
  if v_p.age <= v_s.child_max_age then
    v_child := v_s.child_discount_pct;
  end if;
  if v_p.student_status = 'valide' then
    v_student := v_s.student_discount_pct;
  end if;
  -- réductions non cumulables : la plus avantageuse (égalité → enfant)
  if v_child = 0 and v_student = 0 then
    discount_pct := 0;
    reason := 'none';
  elsif v_child >= v_student then
    discount_pct := v_child;
    reason := 'child';
  else
    discount_pct := v_student;
    reason := 'student';
  end if;
  amount := round(base * (100 - discount_pct) / 100, 2);
  return next;
end;
$$;

-- Statut d'adhésion de soi (p_profile null) ou de son enfant.
-- until : dernier jour couvert (paid_until ou fin de la dernière adhésion
-- active / résiliée) ; null si non adhérent. auto_renew / cancel_at_period_end
-- : ceux de l'adhésion qui finit le plus tard (false pour « payé pour l'année »).
create function public.my_membership(p_profile uuid default null)
returns table (is_member bool, until date, source public.membership_source,
               auto_renew bool, cancel_at_period_end bool)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile uuid := coalesce(p_profile, public.current_profile_id());
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_paid_until date;
  v_m public.memberships;
begin
  if not public.can_pay_for(v_profile) then
    raise exception 'my_membership: own profile or own child required' using errcode = '42501';
  end if;

  is_member := public.is_member(v_profile, v_today);
  auto_renew := false;
  cancel_at_period_end := false;
  if not is_member then
    return next;
    return;
  end if;

  select paid_until into v_paid_until from public.profiles where id = v_profile;
  if v_paid_until < v_today then
    v_paid_until := null;
  end if;
  select * into v_m from public.memberships m
   where m.profile_id = v_profile
     and m.status in ('active', 'cancelled')
     and m.ends_on >= v_today
   order by m.ends_on desc, m.created_at desc
   limit 1;

  if v_m.id is not null and (v_paid_until is null or v_m.ends_on > v_paid_until) then
    until := v_m.ends_on;
    source := v_m.source;
    auto_renew := v_m.auto_renew;
    cancel_at_period_end := v_m.cancel_at_period_end;
  else
    until := v_paid_until;
    source := 'admin_year';
  end if;
  return next;
end;
$$;

-- Modifie les tarifs (admin). Clés : colonnes de pricing_settings sauf id et
-- updated_at ; clé absente : valeur inchangée. Clé inconnue, valeur nulle,
-- illisible ou hors limites → 22023 invalid_field.
create function public.admin_update_pricing(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.pricing_settings;
  v_new public.pricing_settings;
  v_key text;
begin
  if not (public.is_admin() and public.current_account_active()) then
    raise exception 'admin_update_pricing: admin required' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'admin_update_pricing: an object is required'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  for v_key in select jsonb_object_keys(p) loop
    if v_key not in ('price_1m', 'price_3m', 'price_6m', 'price_12m', 'student_discount_pct',
                     'child_discount_pct', 'child_max_age', 'default_course_price') then
      raise exception 'admin_update_pricing: unknown key %', v_key
        using errcode = '22023', hint = 'invalid_field';
    end if;
    if jsonb_typeof(p->v_key) not in ('number', 'string') then
      raise exception 'admin_update_pricing: % must be a number', v_key
        using errcode = '22023', hint = 'invalid_field';
    end if;
  end loop;

  select * into v_old from public.pricing_settings where id for update;
  v_new := v_old;
  begin
    v_new.price_1m := coalesce((p->>'price_1m')::numeric(8,2), v_old.price_1m);
    v_new.price_3m := coalesce((p->>'price_3m')::numeric(8,2), v_old.price_3m);
    v_new.price_6m := coalesce((p->>'price_6m')::numeric(8,2), v_old.price_6m);
    v_new.price_12m := coalesce((p->>'price_12m')::numeric(8,2), v_old.price_12m);
    v_new.student_discount_pct := coalesce((p->>'student_discount_pct')::int, v_old.student_discount_pct);
    v_new.child_discount_pct := coalesce((p->>'child_discount_pct')::int, v_old.child_discount_pct);
    v_new.child_max_age := coalesce((p->>'child_max_age')::int, v_old.child_max_age);
    v_new.default_course_price := coalesce((p->>'default_course_price')::numeric(8,2), v_old.default_course_price);
  exception when data_exception then
    raise exception 'admin_update_pricing: invalid value (%)', sqlerrm
      using errcode = '22023', hint = 'invalid_field';
  end;

  -- contrôles explicites : jamais de 23514 brut renvoyé par cette RPC
  if v_new.price_1m <= 0 or v_new.price_3m <= 0 or v_new.price_6m <= 0 or v_new.price_12m <= 0
     or v_new.student_discount_pct not between 0 and 90
     or v_new.child_discount_pct not between 0 and 90
     or v_new.child_max_age not between 0 and 100
     or v_new.default_course_price < 0 then
    raise exception 'admin_update_pricing: prices > 0, discounts 0..90, child_max_age 0..100, course price >= 0'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  update public.pricing_settings
     set price_1m = v_new.price_1m,
         price_3m = v_new.price_3m,
         price_6m = v_new.price_6m,
         price_12m = v_new.price_12m,
         student_discount_pct = v_new.student_discount_pct,
         child_discount_pct = v_new.child_discount_pct,
         child_max_age = v_new.child_max_age,
         default_course_price = v_new.default_course_price,
         updated_at = now()
   where id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. create_course (0008) : price_non_member absent → default_course_price
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
    v_price_non_member := coalesce(
      (p->>'price_non_member')::numeric(8,2),
      (select s.default_course_price from public.pricing_settings s where s.id),
      0);
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
-- 6. Droits d'exécution
-- ---------------------------------------------------------------------------
revoke all on function public.is_member(uuid, date) from public, anon, authenticated;
revoke all on function public.can_pay_for(uuid) from public, anon;
revoke all on function public.membership_price(uuid, int) from public, anon;
revoke all on function public.my_membership(uuid) from public, anon;
revoke all on function public.admin_update_pricing(jsonb) from public, anon;

grant execute on function public.is_member(uuid, date) to service_role;
grant execute on function public.can_pay_for(uuid) to authenticated;
grant execute on function public.membership_price(uuid, int) to authenticated, service_role;
grant execute on function public.my_membership(uuid) to authenticated;
grant execute on function public.admin_update_pricing(jsonb) to authenticated;
