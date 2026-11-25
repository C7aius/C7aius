-- pgTAP : modifier, annuler, assigner et prendre un cours (migrations 0005, 0006)
begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create temp table res (k text primary key, v uuid[]);
grant all on res to authenticated;
create temp table counts (k text primary key, v int);
grant all on counts to authenticated;

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

create function pg_temp.pid(p_auth uuid) returns uuid
language sql security definer as $$ select id from public.profiles where auth_user_id = p_auth $$;

create function pg_temp.k(p_k text) returns uuid
language sql stable as $$ select v from ids where k = p_k $$;

-- série de n cours (superuser), le premier à now() + p_first, puis chaque
-- semaine ; 19:00 Europe/Zurich est inutile ici : seuls les instants comptent.
create function pg_temp.mk_series(p_creator uuid, p_n int, p_first interval,
                                  p_private bool default false, p_prof uuid default null)
returns uuid[]
language plpgsql security definer as $$
declare v_series uuid; v_ids uuid[];
begin
  insert into public.course_series (created_by) values (p_creator) returning id into v_series;
  with ins as (
    insert into public.courses (series_id, sport, level, is_private, location_id, starts_at, ends_at,
                                prof_id, created_by)
    select v_series, 'jjb', 'adulte', p_private, (select id from public.locations where is_default),
           date_trunc('minute', now()) + p_first + (i * interval '1 week'),
           date_trunc('minute', now()) + p_first + (i * interval '1 week') + interval '90 minutes',
           coalesce(p_prof, p_creator), p_creator
      from generate_series(0, p_n - 1) i
    returning id, starts_at
  )
  select array_agg(id order by starts_at) into v_ids from ins;
  return v_ids;
end;
$$;

create function pg_temp.book(p_course uuid, p_profile uuid, p_by uuid) returns void
language sql security definer as $$
  insert into public.bookings (course_id, profile_id, booked_by) values (p_course, p_profile, p_by);
$$;

-- a : admin ; p1, p2 : profs validés ; s1, s2 : élèves ; pa : parent (élève) de l'enfant ch (sans login)
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'ma@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'mp1@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'mp2@t.ch', '{"first_name":"Pro","last_name":"Two","age":30,"sports":["mma"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('51000000-0000-0000-0000-000000000051', 'ms1@t.ch', '{"first_name":"Sam","last_name":"One","age":25,"sports":["jjb"]}');
select pg_temp.signup('52000000-0000-0000-0000-000000000052', 'ms2@t.ch', '{"first_name":"Sue","last_name":"Two","age":26,"sports":["jjb"]}');
select pg_temp.signup('9a000000-0000-0000-0000-00000000009a', 'mpa@t.ch', '{"first_name":"Pa","last_name":"Rent","age":42,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide'
 where auth_user_id in ('b1000000-0000-0000-0000-0000000000b1', 'b2000000-0000-0000-0000-0000000000b2');

insert into ids values
  ('a',  pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p1', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('p2', pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
  ('s1', pg_temp.pid('51000000-0000-0000-0000-000000000051')),
  ('s2', pg_temp.pid('52000000-0000-0000-0000-000000000052')),
  ('pa', pg_temp.pid('9a000000-0000-0000-0000-00000000009a'));
insert into public.profiles (parent_profile_id, first_name, last_name, age, sports)
values (pg_temp.k('pa'), 'Kid', 'Rent', 9, '{jjb}');
insert into ids values ('ch', (select id from public.profiles where parent_profile_id = pg_temp.k('pa')));

-- upd : série de 4 de p1 (demain + 3 semaines)
insert into res values ('upd', pg_temp.mk_series(pg_temp.k('p1'), 4, interval '1 day'));
-- can : série de p1 : 1 cours passé puis 3 cours futurs
insert into res values ('can', pg_temp.mk_series(pg_temp.k('p1'), 4, interval '-6 days'));
-- priv : cours privé créé par l'admin, assigné à p1
insert into res values ('priv', pg_temp.mk_series(pg_temp.k('a'), 1, interval '2 days', true, pg_temp.k('p1')));
-- privp1 : cours de p1 rendu privé (état forcé côté serveur)
insert into res values ('privp1', pg_temp.mk_series(pg_temp.k('p1'), 1, interval '2 days', true));
-- past : cours de p1 commencé il y a une heure
insert into res values ('past', pg_temp.mk_series(pg_temp.k('p1'), 1, interval '-1 hour'));
-- kid : cours unique de p1 où le parent a inscrit son enfant
insert into res values ('kid', pg_temp.mk_series(pg_temp.k('p1'), 1, interval '3 days'));
-- vac : créneau vacant (admin) ; om : open mat vacant ; vacpriv : privé vacant
insert into res values ('vac', pg_temp.mk_series(pg_temp.k('a'), 1, interval '4 days'));
update public.courses set prof_id = null where id = (select v[1] from res where k = 'vac');
insert into res values ('om', pg_temp.mk_series(pg_temp.k('a'), 1, interval '4 days'));
update public.courses set prof_id = null, status = 'open_mat', vacancy_notified_at = now()
 where id = (select v[1] from res where k = 'om');
insert into res values ('vacpriv', pg_temp.mk_series(pg_temp.k('a'), 1, interval '4 days', true));
update public.courses set prof_id = null where id = (select v[1] from res where k = 'vacpriv');

create function pg_temp.r(p_k text, p_i int default 1) returns uuid
language sql stable as $$ select v[p_i] from res where k = p_k $$;

-- inscriptions : s1 et s2 à chacun des 3 cours futurs de « can » ; l'enfant à « kid »
select pg_temp.book(pg_temp.r('can', i), pg_temp.k(s), pg_temp.k(s))
  from generate_series(1, 4) i, unnest(array['s1', 's2']) s;
select pg_temp.book(pg_temp.r('kid'), pg_temp.k('ch'), pg_temp.k('pa'));
-- une inscription annulée ne compte pas
update public.bookings set cancelled_at = now()
 where course_id = pg_temp.r('can', 1) and profile_id = pg_temp.k('s2');
select pg_temp.book(pg_temp.r('can', 2), pg_temp.k('pa'), pg_temp.k('pa'));
update public.bookings set cancelled_at = now()
 where course_id = pg_temp.r('can', 2) and profile_id = pg_temp.k('pa');

-- ---------------------------------------------------------------------------
-- bookings : index unique sur les inscriptions actives
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.book(pg_temp.r('kid'), pg_temp.k('ch'), pg_temp.k('pa')) $$,
                 '23505', null, 'bookings : une seule inscription active par profil et cours');
select lives_ok($$ select pg_temp.book(pg_temp.r('can', 2), pg_temp.k('pa'), pg_temp.k('pa'));
                   update public.bookings set cancelled_at = now()
                    where course_id = pg_temp.r('can', 2) and profile_id = pg_temp.k('pa') and cancelled_at is null $$,
                'bookings : réinscription possible après annulation');

-- ---------------------------------------------------------------------------
-- update_course
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is(public.update_course(pg_temp.r('upd', 2), '{"places":12,"price_member":15}', 'following'), 3,
          'update following sur la 2e occurrence d''une série de 4 → 3');
select is((select array_agg(places order by starts_at) from public.courses where series_id =
            (select series_id from public.courses where id = pg_temp.r('upd'))),
          array[20, 12, 12, 12], 'la 1re occurrence est inchangée');
select is((select price_member from public.courses where id = pg_temp.r('upd', 4)), 15.00::numeric(8,2),
          'prix modifié sur la dernière occurrence');
select is(public.update_course(pg_temp.r('upd', 1), '{"places":8}', 'one'), 1, 'update one → 1');
select is((select array_agg(places order by starts_at) from public.courses where series_id =
            (select series_id from public.courses where id = pg_temp.r('upd'))),
          array[8, 12, 12, 12], 'update one : seule l''occurrence ciblée change');

-- heures : même jour local, nouvelles heures Europe/Zurich
select is(public.update_course(pg_temp.r('upd', 3), '{"start_time":"18:15","end_time":"19:45","sport":"grappling","level":"enfant","kind":"competition"}', 'one'),
          1, 'update one : heures, sport, niveau, type');
select is((select to_char(starts_at at time zone 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') || ' ' ||
                  to_char(ends_at at time zone 'Europe/Zurich', 'HH24:MI') || ' ' || sport || ' ' || level || ' ' || kind
             from public.courses where id = pg_temp.r('upd', 3)),
          (select to_char((date_trunc('minute', now()) + interval '15 days') at time zone 'Europe/Zurich', 'YYYY-MM-DD')
                  || ' 18:15 19:45 grappling enfant competition'),
          'heures appliquées en Europe/Zurich, même jour local');
select lives_ok($$ select public.update_course(pg_temp.r('upd', 4),
                    jsonb_build_object('location_id', (select id from public.locations where name = 'Sion')), 'one') $$,
                'update : changement de lieu');
select is((select l.name from public.courses c join public.locations l on l.id = c.location_id
            where c.id = pg_temp.r('upd', 4)), 'Sion', 'lieu modifié');

select is(pg_temp.hint_of($$ select public.update_course(pg_temp.r('upd', 2), '{"places":"abc"}', 'one') $$),
          'invalid_field', 'valeur illisible → invalid_field');
select is(pg_temp.hint_of($$ select public.update_course(pg_temp.r('upd', 2), '{"places":10}', 'all') $$),
          'invalid_field', 'portée inconnue → invalid_field');
select is(pg_temp.hint_of($$ select public.update_course(pg_temp.r('upd', 2), '{"is_private":true}', 'one') $$),
          'invalid_field', 'clé non modifiable → invalid_field');
select is(pg_temp.hint_of($$ select public.update_course(pg_temp.r('upd', 2), '{"start_time":"25:00"}', 'one') $$),
          'invalid_field', 'heure invalide → invalid_field');
select throws_ok($$ select public.update_course(pg_temp.r('upd', 2), '{"start_time":"22:00","end_time":"21:00"}', 'one') $$,
                 '23514', null, 'fin avant début refusée');
select throws_ok($$ select public.update_course(pg_temp.r('upd', 2), '{"places":0}', 'one') $$,
                 '23514', null, 'places = 0 refusé');
select throws_ok($$ select public.update_course(gen_random_uuid(), '{"places":10}', 'one') $$,
                 'P0002', null, 'cours inconnu → P0002');
select is(pg_temp.hint_of($$ select public.update_course(pg_temp.r('past'), '{"places":10}', 'one') $$),
          'course_started', 'cours commencé → course_started');
select throws_ok($$ select public.update_course(pg_temp.r('priv'), '{"places":10}', 'one') $$,
                 '42501', null, 'prof assigné à un cours privé de l''admin → 42501');
select throws_ok($$ select public.update_course(pg_temp.r('privp1'), '{"places":10}', 'one') $$,
                 '42501', null, 'prof créateur d''un cours privé → 42501');
reset role;

select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.update_course(pg_temp.r('upd', 2), '{"places":10}', 'one') $$,
                 '42501', null, 'prof non créateur → 42501');
select throws_ok($$ select public.cancel_course(pg_temp.r('upd', 2), 'one') $$,
                 '42501', null, 'cancel : prof non créateur → 42501');
reset role;

select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok($$ select public.update_course(pg_temp.r('upd', 2), '{"places":10}', 'one') $$,
                 '42501', null, 'élève : update_course refusé');
select throws_ok($$ select public.cancel_course(pg_temp.r('upd', 2), 'one') $$,
                 '42501', null, 'élève : cancel_course refusé');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(public.update_course(pg_temp.r('priv'), '{"places":6}', 'one'), 1, 'admin : modifie un cours privé');
select is(public.update_course(pg_temp.r('upd', 2), '{"places":14}', 'one'), 1, 'admin : modifie le cours d''un prof');
reset role;

-- ---------------------------------------------------------------------------
-- cancel_course
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is(public.cancel_course(pg_temp.r('can', 2), 'following'), 3, 'cancel following → 3 cours annulés');
reset role;
select is((select array_agg(status::text order by starts_at) from public.courses
            where series_id = (select series_id from public.courses where id = pg_temp.r('can'))),
          array['prevu', 'annule', 'annule', 'annule'], 'cours passé non modifié, 3 futurs annulés');
select is((select count(*)::int from public.notification_outbox where kind = 'course_cancelled'
            and course_id = any ((select v from res where k = 'can')::uuid[])),
          6, '6 lignes course_cancelled (2 élèves × 3 cours)');
select is((select count(*)::int from public.notification_outbox
            where course_id = pg_temp.r('can', 1)), 0, 'aucune notification pour le cours passé');
select is((select count(*)::int from public.notification_outbox
            where profile_id = pg_temp.k('pa')), 0, 'inscription annulée : pas de notification');
select is((select array_agg(distinct profile_id order by profile_id) from public.notification_outbox
            where course_id = any ((select v from res where k = 'can')::uuid[])),
          (select array_agg(x order by x) from unnest(array[pg_temp.k('s1'), pg_temp.k('s2')]) x),
          'notifications pour s1 et s2');
select is((select count(*)::int from public.notification_outbox where sent_at is not null or error is not null),
          0, 'lignes en attente d''envoi');

select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is(public.cancel_course(pg_temp.r('can', 2), 'following'), 0, 'déjà annulés : 0, idempotent');
select is(pg_temp.hint_of($$ select public.update_course(pg_temp.r('can', 3), '{"places":10}', 'one') $$),
          'course_cancelled', 'update d''un cours annulé → course_cancelled');
select is(pg_temp.hint_of($$ select public.cancel_course(pg_temp.r('past'), 'one') $$),
          'course_started', 'cancel d''un cours commencé → course_started');
select is(pg_temp.hint_of($$ select public.cancel_course(pg_temp.r('kid'), 'later') $$),
          'invalid_field', 'cancel : portée inconnue → invalid_field');
select is(public.cancel_course(pg_temp.r('kid'), 'one'), 1, 'cancel one → 1');
reset role;
select is((select count(*)::int from public.notification_outbox where course_id = pg_temp.r('kid')),
          1, 'enfant inscrit : une seule ligne');
select is((select profile_id from public.notification_outbox where course_id = pg_temp.r('kid')),
          pg_temp.k('pa'), 'enfant sans login : la ligne est pour le parent');
select is((select payload->>'child_profile_id' from public.notification_outbox where course_id = pg_temp.r('kid')),
          pg_temp.k('ch')::text, 'payload : child_profile_id');
select is((select count(*)::int from public.notification_outbox where course_id = pg_temp.r('upd', 1)),
          0, 'update_course n''écrit aucune notification');

-- ---------------------------------------------------------------------------
-- take_slot
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.take_slot(pg_temp.r('vac')) $$, 'p1 prend le créneau vacant');
reset role;
select is((select prof_id from public.courses where id = pg_temp.r('vac')), pg_temp.k('p1'), 'créneau attribué à p1');
select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select is(pg_temp.hint_of($$ select public.take_slot(pg_temp.r('vac')) $$), 'slot_taken', 'p2 ensuite → slot_taken');
select throws_ok($$ select public.take_slot(pg_temp.r('vac')) $$, '22023', null, 'slot_taken : 22023');
select throws_ok($$ select public.take_slot(pg_temp.r('vacpriv')) $$, '42501', null, 'take_slot sur un cours privé → 42501');
select lives_ok($$ select public.take_slot(pg_temp.r('om')) $$, 'p2 prend l''open mat');
reset role;
select is((select status::text || ' ' || (vacancy_notified_at is null)::text from public.courses where id = pg_temp.r('om')),
          'prevu true', 'open mat repris : prevu, vacance réinitialisée');
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok($$ select public.take_slot(pg_temp.r('vacpriv')) $$, '42501', null, 'élève : take_slot → 42501');
reset role;

-- ---------------------------------------------------------------------------
-- assign_prof
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.assign_prof(pg_temp.r('vacpriv'), pg_temp.k('p1')) $$, '42501', null, 'prof : assign_prof → 42501');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(pg_temp.hint_of($$ select public.assign_prof(pg_temp.r('vacpriv'), pg_temp.k('s1')) $$),
          'invalid_prof', 'assign_prof vers un élève → invalid_prof');
select throws_ok($$ select public.assign_prof(pg_temp.r('vacpriv'), pg_temp.k('s1')) $$, '22023', null, 'assign_prof vers un élève → 22023');
select lives_ok($$ select public.assign_prof(pg_temp.r('vacpriv'), pg_temp.k('p2')) $$, 'admin assigne p2');
select is((select prof_id from public.courses where id = pg_temp.r('vacpriv')), pg_temp.k('p2'), 'p2 assigné');
select lives_ok($$ select public.assign_prof(pg_temp.r('vacpriv'), null) $$, 'admin libère le créneau');
select is((select prof_id from public.courses where id = pg_temp.r('vacpriv')), null, 'créneau libéré');
reset role;

-- ---------------------------------------------------------------------------
-- leave_slot
-- ---------------------------------------------------------------------------
update public.courses set vacancy_notified_at = now() where id = pg_temp.r('vac');
select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.leave_slot(pg_temp.r('vac')) $$, '42501', null, 'leave_slot par un prof non assigné → 42501');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.leave_slot(pg_temp.r('vac')) $$, 'leave_slot par le prof assigné');
select is(pg_temp.hint_of($$ select public.leave_slot(pg_temp.r('past')) $$), 'course_started', 'leave_slot d''un cours commencé → course_started');
reset role;
select is((select (prof_id is null and vacancy_notified_at is null) from public.courses where id = pg_temp.r('vac')),
          true, 'prof_id et vacancy_notified_at remis à null');

-- ---------------------------------------------------------------------------
-- outbox et bookings illisibles par authenticated
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ select * from public.notification_outbox $$, '42501', null, 'authenticated : notification_outbox illisible');
select throws_ok($$ select * from public.bookings $$, '42501', null, 'authenticated : bookings sans grant (tâche 3)');
select throws_ok($$ select public.notify_profile(pg_temp.k('s1'), 'course_cancelled', null) $$, '42501', null,
                 'notify_profile non exposée');
reset role;
set local role service_role;
select is((select count(*)::int from public.notification_outbox), 7, 'service_role : outbox lisible (6 + 1)');
reset role;

select * from finish();
rollback;
