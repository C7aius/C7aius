-- pgTAP : justificatif étudiant (migration 0013) — table, RPC, vue admin et
-- politiques storage.objects du bucket privé student-proofs (testées en
-- impersonnant des utilisateurs et en insérant/lisant storage.objects).
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
create temp table mp (k text primary key, membership_id uuid, payment_id uuid);
grant all on mp to authenticated, service_role;

create function pg_temp.signup(p_id uuid, p_email text, p_meta jsonb) returns void
language sql as $$
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta);
$$;

create function pg_temp.login(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create function pg_temp.as_service() returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
$$;

create function pg_temp.hint_of(p_sql text) returns text
language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end;
$$;

create function pg_temp.pid(p_auth uuid) returns uuid
language sql security definer as $$ select id from public.profiles where auth_user_id = p_auth $$;

create function pg_temp.k(p_k text) returns uuid
language sql stable as $$ select v from ids where k = p_k $$;


-- profil enfant (superuser) rattaché à p_parent
create function pg_temp.child(p_parent uuid, p_first text, p_age int) returns uuid
language sql security definer as $$
  insert into public.profiles (parent_profile_id, first_name, last_name, age, sports)
  values (p_parent, p_first, 'Kid', p_age, '{jjb}')
  returning id;
$$;

-- a : admin ; p : prof validé ; u : adulte ; o : autre adulte ; ko : enfant de o ; ku : enfant de u
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'sa@t.ch', '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'sp@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('11000000-0000-0000-0000-000000000011', 'su@t.ch', '{"first_name":"Ute","last_name":"U","age":25,"sports":["jjb"]}');
select pg_temp.signup('00000000-0000-0000-0000-0000000000f0', 'so@t.ch', '{"first_name":"Oth","last_name":"O","age":45,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide' where auth_user_id = 'b1000000-0000-0000-0000-0000000000b1';
insert into ids values
  ('a', pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('u', pg_temp.pid('11000000-0000-0000-0000-000000000011')),
  ('o', pg_temp.pid('00000000-0000-0000-0000-0000000000f0'));
insert into ids values
  ('ku', pg_temp.child(pg_temp.k('u'), 'KidU', 10)),
  ('ko', pg_temp.child(pg_temp.k('o'), 'KidO', 10));

-- chemins de test : <profil>/<uuid>.<ext>
create function pg_temp.path(p_k text, p_n int, p_ext text default 'pdf') returns text
language sql stable as $$
  select (select v from ids where k = p_k)::text || '/00000000-0000-0000-0000-00000000000' || p_n || '.' || p_ext
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_table('public', 'student_proofs', 'table student_proofs');
select is((select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'student-proofs'),
          row(false, 10485760::bigint, array['application/pdf','image/jpeg','image/png']::text[])::text,
          'bucket student-proofs : privé, 10 Mo, pdf/jpg/png');

-- ---------------------------------------------------------------------------
-- submit_student_proof
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select lives_ok($$ select public.submit_student_proof(pg_temp.k('u'), pg_temp.path('u', 1)) $$, 'soi : preuve envoyée');
reset role;
select is((select student_status::text from public.profiles where id = pg_temp.k('u')), 'en_attente', 'soi : student_status = en_attente');
select is((select is_student from public.profiles where id = pg_temp.k('u')), true, 'soi : is_student = true');
select is((select count(*)::int from public.student_proofs where profile_id = pg_temp.k('u')), 1, 'une ligne student_proofs');

select pg_temp.login('11000000-0000-0000-0000-000000000011');
select lives_ok($$ select public.submit_student_proof(pg_temp.k('ku'), pg_temp.path('ku', 2, 'jpg')) $$, 'enfant : preuve envoyée par le parent');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('ko'), pg_temp.path('ko', 3)) $$, '42501', null, 'enfant d''un autre : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('o'), pg_temp.path('o', 3)) $$, '42501', null, 'autre adulte : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('u'), pg_temp.path('o', 4)) $$, '42501', null, 'chemin dans le dossier d''un autre : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('u'), pg_temp.path('u', 5) || '/../x.pdf') $$, '42501', null, 'chemin imbriqué / traversée : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('u'), pg_temp.k('u')::text || '/../' || pg_temp.k('o')::text || '/00000000-0000-0000-0000-000000000006.pdf') $$,
                 '42501', null, 'traversée vers le dossier d''un autre : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('u'), pg_temp.path('u', 7, 'exe')) $$, '42501', null, 'extension interdite : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('u'), pg_temp.k('u')::text || '/note.pdf') $$, '42501', null, 'nom non uuid : refusé');
select throws_ok($$ select public.submit_student_proof(pg_temp.k('u'), null) $$, '42501', null, 'chemin nul : refusé');
select throws_ok($$ insert into public.student_proofs (profile_id, path) values (pg_temp.k('u'), 'x') $$, '42501', null, 'insertion directe refusée');
reset role;
select is((select student_status::text from public.profiles where id = pg_temp.k('o')), 'aucun', 'refus : statut de l''autre inchangé');

-- ---------------------------------------------------------------------------
-- Lecture de la table et vue admin
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000f0');
select is((select count(*)::int from public.student_proofs), 0, 'un autre élève ne voit aucune preuve');
select is((select count(*)::int from public.pending_student_proofs), 0, 'élève : vue pending_student_proofs vide');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.pending_student_proofs), 2, 'admin : 2 preuves en attente');
select is((select first_name || ' ' || age from public.pending_student_proofs where profile_id = pg_temp.k('u')), 'Ute 25', 'vue : nom et âge');
reset role;

-- ---------------------------------------------------------------------------
-- admin_decide_student
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.admin_decide_student((select id from public.student_proofs where profile_id = pg_temp.k('u')), true) $$,
                 '42501', null, 'prof : admin_decide_student refusé');
reset role;
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.admin_decide_student((select id from public.student_proofs where profile_id = pg_temp.k('u')), true) $$,
                 '42501', null, 'élève : admin_decide_student refusé');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.admin_decide_student((select id from public.student_proofs where profile_id = pg_temp.k('u')), true) $$, 'admin : valide');
select lives_ok($$ select public.admin_decide_student((select id from public.student_proofs where profile_id = pg_temp.k('ku')), false) $$, 'admin : refuse');
select is(pg_temp.hint_of($$ select public.admin_decide_student((select id from public.student_proofs where profile_id = pg_temp.k('u')), false) $$),
          'already_decided', 'décision déjà prise : already_decided');
select is((select reason from public.membership_price(pg_temp.k('u'), 12)), 'student', 'prix étudiant appliqué');
select is((select amount from public.membership_price(pg_temp.k('u'), 12)), 455.00, 'prix étudiant 650 - 30 %');
reset role;
select is((select student_status::text from public.profiles where id = pg_temp.k('u')), 'valide', 'student_status = valide');
select is((select student_status::text from public.profiles where id = pg_temp.k('ku')), 'refuse', 'student_status = refuse');
select is((select row(decision, decided_by = pg_temp.k('a'), decided_at is not null)::text from public.student_proofs where profile_id = pg_temp.k('u')),
          row('valide'::text, true, true)::text, 'décision, décideur et date enregistrés');

-- ---------------------------------------------------------------------------
-- Politiques storage.objects
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('student-proofs', pg_temp.path('u', 1), auth.uid()::text) $$,
                'storage : envoi dans son dossier');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('student-proofs', pg_temp.path('ku', 2, 'jpg'), auth.uid()::text) $$,
                'storage : envoi dans le dossier de son enfant');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('student-proofs', pg_temp.path('o', 9), auth.uid()::text) $$,
                 '42501', null, 'storage : envoi dans le dossier d''un autre refusé');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('student-proofs', pg_temp.path('u', 8) || '/x.pdf', auth.uid()::text) $$,
                 '42501', null, 'storage : sous-dossier refusé');
select is((select count(*)::int from storage.objects where bucket_id = 'student-proofs'), 2, 'storage : lit son dossier et celui de son enfant');
select is((select count(*)::int from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and policyname like 'student_proofs_%' and cmd in ('DELETE', 'UPDATE', 'ALL')),
          0, 'storage : aucune politique UPDATE / DELETE (pas de suppression client)');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000f0');
select is((select count(*)::int from storage.objects where bucket_id = 'student-proofs'), 0, 'storage : un autre élève ne lit pas ces dossiers');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from storage.objects where bucket_id = 'student-proofs'), 2, 'storage : l''admin lit tout le bucket');
reset role;

select * from finish();
rollback;
