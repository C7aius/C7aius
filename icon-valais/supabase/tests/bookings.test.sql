-- pgTAP : réservations et appel (migration 0007)
begin;
create extension if not exists pgtap with schema extensions;

select plan(96);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create temp table got (k text primary key, v uuid);
grant all on got to authenticated;

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

-- cours unique (superuser) commençant à now() + p_start, 90 minutes
create function pg_temp.mk(p_prof uuid, p_start interval, p_status public.course_status default 'prevu')
returns uuid
language sql security definer as $$
  insert into public.courses (sport, level, location_id, starts_at, ends_at, prof_id, status, created_by)
  values ('jjb', 'adulte', (select id from public.locations where is_default),
          now() + p_start, now() + p_start + interval '90 minutes', p_prof, p_status,
          (select id from public.profiles where role = 'admin' limit 1))
  returning id;
$$;

-- inscription directe (superuser), pour les cours déjà commencés
create function pg_temp.book(p_course uuid, p_profile uuid, p_by uuid) returns void
language sql security definer as $$
  insert into public.bookings (course_id, profile_id, booked_by) values (p_course, p_profile, p_by);
$$;

-- nombre d'inscriptions actives (superuser)
create function pg_temp.active(p_course uuid, p_profile uuid) returns int
language sql security definer as $$
  select count(*)::int from public.bookings
   where course_id = p_course and profile_id = p_profile and cancelled_at is null;
$$;

-- a : admin ; p1 : prof validé (assigné) ; p2 : prof validé (non assigné) ;
-- s1, s2 : élèves ; pa : parent (élève) de l'enfant ch (sans login) ;
-- pb : parent de l'enfant chb ; mi : mineur sans consentement (inactif) ;
-- pr : prof refusé (inactif)
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'ba@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'bp1@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'bp2@t.ch', '{"first_name":"Pro","last_name":"Two","age":30,"sports":["mma"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('51000000-0000-0000-0000-000000000051', 'bs1@t.ch', '{"first_name":"Sam","last_name":"One","age":25,"sports":["jjb"],"bjj_belt":"bleue"}');
select pg_temp.signup('52000000-0000-0000-0000-000000000052', 'bs2@t.ch', '{"first_name":"Sue","last_name":"Two","age":26,"sports":["jjb"]}');
select pg_temp.signup('9a000000-0000-0000-0000-00000000009a', 'bpa@t.ch', '{"first_name":"Pa","last_name":"Rent","age":42,"sports":["jjb"]}');
select pg_temp.signup('9b000000-0000-0000-0000-00000000009b', 'bpb@t.ch', '{"first_name":"Pb","last_name":"Other","age":44,"sports":["jjb"]}');
select pg_temp.signup('e0000000-0000-0000-0000-00000000000e', 'bmi@t.ch', '{"first_name":"Min","last_name":"Or","age":13,"sports":["jjb"],"parent_email":"pp@t.ch"}');
select pg_temp.signup('bf000000-0000-0000-0000-0000000000bf', 'bpr@t.ch', '{"first_name":"Ref","last_name":"Used","age":30,"sports":["jjb"],"coach_years":1,"role":"prof"}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide'
 where auth_user_id in ('b1000000-0000-0000-0000-0000000000b1', 'b2000000-0000-0000-0000-0000000000b2');
update public.profiles set prof_status = 'refuse' where auth_user_id = 'bf000000-0000-0000-0000-0000000000bf';

insert into ids values
  ('a',  pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p1', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('p2', pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
  ('s1', pg_temp.pid('51000000-0000-0000-0000-000000000051')),
  ('s2', pg_temp.pid('52000000-0000-0000-0000-000000000052')),
  ('pa', pg_temp.pid('9a000000-0000-0000-0000-00000000009a')),
  ('pb', pg_temp.pid('9b000000-0000-0000-0000-00000000009b'));
insert into public.profiles (parent_profile_id, first_name, last_name, age, sports, bjj_belt)
values (pg_temp.k('pa'), 'Kid', 'Rent', 9, '{jjb}', 'grise'),
       (pg_temp.k('pb'), 'Kid', 'Other', 8, '{jjb}', null);
insert into ids values
  ('ch',  (select id from public.profiles where parent_profile_id = pg_temp.k('pa'))),
  ('chb', (select id from public.profiles where parent_profile_id = pg_temp.k('pb')));

-- cours : c1 (demain, p1) ; c2 (demain, p2, sans inscription) ; canc (annulé) ;
-- started (commencé il y a 10 min, p1) ; soon (dans 1 h, p1) ; near (dans 20 min, p1)
insert into ids values
  ('c1',      pg_temp.mk(pg_temp.k('p1'), interval '1 day')),
  ('c2',      pg_temp.mk(pg_temp.k('p2'), interval '1 day')),
  ('canc',    pg_temp.mk(pg_temp.k('p1'), interval '1 day', 'annule')),
  ('started', pg_temp.mk(pg_temp.k('p1'), interval '-10 minutes')),
  ('soon',    pg_temp.mk(pg_temp.k('p1'), interval '1 hour')),
  ('near',    pg_temp.mk(pg_temp.k('p1'), interval '20 minutes'));

select pg_temp.book(pg_temp.k('started'), pg_temp.k('s1'), pg_temp.k('s1'));
select pg_temp.book(pg_temp.k('started'), pg_temp.k('ch'), pg_temp.k('pa'));

-- ---------------------------------------------------------------------------
-- book_course
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
insert into got values ('b1', public.book_course(pg_temp.k('c1')));
select isnt((select v from got where k = 'b1'), null, 'book_course renvoie l''id de la réservation');
select is(public.book_course(pg_temp.k('c1')), (select v from got where k = 'b1'),
          'réserver deux fois → même réservation');
select is(public.book_course(pg_temp.k('c1'), pg_temp.k('s1')), (select v from got where k = 'b1'),
          'p_profile = soi → même réservation');
reset role;
select is(pg_temp.active(pg_temp.k('c1'), pg_temp.k('s1')), 1, 'une seule réservation active');
select is((select booked_by from public.bookings where id = (select v from got where k = 'b1')),
          pg_temp.k('s1'), 'booked_by = l''appelant');

select pg_temp.login('51000000-0000-0000-0000-000000000051');
select is(pg_temp.hint_of(format('select public.book_course(%L)', pg_temp.k('canc'))),
          'course_closed', 'cours annulé → course_closed');
select throws_ok(format('select public.book_course(%L)', pg_temp.k('canc')),
                 '22023', null, 'cours annulé → 22023');
select is(pg_temp.hint_of(format('select public.book_course(%L)', pg_temp.k('started'))),
          'course_closed', 'cours commencé → course_closed');
select throws_ok($$ select public.book_course(gen_random_uuid()) $$, 'P0002', null, 'cours inconnu → P0002');
select throws_ok(format('select public.book_course(%L, %L)', pg_temp.k('c1'), pg_temp.k('ch')),
                 '42501', null, 'réserver pour l''enfant d''un autre → 42501');
select throws_ok(format('select public.book_course(%L, %L)', pg_temp.k('c1'), pg_temp.k('s2')),
                 '42501', null, 'réserver pour un autre adulte → 42501');
select throws_ok(format('select public.book_course(%L, %L)', pg_temp.k('c1'), gen_random_uuid()),
                 '42501', null, 'réserver pour un profil inconnu → 42501');
reset role;

-- parent
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
insert into got values ('bch', public.book_course(pg_temp.k('c1'), pg_temp.k('ch')));
select isnt((select v from got where k = 'bch'), null, 'un parent réserve pour son enfant');
select is(public.book_course(pg_temp.k('c1'), pg_temp.k('ch')), (select v from got where k = 'bch'),
          'parent : deux fois → même réservation');
select throws_ok(format('select public.book_course(%L, %L)', pg_temp.k('c1'), pg_temp.k('chb')),
                 '42501', null, 'parent : enfant d''un autre parent → 42501');
reset role;
select is((select profile_id::text || ' ' || booked_by::text from public.bookings
            where id = (select v from got where k = 'bch')),
          pg_temp.k('ch')::text || ' ' || pg_temp.k('pa')::text, 'réservation de l''enfant, faite par le parent');

-- comptes inactifs
select pg_temp.login('e0000000-0000-0000-0000-00000000000e');
select throws_ok(format('select public.book_course(%L)', pg_temp.k('c1')),
                 '42501', null, 'mineur sans consentement : book_course → 42501');
select throws_ok(format('select public.unbook_course(%L)', pg_temp.k('c1')),
                 '42501', null, 'mineur sans consentement : unbook_course → 42501');
reset role;
select pg_temp.login('bf000000-0000-0000-0000-0000000000bf');
select throws_ok(format('select public.book_course(%L)', pg_temp.k('c1')),
                 '42501', null, 'prof refusé : book_course → 42501');
reset role;
select pg_temp.login('00000000-0000-0000-0000-0000000000ff');
select throws_ok(format('select public.book_course(%L)', pg_temp.k('c1')),
                 '42501', null, 'sans profil : book_course → 42501');
reset role;

-- ---------------------------------------------------------------------------
-- unbook_course
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select lives_ok(format('select public.unbook_course(%L)', pg_temp.k('c1')), 'se désinscrire');
reset role;
select is(pg_temp.active(pg_temp.k('c1'), pg_temp.k('s1')), 0, 'plus de réservation active');
select isnt((select cancelled_at from public.bookings where id = (select v from got where k = 'b1')),
            null, 'cancelled_at renseigné');
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select lives_ok(format('select public.unbook_course(%L)', pg_temp.k('c1')), 'se désinscrire sans réservation active : sans effet');
insert into got values ('b1bis', public.book_course(pg_temp.k('c1')));
select isnt((select v from got where k = 'b1bis'), (select v from got where k = 'b1'), 'réinscription : nouvelle réservation');
select is(public.book_course(pg_temp.k('c1')), (select v from got where k = 'b1bis'), 'réinscription : deux fois → même réservation');
reset role;
select is(pg_temp.active(pg_temp.k('c1'), pg_temp.k('s1')), 1, 'réinscription : une seule réservation active');
select is((select count(*)::int from public.bookings where course_id = pg_temp.k('c1') and profile_id = pg_temp.k('s1')),
          2, 'historique : une annulée, une active');

select pg_temp.login('51000000-0000-0000-0000-000000000051');
select is(pg_temp.hint_of(format('select public.unbook_course(%L)', pg_temp.k('started'))),
          'course_closed', 'unbook d''un cours commencé → course_closed');
select throws_ok(format('select public.unbook_course(%L)', pg_temp.k('started')),
                 '22023', null, 'unbook d''un cours commencé → 22023');
select throws_ok(format('select public.unbook_course(%L, %L)', pg_temp.k('c1'), pg_temp.k('ch')),
                 '42501', null, 'désinscrire l''enfant d''un autre → 42501');
select throws_ok($$ select public.unbook_course(gen_random_uuid()) $$, 'P0002', null, 'unbook : cours inconnu → P0002');
reset role;
select is(pg_temp.active(pg_temp.k('c1'), pg_temp.k('ch')), 1, 'l''enfant reste inscrit');

select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select lives_ok(format('select public.unbook_course(%L, %L)', pg_temp.k('c1'), pg_temp.k('ch')), 'le parent désinscrit son enfant');
select isnt(public.book_course(pg_temp.k('c1'), pg_temp.k('ch')), (select v from got where k = 'bch'),
            'le parent réinscrit son enfant');
reset role;
select is(pg_temp.active(pg_temp.k('c1'), pg_temp.k('ch')), 1, 'enfant : une seule réservation active');

-- ---------------------------------------------------------------------------
-- course_booking_counts
-- ---------------------------------------------------------------------------
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
            where table_schema = 'public' and table_name = 'course_booking_counts'),
          array['booked', 'course_id'], 'course_booking_counts : course_id et booked uniquement');
select pg_temp.login('52000000-0000-0000-0000-000000000052');
select is((select booked from public.course_booking_counts where course_id = pg_temp.k('c1')),
          2, 'c1 : 2 réservations actives (s1, enfant)');
select is((select booked from public.course_booking_counts where course_id = pg_temp.k('c2')),
          0, 'cours sans réservation : 0');
select is((select booked from public.course_booking_counts where course_id = pg_temp.k('started')),
          2, 'started : 2 réservations actives');
reset role;
select pg_temp.login('e0000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from public.course_booking_counts), 0, 'compte inactif : vue vide');
reset role;
set local role anon;
select throws_ok($$ select * from public.course_booking_counts $$, '42501', null, 'anon : vue illisible');
reset role;

-- ---------------------------------------------------------------------------
-- bookings : RLS (lecture) et aucune écriture directe
-- ---------------------------------------------------------------------------
select pg_temp.login('52000000-0000-0000-0000-000000000052');
select is((select count(*)::int from public.bookings), 0, 's2 ne voit pas les réservations des autres');
reset role;
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select is((select count(*)::int from public.bookings where profile_id <> pg_temp.k('s1')), 0,
          's1 ne voit que ses réservations');
select is((select count(*)::int from public.bookings), 3, 's1 : ses 3 réservations (dont l''annulée)');
select throws_ok(format($$ insert into public.bookings (course_id, profile_id, booked_by) values (%L, %L, %L) $$,
                        pg_temp.k('c2'), pg_temp.k('s1'), pg_temp.k('s1')),
                 '42501', null, 'insert direct refusé');
select throws_ok($$ update public.bookings set cancelled_at = null $$, '42501', null, 'update direct refusé');
select throws_ok($$ delete from public.bookings $$, '42501', null, 'delete direct refusé');
reset role;
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select is((select count(*)::int from public.bookings where profile_id = pg_temp.k('ch')), 3,
          'parent : voit les réservations de son enfant');
select is((select count(*)::int from public.bookings where profile_id not in (pg_temp.k('ch'), pg_temp.k('pa'))), 0,
          'parent : rien d''autre');
reset role;
select pg_temp.login('9b000000-0000-0000-0000-00000000009b');
select is((select count(*)::int from public.bookings), 0, 'autre parent : ne voit rien');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.bookings where course_id = pg_temp.k('c1')), 4,
          'prof assigné : toutes les réservations du cours (y c. annulées)');
reset role;
select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.bookings), 0, 'prof non assigné : ne voit rien');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.bookings), 6, 'admin : toutes les réservations');
reset role;
select pg_temp.login('e0000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from public.bookings), 0, 'compte inactif : rien');
reset role;

-- ---------------------------------------------------------------------------
-- course_participants
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok(format('select * from public.course_participants(%L)', pg_temp.k('c1')),
                 '42501', null, 'course_participants par un élève → 42501');
reset role;
select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select throws_ok(format('select * from public.course_participants(%L)', pg_temp.k('c1')),
                 '42501', null, 'course_participants par un prof non assigné → 42501');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.course_participants(pg_temp.k('c1'))), 2,
          'prof assigné : 2 participants actifs');
select is((select first_name || ' ' || last_name || ' ' || age || ' ' || bjj_belt::text || ' ' || coalesce(present::text, 'null')
             from public.course_participants(pg_temp.k('c1')) where profile_id = pg_temp.k('ch')),
          'Kid Rent 9 grise null', 'enfant : nom, âge, ceinture, present null');
select is((select bjj_belt::text from public.course_participants(pg_temp.k('c1')) where profile_id = pg_temp.k('s1')),
          'bleue', 's1 : ceinture');
select throws_ok($$ select * from public.course_participants(gen_random_uuid()) $$, 'P0002', null,
                 'course_participants : cours inconnu → P0002');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.course_participants(pg_temp.k('c1'))), 2, 'admin : participants');
reset role;

-- ---------------------------------------------------------------------------
-- set_attendance
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is(pg_temp.hint_of(format('select public.set_attendance(%L, %L, true)', pg_temp.k('soon'), pg_temp.k('s1'))),
          'too_early', '1 h avant le cours → too_early');
select throws_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('soon'), pg_temp.k('s1')),
                 '22023', null, 'too_early : 22023');
select lives_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), pg_temp.k('s1')),
                'pendant le cours : s1 présent');
select lives_ok(format('select public.set_attendance(%L, %L, false)', pg_temp.k('started'), pg_temp.k('ch')),
                'pendant le cours : enfant absent');
select lives_ok(format('select public.set_attendance(%L, %L, false)', pg_temp.k('started'), pg_temp.k('s1')),
                'correction : s1 absent');
select lives_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), pg_temp.k('s1')),
                'correction : s1 présent');
select is((select array_agg(coalesce(present::text, 'null') order by last_name)
             from public.course_participants(pg_temp.k('started'))),
          array['true', 'false'], 'participants : present coché (One, Rent)');
-- ajout d'un présent non inscrit
select lives_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), pg_temp.k('s2')),
                'ajout d''un présent non inscrit');
select is(pg_temp.hint_of(format('select public.set_attendance(%L, %L, false)', pg_temp.k('started'), pg_temp.k('pb'))),
          'not_booked', 'absent non inscrit → not_booked');
select is(pg_temp.hint_of(format('select public.set_attendance(%L, %L, null)', pg_temp.k('started'), pg_temp.k('s1'))),
          'missing_field', 'p_present null → missing_field');
select throws_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), gen_random_uuid()),
                 'P0002', null, 'profil inconnu → P0002');
select throws_ok(format('select public.set_attendance(%L, %L, true)', gen_random_uuid(), pg_temp.k('s1')),
                 'P0002', null, 'cours inconnu → P0002');
select is(pg_temp.hint_of(format('select public.set_attendance(%L, %L, true)', pg_temp.k('canc'), pg_temp.k('s1'))),
          'course_cancelled', 'cours annulé → course_cancelled');
reset role;
select is((select booked_by from public.bookings
            where course_id = pg_temp.k('started') and profile_id = pg_temp.k('s2') and cancelled_at is null),
          pg_temp.k('p1'), 'réservation créée, booked_by = le prof');
select is((select count(*)::int || ' ' || bool_and(present)::text from public.attendance
            where course_id = pg_temp.k('started') and profile_id = pg_temp.k('s1')),
          '1 true', 'une seule ligne d''appel par personne');
select is((select marked_by from public.attendance
            where course_id = pg_temp.k('started') and profile_id = pg_temp.k('s1')),
          pg_temp.k('p1'), 'marked_by = le prof');

select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select throws_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), pg_temp.k('s1')),
                 '42501', null, 'set_attendance par un prof non assigné → 42501');
reset role;
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), pg_temp.k('s1')),
                 '42501', null, 'set_attendance par un élève → 42501');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('started'), pg_temp.k('ch')),
                'admin : set_attendance');
reset role;

-- fenêtre : 20 min avant le début → ok ; se désinscrire efface l'appel
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select lives_ok(format('select public.book_course(%L)', pg_temp.k('near')), 's1 réserve near');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select lives_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('near'), pg_temp.k('s1')),
                '20 min avant le début → ok');
reset role;
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select lives_ok(format('select public.unbook_course(%L)', pg_temp.k('near')), 's1 se désinscrit de near');
reset role;
select is((select count(*)::int from public.attendance where course_id = pg_temp.k('near')), 0,
          'désinscription : la ligne d''appel est retirée');

-- ---------------------------------------------------------------------------
-- attendance : RLS
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select is((select count(*)::int from public.attendance), 1, 's1 : voit sa présence');
select is((select count(*)::int from public.attendance where profile_id <> pg_temp.k('s1')), 0, 's1 : rien d''autre');
select throws_ok(format($$ insert into public.attendance (course_id, profile_id, present) values (%L, %L, true) $$,
                        pg_temp.k('c1'), pg_temp.k('s1')),
                 '42501', null, 'attendance : insert direct refusé');
select throws_ok($$ update public.attendance set present = false $$, '42501', null, 'attendance : update direct refusé');
reset role;
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select is((select count(*)::int from public.attendance where profile_id = pg_temp.k('ch')), 1, 'parent : présence de son enfant');
select is((select count(*)::int from public.attendance where profile_id <> pg_temp.k('ch')), 0, 'parent : rien d''autre');
reset role;
select pg_temp.login('52000000-0000-0000-0000-000000000052');
select is((select count(*)::int from public.attendance), 1, 's2 : voit seulement sa présence');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.attendance where course_id = pg_temp.k('started')), 3, 'prof assigné : tout l''appel');
reset role;
select pg_temp.login('b2000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.attendance), 0, 'prof non assigné : rien');
reset role;

-- ---------------------------------------------------------------------------
-- droits d'exécution
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.book_course(gen_random_uuid()) $$, '42501', null, 'anon : book_course refusé');
select throws_ok($$ select * from public.course_participants(gen_random_uuid()) $$, '42501', null,
                 'anon : course_participants refusé');
reset role;

select * from finish();
rollback;
