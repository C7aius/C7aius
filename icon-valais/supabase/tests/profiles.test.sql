-- pgTAP: profils, droits, RPC admin (tâche 3)
begin;
create extension if not exists pgtap with schema extensions;

select plan(69);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

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

create function pg_temp.pid(p_auth uuid) returns uuid
language sql security definer as $$ select id from public.profiles where auth_user_id = p_auth $$;

-- Users
select pg_temp.signup('11111111-1111-1111-1111-111111111111', 'eleve@test.ch',
  '{"first_name":"Eva","last_name":"Eleve","age":25,"sports":["jjb"],"bjj_belt":"blanche","role":"eleve"}');
select pg_temp.signup('22222222-2222-2222-2222-222222222222', 'pirate@test.ch',
  '{"first_name":"Pia","last_name":"Pirate","age":30,"sports":["mma"],"years_mma":2,"role":"admin"}');
select pg_temp.signup('33333333-3333-3333-3333-333333333333', 'prof@test.ch',
  '{"first_name":"Paul","last_name":"Prof","age":40,"sports":["jjb","grappling"],"bjj_belt":"noire","years_grappling":10,"coach_years":12,"role":"prof","language":"de"}');
select pg_temp.signup('44444444-4444-4444-4444-444444444444', 'admin@test.ch',
  '{"first_name":"Ada","last_name":"Admin","age":45,"sports":["jjb"],"bjj_belt":"noire"}');
select pg_temp.signup('55555555-5555-5555-5555-555555555555', 'ado@test.ch',
  '{"first_name":"Ali","last_name":"Ado","age":15,"sports":["grappling"],"years_grappling":1,"parent_email":"maman@test.ch"}');
select pg_temp.signup('66666666-6666-6666-6666-666666666666', 'parent@test.ch',
  '{"first_name":"Pierre","last_name":"Parent","age":42,"sports":["jjb"],"bjj_belt":"bleue"}');
select pg_temp.signup('77777777-7777-7777-7777-777777777777', 'refuse@test.ch',
  '{"first_name":"Rita","last_name":"Refus","age":35,"sports":["mma"],"years_mma":3,"coach_years":1,"role":"prof"}');

-- Bootstrap admin (service-level, as postgres)
update public.profiles set role = 'admin'
 where auth_user_id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------------------
-- handle_new_user
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profiles p join auth.users u on u.id = p.auth_user_id
            where u.email in ('eleve@test.ch','pirate@test.ch','prof@test.ch','admin@test.ch','ado@test.ch','parent@test.ch','refuse@test.ch')), 7, 'un profil par auth.users');
select set_config('test.total', (select count(*) from public.profiles)::text, true);
select is((select role::text from public.profiles where auth_user_id = '22222222-2222-2222-2222-222222222222'),
          'eleve', 'role admin demandé à l''inscription → eleve');
select is((select prof_status::text from public.profiles where auth_user_id = '22222222-2222-2222-2222-222222222222'),
          null, 'eleve : prof_status null');
select is((select role::text from public.profiles where auth_user_id = '33333333-3333-3333-3333-333333333333'),
          'prof', 'role prof demandé → prof');
select is((select prof_status::text from public.profiles where auth_user_id = '33333333-3333-3333-3333-333333333333'),
          'en_attente', 'prof → prof_status en_attente');
select is((select row(email, sports::text, bjj_belt::text, years_grappling, coach_years, language::text)::text
             from public.profiles where auth_user_id = '33333333-3333-3333-3333-333333333333'),
          row('prof@test.ch', '{jjb,grappling}', 'noire', 10, 12, 'de')::text,
          'métadonnées recopiées');
select is((select language::text from public.profiles where auth_user_id = '11111111-1111-1111-1111-111111111111'),
          'fr', 'langue par défaut fr');
select is((select parent_email from public.profiles where auth_user_id = '55555555-5555-5555-5555-555555555555'),
          'maman@test.ch', 'parent_email recopié');
select throws_ok($$ select pg_temp.signup('88888888-8888-8888-8888-888888888888', 'kidbelt@test.ch',
                    '{"first_name":"A","last_name":"B","age":25,"sports":["jjb"],"bjj_belt":"grise"}') $$,
                 '23514', null, 'inscription adulte avec ceinture enfant → refusée');

-- ---------------------------------------------------------------------------
-- is_account_active
-- ---------------------------------------------------------------------------
select is((select public.is_account_active(p) from public.profiles p
            where auth_user_id = '33333333-3333-3333-3333-333333333333'), false, 'prof en attente → inactif');
select is((select public.is_account_active(p) from public.profiles p
            where auth_user_id = '11111111-1111-1111-1111-111111111111'), true, 'élève adulte → actif');
select is((select public.is_account_active(p) from public.profiles p
            where auth_user_id = '55555555-5555-5555-5555-555555555555'), false, '15 ans sans consentement → inactif');

-- ---------------------------------------------------------------------------
-- protect_profile_columns (élève sur lui-même)
-- ---------------------------------------------------------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select throws_ok($$ update public.profiles set role = 'admin' where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : role non modifiable');
select throws_ok($$ update public.profiles set paid_until = '2099-12-31' where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : paid_until non modifiable');
select throws_ok($$ update public.profiles set bjj_belt = 'noire' where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : bjj_belt non modifiable');
select throws_ok($$ update public.profiles set student_status = 'valide' where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : student_status non modifiable');
select throws_ok($$ update public.profiles set parent_consent_at = now() where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : parent_consent_at non modifiable');
select throws_ok($$ update public.profiles set auth_user_id = '22222222-2222-2222-2222-222222222222' where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : auth_user_id non modifiable');
-- Le paramètre de session ne peut pas être utilisé par le client pour contourner la protection
select set_config('app.bypass_protect', 'on', true);
select throws_ok($$ update public.profiles set role = 'admin' where auth_user_id = auth.uid() $$,
                 '42501', null, 'élève : set_config(app.bypass_protect) ne contourne pas la protection');
select lives_ok($$ update public.profiles set phone = '079 000 00 00', is_student = true where auth_user_id = auth.uid() $$,
                'élève : champs libres modifiables');
select is((select phone from public.profiles where auth_user_id = auth.uid()), '079 000 00 00', 'téléphone mis à jour');

-- RLS : un élève ne lit pas les autres profils et ne les modifie pas
select is((select count(*)::int from public.profiles), 1, 'élève : ne lit que son profil');
update public.profiles set phone = 'hack' where auth_user_id = '22222222-2222-2222-2222-222222222222';
select throws_ok($$ insert into public.profiles (first_name, last_name, age, sports) values ('X','Y',20,'{jjb}') $$,
                 '42501', null, 'élève : insert direct interdit');
-- RPC refusées
select throws_ok($$ select public.set_belt(pg_temp.pid('22222222-2222-2222-2222-222222222222'), 'bleue') $$,
                 '42501', null, 'set_belt par un élève → exception');
select throws_ok($$ select public.admin_mark_paid_current_year(pg_temp.pid('11111111-1111-1111-1111-111111111111')) $$,
                 '42501', null, 'admin_mark_paid_current_year par un non-admin → exception');
select throws_ok($$ select public.admin_set_prof_status(pg_temp.pid('33333333-3333-3333-3333-333333333333'), 'valide') $$,
                 '42501', null, 'admin_set_prof_status par un non-admin → exception');
select throws_ok($$ select public.admin_set_role(pg_temp.pid('11111111-1111-1111-1111-111111111111'), 'admin') $$,
                 '42501', null, 'admin_set_role par un non-admin → exception');
reset role;
select is((select phone from public.profiles where auth_user_id = '22222222-2222-2222-2222-222222222222'),
          null, 'élève : update d''un autre profil sans effet');

-- ---------------------------------------------------------------------------
-- Consentement : un mineur inscrit seul ne peut pas changer son âge à >= 16
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-5555-5555-555555555555');
select throws_ok($$ update public.profiles set age = 16 where auth_user_id = auth.uid() $$,
                 '42501', null, '15 ans sans consentement : âge -> 16 refusé');
select lives_ok($$ update public.profiles set phone = '078 555 55 55' where auth_user_id = auth.uid() $$,
                '15 ans sans consentement : autres champs modifiables');
select is((select count(*)::int from public.public_profiles), 0, 'mineur sans consentement : public_profiles vide');
reset role;

-- ---------------------------------------------------------------------------
-- public_profiles et prof en attente
-- ---------------------------------------------------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.public_profiles), 0, 'prof en attente : public_profiles vide');
select throws_ok($$ select public.create_child_profile('{"first_name":"K","last_name":"P","age":8,"sports":["mma"]}') $$,
                 '42501', null, 'compte inactif : create_child_profile refusé');
reset role;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select ok((select count(*)::int from public.public_profiles) >= 4, 'utilisateur actif : public_profiles lisible');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('33333333-3333-3333-3333-333333333333')),
          0, 'prof en attente : absent de public_profiles');
reset role;
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select lives_ok($$ select public.admin_set_prof_status(pg_temp.pid('77777777-7777-7777-7777-777777777777'), 'refuse') $$,
                'admin refuse un prof');
reset role;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('77777777-7777-7777-7777-777777777777')),
          0, 'prof refusé : absent de public_profiles');
reset role;

-- ---------------------------------------------------------------------------
-- Prof en attente puis validé
-- ---------------------------------------------------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select throws_ok($$ select public.set_belt(pg_temp.pid('11111111-1111-1111-1111-111111111111'), 'bleue') $$,
                 '42501', null, 'set_belt par un prof en attente → exception');
reset role;

select pg_temp.login('44444444-4444-4444-4444-444444444444');
select lives_ok($$ select public.admin_set_prof_status(pg_temp.pid('33333333-3333-3333-3333-333333333333'), 'valide') $$,
                'admin valide le prof');
reset role;
select is((select public.is_account_active(p) from public.profiles p
            where auth_user_id = '33333333-3333-3333-3333-333333333333'), true, 'prof validé → actif');

select pg_temp.login('33333333-3333-3333-3333-333333333333');
select lives_ok($$ select public.set_belt(pg_temp.pid('11111111-1111-1111-1111-111111111111'), 'bleue') $$,
                'set_belt par un prof validé → ok');
reset role;
select is((select bjj_belt::text from public.profiles where auth_user_id = '11111111-1111-1111-1111-111111111111'),
          'bleue', 'ceinture mise à jour');
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select throws_ok($$ select public.set_belt(public.current_profile_id(), 'blanche') $$,
                 '42501', null, 'un prof ne modifie pas sa propre ceinture');
reset role;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select display_role from public.public_profiles where id = pg_temp.pid('33333333-3333-3333-3333-333333333333')),
          'prof', 'prof validé : display_role = prof');
reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select lives_ok($$ select public.admin_mark_paid_current_year(pg_temp.pid('11111111-1111-1111-1111-111111111111')) $$,
                'admin marque payé');
select lives_ok($$ select public.admin_set_role(pg_temp.pid('22222222-2222-2222-2222-222222222222'), 'prof') $$,
                'admin change le rôle');
select is((select count(*)::int from public.profiles), current_setting('test.total')::int, 'admin lit tous les profils');
select lives_ok($$ update public.profiles set student_status = 'valide' where auth_user_id = '11111111-1111-1111-1111-111111111111' $$,
                'admin modifie directement une colonne protégée');
select lives_ok($$ select public.set_belt(public.current_profile_id(), 'marron') $$,
                'l''admin modifie sa propre ceinture');
select throws_ok($$ select public.set_belt(pg_temp.pid('11111111-1111-1111-1111-111111111111'), 'grise') $$,
                 '23514', null, 'set_belt : ceinture enfant sur un adulte → refusée');
reset role;
select is((select student_status::text from public.profiles where auth_user_id = '11111111-1111-1111-1111-111111111111'),
          'valide', 'student_status modifié par l''admin');
select is((select bjj_belt::text from public.profiles where auth_user_id = '44444444-4444-4444-4444-444444444444'),
          'marron', 'ceinture de l''admin mise à jour');
select is((select paid_until from public.profiles where auth_user_id = '11111111-1111-1111-1111-111111111111'),
          make_date(extract(year from now() at time zone 'Europe/Zurich')::int, 12, 31),
          'paid_until = 31.12 de l''année courante (Europe/Zurich)');
select is((select role::text || '/' || prof_status::text from public.profiles
            where auth_user_id = '22222222-2222-2222-2222-222222222222'), 'prof/valide', 'rôle prof attribué par l''admin');

-- ---------------------------------------------------------------------------
-- Profils enfants
-- ---------------------------------------------------------------------------
select pg_temp.login('55555555-5555-5555-5555-555555555555');
select throws_ok($$ select public.create_child_profile('{"first_name":"Kid","last_name":"Ado","age":8,"sports":["jjb"],"bjj_belt":"blanche"}') $$,
                 '42501', null, 'un mineur ne peut pas créer de profil enfant');
reset role;

select pg_temp.login('66666666-6666-6666-6666-666666666666');
insert into ids values ('child', public.create_child_profile(
  '{"first_name":"Lea","last_name":"Parent","age":8,"sports":["jjb"],"bjj_belt":"grise","role":"admin"}'));
select is((select first_name || '/' || role::text || '/' || bjj_belt::text from public.profiles where id = (select v from ids where k = 'child')),
          'Lea/eleve/grise', 'le parent lit son enfant');
update public.profiles set phone = '027 111 11 11' where id = (select v from ids where k = 'child');
select is((select phone from public.profiles where id = (select v from ids where k = 'child')), '027 111 11 11',
          'le parent modifie son enfant');
select throws_ok($$ update public.profiles set bjj_belt = 'jaune' where id = (select v from ids where k = 'child') $$,
                 '42501', null, 'le parent ne modifie pas la ceinture de l''enfant');
select throws_ok($$ update public.profiles set parent_profile_id = pg_temp.pid('11111111-1111-1111-1111-111111111111')
                     where id = (select v from ids where k = 'child') $$,
                 '42501', null, 'le parent ne modifie pas parent_profile_id de l''enfant');
select throws_ok($$ update public.profiles set age = 18 where id = (select v from ids where k = 'child') $$,
                 '23514', null, 'âge -> 18 avec ceinture enfant → refusé');
select throws_ok($$ select public.create_child_profile('{"first_name":"Max","last_name":"Parent","age":20,"sports":["jjb"],"bjj_belt":"verte"}') $$,
                 '22023', null, 'create_child_profile : enfant de 20 ans (ceinture enfant) → refusé');
reset role;
select is((select public.is_account_active(p) from public.profiles p where id = (select v from ids where k = 'child')),
          true, 'enfant créé par un parent → actif sans consentement');

select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.profiles where id = (select v from ids where k = 'child')), 0,
          'un autre utilisateur ne lit pas l''enfant dans profiles');
select is((select first_name from public.public_profiles where id = (select v from ids where k = 'child')), 'Lea',
          'mais le voit dans public_profiles');
select is((select display_role from public.public_profiles where id = pg_temp.pid('44444444-4444-4444-4444-444444444444')),
          'prof', 'display_role de l''admin = prof');
reset role;

-- Un autre utilisateur ne peut pas modifier l'enfant
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.profiles set phone = 'hack' where id = (select v from ids where k = 'child');
reset role;
select is((select phone from public.profiles where id = (select v from ids where k = 'child')), '027 111 11 11',
          'un autre utilisateur ne modifie pas l''enfant');

-- ---------------------------------------------------------------------------
-- anon : aucun accès
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon : profiles illisible');
select throws_ok($$ select * from public.public_profiles $$, '42501', null, 'anon : public_profiles illisible');
select throws_ok($$ select public.create_child_profile('{}') $$, '42501', null, 'anon : RPC non exécutable');
reset role;

select * from finish();
rollback;
