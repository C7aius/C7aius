-- pgTAP: consentement parental (tâche 4)
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

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

-- 1 = mineur, 2 = mineur, 3 = mineur (jeton ancien), 4 = mineur sans demande, 5 = parent adulte, 6 = admin
select pg_temp.signup('a1000000-0000-0000-0000-000000000001', 'm1@test.ch',
  '{"first_name":"Mia","last_name":"Un","age":14,"sports":["jjb"],"parent_email":"maman@test.ch"}');
select pg_temp.signup('a1000000-0000-0000-0000-000000000002', 'm2@test.ch',
  '{"first_name":"Max","last_name":"Deux","age":13,"sports":["jjb"],"parent_email":"papa@test.ch"}');
select pg_temp.signup('a1000000-0000-0000-0000-000000000003', 'm3@test.ch',
  '{"first_name":"Meg","last_name":"Trois","age":15,"sports":["mma"],"parent_email":"tata@test.ch"}');
select pg_temp.signup('a1000000-0000-0000-0000-000000000004', 'm4@test.ch',
  '{"first_name":"Moe","last_name":"Quatre","age":12,"sports":["mma"],"parent_email":"oncle@test.ch"}');
select pg_temp.signup('a1000000-0000-0000-0000-000000000005', 'p5@test.ch',
  '{"first_name":"Pat","last_name":"Parent","age":40,"sports":["jjb"]}');
select pg_temp.signup('a1000000-0000-0000-0000-000000000006', 'ad@test.ch',
  '{"first_name":"Ada","last_name":"Admin","age":45,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a1000000-0000-0000-0000-000000000006';

insert into public.parent_consents (token, profile_id, parent_email, created_at) values
  ('00000000-0000-4000-8000-000000000001', pg_temp.pid('a1000000-0000-0000-0000-000000000001'), 'maman@test.ch', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000002', pg_temp.pid('a1000000-0000-0000-0000-000000000002'), 'papa@test.ch', now() - interval '6 days'),
  ('00000000-0000-4000-8000-000000000003', pg_temp.pid('a1000000-0000-0000-0000-000000000003'), 'tata@test.ch', now() - interval '8 days');

-- jeton valide
select is(public.is_account_active((select p from public.profiles p where auth_user_id = 'a1000000-0000-0000-0000-000000000001')),
          false, 'mineur sans consentement : inactif');
select is(public.confirm_parent_consent('00000000-0000-4000-8000-000000000001'), true, 'jeton valide → true');
select isnt((select parent_consent_at from public.profiles where auth_user_id = 'a1000000-0000-0000-0000-000000000001'),
            null, 'parent_consent_at renseigné');
select is(public.is_account_active((select p from public.profiles p where auth_user_id = 'a1000000-0000-0000-0000-000000000001')),
          true, 'après consentement : actif');
select isnt((select confirmed_at from public.parent_consents where token = '00000000-0000-4000-8000-000000000001'),
            null, 'confirmed_at renseigné');

-- réutilisation
select is(public.confirm_parent_consent('00000000-0000-4000-8000-000000000001'), false, 'second appel → false');

-- inconnu
select is(public.confirm_parent_consent('00000000-0000-4000-8000-0000000000ff'), false, 'jeton inconnu → false');

-- 6 jours : encore valide
select is(public.confirm_parent_consent('00000000-0000-4000-8000-000000000002'), true, 'jeton de 6 jours → true');

-- 8 jours : expiré
select is(public.confirm_parent_consent('00000000-0000-4000-8000-000000000003'), false, 'jeton de 8 jours → false');
select is((select parent_consent_at from public.profiles where auth_user_id = 'a1000000-0000-0000-0000-000000000003'),
          null, 'jeton expiré : pas de consentement');

-- e-mail parent modifié depuis la demande (par l'admin) : l'ancien jeton ne vaut plus
insert into public.parent_consents (token, profile_id, parent_email, created_at) values
  ('00000000-0000-4000-8000-000000000004', pg_temp.pid('a1000000-0000-0000-0000-000000000004'), 'oncle@test.ch', now());
update public.profiles set parent_email = 'autre@test.ch' where auth_user_id = 'a1000000-0000-0000-0000-000000000004';
select is(public.confirm_parent_consent('00000000-0000-4000-8000-000000000004'), false,
          'e-mail parent changé depuis la demande → false');

-- droits : table et RPC inaccessibles aux clients
select pg_temp.login('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select * from public.parent_consents$$, '42501', null, 'authenticated ne lit pas parent_consents');
select throws_ok($$select public.confirm_parent_consent('00000000-0000-4000-8000-000000000003')$$, '42501', null,
                 'authenticated ne peut pas appeler confirm_parent_consent');
reset role;
set local role anon;
select throws_ok($$select public.confirm_parent_consent('00000000-0000-4000-8000-000000000003')$$, '42501', null,
                 'anon ne peut pas appeler confirm_parent_consent');
reset role;

-- gel de parent_email : Mia (1, demande confirmée), Moe (4, demande non
-- confirmée) et Meg (3, demande expirée) ne peuvent plus le modifier.
select pg_temp.login('a1000000-0000-0000-0000-000000000004');
select throws_ok($$update public.profiles set parent_email = 'moi@test.ch' where auth_user_id = 'a1000000-0000-0000-0000-000000000004'$$,
                 '42501', null, 'parent_email gelé après une demande non confirmée');
select lives_ok($$update public.profiles set parent_email = parent_email, phone = '079' where auth_user_id = 'a1000000-0000-0000-0000-000000000004'$$,
                'mise à jour sans changer parent_email : ok');
reset role;
select pg_temp.login('a1000000-0000-0000-0000-000000000003');
select throws_ok($$update public.profiles set parent_email = 'moi@test.ch' where auth_user_id = 'a1000000-0000-0000-0000-000000000003'$$,
                 '42501', null, 'parent_email gelé aussi après expiration du jeton');
reset role;
select pg_temp.login('a1000000-0000-0000-0000-000000000001');
select throws_ok($$update public.profiles set parent_email = 'moi@test.ch' where auth_user_id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'parent_email gelé après consentement confirmé');
reset role;

-- sans demande : libre (profil 5, aucune ligne parent_consents)
select pg_temp.login('a1000000-0000-0000-0000-000000000005');
select lives_ok($$update public.profiles set parent_email = 'x@test.ch' where auth_user_id = 'a1000000-0000-0000-0000-000000000005'$$,
                'parent_email libre tant qu''aucune demande n''existe');
reset role;

-- l'admin peut corriger
select pg_temp.login('a1000000-0000-0000-0000-000000000006');
select lives_ok($$update public.profiles set parent_email = 'corrige@test.ch' where auth_user_id = 'a1000000-0000-0000-0000-000000000004'$$,
                'admin peut corriger parent_email');
reset role;

-- cascade : suppression de l'utilisateur auth → profil, enfants, demandes
select pg_temp.signup('a1000000-0000-0000-0000-000000000007', 'p7@test.ch',
  '{"first_name":"Per","last_name":"Pere","age":41,"sports":["jjb"]}');
select pg_temp.login('a1000000-0000-0000-0000-000000000007');
select public.create_child_profile('{"first_name":"Kid","last_name":"Pere","age":9,"sports":["jjb"]}'::jsonb);
reset role;
insert into public.parent_consents (profile_id, parent_email)
  values (pg_temp.pid('a1000000-0000-0000-0000-000000000007'), 'x@test.ch');
select is((select count(*)::int from public.profiles where parent_profile_id = pg_temp.pid('a1000000-0000-0000-0000-000000000007')),
          1, 'enfant créé');
delete from auth.users where id = 'a1000000-0000-0000-0000-000000000007';
select is((select count(*)::int from public.profiles where first_name in ('Per', 'Kid')), 0,
          'suppression auth.users : profil et enfants supprimés');
select is((select count(*)::int from public.parent_consents where parent_email = 'x@test.ch'
             and profile_id not in (select id from public.profiles)), 0,
          'demandes supprimées en cascade');

select * from finish();
rollback;
