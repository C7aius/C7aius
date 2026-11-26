-- pgTAP : admin_member_overview (migration 0014)
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

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

select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'oa@t.ch', '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('11000000-0000-0000-0000-000000000011', 'ou@t.ch', '{"first_name":"Ute","last_name":"U","age":25,"sports":["jjb"]}');
select pg_temp.signup('22000000-0000-0000-0000-000000000022', 'ov@t.ch', '{"first_name":"Vic","last_name":"V","age":25,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
insert into ids values
  ('a', pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('u', pg_temp.pid('11000000-0000-0000-0000-000000000011')),
  ('v', pg_temp.pid('22000000-0000-0000-0000-000000000022'));

-- u : adhésion active couvrant aujourd'hui ; v : rien
insert into public.memberships (profile_id, source, months, starts_on, ends_on, status, amount)
values (pg_temp.k('u'), 'one_time', 3, current_date - 10, current_date + 80, 'active', 250);

select pg_temp.login('11000000-0000-0000-0000-000000000011');
select throws_ok($$ select * from public.admin_member_overview() $$, '42501', null, 'élève : refusé');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ select * from public.admin_member_overview() $$, 'admin : autorisé');
select is((select member_until from public.admin_member_overview() where profile_id = pg_temp.k('u')),
          current_date + 80, 'adhésion active : member_until = ends_on');
select is((select member_until from public.admin_member_overview() where profile_id = pg_temp.k('v')),
          null::date, 'non-adhérent : null');
select is((select trial_used from public.admin_member_overview() where profile_id = pg_temp.k('v')), 0, 'essais : 0');
select is((select count(*)::int from public.admin_member_overview()), 3, 'une ligne par profil');
reset role;

select * from finish();
rollback;
