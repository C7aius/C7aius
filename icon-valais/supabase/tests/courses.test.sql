-- pgTAP : lieux et création de cours (migration 0005)
begin;
create extension if not exists pgtap with schema extensions;

select plan(70);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create temp table res (k text primary key, v uuid[]);
grant all on res to authenticated;

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

-- dates en Europe/Zurich
create function pg_temp.today_z() returns date
language sql stable as $$ select (now() at time zone 'Europe/Zurich')::date $$;
create function pg_temp.tomorrow() returns date
language sql stable as $$ select pg_temp.today_z() + 1 $$;
-- complète p avec local_date = demain s'il n'en a pas
create function pg_temp.c(p jsonb) returns jsonb
language sql stable as $$
  select case when p ? 'local_date' then p else p || jsonb_build_object('local_date', pg_temp.tomorrow()) end
$$;
-- mardi précédant le prochain passage à l'heure d'été (dernier dimanche de
-- mars) strictement après aujourd'hui
create function pg_temp.dst_tuesday() returns date
language sql stable as $$
  select min(t) from (
    select make_date(y, 3, 31) - extract(dow from make_date(y, 3, 31))::int - 5 as t
      from generate_series(extract(year from pg_temp.today_z())::int,
                           extract(year from pg_temp.today_z())::int + 1) y
  ) x where t > pg_temp.today_z()
$$;

create function pg_temp.pid(p_auth uuid) returns uuid
language sql security definer as $$ select id from public.profiles where auth_user_id = p_auth $$;

-- a : admin ; p1, p2 : profs validés ; pp : prof en attente ; s : élève
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'ca@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'cp1@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'cp2@t.ch', '{"first_name":"Pro","last_name":"Two","age":30,"sports":["mma"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('bb000000-0000-0000-0000-0000000000bb', 'cpp@t.ch', '{"first_name":"Pend","last_name":"P","age":30,"sports":["mma"],"coach_years":1,"role":"prof"}');
select pg_temp.signup('50000000-0000-0000-0000-000000000005', 'cs@t.ch',  '{"first_name":"Sam","last_name":"S","age":25,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide'
 where auth_user_id in ('b1000000-0000-0000-0000-0000000000b1', 'b2000000-0000-0000-0000-0000000000b2');

-- ---------------------------------------------------------------------------
-- Lieux : seed
-- ---------------------------------------------------------------------------
select is((select array_agg(name order by name) from public.locations),
          array['Conthey', 'Martigny', 'Sion'], 'seed : Conthey, Martigny, Sion');
select is((select name from public.locations where is_default), 'Conthey', 'seed : Conthey par défaut');

-- ---------------------------------------------------------------------------
-- create_course : droits
-- ---------------------------------------------------------------------------
select pg_temp.login('50000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30"}')) $$,
                 '42501', null, 'élève : create_course refusé');
select throws_ok($$ insert into public.courses (sport, level, location_id, starts_at, ends_at, created_by)
                    values ('jjb', 'adulte', (select id from public.locations limit 1), now(), now() + interval '1 hour',
                            public.current_profile_id()) $$,
                 '42501', null, 'élève : insert direct dans courses refusé');
reset role;

select pg_temp.login('bb000000-0000-0000-0000-0000000000bb');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30"}')) $$,
                 '42501', null, 'prof en attente : create_course refusé');
reset role;

select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select lives_ok($$ insert into res values ('one', public.create_course(
                    pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30"}'))) $$,
                'prof valide : crée un cours');
select is((select cardinality(v) from res where k = 'one'), 1, 'sans p_repeat_until : un seul cours');
select is((select prof_id from public.courses where id = (select v[1] from res where k = 'one')),
          public.current_profile_id(), 'prof sans prof_id : prof = lui-même');
select is((select status::text from public.courses where id = (select v[1] from res where k = 'one')),
          'prevu', 'statut par défaut : prevu');
select is((select places from public.courses where id = (select v[1] from res where k = 'one')),
          20, 'places par défaut : 20');
select is((select l.name from public.courses c join public.locations l on l.id = c.location_id
            where c.id = (select v[1] from res where k = 'one')),
          'Conthey', 'lieu par défaut : Conthey');
select is((select series_id from public.courses where id = (select v[1] from res where k = 'one')),
          null, 'cours unique : sans série');
select is((select created_by from public.courses where id = (select v[1] from res where k = 'one')),
          public.current_profile_id(), 'created_by = appelant');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","is_private":true,"start_time":"19:00","end_time":"20:30"}')) $$,
                 '42501', null, 'prof : cours privé refusé');
select throws_ok(format($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30","prof_id":"%s"}')) $$,
                        pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
                 '42501', null, 'prof : prof_id d''un autre refusé');

-- récurrence hebdomadaire d'aujourd'hui au 31.12 (limite prof)
select lives_ok($$ insert into res values ('rep', public.create_course(
                    jsonb_build_object('sport', 'jjb', 'level', 'adulte', 'start_time', '19:00', 'end_time', '20:30',
                                       'local_date', pg_temp.today_z()),
                    make_date(extract(year from pg_temp.today_z())::int, 12, 31))) $$,
                'prof : cours récurrent d''aujourd''hui au 31.12');
select is((select cardinality(v) from res where k = 'rep'),
          (make_date(extract(year from pg_temp.today_z())::int, 12, 31) - pg_temp.today_z()) / 7 + 1,
          'récurrence prof : une occurrence par semaine jusqu''au 31.12 inclus');
select is((select array_agg(distinct to_char(starts_at at time zone 'Europe/Zurich', 'HH24:MI'))
             from public.courses where id = any ((select v from res where k = 'rep')::uuid[])),
          array['19:00'], 'récurrence prof : tous à 19:00 Europe/Zurich');
select is((select count(distinct series_id)::int from public.courses where id = any ((select v from res where k = 'rep')::uuid[])),
          1, 'récurrence : une seule série');
select isnt((select min(series_id::text) from public.courses where id = any ((select v from res where k = 'rep')::uuid[])),
            null, 'récurrence : série non nulle');

-- dates passées
select is(pg_temp.hint_of($$ select public.create_course(jsonb_build_object('sport', 'jjb', 'level', 'adulte',
                    'start_time', '19:00', 'end_time', '20:30', 'local_date', pg_temp.today_z() - 1)) $$),
          'date_in_past', 'prof : date d''hier refusée (date_in_past)');
select is(pg_temp.hint_of($$ select public.create_course('{"sport":"jjb","level":"adulte","local_date":"1900-01-06","start_time":"19:00","end_time":"20:30"}',
                    make_date(extract(year from pg_temp.today_z())::int, 12, 31)) $$),
          'date_in_past', 'prof : série depuis 1900 refusée (date_in_past)');

-- valeurs illisibles → invalid_field
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","places":"abc","start_time":"19:00","end_time":"20:30"}')) $$),
          'invalid_field', 'places = abc → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"25:00","end_time":"26:00"}')) $$),
          'invalid_field', 'start_time = 25:00 → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"7:00","end_time":"20:30"}')) $$),
          'invalid_field', 'start_time hors format HH:MI → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00:00","end_time":"20:30"}')) $$),
          'invalid_field', 'start_time avec secondes → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","prof_id":"","start_time":"19:00","end_time":"20:30"}')) $$),
          'invalid_field', 'prof_id vide → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course('{"sport":"jjb","level":"adulte","local_date":"2030-13-45","start_time":"19:00","end_time":"20:30"}') $$),
          'invalid_field', 'date invalide → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course('{"sport":"jjb","level":"adulte","local_date":"demain","start_time":"19:00","end_time":"20:30"}') $$),
          'invalid_field', 'date mal formée → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"judo","level":"adulte","start_time":"19:00","end_time":"20:30"}')) $$),
          'invalid_field', 'sport inconnu → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","price_member":"x","start_time":"19:00","end_time":"20:30"}')) $$),
          'invalid_field', 'prix illisible → invalid_field');

select throws_ok(format($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30"}'), '%s-01-15') $$,
                        extract(year from now() at time zone 'Europe/Zurich')::int + 1),
                 '22023', null, 'prof : récurrence dans l''année suivante refusée');
select is(pg_temp.hint_of(format($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30"}'), '%s-01-15') $$,
                        extract(year from now() at time zone 'Europe/Zurich')::int + 1)),
          'repeat_too_far', 'prof : hint repeat_too_far');
select throws_ok($$ update public.courses set places = 99 $$,
                 '42501', null, 'prof : update direct dans courses refusé');
select throws_ok($$ delete from public.courses $$,
                 '42501', null, 'prof : delete direct dans courses refusé');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","places":0,"start_time":"19:00","end_time":"20:30"}')) $$,
                 '23514', null, 'places = 0 refusé');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","places":101,"start_time":"19:00","end_time":"20:30"}')) $$,
                 '23514', null, 'places = 101 refusé');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"19:00"}')) $$,
                 '23514', null, 'end_time = start_time refusé');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"18:00"}')) $$,
                 '23514', null, 'end_time < start_time refusé');
select throws_ok($$ select public.admin_upsert_location('{"name":"Sierre"}') $$,
                 '42501', null, 'prof : admin_upsert_location refusé');
reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok(format($$ select public.create_course(pg_temp.c('{"sport":"mma","level":"adulte","is_private":true,"start_time":"19:00","end_time":"20:30","prof_id":"%s"}')) $$,
                       pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
                'admin : cours privé pour un autre prof');
select throws_ok(format($$ select public.create_course(pg_temp.c('{"sport":"mma","level":"adulte","start_time":"19:00","end_time":"20:30","prof_id":"%s"}')) $$,
                        pg_temp.pid('bb000000-0000-0000-0000-0000000000bb')),
                 '22023', null, 'admin : prof_id d''un prof en attente refusé');
select lives_ok($$ insert into res values ('adm4', public.create_course(
                    pg_temp.c('{"sport":"jjb","level":"enfant","start_time":"17:00","end_time":"18:00"}'),
                    (pg_temp.tomorrow() + interval '4 years')::date)) $$,
                'admin : récurrence sur 4 ans');
select throws_ok($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"enfant","start_time":"17:00","end_time":"18:00"}'),
                    (pg_temp.tomorrow() + interval '5 years' + interval '1 day')::date) $$,
                 '22023', null, 'admin : récurrence 5 ans + 1 jour refusée');

-- admin : rétrodatage de 7 jours au plus
select lives_ok($$ select public.create_course(jsonb_build_object('sport', 'jjb', 'level', 'adulte',
                    'start_time', '19:00', 'end_time', '20:30', 'local_date', pg_temp.today_z() - 7)) $$,
                'admin : cours il y a 7 jours accepté');
select is(pg_temp.hint_of($$ select public.create_course(jsonb_build_object('sport', 'jjb', 'level', 'adulte',
                    'start_time', '19:00', 'end_time', '20:30', 'local_date', pg_temp.today_z() - 8)) $$),
          'date_in_past', 'admin : cours il y a 8 jours refusé (date_in_past)');

-- récurrence à travers le passage à l'heure d'été (dernier dimanche de mars)
select lives_ok($$ insert into res values ('dst', public.create_course(
                    jsonb_build_object('sport', 'jjb', 'level', 'adulte', 'start_time', '19:00', 'end_time', '20:30',
                                       'local_date', pg_temp.dst_tuesday()),
                    pg_temp.dst_tuesday() + 21)) $$,
                'admin : cours récurrent sur 4 mardis autour du passage à l''heure d''été');
select is((select array_agg(to_char(starts_at at time zone 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') order by starts_at)
             from public.courses where id = any ((select v from res where k = 'dst')::uuid[])),
          array[to_char(pg_temp.dst_tuesday(), 'YYYY-MM-DD') || ' 19:00',
                to_char(pg_temp.dst_tuesday() + 7, 'YYYY-MM-DD') || ' 19:00',
                to_char(pg_temp.dst_tuesday() + 14, 'YYYY-MM-DD') || ' 19:00',
                to_char(pg_temp.dst_tuesday() + 21, 'YYYY-MM-DD') || ' 19:00'],
          'DST : 4 cours, tous à 19:00 Europe/Zurich, avant et après le changement');
select is((select array_agg(to_char(starts_at at time zone 'UTC', 'HH24:MI') order by starts_at)
             from public.courses where id = any ((select v from res where k = 'dst')::uuid[])),
          array['18:00', '17:00', '17:00', '17:00'],
          'DST : 18:00 UTC avant (UTC+1), 17:00 UTC après (UTC+2)');
select is((select array_agg(distinct to_char(ends_at at time zone 'Europe/Zurich', 'HH24:MI'))
             from public.courses where id = any ((select v from res where k = 'dst')::uuid[])),
          array['20:30'], 'DST : tous finissent à 20:30');

select lives_ok($$ insert into ids values ('sion', (select id from public.locations where name = 'Sion'));
                   select public.admin_upsert_location(jsonb_build_object('id', (select v from ids where k = 'sion'), 'is_default', true)) $$,
                'admin : Sion devient le lieu par défaut');
select is((select array_agg(name) from public.locations where is_default), array['Sion'],
          'Conthey n''est plus le lieu par défaut');
select lives_ok($$ insert into ids values ('arch', public.admin_upsert_location('{"name":"Ancien","archived":true}')) $$,
                'admin : crée un lieu archivé');
select throws_ok(format($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30","location_id":"%s"}')) $$,
                        (select v from ids where k = 'arch')),
                 '22023', null, 'lieu archivé refusé');
select is(pg_temp.hint_of(format($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30","location_id":"%s"}')) $$,
                        (select v from ids where k = 'arch'))),
          'location_archived', 'hint location_archived');
select throws_ok($$ select public.admin_upsert_location(jsonb_build_object('id', (select v from ids where k = 'sion'), 'archived', true)) $$,
                 '22023', null, 'admin : le lieu par défaut ne peut pas être archivé');
select is(pg_temp.hint_of($$ select public.admin_upsert_location(jsonb_build_object('id', (select v from ids where k = 'sion'), 'is_default', false)) $$),
          'default_required', 'admin : retirer le seul lieu par défaut refusé (default_required)');
select is(pg_temp.hint_of($$ select public.admin_upsert_location('{"name":"Sierre","is_default":"peut-être"}') $$),
          'invalid_field', 'admin_upsert_location : booléen illisible → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_upsert_location('{"id":"","is_default":true}') $$),
          'invalid_field', 'admin_upsert_location : id vide → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_upsert_location('{"name":"   "}') $$),
          'missing_field', 'admin_upsert_location : nom blanc → missing_field');
select throws_ok($$ update public.locations set archived = true where is_default $$,
                 '23514', null, 'admin : UPDATE direct archivant le lieu par défaut refusé');
select throws_ok($$ insert into public.locations (name) values ('  ') $$,
                 '23514', null, 'admin : INSERT direct d''un nom blanc refusé');
select is((select array_agg(name) from public.locations where is_default), array['Sion'],
          'Sion reste le lieu par défaut');
reset role;

-- sans lieu par défaut (état forcé côté serveur)
update public.locations set is_default = false where is_default;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(pg_temp.hint_of($$ select public.create_course(pg_temp.c('{"sport":"jjb","level":"adulte","start_time":"19:00","end_time":"20:30"}')) $$),
          'no_default_location', 'sans lieu par défaut : no_default_location');
reset role;
update public.locations set is_default = true where name = 'Sion';
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
reset role;

select pg_temp.login('50000000-0000-0000-0000-000000000005');
select ok((select count(*) from public.courses) > 0, 'élève actif : cours lisibles');
select is((select count(*)::int from public.locations), 4, 'élève actif : lieux lisibles');
select throws_ok($$ insert into public.locations (name) values ('Pirate') $$,
                 '42501', null, 'élève : écriture directe des lieux refusée');
reset role;

-- ---------------------------------------------------------------------------
-- Compte inactif : aucune lecture
-- ---------------------------------------------------------------------------
select pg_temp.login('bb000000-0000-0000-0000-0000000000bb');
select is((select count(*)::int from public.courses), 0, 'prof en attente : 0 cours lisible');
select is((select count(*)::int from public.locations), 0, 'prof en attente : 0 lieu lisible');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select * from public.courses $$, '42501', null, 'anon : courses illisible');
reset role;

select * from finish();
rollback;
