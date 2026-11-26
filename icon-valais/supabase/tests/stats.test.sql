-- pgTAP : statistiques de présence et d'enseignement (migration 0016)
begin;
create extension if not exists pgtap with schema extensions;

select plan(53);

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

-- exécute p_sql et retourne le HINT de l'erreur levée (null si aucune erreur)
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

-- cours (superuser) commençant à p_start, durée p_len
create function pg_temp.mk(p_key text, p_prof uuid, p_start timestamptz, p_len interval,
                           p_status public.course_status default 'prevu')
returns void
language sql security definer as $$
  with c as (
    insert into public.courses (sport, level, location_id, starts_at, ends_at, prof_id, status, created_by)
    values ('jjb', 'adulte', (select id from public.locations where is_default),
            p_start, p_start + p_len, p_prof, p_status,
            (select id from public.profiles where role = 'admin' limit 1))
    returning id)
  insert into ids select p_key, c.id from c;
$$;

-- présence (superuser)
create function pg_temp.mark(p_course text, p_profile text, p_present bool default true) returns void
language sql security definer as $$
  insert into public.attendance (course_id, profile_id, present)
  values (pg_temp.k(p_course), pg_temp.k(p_profile), p_present);
$$;

-- a : admin ; p1, p2 : profs validés ; pw : prof en attente (inactif) ;
-- mi : mineur sans consentement (inactif) ; s1, s2, s3, y : élèves
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'sa@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'sp1@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'sp2@t.ch', '{"first_name":"Pro","last_name":"Two","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('bd000000-0000-0000-0000-0000000000bd', 'spw@t.ch', '{"first_name":"Pend","last_name":"Ing","age":30,"sports":["jjb"],"coach_years":1,"role":"prof"}');
select pg_temp.signup('e0000000-0000-0000-0000-00000000000e', 'smi@t.ch', '{"first_name":"Min","last_name":"Or","age":13,"sports":["jjb"],"parent_email":"pp@t.ch"}');
select pg_temp.signup('51000000-0000-0000-0000-000000000051', 'ss1@t.ch', '{"first_name":"Sam","last_name":"Alpha","age":25,"sports":["jjb"],"bjj_belt":"bleue"}');
select pg_temp.signup('52000000-0000-0000-0000-000000000052', 'ss2@t.ch', '{"first_name":"Sue","last_name":"Beta","age":26,"sports":["jjb"]}');
select pg_temp.signup('53000000-0000-0000-0000-000000000053', 'ss3@t.ch', '{"first_name":"Sid","last_name":"Gamma","age":27,"sports":["jjb"]}');
select pg_temp.signup('54000000-0000-0000-0000-000000000054', 'sy@t.ch',  '{"first_name":"Yan","last_name":"Year","age":28,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide'
 where auth_user_id in ('b1000000-0000-0000-0000-0000000000b1', 'b2000000-0000-0000-0000-0000000000b2');
insert into ids values
  ('a',  pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p1', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('p2', pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
  ('pw', pg_temp.pid('bd000000-0000-0000-0000-0000000000bd')),
  ('mi', pg_temp.pid('e0000000-0000-0000-0000-00000000000e')),
  ('s1', pg_temp.pid('51000000-0000-0000-0000-000000000051')),
  ('s2', pg_temp.pid('52000000-0000-0000-0000-000000000052')),
  ('s3', pg_temp.pid('53000000-0000-0000-0000-000000000053')),
  ('y',  pg_temp.pid('54000000-0000-0000-0000-000000000054'));

-- c1..c5 : cours passés de 1 h 30 donnés par p1 (il y a 1 à 5 jours)
select pg_temp.mk('c' || d, pg_temp.k('p1'), now() - make_interval(days => d), interval '90 minutes')
  from generate_series(1, 5) d;
-- s1, s2 : 5 présences ; s3 : 2 présences (+ une absence) ; pw, mi : présents (inactifs)
select pg_temp.mark('c' || d, 's1') from generate_series(1, 5) d;
select pg_temp.mark('c' || d, 's2') from generate_series(1, 5) d;
select pg_temp.mark('c1', 's3');
select pg_temp.mark('c2', 's3');
select pg_temp.mark('c3', 's3', false);
select pg_temp.mark('c1', 'pw');
select pg_temp.mark('c1', 'mi');
-- cours annulé passé (p1) et cours qui commence dans 30 min (p1), s1 coché
select pg_temp.mk('cx', pg_temp.k('p1'), now() - interval '6 days', interval '90 minutes', 'annule');
select pg_temp.mk('cf', pg_temp.k('p1'), now() + interval '30 minutes', interval '90 minutes');
select pg_temp.mark('cx', 's1');
select pg_temp.mark('cf', 's1');
-- p1 assiste comme élève au cours c6 (1 h) donné par p2
select pg_temp.mk('c6', pg_temp.k('p2'), now() - interval '2 days', interval '60 minutes');
select pg_temp.mark('c6', 'p1');
-- open mat sans prof, passé, 2 h
select pg_temp.mk('om', null, now() - interval '3 days', interval '2 hours', 'open_mat');
-- y : open mats sans prof le 31.12 de l'an dernier à 23 h 30 (Zurich) et le
-- 1.1 de cette année à 0 h (Zurich), 1 h chacun
create temp table yr as
  select extract(year from now() at time zone 'Europe/Zurich')::int as y;
select pg_temp.mk('ylast', null, make_timestamptz((select y from yr) - 1, 12, 31, 23, 30, 0, 'Europe/Zurich'), interval '1 hour', 'open_mat');
select pg_temp.mk('ynew',  null, make_timestamptz((select y from yr), 1, 1, 0, 0, 0, 'Europe/Zurich'), interval '1 hour', 'open_mat');
select pg_temp.mark('ylast', 'y');
select pg_temp.mark('ynew', 'y');
grant select on yr to authenticated;

-- ---------------------------------------------------------------------------
-- Classement
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
create temp table r as select * from public.attendance_ranking();
select is((select rank from r where profile_id = pg_temp.k('s1')), 1, 's1 (5) : rang 1');
select is((select rank from r where profile_id = pg_temp.k('s2')), 1, 's2 (5) : rang 1 (ex aequo)');
select is((select rank from r where profile_id = pg_temp.k('s3')), 2, 's3 (2) : rang 2 (dense)');
select is((select sessions from r where profile_id = pg_temp.k('s1')), 5,
          'cours annulé et cours pas encore commencé ne comptent pas');
select is((select sessions from r where profile_id = pg_temp.k('s3')), 2, 'une absence ne compte pas');
select is((select bjj_belt::text from r where profile_id = pg_temp.k('s1')), 'bleue', 'ceinture renvoyée');
select is((select first_name || ' ' || last_name from r where profile_id = pg_temp.k('s1')), 'Sam Alpha', 'nom renvoyé');
select is((select sessions from r where profile_id = pg_temp.k('p1')), 1, 'prof présent comme élève : dans le classement');
select ok(not exists (select 1 from r where profile_id in (pg_temp.k('pw'), pg_temp.k('mi'))),
          'comptes inactifs absents du classement');
select ok(not exists (select 1 from r where profile_id = pg_temp.k('a')), 'aucune présence : absent du classement');
select is((select count(*)::int from r), 5, 's1, s2, s3, y, p1');
select is((select array_agg(profile_id) from (select profile_id from public.attendance_ranking() limit 2) t),
          array[pg_temp.k('s1'), pg_temp.k('s2')], 'tri sessions desc, nom');
select is((select count(*)::int from public.attendance_ranking('all', 1)), 2, 'p_limit = 1 : les 2 ex aequo');
select is((select count(*)::int from public.attendance_ranking('all', 2)), 2, 'p_limit = 2 : les 2 premiers');
select is((select count(*)::int from public.attendance_ranking('all', 3)), 4,
          'p_limit = 3 : ex aequo à la 3e place gardés (s3, y)');
select is((select sessions from r where profile_id = pg_temp.k('y')), 2, 'y : 2 présences au total');
select is((select sessions from public.attendance_ranking('year') where profile_id = pg_temp.k('y')), 1,
          'année : 31.12 23 h 30 (Zurich) compte dans l''année précédente, 1.1 0 h dans celle-ci');
select throws_ok($$ select * from public.attendance_ranking('x') $$, '22023', null, 'période inconnue : 22023');
select is(pg_temp.hint_of($$ select * from public.attendance_ranking('x') $$), 'invalid_field', 'HINT invalid_field');
select throws_ok($$ select * from public.attendance_ranking('all', 0) $$, '22023', null, 'p_limit < 1 : 22023');
select throws_ok($$ select * from public.my_ranking('x') $$, '22023', null, 'my_ranking période inconnue : 22023');

-- my_ranking
select is((select row(rank, sessions)::text from public.my_ranking()), '(1,5)', 'my_ranking s1 : (1, 5)');
reset role;
select pg_temp.login('53000000-0000-0000-0000-000000000053');
select is((select row(rank, sessions)::text from public.my_ranking()), '(2,2)', 'my_ranking s3 : (2, 2)');
reset role;
select pg_temp.login('54000000-0000-0000-0000-000000000054');
select is((select sessions from public.my_ranking('year')), 1, 'my_ranking y année : 1');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select row(rank, sessions)::text from public.my_ranking()), '(,0)', 'aucune présence : rang null');
reset role;

-- comptes inactifs : refusés
select pg_temp.login('bd000000-0000-0000-0000-0000000000bd');
select throws_ok($$ select * from public.attendance_ranking() $$, '42501', null, 'prof en attente : classement refusé');
select throws_ok($$ select * from public.my_ranking() $$, '42501', null, 'prof en attente : my_ranking refusé');
reset role;
select pg_temp.login('e0000000-0000-0000-0000-00000000000e');
select throws_ok($$ select * from public.attendance_ranking() $$, '42501', null, 'mineur sans accord : classement refusé');
select throws_ok($$ select * from public.my_ranking() $$, '42501', null, 'mineur sans accord : my_ranking refusé');
reset role;

-- ---------------------------------------------------------------------------
-- Heures (admin)
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok($$ select * from public.admin_teaching_hours(current_date - 30, current_date) $$, '42501', null,
                 'élève : admin_teaching_hours refusé');
select throws_ok($$ select * from public.admin_member_hours(current_date - 30, current_date) $$, '42501', null,
                 'élève : admin_member_hours refusé');
select throws_ok($$ select * from public.admin_member_segments() $$, '42501', null,
                 'élève : admin_member_segments refusé');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
create temp table t as
  select * from public.admin_teaching_hours(
    (now() at time zone 'Europe/Zurich')::date - 30, (now() at time zone 'Europe/Zurich')::date);
select is((select row(courses, hours)::text from t where prof_id = pg_temp.k('p1')), '(5,7.50)',
          'p1 : 5 cours, 7.5 h (annulé et futur exclus, sa présence chez p2 non comptée)');
select is((select row(courses, hours)::text from t where prof_id = pg_temp.k('p2')), '(1,1.00)', 'p2 : 1 cours, 1 h');
select ok(not exists (select 1 from t where prof_id is null), 'open mat sans prof : compte pour personne');
select is((select count(*)::int from t), 2, 'seulement les profs qui ont donné des cours');
select is((select prof_id from t limit 1), pg_temp.k('p1'), 'tri heures desc');
select is((select first_name || ' ' || last_name from t where prof_id = pg_temp.k('p1')), 'Pro One', 'nom du prof');
select is((select row(courses, hours)::text from public.admin_teaching_hours(
             (select (starts_at at time zone 'Europe/Zurich')::date from public.courses where id = pg_temp.k('c1')),
             (select (starts_at at time zone 'Europe/Zurich')::date from public.courses where id = pg_temp.k('c1')))
            where prof_id = pg_temp.k('p1')), '(1,1.50)', 'un cours de 1 h 30 → 1.5 ; bornes incluses');
select throws_ok($$ select * from public.admin_teaching_hours(current_date, current_date - 1) $$, '22023', null,
                 'p_from > p_to : 22023');
select throws_ok($$ select * from public.admin_member_hours(null, current_date) $$, '22023', null,
                 'borne nulle : 22023');

create temp table mh as
  select * from public.admin_member_hours(
    (now() at time zone 'Europe/Zurich')::date - 30, (now() at time zone 'Europe/Zurich')::date);
select is((select row(sessions, hours)::text from mh where profile_id = pg_temp.k('s1')), '(5,7.50)', 's1 : 5 venues, 7.5 h');
select is((select row(sessions, hours)::text from mh where profile_id = pg_temp.k('p1')), '(1,1.00)', 'p1 élève : 1 venue, 1 h');
select is((select array_agg(profile_id) from (select profile_id from mh limit 2) x),
          array[pg_temp.k('s1'), pg_temp.k('s2')], 'tri heures desc, nom');
select is((select row(sessions, hours)::text from public.admin_member_hours(
             make_date((select y from yr) - 1, 12, 31), make_date((select y from yr) - 1, 12, 31))
            where profile_id = pg_temp.k('y')), '(1,1.00)', 'bornes en heure de Zurich (31.12 23 h 30)');
reset role;

-- ---------------------------------------------------------------------------
-- Segments
-- ---------------------------------------------------------------------------
-- o : 5 présences dont 3 récentes ; r : 12 sur 90 jours ; r2 : 11 sur 90 jours
select pg_temp.signup('61000000-0000-0000-0000-000000000061', 'so@t.ch',  '{"first_name":"Oli","last_name":"Occ","age":30,"sports":["jjb"]}');
select pg_temp.signup('62000000-0000-0000-0000-000000000062', 'sr@t.ch',  '{"first_name":"Reg","last_name":"Ular","age":30,"sports":["jjb"]}');
select pg_temp.signup('63000000-0000-0000-0000-000000000063', 'sr2@t.ch', '{"first_name":"Ele","last_name":"Ven","age":30,"sports":["jjb"]}');
insert into ids values
  ('o',  pg_temp.pid('61000000-0000-0000-0000-000000000061')),
  ('r',  pg_temp.pid('62000000-0000-0000-0000-000000000062')),
  ('r2', pg_temp.pid('63000000-0000-0000-0000-000000000063'));
select pg_temp.mk('g' || d, null, now() - make_interval(days => d * 7), interval '1 hour')
  from generate_series(1, 12) d;
select pg_temp.mk('old' || d, null, now() - make_interval(days => 200 + d), interval '1 hour')
  from generate_series(1, 2) d;
select pg_temp.mark('g' || d, 'r') from generate_series(1, 12) d;
select pg_temp.mark('g' || d, 'r2') from generate_series(1, 11) d;
select pg_temp.mark('g' || d, 'o') from generate_series(1, 3) d;
select pg_temp.mark('old' || d, 'o') from generate_series(1, 2) d;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
create temp table sg as select * from public.admin_member_segments();
select is((select segment from sg where profile_id = pg_temp.k('a')), 'jamais', '0 → jamais');
select is((select segment from sg where profile_id = pg_temp.k('p1')), 'essai', '1 → essai');
select is((select row(visits_total, visits_90d, segment)::text from sg where profile_id = pg_temp.k('o')),
          '(5,3,occasionnel)', '5 dont 3 récentes → occasionnel');
select is((select row(visits_total, visits_90d, segment)::text from sg where profile_id = pg_temp.k('r2')),
          '(11,11,occasionnel)', '11 sur 90 jours → occasionnel');
select is((select row(visits_total, visits_90d, segment)::text from sg where profile_id = pg_temp.k('r')),
          '(12,12,regulier)', '12 sur 90 jours → regulier');
select is((select last_visit from sg where profile_id = pg_temp.k('o')),
          ((now() - interval '7 days') at time zone 'Europe/Zurich')::date, 'dernière venue (date Zurich)');
select is((select count(*)::int from sg), (select count(*)::int from public.profiles), 'une ligne par profil');
reset role;

-- anon : jamais
select ok(not has_function_privilege('anon', 'public.attendance_ranking(text, int)', 'execute')
          and not has_function_privilege('anon', 'public.my_ranking(text)', 'execute')
          and not has_function_privilege('anon', 'public.admin_teaching_hours(date, date)', 'execute')
          and not has_function_privilege('anon', 'public.admin_member_hours(date, date)', 'execute')
          and not has_function_privilege('anon', 'public.admin_member_segments()', 'execute'),
          'anon : aucune fonction exécutable');

select * from finish();
rollback;
