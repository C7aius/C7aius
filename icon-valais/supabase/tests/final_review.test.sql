-- pgTAP : corrections de la revue finale (migration 0004)
begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

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

-- a1 : seul admin ; a2 : second admin plus tard ; s : élève ; m : mineur sans consentement ;
-- pp : prof en attente ; pr : prof refusé ; par : parent ; y : 17 ans (≥ 16, sans consentement)
select pg_temp.signup('a1000000-0000-0000-0000-000000000001', 'a1@t.ch', '{"first_name":"A","last_name":"One","age":40,"sports":["mma"],"years_mma":1}');
select pg_temp.signup('a2000000-0000-0000-0000-000000000002', 'a2@t.ch', '{"first_name":"A","last_name":"Two","age":40,"sports":["mma"],"years_mma":1}');
select pg_temp.signup('50000000-0000-0000-0000-000000000005', 's@t.ch',  '{"first_name":"Sam","last_name":"S","age":25,"sports":["mma"],"years_mma":1}');
select pg_temp.signup('e0000000-0000-0000-0000-00000000000e', 'm@t.ch',  '{"first_name":"Min","last_name":"M","age":13,"sports":["mma"],"years_mma":1,"parent_email":"p@t.ch"}');
select pg_temp.signup('bb000000-0000-0000-0000-0000000000bb', 'pp@t.ch', '{"first_name":"Pend","last_name":"P","age":30,"sports":["mma"],"years_mma":1,"coach_years":1,"role":"prof"}');
select pg_temp.signup('cc000000-0000-0000-0000-0000000000cc', 'pr@t.ch', '{"first_name":"Refu","last_name":"P","age":30,"sports":["mma"],"years_mma":1,"coach_years":1,"role":"prof"}');
select pg_temp.signup('dd000000-0000-0000-0000-0000000000dd', 'par@t.ch','{"first_name":"Par","last_name":"P","age":45,"sports":["mma"],"years_mma":1}');
select pg_temp.signup('f7000000-0000-0000-0000-0000000000f7', 'y@t.ch',  '{"first_name":"Yan","last_name":"Y","age":17,"sports":["mma"],"years_mma":1}');

-- la base de test peut contenir d'autres admins : on part d'un seul admin (a1)
update public.profiles set role = 'eleve', prof_status = null where role = 'admin';
update public.profiles set role = 'admin' where auth_user_id = 'a1000000-0000-0000-0000-000000000001';
update public.profiles set prof_status = 'refuse' where auth_user_id = 'cc000000-0000-0000-0000-0000000000cc';

-- ---------------------------------------------------------------------------
-- 3. Dernier admin, profils enfants
-- ---------------------------------------------------------------------------
select pg_temp.login('dd000000-0000-0000-0000-0000000000dd');
insert into ids values ('child', public.create_child_profile('{"first_name":"Kid","last_name":"P","age":9,"sports":["mma"]}'));
reset role;

select pg_temp.login('a1000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_set_role(public.current_profile_id(), 'eleve') $$,
                 '42501', null, 'admin_set_role : le dernier admin ne peut pas se rétrograder');
select throws_ok($$ select public.admin_set_role(public.current_profile_id(), 'prof') $$,
                 '42501', null, 'admin_set_role : dernier admin → prof refusé');
select throws_ok($$ update public.profiles set role = 'eleve' where id = public.current_profile_id() $$,
                 '42501', null, 'REST : le dernier admin ne peut pas se retirer le rôle');
select throws_ok($$ select public.admin_set_role((select v from ids where k = 'child'), 'prof') $$,
                 '42501', null, 'admin_set_role : profil enfant (sans login) refusé');
select throws_ok($$ update public.profiles set role = 'admin' where id = (select v from ids where k = 'child') $$,
                 '42501', null, 'REST : pas de rôle pour un profil enfant');
select lives_ok($$ select public.admin_set_role(public.current_profile_id(), 'admin') $$,
                'admin_set_role : admin → admin (sans changement) accepté');
select lives_ok($$ select public.admin_set_role(pg_temp.pid('a2000000-0000-0000-0000-000000000002'), 'admin') $$,
                'admin promeut un second admin');
select lives_ok($$ select public.admin_set_role(public.current_profile_id(), 'eleve') $$,
                'avec un autre admin, l''admin peut se rétrograder');
reset role;
select is((select role::text from public.profiles where auth_user_id = 'a1000000-0000-0000-0000-000000000001'),
          'eleve', 'a1 rétrogradé');
select pg_temp.login('a2000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.admin_set_role(public.current_profile_id(), 'eleve') $$,
                 '42501', null, 'a2 est maintenant le dernier admin');
select lives_ok($$ select public.admin_set_role(pg_temp.pid('a1000000-0000-0000-0000-000000000001'), 'admin') $$,
                'a2 repromeut a1');
select lives_ok($$ update public.profiles set role = 'eleve' where id = public.current_profile_id() $$,
                'REST : rétrogradation possible s''il reste un admin');
reset role;

-- ---------------------------------------------------------------------------
-- 4. public_profiles : comptes actifs uniquement
-- ---------------------------------------------------------------------------
select pg_temp.login('50000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('e0000000-0000-0000-0000-00000000000e')),
          0, 'public_profiles : mineur sans consentement absent');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('bb000000-0000-0000-0000-0000000000bb')),
          0, 'public_profiles : prof en attente absent');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('cc000000-0000-0000-0000-0000000000cc')),
          0, 'public_profiles : prof refusé absent');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('dd000000-0000-0000-0000-0000000000dd')),
          1, 'public_profiles : compte actif présent');
select is((select count(*)::int from public.public_profiles where id = (select v from ids where k = 'child')),
          1, 'public_profiles : enfant créé par un parent présent');
reset role;
update public.profiles set parent_consent_at = now() where auth_user_id = 'e0000000-0000-0000-0000-00000000000e';
select pg_temp.login('50000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.public_profiles where id = pg_temp.pid('e0000000-0000-0000-0000-00000000000e')),
          1, 'public_profiles : mineur présent après consentement');
reset role;
update public.profiles set parent_consent_at = null where auth_user_id = 'e0000000-0000-0000-0000-00000000000e';

-- ---------------------------------------------------------------------------
-- 5. Limites de longueur, au moins un sport
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.signup('10000000-0000-0000-0000-000000000051', 'long1@t.ch',
                    jsonb_build_object('first_name', repeat('x', 51), 'last_name', 'L', 'age', 20, 'sports', '["mma"]'::jsonb)) $$,
                 '23514', null, 'inscription : prénom de 51 caractères refusé');
select throws_ok($$ select pg_temp.signup('10000000-0000-0000-0000-000000000052', 'long2@t.ch',
                    jsonb_build_object('first_name', 'F', 'last_name', repeat('x', 51), 'age', 20, 'sports', '["mma"]'::jsonb)) $$,
                 '23514', null, 'inscription : nom de 51 caractères refusé');
select lives_ok($$ select pg_temp.signup('10000000-0000-0000-0000-000000000050', 'long0@t.ch',
                    jsonb_build_object('first_name', repeat('é', 50), 'last_name', repeat('x', 50), 'age', 20, 'sports', '["mma"]'::jsonb)) $$,
                'inscription : prénom et nom de 50 caractères acceptés');
select throws_ok($$ select pg_temp.signup('10000000-0000-0000-0000-000000000053', 'nosport@t.ch',
                    '{"first_name":"N","last_name":"S","age":20,"sports":[]}') $$,
                 '23514', null, 'inscription : aucun sport refusé');
select throws_ok($$ select pg_temp.signup('10000000-0000-0000-0000-000000000054', 'cv@t.ch',
                    jsonb_build_object('first_name', 'C', 'last_name', 'V', 'age', 30, 'sports', '["mma"]'::jsonb,
                                       'role', 'prof', 'coach_years', 1, 'cv', repeat('x', 3001))) $$,
                 '23514', null, 'inscription : cv de 3001 caractères refusé');
select pg_temp.login('50000000-0000-0000-0000-000000000005');
select throws_ok($$ update public.profiles set phone = repeat('1', 31) where id = public.current_profile_id() $$,
                 '23514', null, 'téléphone de 31 caractères refusé');
select throws_ok($$ update public.profiles set training_places = repeat('x', 1001) where id = public.current_profile_id() $$,
                 '23514', null, 'lieux d''entraînement de 1001 caractères refusés');
select throws_ok($$ update public.profiles set competition_awards = repeat('x', 1001) where id = public.current_profile_id() $$,
                 '23514', null, 'palmarès de 1001 caractères refusé');
select throws_ok($$ update public.profiles set sports = '{}' where id = public.current_profile_id() $$,
                 '23514', null, 'sports vide refusé');
select lives_ok($$ update public.profiles set phone = repeat('1', 30), cv = repeat('x', 3000) where id = public.current_profile_id() $$,
                'téléphone de 30 et cv de 3000 caractères acceptés');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Âge abaissé sous 16 ans sans consentement
-- ---------------------------------------------------------------------------
select pg_temp.login('f7000000-0000-0000-0000-0000000000f7');
select throws_ok($$ update public.profiles set age = 15 where id = public.current_profile_id() $$,
                 '42501', null, '17 ans sans consentement : âge -> 15 refusé');
select lives_ok($$ update public.profiles set age = 16 where id = public.current_profile_id() $$,
                '17 ans : âge -> 16 accepté');
reset role;
select pg_temp.login('dd000000-0000-0000-0000-0000000000dd');
select lives_ok($$ update public.profiles set age = 12 where id = (select v from ids where k = 'child') $$,
                'profil enfant : âge abaissé librement par le parent');
reset role;

-- ---------------------------------------------------------------------------
-- 8. create_child_profile : moins de 18 ans
-- ---------------------------------------------------------------------------
select pg_temp.login('dd000000-0000-0000-0000-0000000000dd');
select throws_ok($$ select public.create_child_profile('{"first_name":"Big","last_name":"P","age":18,"sports":["mma"]}') $$,
                 '22023', null, 'create_child_profile : 18 ans refusé');
select lives_ok($$ select public.create_child_profile('{"first_name":"Teen","last_name":"P","age":17,"sports":["mma"]}') $$,
                'create_child_profile : 17 ans accepté');
reset role;

-- ---------------------------------------------------------------------------
-- 9. DELETE REST : jamais un profil avec login
-- ---------------------------------------------------------------------------
select pg_temp.login('a1000000-0000-0000-0000-000000000001');
delete from public.profiles where auth_user_id = '50000000-0000-0000-0000-000000000005';
reset role;
select is((select count(*)::int from public.profiles where auth_user_id = '50000000-0000-0000-0000-000000000005'),
          1, 'admin : DELETE REST d''un profil avec login sans effet');
select pg_temp.login('a1000000-0000-0000-0000-000000000001');
delete from public.profiles where id = (select v from ids where k = 'child');
reset role;
select is((select count(*)::int from public.profiles where id = (select v from ids where k = 'child')),
          0, 'admin : DELETE REST d''un profil enfant accepté');

select * from finish();
rollback;
