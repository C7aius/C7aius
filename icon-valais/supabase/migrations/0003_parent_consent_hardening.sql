-- =============================================================================
-- 0003_parent_consent_hardening
--  * check_parent_consent : validation en LECTURE SEULE d'un jeton (page GET de
--    confirm-parent-consent) ; ne consomme rien. service_role uniquement.
--  * protect_parent_email : ne dépend plus d'un helper appelable par les
--    clients (has_parent_consent_request fuitait le statut des mineurs).
--    Le trigger devient SECURITY DEFINER (il lit parent_consents) ; comme
--    current_user y vaut postgres, le rôle de l'appelant est lu dans le JWT
--    via auth.role() (renseigné par PostgREST à partir du jeton vérifié ; un
--    client ne peut pas poser ce paramètre de session).
-- =============================================================================

create function public.check_parent_consent(p_token uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.parent_consents pc
      join public.profiles p on p.id = pc.profile_id
     where pc.token = p_token
       and pc.confirmed_at is null
       and pc.created_at > now() - interval '7 days'
       and lower(p.parent_email) = lower(pc.parent_email)
  );
$$;

revoke all on function public.check_parent_consent(uuid) from public, anon, authenticated;
grant execute on function public.check_parent_consent(uuid) to service_role;

drop trigger protect_parent_email on public.profiles;
drop function public.protect_parent_email();
drop function public.has_parent_consent_request(uuid);

create function public.protect_parent_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- rôle de l'appelant d'après le JWT (service / connexion directe : pas client)
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.parent_email is distinct from old.parent_email
     and not public.is_admin()
     and exists (select 1 from public.parent_consents where profile_id = old.id) then
    raise exception 'parent_email is frozen once a consent request exists' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_parent_email() from public, anon, authenticated;

create trigger protect_parent_email
  before update on public.profiles
  for each row execute function public.protect_parent_email();
