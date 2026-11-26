-- =============================================================================
-- 0013 : justificatif étudiant (base + stockage)
--
--  * Bucket privé `student-proofs` (10 Mo, pdf/jpg/png). Chemin imposé :
--    <profile_id>/<uuid>.<pdf|jpg|png> (un seul niveau de dossier).
--  * Politiques storage.objects : INSERT et SELECT dans son dossier ou celui de
--    son enfant (compte actif) ; SELECT de tout le bucket pour l'admin actif ;
--    aucune politique UPDATE / DELETE : le client ne supprime ni ne remplace
--    rien (les fichiers sont supprimés par delete-account, service_role).
--    Le fichier est CONSERVÉ après la décision (décision du propriétaire).
--  * student_proofs : lecture soi / enfant / admin ; aucune écriture directe.
--  * submit_student_proof / admin_decide_student : SECURITY DEFINER ; le
--    trigger protect_profile_columns laisse passer (current_user = postgres).
--  * pending_student_proofs : vue admin (preuve + nom + âge), vide sinon.
--
-- HINTs stables : already_valid, already_decided.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.student_proofs (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  path         text not null unique,
  submitted_at timestamptz not null default now(),
  decided_at   timestamptz null,
  decided_by   uuid null references public.profiles (id) on delete set null,
  decision     text null check (decision in ('valide', 'refuse')),
  constraint student_proofs_decided check ((decision is null) = (decided_at is null))
);

create index student_proofs_profile_id_idx on public.student_proofs (profile_id);
create index student_proofs_decided_by_idx on public.student_proofs (decided_by);

alter table public.student_proofs enable row level security;

create policy student_proofs_select on public.student_proofs
  for select to authenticated
  using (
    profile_id = public.current_profile_id()
    or exists (
      select 1 from public.profiles c
       where c.id = student_proofs.profile_id
         and c.parent_profile_id = public.current_profile_id()
    )
    or public.is_admin()
  );

-- Pas de policy INSERT / UPDATE / DELETE : RPC seulement.
revoke all on public.student_proofs from anon, authenticated;
grant select on public.student_proofs to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chemin : <uuid>/<uuid>.<pdf|jpg|png>, rien d'autre (pas de '..', pas de
--    sous-dossier). Renvoie le profil du dossier, ou null si le chemin est
--    invalide.
-- ---------------------------------------------------------------------------
create function public.proof_path_profile(p_path text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$'
    then split_part(p_path, '/', 1)::uuid
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Stockage : bucket privé + politiques
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-proofs', 'student-proofs', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png']);

create policy student_proofs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-proofs'
    and public.proof_path_profile(name) is not null
    and public.can_pay_for(public.proof_path_profile(name))
  );

create policy student_proofs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-proofs'
    and (
      (public.proof_path_profile(name) is not null
       and public.can_pay_for(public.proof_path_profile(name)))
      or (public.is_admin() and public.current_account_active())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. RPC
-- ---------------------------------------------------------------------------
create function public.submit_student_proof(p_profile uuid, p_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.student_status;
  v_id uuid;
begin
  if not public.can_pay_for(p_profile) then
    raise exception 'submit_student_proof: not allowed for this profile' using errcode = '42501';
  end if;
  if public.proof_path_profile(p_path) is distinct from p_profile then
    raise exception 'submit_student_proof: path must be <profile_id>/<uuid>.<pdf|jpg|png>' using errcode = '42501';
  end if;
  select student_status into v_status from public.profiles where id = p_profile for update;
  if v_status = 'valide' then
    raise exception 'submit_student_proof: already validated' using errcode = '22023', hint = 'already_valid';
  end if;
  insert into public.student_proofs (profile_id, path) values (p_profile, p_path) returning id into v_id;
  update public.profiles set student_status = 'en_attente', is_student = true where id = p_profile;
  return v_id;
end;
$$;

create function public.admin_decide_student(p_proof uuid, p_valid bool) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_proof public.student_proofs;
begin
  if not (public.is_admin() and public.current_account_active()) then
    raise exception 'admin_decide_student: admin only' using errcode = '42501';
  end if;
  if p_valid is null then
    raise exception 'admin_decide_student: p_valid is required' using errcode = '22023';
  end if;
  select * into v_proof from public.student_proofs where id = p_proof for update;
  if v_proof.id is null then
    raise exception 'admin_decide_student: proof not found' using errcode = 'P0002';
  end if;
  if v_proof.decision is not null then
    raise exception 'admin_decide_student: already decided' using errcode = '22023', hint = 'already_decided';
  end if;
  update public.student_proofs
     set decision = case when p_valid then 'valide' else 'refuse' end,
         decided_at = now(),
         decided_by = public.current_profile_id()
   where id = p_proof;
  -- is_student reflète la déclaration : retirée si le justificatif est refusé
  update public.profiles
     set student_status = case when p_valid then 'valide' else 'refuse' end::public.student_status,
         is_student = p_valid
   where id = v_proof.profile_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Vue admin (propriétaire postgres ; vide hors admin actif)
-- ---------------------------------------------------------------------------
create view public.pending_student_proofs as
  select sp.id, sp.profile_id, sp.path, sp.submitted_at,
         p.first_name, p.last_name, p.age
    from public.student_proofs sp
    join public.profiles p on p.id = sp.profile_id
   where sp.decision is null
     and public.is_admin() and public.current_account_active();

revoke all on public.pending_student_proofs from anon, authenticated;
grant select on public.pending_student_proofs to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Droits d'exécution
-- ---------------------------------------------------------------------------
revoke all on function public.proof_path_profile(text) from public, anon;
revoke all on function public.submit_student_proof(uuid, text) from public, anon;
revoke all on function public.admin_decide_student(uuid, bool) from public, anon;
grant execute on function public.proof_path_profile(text) to authenticated;
grant execute on function public.submit_student_proof(uuid, text) to authenticated;
grant execute on function public.admin_decide_student(uuid, bool) to authenticated;
