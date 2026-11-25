-- pgTAP : créneaux vacants, Open Mat, prof validé, jetons push, tâches planifiées (migration 0006)
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

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

-- lignes d'outbox (superuser)
create function pg_temp.outbox(p_kind text, p_course uuid) returns int
language sql security definer as $$
  select count(*)::int from public.notification_outbox
   where kind = p_kind and course_id is not distinct from p_course;
$$;

-- a : admin ; p1, p2 : profs validés ; pq : prof en attente ; pr : prof refusé ;
-- s1 : élève ; pa : parent (élève)
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'na@t.ch',  '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'np1@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'np2@t.ch', '{"first_name":"Pro","last_name":"Two","age":30,"sports":["mma"],"coach_years":3,"role":"prof","language":"de"}');
select pg_temp.signup('bd000000-0000-0000-0000-0000000000bd', 'npq@t.ch', '{"first_name":"Pend","last_name":"Ing","age":30,"sports":["jjb"],"coach_years":1,"role":"prof"}');
select pg_temp.signup('bf000000-0000-0000-0000-0000000000bf', 'npr@t.ch', '{"first_name":"Ref","last_name":"Used","age":30,"sports":["jjb"],"coach_years":1,"role":"prof"}');
select pg_temp.signup('51000000-0000-0000-0000-000000000051', 'ns1@t.ch', '{"first_name":"Sam","last_name":"One","age":25,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide'
 where auth_user_id in ('b1000000-0000-0000-0000-0000000000b1', 'b2000000-0000-0000-0000-0000000000b2');
update public.profiles set prof_status = 'refuse' where auth_user_id = 'bf000000-0000-0000-0000-0000000000bf';

insert into ids values
  ('a',  pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p1', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('p2', pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
  ('pq', pg_temp.pid('bd000000-0000-0000-0000-0000000000bd')),
  ('pr', pg_temp.pid('bf000000-0000-0000-0000-0000000000bf')),
  ('s1', pg_temp.pid('51000000-0000-0000-0000-000000000051'));

-- v23 : vacant dans 23 h ; v25 : vacant dans 25 h ; vgo : vacant commencé il y a 1 min ;
-- pgo : avec prof, commencé il y a 1 min ; p23 : avec prof dans 23 h ;
-- c23 : annulé vacant dans 23 h ; om23 : open mat vacant dans 23 h
insert into ids values
  ('v23',  pg_temp.mk(null, interval '23 hours')),
  ('v25',  pg_temp.mk(null, interval '25 hours')),
  ('vgo',  pg_temp.mk(null, interval '-1 minute')),
  ('pgo',  pg_temp.mk(pg_temp.k('p1'), interval '-1 minute')),
  ('p23',  pg_temp.mk(pg_temp.k('p1'), interval '23 hours')),
  ('c23',  pg_temp.mk(null, interval '23 hours', 'annule')),
  ('om23', pg_temp.mk(null, interval '23 hours', 'open_mat'));

-- ---------------------------------------------------------------------------
-- process_course_schedule : droits
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.process_course_schedule() $$, '42501', null,
                 'authenticated (même admin) : process_course_schedule interdite');
reset role;
set local role anon;
select throws_ok($$ select public.process_course_schedule() $$, '42501', null,
                 'anon : process_course_schedule interdite');
reset role;

-- ---------------------------------------------------------------------------
-- process_course_schedule : créneau vacant dans 23 h
-- ---------------------------------------------------------------------------
set local role service_role;
select lives_ok($$ select public.process_course_schedule() $$, 'service_role : process_course_schedule');
reset role;

select is(pg_temp.outbox('slot_vacant', pg_temp.k('v23')), 3, 'vacant dans 23 h : une ligne par prof actif (2 profs validés + admin)');
select is((select array_agg(profile_id order by profile_id) from public.notification_outbox
            where kind = 'slot_vacant' and course_id = pg_temp.k('v23')),
          (select array_agg(x order by x) from unnest(array[pg_temp.k('a'), pg_temp.k('p1'), pg_temp.k('p2')]) x),
          'vacant dans 23 h : admin, p1 et p2');
select is((select count(*)::int from public.notification_outbox
            where profile_id in (pg_temp.k('pq'), pg_temp.k('pr'), pg_temp.k('s1'))),
          0, 'ni prof en attente, ni prof refusé, ni élève');
select isnt((select vacancy_notified_at from public.courses where id = pg_temp.k('v23')), null,
            'vacant dans 23 h : vacancy_notified_at renseigné');
select is((select status::text from public.courses where id = pg_temp.k('v23')), 'prevu', 'vacant dans 23 h : reste prevu');
select is((select count(*)::int from public.notification_outbox where sent_at is not null or error is not null),
          0, 'lignes non envoyées');

-- second appel : aucune nouvelle ligne
select public.process_course_schedule();
select is(pg_temp.outbox('slot_vacant', pg_temp.k('v23')), 3, 'second appel : aucune nouvelle ligne');

-- vacant dans 25 h : rien
select is(pg_temp.outbox('slot_vacant', pg_temp.k('v25')), 0, 'vacant dans 25 h : aucune ligne');
select is((select vacancy_notified_at from public.courses where id = pg_temp.k('v25')), null,
          'vacant dans 25 h : vacancy_notified_at null');
select is((select status::text from public.courses where id = pg_temp.k('v25')), 'prevu', 'vacant dans 25 h : reste prevu');

-- vacant commencé il y a 1 min : open mat sans notification
select is((select status::text from public.courses where id = pg_temp.k('vgo')), 'open_mat', 'vacant commencé : open_mat');
select is((select count(*)::int from public.notification_outbox where course_id = pg_temp.k('vgo')), 0,
          'vacant commencé : aucune ligne outbox');

-- avec prof : rien
select is((select status::text from public.courses where id = pg_temp.k('pgo')), 'prevu', 'cours avec prof commencé : reste prevu');
select is((select count(*)::int from public.notification_outbox where course_id in (pg_temp.k('pgo'), pg_temp.k('p23'))),
          0, 'cours avec prof : aucune ligne');

-- annulé / open mat : rien
select is((select status::text from public.courses where id = pg_temp.k('c23')), 'annule', 'annulé vacant : reste annule');
select is((select count(*)::int from public.notification_outbox where course_id in (pg_temp.k('c23'), pg_temp.k('om23'))),
          0, 'annulé ou open mat : aucune ligne');

-- le créneau se libère à nouveau (leave_slot remet vacancy_notified_at à null) : nouvelle notification
update public.courses set vacancy_notified_at = null where id = pg_temp.k('v23');
select public.process_course_schedule();
select is(pg_temp.outbox('slot_vacant', pg_temp.k('v23')), 6, 'vacancy_notified_at remis à null : nouvelle série');

-- un prof qui perd son statut n'est plus notifié
update public.profiles set prof_status = 'refuse' where id = pg_temp.k('p2');
insert into ids values ('v12', pg_temp.mk(null, interval '12 hours'));
select public.process_course_schedule();
select is(pg_temp.outbox('slot_vacant', pg_temp.k('v12')), 2, 'prof devenu refusé : non notifié');
update public.profiles set prof_status = 'valide' where id = pg_temp.k('p2');

-- ---------------------------------------------------------------------------
-- admin_set_prof_status : prof validé → ligne prof_validated
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select public.admin_set_prof_status(pg_temp.k('pq'), 'valide');
reset role;
select is((select count(*)::int from public.notification_outbox where kind = 'prof_validated'), 1,
          'admin_set_prof_status valide : une ligne prof_validated');
select is((select profile_id from public.notification_outbox where kind = 'prof_validated'), pg_temp.k('pq'),
          'prof_validated : pour ce prof');
select is((select course_id from public.notification_outbox where kind = 'prof_validated'), null,
          'prof_validated : sans cours');
select is((select prof_status::text from public.profiles where id = pg_temp.k('pq')), 'valide', 'statut mis à jour');

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select public.admin_set_prof_status(pg_temp.k('pq'), 'valide');
select public.admin_set_prof_status(pg_temp.k('pr'), 'refuse');
select public.admin_set_prof_status(pg_temp.k('pr'), 'en_attente');
reset role;
select is((select count(*)::int from public.notification_outbox where kind = 'prof_validated'), 1,
          'déjà validé, refusé ou en attente : aucune nouvelle ligne');

select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok(format($$ select public.admin_set_prof_status(%L, 'valide') $$, pg_temp.k('pr')), '42501', null,
                 'admin_set_prof_status : admin requis');
reset role;
select is((select count(*)::int from public.notification_outbox where kind = 'prof_validated'), 1,
          'non-admin : aucune ligne');

-- ---------------------------------------------------------------------------
-- push_tokens / register_push_token
-- ---------------------------------------------------------------------------
select pg_temp.login('51000000-0000-0000-0000-000000000051');
select throws_ok($$ select public.register_push_token('abc', 'ios') $$, '22023', null, 'jeton invalide : 22023');
select is(pg_temp.hint_of($$ select public.register_push_token('abc', 'ios') $$), 'invalid_push_token',
          'jeton invalide : hint invalid_push_token');
select throws_ok($$ select public.register_push_token('ExponentPushToken[aaa]', 'web') $$, '22023', null,
                 'plateforme invalide : 22023');
select throws_ok($$ insert into public.push_tokens (token, profile_id, platform)
                    values ('ExponentPushToken[zzz]', pg_temp.k('s1'), 'ios') $$,
                 '42501', null, 'authenticated : aucune insertion directe');
select lives_ok($$ select public.register_push_token('ExponentPushToken[aaa]', 'ios') $$, 's1 enregistre un jeton');
select is((select count(*)::int from public.push_tokens), 1, 's1 voit son jeton');
reset role;

select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.push_tokens), 0, 'p1 ne voit pas le jeton de s1');
select public.register_push_token('ExponentPushToken[aaa]', 'android');
select is((select count(*)::int from public.push_tokens), 1, 'p1 voit le jeton repris');
reset role;
select is((select profile_id from public.push_tokens where token = 'ExponentPushToken[aaa]'), pg_temp.k('p1'),
          'même jeton enregistré par deux comptes : appartient au dernier');
select is((select platform from public.push_tokens where token = 'ExponentPushToken[aaa]'), 'android',
          'plateforme mise à jour');

select pg_temp.login('51000000-0000-0000-0000-000000000051');
select is((select count(*)::int from public.push_tokens), 0, 's1 ne voit plus le jeton');
delete from public.push_tokens where token = 'ExponentPushToken[aaa]';
reset role;
select is((select count(*)::int from public.push_tokens), 1, 's1 ne peut pas supprimer le jeton de p1');

select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
delete from public.push_tokens where token = 'ExponentPushToken[aaa]';
reset role;
select is((select count(*)::int from public.push_tokens), 0, 'p1 supprime son jeton');

set local role anon;
select throws_ok($$ select public.register_push_token('ExponentPushToken[bbb]', 'ios') $$, '42501', null,
                 'anon : register_push_token interdite');
reset role;

-- ---------------------------------------------------------------------------
-- tâches planifiées
-- ---------------------------------------------------------------------------
select is((select count(*)::int from cron.job where jobname = 'process-course-schedule' and schedule = '*/5 * * * *'), 1,
          'cron process-course-schedule toutes les 5 minutes');
select is((select count(*)::int from cron.job where jobname = 'send-push' and schedule = '* * * * *'), 1,
          'cron send-push chaque minute');
-- secrets Vault absents : la tâche ne fait rien, sans erreur
delete from vault.secrets where name in ('functions_url', 'service_role_key');
select is(public.invoke_send_push(), null, 'invoke_send_push sans secrets Vault : rien, sans erreur');
select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select is(public.invoke_send_push(), null, 'un seul secret : rien, sans erreur');
select vault.create_secret('test-service-key', 'service_role_key');
select isnt(public.invoke_send_push(), null, 'secrets présents et lignes en attente : requête pg_net envoyée');
select is((select url from net.http_request_queue order by id desc limit 1),
          'http://127.0.0.1:54321/functions/v1/send-push', 'URL de la fonction send-push');
update public.notification_outbox set sent_at = now();
select is(public.invoke_send_push(), null, 'aucune ligne en attente : rien');
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.invoke_send_push() $$, '42501', null, 'authenticated : invoke_send_push interdite');
reset role;

select * from finish();
rollback;
