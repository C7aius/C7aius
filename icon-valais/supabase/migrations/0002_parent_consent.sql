-- =============================================================================
-- 0002_parent_consent : consentement parental par jeton e-mail
--
-- Flux : l'Edge Function send-parent-consent (clé service) crée une ligne
-- parent_consents et envoie le lien par e-mail ; le parent ouvre le lien
-- (Edge Function confirm-parent-consent, publique) qui appelle
-- confirm_parent_consent(token). Le jeton (uuid aléatoire, 122 bits) est le
-- secret ; il est valable 7 jours et à usage unique.
--
-- La table et la RPC ne sont accessibles qu'au service (service_role) : un
-- client authentifié ne peut ni lire les jetons ni confirmer lui-même.
-- confirm_parent_consent est SECURITY DEFINER (propriétaire postgres) : dans
-- la fonction current_user = postgres, donc protect_profile_columns laisse
-- passer la mise à jour de parent_consent_at (même mécanisme que 0001).
-- =============================================================================

create table public.parent_consents (
  token        uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  parent_email text not null,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz null
);

create index parent_consents_profile_id_idx on public.parent_consents (profile_id);

alter table public.parent_consents enable row level security;  -- aucune policy
revoke all on public.parent_consents from public, anon, authenticated;
grant select, insert, update, delete on public.parent_consents to service_role;

-- ---------------------------------------------------------------------------
-- confirm_parent_consent : true si le jeton est valide (connu, non utilisé,
-- < 7 jours, e-mail parent inchangé depuis la demande) ; sinon false.
-- ---------------------------------------------------------------------------
create function public.confirm_parent_consent(p_token uuid) returns bool
language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
begin
  update public.parent_consents pc
     set confirmed_at = now()
    from public.profiles p
   where pc.token = p_token
     and pc.confirmed_at is null
     and pc.created_at > now() - interval '7 days'
     and p.id = pc.profile_id
     and lower(p.parent_email) = lower(pc.parent_email)
  returning pc.profile_id into v_profile;

  if v_profile is null then
    return false;
  end if;

  update public.profiles
     set parent_consent_at = coalesce(parent_consent_at, now())
   where id = v_profile;
  return true;
end;
$$;

revoke all on function public.confirm_parent_consent(uuid) from public, anon, authenticated;
grant execute on function public.confirm_parent_consent(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Gel de parent_email : dès qu'une demande de consentement existe pour un
-- profil, seul un admin (ou le service) peut modifier parent_email. Sans cela
-- un mineur pourrait rediriger l'e-mail de consentement vers lui-même après
-- l'envoi. Le renvoi vers la même adresse reste possible.
-- ---------------------------------------------------------------------------
create function public.has_parent_consent_request(p_profile uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.parent_consents where profile_id = p_profile);
$$;

revoke all on function public.has_parent_consent_request(uuid) from public, anon;
grant execute on function public.has_parent_consent_request(uuid) to authenticated;

create function public.protect_parent_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.parent_email is distinct from old.parent_email
     and not public.is_admin()
     and public.has_parent_consent_request(old.id) then
    raise exception 'parent_email is frozen once a consent request exists' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_parent_email() from public, anon, authenticated;

create trigger protect_parent_email
  before update on public.profiles
  for each row execute function public.protect_parent_email();
