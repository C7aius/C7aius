-- pgTAP : corrections de la revue finale du plan 2 (migration 0008)
begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

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

-- cours unique (superuser) : now() + p_start, 90 minutes
create function pg_temp.mk(p_prof uuid, p_start interval, p_private bool default false,
                           p_creator uuid default null) returns uuid
language sql security definer as $$
  insert into public.courses (sport, level, is_private, location_id, starts_at, ends_at, prof_id, created_by)
  values ('jjb', 'adulte', p_private, (select id from public.locations where is_default),
          date_trunc('minute', now()) + p_start, date_trunc('minute', now()) + p_start + interval '90 minutes',
          p_prof, coalesce(p_creator, (select id from public.profiles where role = 'admin' limit 1)))
  returning id;
$$;

create function pg_temp.outbox(p_kind text, p_course uuid) returns int
language sql security definer as $$
  select count(*)::int from public.notification_outbox
   where kind = p_kind and course_id is not distinct from p_course;
$$;

-- a : admin ; pc : prof créateur (compte supprimé ensuite) ; p1, p2, p3, p4 : profs validés
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'ra@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('bc000000-0000-0000-0000-0000000000bc', 'rpc@t.ch', '{"first_name":"Cre","last_name":"Ator","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'rp1@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'rp2@t.ch', '{"first_name":"Pro","last_name":"Two","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b3000000-0000-0000-0000-0000000000b3', 'rp3@t.ch', '{"first_name":"Pro","last_name":"Three","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b4000000-0000-0000-0000-0000000000b4', 'rp4@t.ch', '{"first_name":"Pro","last_name":"Four","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('51000000-0000-0000-0000-000000000051', 'rs1@t.ch', '{"first_name":"Sam","last_name":"One","age":25,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide'
 where auth_user_id in ('bc000000-0000-0000-0000-0000000000bc', 'b1000000-0000-0000-0000-0000000000b1',
                        'b2000000-0000-0000-0000-0000000000b2', 'b3000000-0000-0000-0000-0000000000b3',
                        'b4000000-0000-0000-0000-0000000000b4');
insert into ids values
  ('a',  pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('pc', pg_temp.pid('bc000000-0000-0000-0000-0000000000bc')),
  ('p1', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('p2', pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
  ('p3', pg_temp.pid('b3000000-0000-0000-0000-0000000000b3')),
  ('p4', pg_temp.pid('b4000000-0000-0000-0000-0000000000b4')),
  ('s1', pg_temp.pid('51000000-0000-0000-0000-000000000051'));

-- ---------------------------------------------------------------------------
-- 1. Suppression du compte d'un prof qui a créé un cours et une série
-- ---------------------------------------------------------------------------
select pg_temp.login('bc000000-0000-0000-0000-0000000000bc');
select lives_ok($$ insert into ids
                   select 'pc_one', (public.create_course(jsonb_build_object(
                     'sport', 'jjb', 'level', 'adulte', 'start_time', '19:00', 'end_time', '20:30',
                     'local_date', (now() at time zone 'Europe/Zurich')::date + 3)))[1] $$,
                'prof pc : crée un cours unique');
select lives_ok($$ insert into ids
                   select 'pc_ser', (public.create_course(jsonb_build_object(
                     'sport', 'jjb', 'level', 'adulte', 'start_time', '19:00', 'end_time', '20:30',
                     'local_date', (now() at time zone 'Europe/Zurich')::date + 3),
                     (now() at time zone 'Europe/Zurich')::date + 3))[1] $$,
                'prof pc : crée une série');
reset role;
insert into ids select 'pc_series', series_id from public.courses where id = pg_temp.k('pc_ser');

select lives_ok($$ delete from auth.users where id = 'bc000000-0000-0000-0000-0000000000bc' $$,
                'suppression du compte du créateur : réussit');
select is((select count(*)::int from public.profiles where id = pg_temp.k('pc')), 0, 'profil du créateur supprimé');
select is((select count(*)::int from public.courses
            where id in (pg_temp.k('pc_one'), pg_temp.k('pc_ser')) and created_by is null),
          2, 'les cours restent, created_by = null');
select is((select created_by from public.course_series where id = pg_temp.k('pc_series')), null::uuid,
          'la série reste, created_by = null');
-- le créateur était aussi le prof : prof_id = null (ON DELETE SET NULL, 0005)
select is((select count(*)::int from public.courses
            where id in (pg_temp.k('pc_one'), pg_temp.k('pc_ser')) and prof_id is null),
          2, 'prof_id = null');

select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.update_course(pg_temp.k('pc_one'), '{"places":12}', 'one') $$,
                 '42501', null, 'cours sans créateur : un prof ne peut pas le modifier');
select throws_ok($$ select public.cancel_course(pg_temp.k('pc_one'), 'one') $$,
                 '42501', null, 'cours sans créateur : un prof ne peut pas l''annuler');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(public.update_course(pg_temp.k('pc_one'), '{"places":12}', 'one'), 1,
          'cours sans créateur : l''admin le modifie');
select is(public.cancel_course(pg_temp.k('pc_ser'), 'following'), 1,
          'série sans créateur : l''admin l''annule');
reset role;

-- ---------------------------------------------------------------------------
-- 2. process_course_schedule : cours privé vacant → admins seulement
-- ---------------------------------------------------------------------------
insert into ids values
  ('vac_pub',  pg_temp.mk(null, interval '10 hours')),
  ('vac_priv', pg_temp.mk(null, interval '11 hours', true));
-- le cours pc_one (dans 3 jours, vacant) n'est pas dans les 24 h : ignoré
select lives_ok($$ select public.process_course_schedule() $$, 'process_course_schedule');
select is(pg_temp.outbox('slot_vacant', pg_temp.k('vac_pub')), 5, 'cours public vacant : 4 profs validés + 1 admin');
select is(pg_temp.outbox('slot_vacant', pg_temp.k('vac_priv')), 1, 'cours privé vacant : l''admin seulement');
select is((select profile_id from public.notification_outbox
            where kind = 'slot_vacant' and course_id = pg_temp.k('vac_priv')),
          pg_temp.k('a'), 'cours privé vacant : destinataire = admin');
select isnt((select vacancy_notified_at from public.courses where id = pg_temp.k('vac_priv')), null,
            'cours privé vacant : vacancy_notified_at posé');
select lives_ok($$ select public.process_course_schedule() $$, 'process_course_schedule (2e passage)');
select is(pg_temp.outbox('slot_vacant', pg_temp.k('vac_priv')), 1, 'cours privé vacant : signalé une seule fois');

-- ---------------------------------------------------------------------------
-- 6. Un prof qui perd sa validation est retiré de ses cours à venir
-- ---------------------------------------------------------------------------
insert into ids values
  ('p1_fut',  pg_temp.mk(pg_temp.k('p1'), interval '3 days')),
  ('p1_past', pg_temp.mk(pg_temp.k('p1'), interval '-2 days')),
  ('p2_fut',  pg_temp.mk(pg_temp.k('p2'), interval '3 days')),
  ('p3_fut',  pg_temp.mk(pg_temp.k('p3'), interval '3 days', true)),
  ('p4_fut',  pg_temp.mk(pg_temp.k('p4'), interval '3 days'));
update public.courses set vacancy_notified_at = now() - interval '1 day'
 where id in (pg_temp.k('p1_fut'), pg_temp.k('p2_fut'), pg_temp.k('p3_fut'));

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.admin_set_role(pg_temp.k('p1'), 'eleve') $$, 'admin_set_role : p1 → élève');
select lives_ok($$ select public.admin_set_prof_status(pg_temp.k('p2'), 'refuse') $$, 'admin_set_prof_status : p2 → refuse');
select lives_ok($$ select public.admin_set_prof_status(pg_temp.k('p3'), 'en_attente') $$, 'admin_set_prof_status : p3 → en_attente');
select lives_ok($$ select public.admin_set_prof_status(pg_temp.k('p4'), 'valide') $$, 'admin_set_prof_status : p4 reste valide');
reset role;
select is((select (prof_id is null and vacancy_notified_at is null) from public.courses where id = pg_temp.k('p1_fut')),
          true, 'prof rétrogradé en élève : cours à venir libéré');
select is((select prof_id from public.courses where id = pg_temp.k('p1_past')), pg_temp.k('p1'),
          'prof rétrogradé : cours passé inchangé');
select is((select (prof_id is null and vacancy_notified_at is null) from public.courses where id = pg_temp.k('p2_fut')),
          true, 'prof refusé : cours à venir libéré');
select is((select (prof_id is null and vacancy_notified_at is null) from public.courses where id = pg_temp.k('p3_fut')),
          true, 'prof remis en attente : cours privé à venir libéré');
select is((select prof_id from public.courses where id = pg_temp.k('p4_fut')), pg_temp.k('p4'),
          'prof toujours validé : cours inchangé');

-- promotion admin d'un prof puis rétrogradation en prof validé : rien n'est libéré
update public.profiles set role = 'admin' where id = pg_temp.k('p4');
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.admin_set_role(pg_temp.k('p4'), 'prof') $$, 'admin_set_role : admin p4 → prof');
reset role;
select is((select prof_id from public.courses where id = pg_temp.k('p4_fut')), pg_temp.k('p4'),
          'admin → prof validé : cours inchangé');

-- ---------------------------------------------------------------------------
-- 7. Profil du prof supprimé : vacancy_notified_at remis à null
-- ---------------------------------------------------------------------------
insert into ids values
  ('p4_soon', pg_temp.mk(pg_temp.k('p4'), interval '6 hours')),
  ('p4_old',  pg_temp.mk(pg_temp.k('p4'), interval '-3 days'));
update public.courses set vacancy_notified_at = now() - interval '1 day'
 where id in (pg_temp.k('p4_soon'), pg_temp.k('p4_old'));
select lives_ok($$ delete from auth.users where id = 'b4000000-0000-0000-0000-0000000000b4' $$,
                'suppression du compte du prof p4');
select is((select (prof_id is null and vacancy_notified_at is null) from public.courses where id = pg_temp.k('p4_soon')),
          true, 'cours à venir : prof_id et vacancy_notified_at = null');
select isnt((select vacancy_notified_at from public.courses where id = pg_temp.k('p4_old')), null,
            'cours passé : vacancy_notified_at inchangé');
select lives_ok($$ select public.process_course_schedule() $$, 'process_course_schedule après suppression');
select ok(pg_temp.outbox('slot_vacant', pg_temp.k('p4_soon')) > 0, 'le créneau libéré est de nouveau signalé');
-- trigger : tout passage de prof_id à null (pas seulement la suppression)
update public.courses set vacancy_notified_at = now() where id = pg_temp.k('p4_soon');
update public.courses set prof_id = pg_temp.k('p2') where id = pg_temp.k('p4_soon');
update public.courses set prof_id = null where id = pg_temp.k('p4_soon');
select is((select vacancy_notified_at from public.courses where id = pg_temp.k('p4_soon')), null::timestamptz,
          'trigger : prof_id → null remet vacancy_notified_at à null');

-- ---------------------------------------------------------------------------
-- 8. cancel_course supprime l'appel des cours annulés
-- ---------------------------------------------------------------------------
insert into ids values
  ('att',   pg_temp.mk(pg_temp.k('a'), interval '20 minutes')),
  ('att_k', pg_temp.mk(pg_temp.k('a'), interval '25 minutes'));
insert into public.bookings (course_id, profile_id, booked_by)
values (pg_temp.k('att'), pg_temp.k('s1'), pg_temp.k('s1')), (pg_temp.k('att_k'), pg_temp.k('s1'), pg_temp.k('s1'));
insert into public.attendance (course_id, profile_id, present, marked_by)
values (pg_temp.k('att'), pg_temp.k('s1'), true, pg_temp.k('a')), (pg_temp.k('att_k'), pg_temp.k('s1'), true, pg_temp.k('a'));
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(public.cancel_course(pg_temp.k('att'), 'one'), 1, 'cancel_course : cours avec appel annulé');
reset role;
select is((select count(*)::int from public.attendance where course_id = pg_temp.k('att')), 0,
          'cours annulé : appel supprimé');
select is((select count(*)::int from public.attendance where course_id = pg_temp.k('att_k')), 1,
          'autre cours : appel conservé');

-- ---------------------------------------------------------------------------
-- 4, 5. update_course / create_course : lieu archivé actuel, contrôles explicites
-- ---------------------------------------------------------------------------
insert into ids values ('upd', pg_temp.mk(pg_temp.k('a'), interval '4 days'));
insert into ids values ('sion', (select id from public.locations where name = 'Sion'));
insert into ids values ('mart', (select id from public.locations where name = 'Martigny'));
update public.courses set location_id = pg_temp.k('sion') where id = pg_temp.k('upd');
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.admin_upsert_location(jsonb_build_object('id', pg_temp.k('sion'), 'archived', true));
                   select public.admin_upsert_location(jsonb_build_object('id', pg_temp.k('mart'), 'archived', true)) $$,
                'admin : Sion et Martigny archivés');
select is(public.update_course(pg_temp.k('upd'), jsonb_build_object('location_id', pg_temp.k('sion'), 'places', 15), 'one'), 1,
          'update_course : lieu actuel archivé renvoyé tel quel → accepté');
select is((select location_id from public.courses where id = pg_temp.k('upd')), pg_temp.k('sion'),
          'lieu inchangé');
select is((select places from public.courses where id = pg_temp.k('upd')), 15, 'places modifiées');
select is(pg_temp.hint_of(format($$ select public.update_course(%L, jsonb_build_object('location_id', %L::uuid), 'one') $$,
                                 pg_temp.k('upd'), pg_temp.k('mart'))),
          'location_archived', 'update_course : autre lieu archivé → location_archived');
select is(pg_temp.hint_of(format($$ select public.update_course(%L, '{"start_time":"22:00","end_time":"21:00"}', 'one') $$, pg_temp.k('upd'))),
          'invalid_field', 'update_course : fin avant début → invalid_field');
select is(pg_temp.hint_of(format($$ select public.update_course(%L, '{"start_time":"23:30"}', 'one') $$, pg_temp.k('upd'))),
          'invalid_field', 'update_course : début seul après la fin actuelle → invalid_field');
select is(pg_temp.hint_of(format($$ select public.update_course(%L, '{"places":0}', 'one') $$, pg_temp.k('upd'))),
          'invalid_field', 'update_course : places = 0 → invalid_field');
select is(pg_temp.hint_of(format($$ select public.update_course(%L, '{"places":101}', 'one') $$, pg_temp.k('upd'))),
          'invalid_field', 'update_course : places = 101 → invalid_field');
select is(pg_temp.hint_of(format($$ select public.update_course(%L, '{"price_member":-1}', 'one') $$, pg_temp.k('upd'))),
          'invalid_field', 'update_course : prix négatif → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(jsonb_build_object('sport', 'jjb', 'level', 'adulte',
             'start_time', '19:00', 'end_time', '19:00', 'local_date', (now() at time zone 'Europe/Zurich')::date + 1)) $$),
          'invalid_field', 'create_course : fin = début → invalid_field');
select is(pg_temp.hint_of($$ select public.create_course(jsonb_build_object('sport', 'jjb', 'level', 'adulte', 'places', 0,
             'start_time', '19:00', 'end_time', '20:00', 'local_date', (now() at time zone 'Europe/Zurich')::date + 1)) $$),
          'invalid_field', 'create_course : places = 0 → invalid_field');

-- ---------------------------------------------------------------------------
-- 9. locations : aucune écriture directe, même admin ; lecture et RPC OK
-- ---------------------------------------------------------------------------
select throws_ok($$ insert into public.locations (name) values ('Pirate') $$, '42501', null, 'admin : INSERT direct refusé');
select throws_ok($$ update public.locations set address = 'x' $$, '42501', null, 'admin : UPDATE direct refusé');
select throws_ok($$ delete from public.locations where name = 'Sion' $$, '42501', null, 'admin : DELETE direct refusé');
select ok((select count(*) from public.locations) >= 3, 'admin : lieux lisibles');
select isnt(public.admin_upsert_location('{"name":"Sierre"}'), null, 'admin_upsert_location fonctionne');
reset role;
select throws_ok($$ update public.locations set archived = true where is_default $$,
                 '23514', null, 'contrainte : le lieu par défaut ne peut pas être archivé (superuser)');

select * from finish();
rollback;
