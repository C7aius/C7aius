-- pgTAP : moins de 16 ans masqués du classement (migration 0017)
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

create function pg_temp.signup(p_id uuid, p_email text, p_meta jsonb) returns void
language sql as $$
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta);
$$;
create function pg_temp.login(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;
create function pg_temp.pid(p_auth uuid) returns uuid
language sql security definer as $$ select id from public.profiles where auth_user_id = p_auth $$;
create function pg_temp.k(p_k text) returns uuid
language sql stable as $$ select v from ids where k = p_k $$;

-- c1..c6 : cours passés d'une heure
create function pg_temp.mk(p_key text, p_start timestamptz) returns void
language sql security definer as $$
  with c as (
    insert into public.courses (sport, level, location_id, starts_at, ends_at, status, created_by)
    values ('jjb', 'adulte', (select id from public.locations where is_default),
            p_start, p_start + interval '1 hour', 'prevu',
            (select id from public.profiles where role = 'admin' limit 1))
    returning id)
  insert into ids select p_key, c.id from c;
$$;
create function pg_temp.mark(p_course text, p_profile text) returns void
language sql security definer as $$
  insert into public.attendance (course_id, profile_id, present)
  values (pg_temp.k(p_course), pg_temp.k(p_profile), true);
$$;

-- s1, s2 : adultes (5 présences) ; s3 : adulte (2) ; q : 16 ans (1) ;
-- m : 12 ans avec accord parental (6) ; m2 : 14 ans avec accord (3) ;
-- ch : enfant sans login de s1, 9 ans (6)
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'ha@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('51000000-0000-0000-0000-000000000051', 'hs1@t.ch', '{"first_name":"Sam","last_name":"Alpha","age":25,"sports":["jjb"]}');
select pg_temp.signup('52000000-0000-0000-0000-000000000052', 'hs2@t.ch', '{"first_name":"Sue","last_name":"Beta","age":26,"sports":["jjb"]}');
select pg_temp.signup('53000000-0000-0000-0000-000000000053', 'hs3@t.ch', '{"first_name":"Sid","last_name":"Gamma","age":27,"sports":["jjb"]}');
select pg_temp.signup('56000000-0000-0000-0000-000000000056', 'hq@t.ch',  '{"first_name":"Quinn","last_name":"Sixteen","age":16,"sports":["jjb"]}');
select pg_temp.signup('e1000000-0000-0000-0000-0000000000e1', 'hm@t.ch',  '{"first_name":"Max","last_name":"Minor","age":12,"sports":["jjb"],"parent_email":"pm@t.ch"}');
select pg_temp.signup('e2000000-0000-0000-0000-0000000000e2', 'hm2@t.ch', '{"first_name":"Mia","last_name":"Minor","age":14,"sports":["jjb"],"parent_email":"pm2@t.ch"}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set parent_consent_at = now()
 where auth_user_id in ('e1000000-0000-0000-0000-0000000000e1', 'e2000000-0000-0000-0000-0000000000e2');
insert into ids values
  ('s1', pg_temp.pid('51000000-0000-0000-0000-000000000051')),
  ('s2', pg_temp.pid('52000000-0000-0000-0000-000000000052')),
  ('s3', pg_temp.pid('53000000-0000-0000-0000-000000000053')),
  ('q',  pg_temp.pid('56000000-0000-0000-0000-000000000056')),
  ('m',  pg_temp.pid('e1000000-0000-0000-0000-0000000000e1')),
  ('m2', pg_temp.pid('e2000000-0000-0000-0000-0000000000e2'));
with c as (
  insert into public.profiles (parent_profile_id, first_name, last_name, age, sports)
  values (pg_temp.k('s1'), 'Kid', 'Alpha', 9, '{jjb}') returning id)
insert into ids select 'ch', id from c;

select pg_temp.mk('c' || d, now() - make_interval(days => d)) from generate_series(1, 6) d;
select pg_temp.mark('c' || d, 's1') from generate_series(1, 5) d;
select pg_temp.mark('c' || d, 's2') from generate_series(1, 5) d;
select pg_temp.mark('c' || d, 's3') from generate_series(1, 2) d;
select pg_temp.mark('c1', 'q');
select pg_temp.mark('c' || d, 'm')  from generate_series(1, 6) d;
select pg_temp.mark('c' || d, 'm2') from generate_series(1, 3) d;
select pg_temp.mark('c' || d, 'ch') from generate_series(1, 6) d;

select pg_temp.login('51000000-0000-0000-0000-000000000051');
create temp table r as select * from public.attendance_ranking();
select ok(not exists (select 1 from r where profile_id in (pg_temp.k('m'), pg_temp.k('m2'))),
          'moins de 16 ans (inscrits seuls) absents du classement');
select ok(not exists (select 1 from r where profile_id = pg_temp.k('ch')), 'enfant sans login absent du classement');
select is((select rank from r where profile_id = pg_temp.k('s1')), 1, 's1 : rang 1 (le mineur à 6 ne prend pas de rang)');
select is((select rank from r where profile_id = pg_temp.k('s3')), 2, 's3 : rang 2');
select is((select rank from r where profile_id = pg_temp.k('q')), 3, '16 ans : visible, rang 3');
select is((select count(*)::int from r), 4, 's1, s2, s3, q');
select is((select count(*)::int from public.attendance_ranking('all', 1)), 2, 'p_limit = 1 : s1, s2');
select is((select row(rank, sessions)::text from public.my_ranking()), '(1,5)', 'my_ranking adulte inchangé');
reset role;

select pg_temp.login('e1000000-0000-0000-0000-0000000000e1');
select lives_ok($$ select * from public.attendance_ranking() $$, 'mineur actif : peut ouvrir le classement');
select is((select row(rank, sessions)::text from public.my_ranking()), '(1,6)', 'my_ranking mineur : rang 1, 6 présences');
reset role;
select pg_temp.login('e2000000-0000-0000-0000-0000000000e2');
select is((select row(rank, sessions)::text from public.my_ranking()), '(2,3)', 'my_ranking mineur : rang 2 (après les 5), 3 présences');
reset role;
select pg_temp.login('56000000-0000-0000-0000-000000000056');
select is((select row(rank, sessions)::text from public.my_ranking()), '(3,1)', 'my_ranking 16 ans : (3, 1)');
reset role;

select * from finish();
rollback;
