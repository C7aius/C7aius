-- pgTAP : tarifs et adhésions (migration 0009)
begin;
create extension if not exists pgtap with schema extensions;

select plan(78);

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

-- appel côté serveur (Edge Function, service_role)
create function pg_temp.as_service() returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
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

create function pg_temp.today_z() returns date
language sql stable as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- profil enfant (superuser) rattaché à p_parent
create function pg_temp.child(p_parent uuid, p_first text, p_age int,
                              p_student public.student_status default 'aucun') returns uuid
language sql security definer as $$
  insert into public.profiles (parent_profile_id, first_name, last_name, age, sports, student_status)
  values (p_parent, p_first, 'Kid', p_age, '{jjb}', p_student)
  returning id;
$$;

-- adhésion (superuser)
create function pg_temp.ms(p_profile uuid, p_status public.membership_status,
                           p_starts date, p_ends date) returns uuid
language sql security definer as $$
  insert into public.memberships (profile_id, source, months, starts_on, ends_on, status, amount)
  values (p_profile, 'one_time', 1, p_starts, p_ends, p_status, 100)
  returning id;
$$;

-- a : admin ; p : prof validé ; u : adulte non étudiant ; s : étudiant validé ;
-- o : autre adulte (parent de ko)
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'ma@t.ch', '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'mp@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('11000000-0000-0000-0000-000000000011', 'mu@t.ch', '{"first_name":"Ute","last_name":"U","age":25,"sports":["jjb"]}');
select pg_temp.signup('55000000-0000-0000-0000-000000000055', 'ms@t.ch', '{"first_name":"Stu","last_name":"S","age":22,"sports":["jjb"]}');
select pg_temp.signup('00000000-0000-0000-0000-0000000000f0', 'mo@t.ch', '{"first_name":"Oth","last_name":"O","age":45,"sports":["jjb"]}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide' where auth_user_id = 'b1000000-0000-0000-0000-0000000000b1';
update public.profiles set student_status = 'valide' where auth_user_id = '55000000-0000-0000-0000-000000000055';
insert into ids values
  ('a', pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('u', pg_temp.pid('11000000-0000-0000-0000-000000000011')),
  ('s', pg_temp.pid('55000000-0000-0000-0000-000000000055')),
  ('o', pg_temp.pid('00000000-0000-0000-0000-0000000000f0'));
-- enfants de u : k15 (15 ans, étudiant validé), k16s (16 ans, étudiant validé), k16 (16 ans)
insert into ids values
  ('k15',  pg_temp.child(pg_temp.k('u'), 'Kid15', 15, 'valide')),
  ('k16s', pg_temp.child(pg_temp.k('u'), 'Kid16s', 16, 'valide')),
  ('k16',  pg_temp.child(pg_temp.k('u'), 'Kid16', 16)),
  ('ko',   pg_temp.child(pg_temp.k('o'), 'KidO', 10));

-- ---------------------------------------------------------------------------
-- pricing_settings : valeurs initiales, lecture, pas d'écriture directe
-- ---------------------------------------------------------------------------
select is((select row(price_1m, price_3m, price_6m, price_12m, student_discount_pct,
                      child_discount_pct, child_max_age, default_course_price)::text
             from public.pricing_settings),
          row(100.00, 250.00, 450.00, 650.00, 30, 50, 15, 20.00)::text,
          'pricing_settings : 100/250/450/650, 30 %, 50 %, 15 ans, 20 CHF');
select is((select count(*)::int from public.pricing_settings), 1, 'pricing_settings : une seule ligne');
select throws_ok($$ insert into public.pricing_settings (id, price_1m, price_3m, price_6m, price_12m)
                    values (false, 1, 1, 1, 1) $$,
                 '23514', null, 'pricing_settings : singleton (id = true)');

select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select price_3m from public.pricing_settings), 250.00, 'élève actif : lit les tarifs');
select throws_ok($$ update public.pricing_settings set price_1m = 1 $$, '42501', null,
                 'élève : update direct des tarifs refusé');
select throws_ok($$ delete from public.pricing_settings $$, '42501', null,
                 'élève : delete des tarifs refusé');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ update public.pricing_settings set price_1m = 1 $$, '42501', null,
                 'admin : update direct des tarifs refusé (RPC seulement)');
reset role;

-- ---------------------------------------------------------------------------
-- membership_price
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select row(base, discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('u'), 3)),
          row(250.00, 0, 'none', 250.00)::text, 'adulte non étudiant, 3 mois : 250 / 0 / none');
select is((select row(discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('k15'), 1)),
          row(50, 'child', 50.00)::text, '15 ans étudiant : 50 % child (pas 80 %, pas 30 %)');
select is((select row(discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('k16s'), 12)),
          row(30, 'student', 455.00)::text, '16 ans étudiant validé : 30 % student');
select is((select row(discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('k16'), 6)),
          row(0, 'none', 450.00)::text, '16 ans non étudiant : plein tarif');
select throws_ok($$ select * from public.membership_price(pg_temp.k('s'), 1) $$, '42501', null,
                 'membership_price d''un autre adulte : refusé');
select throws_ok($$ select * from public.membership_price(pg_temp.k('ko'), 1) $$, '42501', null,
                 'membership_price de l''enfant d''un autre : refusé');
select is(pg_temp.hint_of($$ select * from public.membership_price(pg_temp.k('u'), 2) $$),
          'invalid_field', 'membership_price : durée 2 mois → invalid_field');
select throws_ok($$ select * from public.membership_price(pg_temp.k('u'), 2) $$, '22023', null,
                 'membership_price : durée invalide → 22023');
reset role;

select pg_temp.login('55000000-0000-0000-0000-000000000055');
select is((select row(base, discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('s'), 12)),
          row(650.00, 30, 'student', 455.00)::text, 'étudiant validé, 12 mois : 455 / 30 / student');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select amount from public.membership_price(pg_temp.k('s'), 3)), 175.00,
          'admin : membership_price de n''importe quel profil');
reset role;

select pg_temp.as_service();
select is((select amount from public.membership_price(pg_temp.k('u'), 1)), 100.00,
          'service : membership_price autorisé');
select throws_ok($$ select * from public.membership_price(gen_random_uuid(), 1) $$, 'P0002', null,
                 'membership_price : profil inconnu → P0002');

-- ---------------------------------------------------------------------------
-- admin_update_pricing
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.admin_update_pricing('{"price_1m":120}') $$, '42501', null,
                 'prof : admin_update_pricing refusé');
reset role;
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.admin_update_pricing('{"price_1m":120}') $$, '42501', null,
                 'élève : admin_update_pricing refusé');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.admin_update_pricing('{"student_discount_pct":95}') $$, '22023', null,
                 'admin_update_pricing : réduction 95 % → 22023');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"student_discount_pct":95}') $$),
          'invalid_field', 'admin_update_pricing : réduction 95 % → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"child_discount_pct":-1}') $$),
          'invalid_field', 'admin_update_pricing : réduction négative → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"price_6m":0}') $$),
          'invalid_field', 'admin_update_pricing : prix 0 → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"default_course_price":-5}') $$),
          'invalid_field', 'admin_update_pricing : prix de cours négatif → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"price_1m":"abc"}') $$),
          'invalid_field', 'admin_update_pricing : valeur illisible → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"price_1m":null}') $$),
          'invalid_field', 'admin_update_pricing : null → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"price_1m":10000000}') $$),
          'invalid_field', 'admin_update_pricing : dépassement → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"student_discount_pct":30.5}') $$),
          'invalid_field', 'admin_update_pricing : pourcentage non entier → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"foo":1}') $$),
          'invalid_field', 'admin_update_pricing : clé inconnue → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('{"id":false}') $$),
          'invalid_field', 'admin_update_pricing : id non modifiable → invalid_field');
select is(pg_temp.hint_of($$ select public.admin_update_pricing('[1]') $$),
          'invalid_field', 'admin_update_pricing : pas un objet → invalid_field');
select is((select price_1m from public.pricing_settings), 100.00, 'tarifs inchangés après les refus');
select lives_ok($$ select public.admin_update_pricing('{"price_1m":120}') $$, 'admin : price_1m = 120');
reset role;

select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select amount from public.membership_price(pg_temp.k('u'), 1)), 120.00,
          'après admin_update_pricing : 1 mois = 120');
reset role;

select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.admin_update_pricing('{"price_3m":"99.99","child_discount_pct":33,"child_max_age":17}') $$,
                'admin : plusieurs clés (texte ou nombre)');
reset role;
select is((select row(price_1m, price_3m, child_discount_pct, child_max_age)::text from public.pricing_settings),
          row(120.00, 99.99, 33, 17)::text, 'admin_update_pricing : clés absentes inchangées');
select is((select updated_at from public.pricing_settings), now(), 'admin_update_pricing : updated_at');
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select row(discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('k16'), 3)),
          row(33, 'child', 66.99)::text, 'arrondi au centime (99.99 × 0.67 = 66.9933 → 66.99)');
select is((select row(discount_pct, reason, amount)::text from public.membership_price(pg_temp.k('k16s'), 1)),
          row(33, 'child', 80.40)::text, 'child_max_age 17 : 16 ans étudiant → child 33 % (> 30 %)');
reset role;

-- remise des valeurs par défaut pour la suite
update public.pricing_settings set price_1m = 100, price_3m = 250, child_discount_pct = 50, child_max_age = 15;

-- ---------------------------------------------------------------------------
-- is_member
-- ---------------------------------------------------------------------------
update public.profiles set paid_until = pg_temp.today_z() where id = pg_temp.k('u');
select is(public.is_member(pg_temp.k('u')), true, 'is_member : paid_until = aujourd''hui → vrai');
update public.profiles set paid_until = pg_temp.today_z() - 1 where id = pg_temp.k('u');
select is(public.is_member(pg_temp.k('u')), false, 'is_member : paid_until = hier → faux');
select is(public.is_member(pg_temp.k('u'), pg_temp.today_z() - 1), true, 'is_member : à une date passée');

select pg_temp.ms(pg_temp.k('s'), 'active', pg_temp.today_z() - 10, pg_temp.today_z() + 20);
select is(public.is_member(pg_temp.k('s')), true, 'is_member : abonnement active couvrant aujourd''hui → vrai');
select is(public.is_member(pg_temp.k('s'), pg_temp.today_z() + 21), false, 'is_member : après ends_on → faux');
select is(public.is_member(pg_temp.k('s'), pg_temp.today_z() + 20), true, 'is_member : le jour de ends_on → vrai');

select pg_temp.ms(pg_temp.k('k15'), 'cancelled', pg_temp.today_z() - 10, pg_temp.today_z() + 5);
select is(public.is_member(pg_temp.k('k15')), true, 'is_member : cancelled avec ends_on futur → vrai');
select pg_temp.ms(pg_temp.k('k16'), 'ended', pg_temp.today_z() - 10, pg_temp.today_z() + 5);
select is(public.is_member(pg_temp.k('k16')), false, 'is_member : ended → faux');
select pg_temp.ms(pg_temp.k('k16s'), 'pending', pg_temp.today_z() - 10, pg_temp.today_z() + 5);
select is(public.is_member(pg_temp.k('k16s')), false, 'is_member : pending → faux');
select is(public.is_member(pg_temp.k('o')), false, 'is_member : rien → faux');

select pg_temp.login('11000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.is_member(pg_temp.k('u')) $$, '42501', null,
                 'is_member : non appelable par un client (my_membership)');
reset role;

-- ---------------------------------------------------------------------------
-- can_pay_for
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is(public.can_pay_for(pg_temp.k('u')), true, 'can_pay_for : soi → vrai');
select is(public.can_pay_for(pg_temp.k('k15')), true, 'can_pay_for : son enfant → vrai');
select is(public.can_pay_for(pg_temp.k('ko')), false, 'can_pay_for : l''enfant d''un autre → faux');
select is(public.can_pay_for(pg_temp.k('o')), false, 'can_pay_for : un autre adulte → faux');
select is(public.can_pay_for(gen_random_uuid()), false, 'can_pay_for : profil inconnu → faux');
select is(public.can_pay_for(null), false, 'can_pay_for : null → faux');
reset role;

-- compte appelant inactif (prof en attente)
update public.profiles set prof_status = 'en_attente' where id = pg_temp.k('p');
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is(public.can_pay_for(pg_temp.k('p')), false, 'can_pay_for : compte inactif → faux');
select is((select count(*)::int from public.pricing_settings), 0, 'compte inactif : tarifs illisibles');
reset role;
update public.profiles set prof_status = 'valide' where id = pg_temp.k('p');

-- ---------------------------------------------------------------------------
-- my_membership
-- ---------------------------------------------------------------------------
select pg_temp.login('55000000-0000-0000-0000-000000000055');
select is((select row(is_member, until, source, auto_renew, cancel_at_period_end)::text from public.my_membership()),
          row(true, pg_temp.today_z() + 20, 'one_time'::public.membership_source, false, false)::text,
          'my_membership() : soi, abonnement en cours');
select throws_ok($$ select * from public.my_membership(pg_temp.k('k15')) $$, '42501', null,
                 'my_membership : l''enfant d''un autre → refusé');
reset role;

select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select row(is_member, until, source)::text from public.my_membership(pg_temp.k('k15'))),
          row(true, pg_temp.today_z() + 5, 'one_time'::public.membership_source)::text,
          'my_membership(enfant) : parent → résilié mais actif jusqu''à ends_on');
select is((select row(is_member, until, source)::text from public.my_membership()),
          row(false, null::date, null::public.membership_source)::text,
          'my_membership() : non adhérent');
reset role;

update public.profiles set paid_until = make_date(extract(year from pg_temp.today_z())::int + 1, 12, 31)
 where id = pg_temp.k('o');
select pg_temp.login('00000000-0000-0000-0000-0000000000f0');
select is((select row(is_member, until, source)::text from public.my_membership()),
          row(true, make_date(extract(year from pg_temp.today_z())::int + 1, 12, 31),
              'admin_year'::public.membership_source)::text,
          'my_membership() : payé pour l''année par l''admin');
reset role;

-- ---------------------------------------------------------------------------
-- memberships : RLS lecture, aucune écriture client
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.memberships), 3, 'parent : voit les adhésions de ses enfants');
select throws_ok(format($$ insert into public.memberships (profile_id, source, months, amount)
                           values ('%s', 'one_time', 1, 0) $$, pg_temp.k('u')),
                 '42501', null, 'élève : insert dans memberships refusé');
select throws_ok($$ update public.memberships set status = 'active' $$, '42501', null,
                 'élève : update de memberships refusé');
select throws_ok($$ delete from public.memberships $$, '42501', null,
                 'élève : delete de memberships refusé');
select throws_ok($$ update public.profiles set stripe_customer_id = 'cus_x' where id = public.current_profile_id() $$,
                 '42501', null, 'élève : stripe_customer_id protégé');
select throws_ok(format($$ update public.profiles set stripe_customer_id = 'cus_y' where id = '%s' $$, pg_temp.k('k15')),
                 '42501', null, 'parent : stripe_customer_id de son enfant protégé');
reset role;

select pg_temp.login('55000000-0000-0000-0000-000000000055');
select is((select count(*)::int from public.memberships), 1, 'élève : voit seulement ses adhésions');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.memberships), 0, 'prof : ne voit pas les adhésions des autres');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.memberships), 4, 'admin : voit toutes les adhésions');
reset role;

-- ---------------------------------------------------------------------------
-- create_course : prix non-adhérent par défaut
-- ---------------------------------------------------------------------------
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select lives_ok($$ insert into res values ('d', public.create_course(jsonb_build_object(
                    'sport', 'jjb', 'level', 'adulte', 'local_date', pg_temp.today_z() + 1,
                    'start_time', '19:00', 'end_time', '20:30'))) $$,
                'create_course sans price_non_member');
select lives_ok($$ insert into res values ('e', public.create_course(jsonb_build_object(
                    'sport', 'jjb', 'level', 'adulte', 'local_date', pg_temp.today_z() + 1,
                    'start_time', '19:00', 'end_time', '20:30', 'price_non_member', 35))) $$,
                'create_course avec price_non_member 35');
reset role;
select is((select price_non_member from public.courses where id = (select v[1] from res where k = 'd')),
          20.00, 'create_course : price_non_member absent → 20');
select is((select price_non_member from public.courses where id = (select v[1] from res where k = 'e')),
          35.00, 'create_course : price_non_member = 35');

select * from finish();
rollback;
