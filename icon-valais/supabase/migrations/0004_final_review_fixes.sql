-- =============================================================================
-- 0004_final_review_fixes : corrections de la revue finale (Plan 1)
--
--  * protect_profile_columns : un élève inscrit seul (≥ 16 ans, sans
--    consentement) ne peut plus abaisser son âge sous 16 ans (il se bloquerait
--    lui-même sur l'écran de consentement) ; le dernier admin ne peut pas se
--    retirer le rôle admin par REST ; un profil enfant (sans login) reste élève.
--  * admin_set_role : refuse de rétrograder le dernier admin et refuse les
--    profils enfants (auth_user_id null).
--  * create_child_profile : l'enfant doit avoir moins de 18 ans.
--  * public_profiles : n'expose plus les comptes inactifs (mineurs sans
--    consentement, profs en attente / refusés).
--  * limites de longueur sur les champs libres et au moins un sport (contre
--    les abus via l'inscription ouverte).
--  * profiles_delete : un profil avec login ne se supprime pas par REST
--    (suppression de compte : Edge Function delete-account).
--
-- Les erreurs métier portent un HINT stable (lu par l'application pour
-- choisir le message traduit, sans dépendre du texte de l'erreur) :
--   last_admin, child_profile_role, age_lower_requires_consent, child_must_be_minor.
--
-- NOTE — deux triggers BEFORE UPDATE protègent profiles, avec des tests
-- d'appelant différents :
--   * protect_profile_columns (SECURITY INVOKER, 0001) teste current_user :
--     dans une RPC SECURITY DEFINER (propriétaire postgres) current_user vaut
--     postgres, donc la RPC passe ce trigger ; la RPC doit faire elle-même ses
--     contrôles (admin, dernier admin, ...).
--   * protect_parent_email (SECURITY DEFINER, 0003) teste auth.role() (rôle du
--     JWT) : il s'applique AUSSI à l'intérieur des RPC appelées par un client
--     (auth.role() = 'authenticated'). Une RPC definer qui modifierait
--     parent_email pour un non-admin serait donc refusée par ce trigger ; seul
--     le service (send-parent-consent, service_role) y échappe.
-- Toute nouvelle RPC qui modifie profiles doit tenir compte des deux.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Limites de longueur et sports
-- ---------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_first_name_len check (char_length(first_name) <= 50),
  add constraint profiles_last_name_len check (char_length(last_name) <= 50),
  add constraint profiles_phone_len check (phone is null or char_length(phone) <= 30),
  add constraint profiles_parent_email_len check (parent_email is null or char_length(parent_email) <= 254),
  add constraint profiles_training_places_len check (training_places is null or char_length(training_places) <= 1000),
  add constraint profiles_competition_awards_len check (competition_awards is null or char_length(competition_awards) <= 1000),
  add constraint profiles_cv_len check (cv is null or char_length(cv) <= 3000),
  add constraint profiles_sports_nonempty check (cardinality(sports) >= 1);

-- ---------------------------------------------------------------------------
-- protect_profile_columns (remplace la version de 0001)
-- ---------------------------------------------------------------------------
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
-- admin_set_role : dernier admin et profils enfants
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role(p_profile uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
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
   where id = p_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_child_profile : enfant mineur uniquement
-- ---------------------------------------------------------------------------
create or replace function public.create_child_profile(p jsonb) returns uuid
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
  if (p->>'age')::int >= 18 then
    raise exception 'create_child_profile: a child profile must be under 18'
      using errcode = '22023', hint = 'child_must_be_minor';
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
-- public_profiles : comptes actifs uniquement
-- ---------------------------------------------------------------------------
create or replace view public.public_profiles as
  select
    p.id,
    p.first_name,
    p.last_name,
    p.bjj_belt,
    p.sports,
    (case
       when p.role = 'admin' or (p.role = 'prof' and p.prof_status = 'valide') then 'prof'
       else 'eleve'
     end)::text as display_role
  from public.profiles p
  where public.current_account_active()
    and public.is_account_active(p);

-- ---------------------------------------------------------------------------
-- profiles_delete : uniquement les profils sans login (enfants)
-- ---------------------------------------------------------------------------
drop policy profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (
    auth_user_id is null
    and (parent_profile_id = public.current_profile_id() or public.is_admin())
  );
