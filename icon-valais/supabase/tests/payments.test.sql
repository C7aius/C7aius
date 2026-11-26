-- pgTAP : prix des réservations, essais, paiements et remboursements (migration 0010)
begin;
create extension if not exists pgtap with schema extensions;

select plan(131);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
-- résultats de book_course
create temp table bk (k text primary key, booking_id uuid, amount numeric, needs bool);
grant all on bk to authenticated, service_role;
-- résultats de start_course_payment
create temp table pay (k text primary key, payment_id uuid, amount numeric, description text);
grant all on pay to authenticated, service_role;

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

-- appel côté serveur (Edge Function) : rôle service_role, sans auth.uid()
create function pg_temp.as_service() returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
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

create function pg_temp.b(p_k text) returns uuid
language sql stable as $$ select booking_id from bk where k = p_k $$;

create function pg_temp.pm(p_k text) returns uuid
language sql stable as $$ select payment_id from pay where k = p_k $$;

-- cours unique (superuser) : now() + p_start, prof p, prix adhérent / non-adhérent
create function pg_temp.mk(p_key text, p_start interval, p_member numeric default 5,
                           p_non_member numeric default 20) returns void
language sql security definer as $$
  with c as (
    insert into public.courses (sport, level, location_id, starts_at, ends_at, prof_id,
                                price_member, price_non_member, created_by)
    values ('jjb', 'adulte', (select id from public.locations where is_default),
            now() + p_start, now() + p_start + interval '90 minutes',
            (select v from ids where k = 'p'), p_member, p_non_member,
            (select v from ids where k = 'a'))
    returning id
  )
  insert into ids select p_key, c.id from c;
$$;

-- réserve (appelant courant) et garde le résultat sous p_key
create function pg_temp.bk(p_key text, p_course uuid, p_profile uuid default null) returns void
language plpgsql as $$
begin
  insert into bk select p_key, r.booking_id, r.amount, r.needs_payment
    from public.book_course(p_course, p_profile) r
  on conflict (k) do update set booking_id = excluded.booking_id, amount = excluded.amount,
                                needs = excluded.needs;
end;
$$;

-- démarre un paiement (appelant courant) et garde le résultat sous p_key
create function pg_temp.sp(p_key text, p_booking uuid, p_payer uuid) returns void
language plpgsql as $$
begin
  insert into pay select p_key, r.payment_id, r.amount, r.description
    from public.start_course_payment(p_booking, p_payer) r
  on conflict (k) do update set payment_id = excluded.payment_id;
end;
$$;

-- réservation en attente expirée (superuser)
create function pg_temp.expire(p_booking uuid) returns void
language sql security definer as $$
  update public.bookings set pending_until = now() - interval '1 minute' where id = p_booking;
$$;

create function pg_temp.bst(p_booking uuid) returns text
language sql security definer as $$
  select payment_status || ' ' || (cancelled_at is null)::text from public.bookings where id = p_booking;
$$;

create function pg_temp.pst(p_payment uuid) returns text
language sql security definer as $$ select status::text from public.payments where id = p_payment $$;

-- réservations actives (définition de la migration 0010)
create function pg_temp.active(p_course uuid, p_profile uuid) returns int
language sql security definer as $$
  select count(*)::int from public.bookings
   where course_id = p_course and profile_id = p_profile and cancelled_at is null
     and (payment_status <> 'pending' or pending_until > now());
$$;

-- a : admin ; p : prof validé ; n : non-adhérent ; m : adhérent ;
-- pa : parent de ch (adhérent) ; o : autre parent (de ko) ; mi : mineur sans consentement
select pg_temp.signup('a0000000-0000-0000-0000-00000000000a', 'pya@t.ch', '{"first_name":"Ad","last_name":"Min","age":40,"sports":["jjb"]}');
select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'pyp@t.ch', '{"first_name":"Pro","last_name":"One","age":30,"sports":["jjb"],"coach_years":3,"role":"prof"}');
select pg_temp.signup('11000000-0000-0000-0000-000000000011', 'pyn@t.ch', '{"first_name":"Non","last_name":"Member","age":25,"sports":["jjb"]}');
select pg_temp.signup('22000000-0000-0000-0000-000000000022', 'pym@t.ch', '{"first_name":"Mem","last_name":"Ber","age":28,"sports":["jjb"]}');
select pg_temp.signup('9a000000-0000-0000-0000-00000000009a', 'pypa@t.ch', '{"first_name":"Pa","last_name":"Rent","age":42,"sports":["jjb"]}');
select pg_temp.signup('9b000000-0000-0000-0000-00000000009b', 'pyo@t.ch', '{"first_name":"Oth","last_name":"Er","age":44,"sports":["jjb"]}');
select pg_temp.signup('e0000000-0000-0000-0000-00000000000e', 'pymi@t.ch', '{"first_name":"Min","last_name":"Or","age":13,"sports":["jjb"],"parent_email":"pp@t.ch"}');
update public.profiles set role = 'admin' where auth_user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set prof_status = 'valide' where auth_user_id = 'b1000000-0000-0000-0000-0000000000b1';
update public.profiles set paid_until = (now() at time zone 'Europe/Zurich')::date + 30
 where auth_user_id = '22000000-0000-0000-0000-000000000022';
insert into ids values
  ('a',  pg_temp.pid('a0000000-0000-0000-0000-00000000000a')),
  ('p',  pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('n',  pg_temp.pid('11000000-0000-0000-0000-000000000011')),
  ('m',  pg_temp.pid('22000000-0000-0000-0000-000000000022')),
  ('pa', pg_temp.pid('9a000000-0000-0000-0000-00000000009a')),
  ('o',  pg_temp.pid('9b000000-0000-0000-0000-00000000009b')),
  ('mi', pg_temp.pid('e0000000-0000-0000-0000-00000000000e'));
insert into public.profiles (parent_profile_id, first_name, last_name, age, sports, paid_until)
values (pg_temp.k('pa'), 'Kid', 'Rent', 9, '{jjb}', (now() at time zone 'Europe/Zurich')::date + 30),
       (pg_temp.k('o'), 'Kid', 'Other', 8, '{jjb}', null);
insert into ids values
  ('ch', (select id from public.profiles where parent_profile_id = pg_temp.k('pa'))),
  ('ko', (select id from public.profiles where parent_profile_id = pg_temp.k('o')));

-- cours t1..t12 (essais), e1..e3 (expiration), l1..l3 (paiement tardif), cours divers
select pg_temp.mk('t' || i, make_interval(days => 1, mins => i)) from generate_series(1, 12) i;
select pg_temp.mk('e1', interval '2 days');
select pg_temp.mk('e2', interval '2 days 1 hour');
select pg_temp.mk('e3', interval '2 days 2 hours');
select pg_temp.mk('l1', interval '3 days');
select pg_temp.mk('l2', interval '3 days 1 hour');
select pg_temp.mk('l3', interval '3 days 2 hours');
select pg_temp.mk('l4', interval '3 days 3 hours');
select pg_temp.mk('l5', interval '3 days 4 hours');
select pg_temp.mk('u1', interval '4 days');
select pg_temp.mk('fp', interval '4 days 1 hour');
select pg_temp.mk('mc', interval '5 days');
select pg_temp.mk('f1', interval '5 days 1 hour');
select pg_temp.mk('near', interval '20 minutes');
select pg_temp.mk('free', interval '6 days', 0, 0);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
            where table_schema = 'public' and table_name = 'bookings'
              and column_name in ('price', 'free_trial', 'payment_status', 'pending_until')),
          array['free_trial', 'payment_status', 'pending_until', 'price'], 'bookings : colonnes de paiement');
select is(enum_range(null::public.payment_kind)::text, '{course,membership}', 'payment_kind');
select is(enum_range(null::public.payment_state)::text, '{pending,succeeded,failed,refund_pending,refunded}',
          'payment_state');

-- ---------------------------------------------------------------------------
-- Essais : 10 réservations gratuites, puis prix non-adhérent
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('t' || i, pg_temp.k('t' || i)) from generate_series(1, 10) i;
select is((select count(*)::int from bk where k ~ '^t' and amount = 0 and not needs), 10,
          'réservations 1 à 10 : montant 0, sans paiement');
select is((select used || '/' || trial_limit from public.my_trial_status()), '10/10', 'my_trial_status : 10/10');
select pg_temp.bk('t11', pg_temp.k('t11'));
select is((select amount from bk where k = 't11'), 20.00, '11e réservation : 20');
select ok((select needs from bk where k = 't11'), '11e réservation : needs_payment');
reset role;
select is((select count(*)::int from public.bookings where id in (select booking_id from bk where k ~ '^t([1-9]|10)$')
              and free_trial and price = 0 and payment_status = 'none'), 10, 'essais : free_trial, prix 0, none');
select is(public.trial_used(pg_temp.k('n')), 10, 'trial_used = 10');
select is((select payment_status || ' ' || free_trial::text || ' ' || price from public.bookings where id = pg_temp.b('t11')),
          'pending false 20.00', '11e : en attente, pas un essai, prix 20');
select is((select pending_until from public.bookings where id = pg_temp.b('t11')), now() + interval '15 minutes',
          '11e : pending_until = +15 min');

-- réserver de nouveau un cours en attente : même réservation, délai prolongé
update public.bookings set pending_until = now() + interval '1 minute' where id = pg_temp.b('t11');
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select booking_id || ' ' || amount || ' ' || needs_payment from public.book_course(pg_temp.k('t11'))),
          pg_temp.b('t11') || ' 20.00 true', 'en attente : même réservation, même montant');
reset role;
select is((select pending_until from public.bookings where id = pg_temp.b('t11')), now() + interval '15 minutes',
          'en attente : pending_until prolongé');
select is(public.trial_used(pg_temp.k('n')), 10, 'trial_used inchangé');

-- adhérent : prix adhérent, pas d'essai
select pg_temp.login('22000000-0000-0000-0000-000000000022');
select pg_temp.bk('m_mc', pg_temp.k('mc'));
select is((select amount || ' ' || needs from bk where k = 'm_mc'), '5.00 true', 'adhérent : prix adhérent (5), à payer');
select pg_temp.bk('m_free', pg_temp.k('free'));
select is((select amount || ' ' || needs from bk where k = 'm_free'), '0.00 false', 'adhérent, cours à 0 : rien à payer');
select is((select used from public.my_trial_status()), 0, 'adhérent : my_trial_status.used = 0');
reset role;
select is((select free_trial::text || ' ' || payment_status from public.bookings where id = pg_temp.b('m_mc')),
          'false pending', 'adhérent : free_trial = false');
select is((select payment_status from public.bookings where id = pg_temp.b('m_free')), 'none', 'adhérent, 0 : none');
select is(public.trial_used(pg_temp.k('m')), 0, 'adhérent : trial_used inchangé');

-- my_trial_status : soi ou son enfant
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select is((select used || '/' || trial_limit from public.my_trial_status(pg_temp.k('ch'))), '0/10',
          'my_trial_status : son enfant');
select throws_ok(format('select * from public.my_trial_status(%L)', pg_temp.k('ko')), '42501', null,
                 'my_trial_status : enfant d''un autre → 42501');
select throws_ok(format('select * from public.my_trial_status(%L)', pg_temp.k('n')), '42501', null,
                 'my_trial_status : autre adulte → 42501');
reset role;

-- ---------------------------------------------------------------------------
-- Réservation en attente expirée : plus active
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('e1', pg_temp.k('e1'));
select pg_temp.bk('e2', pg_temp.k('e2'));
select pg_temp.bk('e3', pg_temp.k('e3'));
select is((select booked from public.course_booking_counts where course_id = pg_temp.k('e1')), 1,
          'en attente (valide) : comptée');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.course_participants(pg_temp.k('e1')) where profile_id = pg_temp.k('n')), 1,
          'en attente (valide) : dans les participants');
reset role;
select pg_temp.expire(pg_temp.b('e1'));
select pg_temp.expire(pg_temp.b('e2'));
select pg_temp.expire(pg_temp.b('e3'));
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select booked from public.course_booking_counts where course_id = pg_temp.k('e1')), 0,
          'expirée : plus comptée');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.course_participants(pg_temp.k('e1'))), 0,
          'expirée : plus dans les participants');
reset role;
-- annulation du cours : pas de notification pour une réservation expirée
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(public.cancel_course(pg_temp.k('e2'), 'one'), 1, 'cancel_course e2');
reset role;
select is((select count(*)::int from public.notification_outbox
            where course_id = pg_temp.k('e2') and kind = 'course_cancelled'), 0,
          'expirée : pas de notification d''annulation');
select is(pg_temp.bst(pg_temp.b('e2')), 'pending true', 'annulation : une réservation expirée n''est pas remboursée');
-- réserver de nouveau après expiration (avant le passage du planificateur)
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('e3b', pg_temp.k('e3'));
reset role;
select isnt(pg_temp.b('e3b'), pg_temp.b('e3'), 'après expiration : nouvelle réservation');
select is((select amount || ' ' || needs from bk where k = 'e3b'), '20.00 true', 'après expiration : à payer');
select is(pg_temp.bst(pg_temp.b('e3')), 'pending false', 'après expiration : l''ancienne est annulée');
select is(pg_temp.active(pg_temp.k('e3'), pg_temp.k('n')), 1, 'après expiration : une seule active');
-- process_course_schedule libère les réservations expirées
select lives_ok('select public.process_course_schedule()', 'process_course_schedule');
select is((select cancelled_at from public.bookings where id = pg_temp.b('e1')), now(),
          'process_course_schedule : cancelled_at = now()');
select is(pg_temp.bst(pg_temp.b('e3b')), 'pending true', 'process_course_schedule : une réservation valide reste');

-- appel : une réservation expirée ne compte pas comme inscrite
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('near', pg_temp.k('near'));
reset role;
select pg_temp.expire(pg_temp.b('near'));
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is(pg_temp.hint_of(format('select public.set_attendance(%L, %L, false)', pg_temp.k('near'), pg_temp.k('n'))),
          'not_booked', 'appel : expirée + absent → not_booked');
select lives_ok(format('select public.set_attendance(%L, %L, true)', pg_temp.k('near'), pg_temp.k('n')),
                'appel : expirée + présent → réservation créée');
reset role;
select is(pg_temp.active(pg_temp.k('near'), pg_temp.k('n')), 1, 'appel : une réservation active');
select is(pg_temp.bst(pg_temp.b('near')), 'pending false', 'appel : l''expirée est annulée');
select is((select present from public.attendance where course_id = pg_temp.k('near') and profile_id = pg_temp.k('n')),
          true, 'appel : présent');

-- ---------------------------------------------------------------------------
-- start_course_payment / attach_payment_intent / confirm_payment
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.sp('t11', pg_temp.b('t11'), pg_temp.k('n'));
select pg_temp.sp('t11b', pg_temp.b('t11'), pg_temp.k('n'));
select is(pg_temp.pm('t11b'), pg_temp.pm('t11'), 'start_course_payment deux fois → même paiement');
select is((select amount from pay where k = 't11'), 20.00, 'start_course_payment : montant de la réservation');
select ok((select description from pay where k = 't11') like 'Cours %', 'start_course_payment : description');
select lives_ok(format('select public.attach_payment_intent(%L, %L)', pg_temp.pm('t11'), 'pi_t11'), 'attach_payment_intent');
select lives_ok(format('select public.attach_payment_intent(%L, %L)', pg_temp.pm('t11'), 'pi_t11'),
                'attach_payment_intent deux fois');
select is(public.confirm_payment('pi_t11', 'card'), 'confirmed', 'confirm_payment → confirmed');
select is(public.confirm_payment('pi_t11', 'twint'), 'already', 'confirm_payment deux fois → already');
select throws_ok($$ select public.confirm_payment('pi_unknown', 'card') $$, 'P0002', null, 'intent inconnu → P0002');
reset role;
select is(pg_temp.bst(pg_temp.b('t11')), 'paid true', 'réservation payée et active');
select is((select status || ' ' || method || ' ' || (paid_at is not null)::text || ' ' || kind || ' '
                  || payer_profile_id || ' ' || beneficiary_profile_id
             from public.payments where id = pg_temp.pm('t11')),
          'succeeded card true course ' || pg_temp.k('n') || ' ' || pg_temp.k('n'),
          'paiement réussi, un seul passage (moyen inchangé)');
select is((select count(*)::int from public.payments where booking_id = pg_temp.b('t11')), 1, 'un seul paiement');
select pg_temp.as_service();
select is(pg_temp.hint_of(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('t11'), pg_temp.k('n'))),
          'not_pending', 'start_course_payment sur une réservation payée → not_pending');
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('t1'), pg_temp.k('n')),
                 '22023', null, 'start_course_payment sur un essai → 22023');
select throws_ok(format('select * from public.start_course_payment(%L, %L)', gen_random_uuid(), pg_temp.k('n')),
                 'P0002', null, 'start_course_payment : réservation inconnue → P0002');
reset role;

-- payeur : enfant
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select pg_temp.bk('f1ch', pg_temp.k('f1'), pg_temp.k('ch'));
reset role;
select is((select amount || ' ' || needs from bk where k = 'f1ch'), '5.00 true', 'enfant adhérent : prix adhérent');
select pg_temp.as_service();
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('f1ch'), pg_temp.k('o')),
                 '42501', null, 'start_course_payment pour l''enfant d''un autre → 42501');
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('f1ch'), pg_temp.k('n')),
                 '42501', null, 'start_course_payment par un autre adulte → 42501');
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('f1ch'), gen_random_uuid()),
                 '42501', null, 'start_course_payment : payeur inconnu → 42501');
select pg_temp.sp('f1ch', pg_temp.b('f1ch'), pg_temp.k('pa'));
select is((select payer_profile_id || ' ' || beneficiary_profile_id from public.payments where id = pg_temp.pm('f1ch')),
          pg_temp.k('pa') || ' ' || pg_temp.k('ch'), 'parent payeur, enfant bénéficiaire');
reset role;
-- payeur inactif
insert into public.bookings (course_id, profile_id, booked_by, price, payment_status, pending_until)
values (pg_temp.k('f1'), pg_temp.k('mi'), pg_temp.k('mi'), 20, 'pending', now() + interval '15 minutes');
insert into bk values ('f1mi', (select id from public.bookings where course_id = pg_temp.k('f1') and profile_id = pg_temp.k('mi')), 20, true);
select pg_temp.as_service();
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('f1mi'), pg_temp.k('mi')),
                 '42501', null, 'start_course_payment : payeur inactif → 42501');
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('e1'), pg_temp.k('n')),
                 '22023', null, 'start_course_payment : réservation expirée → 22023');
reset role;

-- fail_payment
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('fp', pg_temp.k('fp'));
reset role;
select pg_temp.as_service();
select pg_temp.sp('fp', pg_temp.b('fp'), pg_temp.k('n'));
select public.attach_payment_intent(pg_temp.pm('fp'), 'pi_fp');
select lives_ok($$ select public.fail_payment('pi_fp') $$, 'fail_payment');
select lives_ok($$ select public.fail_payment('pi_fp') $$, 'fail_payment deux fois');
select lives_ok($$ select public.fail_payment('pi_nope') $$, 'fail_payment : intent inconnu, sans effet');
select pg_temp.sp('fp2', pg_temp.b('fp'), pg_temp.k('n'));
reset role;
select is(pg_temp.pst(pg_temp.pm('fp')), 'failed', 'fail_payment → failed');
select is(pg_temp.bst(pg_temp.b('fp')), 'pending true', 'échec : la réservation reste en attente');
select isnt(pg_temp.pm('fp2'), pg_temp.pm('fp'), 'après échec : nouveau paiement');

-- ---------------------------------------------------------------------------
-- Paiement tardif (après expiration)
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('l1', pg_temp.k('l1'));
select pg_temp.bk('l2', pg_temp.k('l2'));
select pg_temp.bk('l3', pg_temp.k('l3'));
select pg_temp.bk('l4', pg_temp.k('l4'));
select pg_temp.bk('l5', pg_temp.k('l5'));
reset role;
select pg_temp.as_service();
select pg_temp.sp('l4', pg_temp.b('l4'), pg_temp.k('n'));
select pg_temp.sp('l5', pg_temp.b('l5'), pg_temp.k('n'));
select public.attach_payment_intent(pg_temp.pm('l4'), 'pi_l4');
select public.attach_payment_intent(pg_temp.pm('l5'), 'pi_l5');
select pg_temp.sp('l1', pg_temp.b('l1'), pg_temp.k('n'));
select pg_temp.sp('l2', pg_temp.b('l2'), pg_temp.k('n'));
select pg_temp.sp('l3', pg_temp.b('l3'), pg_temp.k('n'));
select public.attach_payment_intent(pg_temp.pm('l1'), 'pi_l1');
select public.attach_payment_intent(pg_temp.pm('l2'), 'pi_l2');
select public.attach_payment_intent(pg_temp.pm('l3'), 'pi_l3');
reset role;
select pg_temp.expire(pg_temp.b('l1'));
select pg_temp.expire(pg_temp.b('l2'));
select pg_temp.expire(pg_temp.b('l3'));
select public.process_course_schedule();
select is(pg_temp.bst(pg_temp.b('l1')), 'pending false', 'l1 libérée par le planificateur');
-- l2 : cours annulé entre-temps
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select public.cancel_course(pg_temp.k('l2'), 'one');
reset role;
-- l3 : réservée de nouveau (nouvelle réservation en attente)
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('l3b', pg_temp.k('l3'));
reset role;
-- l4 : cours annulé pendant l'attente (réservation encore valide)
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select public.cancel_course(pg_temp.k('l4'), 'one');
reset role;
-- l5 : désinscrite pendant l'attente
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select public.unbook_course(pg_temp.k('l5'));
reset role;
select pg_temp.as_service();
select is(public.confirm_payment('pi_l4', 'card'), 'late_refund', 'en attente, cours annulé → late_refund');
select is(public.confirm_payment('pi_l5', 'card'), 'late_refund', 'désinscrite pendant l''attente → late_refund');
select is(public.confirm_payment('pi_l1', 'card'), 'confirmed', 'tardif, cours futur → confirmed');
select is(public.confirm_payment('pi_l2', 'card'), 'late_refund', 'tardif, cours annulé → late_refund');
select is(public.confirm_payment('pi_l2', 'card'), 'already', 'late_refund deux fois → already');
select is(public.confirm_payment('pi_l3', 'card'), 'confirmed', 'tardif, réservé de nouveau → confirmed');
reset role;
select is(pg_temp.bst(pg_temp.b('l1')), 'paid true', 'tardif : réservation réactivée et payée');
select is(pg_temp.active(pg_temp.k('l1'), pg_temp.k('n')), 1, 'tardif : active');
select is(pg_temp.pst(pg_temp.pm('l2')), 'refund_pending', 'cours annulé : paiement refund_pending');
select is(pg_temp.bst(pg_temp.b('l2')), 'refund_pending false', 'cours annulé : réservation refund_pending, inactive');
select is(pg_temp.bst(pg_temp.b('l3')), 'paid true', 'réservé de nouveau : la réservation payée est réactivée');
select is(pg_temp.bst(pg_temp.b('l3b')), 'pending false', 'réservé de nouveau : la nouvelle en attente est libérée');
select is(pg_temp.active(pg_temp.k('l3'), pg_temp.k('n')), 1, 'réservé de nouveau : une seule active');
select is(pg_temp.bst(pg_temp.b('l4')) || ' ' || pg_temp.pst(pg_temp.pm('l4')), 'refund_pending false refund_pending',
          'en attente, cours annulé : remboursement, réservation inactive');
select is(pg_temp.bst(pg_temp.b('l5')) || ' ' || pg_temp.pst(pg_temp.pm('l5')), 'none false refund_pending',
          'désinscrite : non réactivée, paiement à rembourser');

-- ---------------------------------------------------------------------------
-- Désinscription
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('u1', pg_temp.k('u1'));
select lives_ok(format('select public.unbook_course(%L)', pg_temp.k('u1')), 'désinscription d''une réservation en attente');
reset role;
select is(pg_temp.active(pg_temp.k('u1'), pg_temp.k('n')), 0, 'en attente : libérée');
-- payée : reste payée, pas de remboursement
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select lives_ok(format('select public.unbook_course(%L)', pg_temp.k('l1')), 'désinscription d''une réservation payée');
reset role;
select is(pg_temp.bst(pg_temp.b('l1')), 'paid false', 'payée : reste paid, inactive');
select is(pg_temp.pst(pg_temp.pm('l1')), 'succeeded', 'payée : pas de remboursement');
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select booking_id || ' ' || amount || ' ' || needs_payment from public.book_course(pg_temp.k('l1'))),
          pg_temp.b('l1') || ' 20.00 false', 'réserver de nouveau un cours déjà payé : même réservation, rien à payer');
reset role;
select is(pg_temp.bst(pg_temp.b('l1')), 'paid true', 'déjà payé : réactivée');
select is((select count(*)::int from public.payments where booking_id = pg_temp.b('l1')), 1, 'déjà payé : pas de 2e paiement');

-- ---------------------------------------------------------------------------
-- Annulation par le club : remboursement
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is(public.cancel_course(pg_temp.k('t11'), 'one'), 1, 'cancel_course d''un cours avec une réservation payée');
reset role;
select is(pg_temp.bst(pg_temp.b('t11')), 'refund_pending true', 'cancel_course : réservation refund_pending');
select is(pg_temp.pst(pg_temp.pm('t11')), 'refund_pending', 'cancel_course : paiement refund_pending');
select is((select count(*)::int from public.notification_outbox
            where course_id = pg_temp.k('t11') and kind = 'course_cancelled' and profile_id = pg_temp.k('n')), 1,
          'cancel_course : réservation payée notifiée');
select pg_temp.as_service();
select is((select array_agg(id order by id) from public.refunds_to_process(10)),
          (select array_agg(id order by id) from (values (pg_temp.pm('t11')), (pg_temp.pm('l2')),
                                                         (pg_temp.pm('l4')), (pg_temp.pm('l5'))) v(id)),
          'refunds_to_process : les paiements à rembourser');
select lives_ok(format('select public.mark_refunded(%L)', pg_temp.pm('t11')), 'mark_refunded');
select lives_ok(format('select public.mark_refunded(%L)', pg_temp.pm('t11')), 'mark_refunded deux fois');
select is((select array_agg(id order by id) from public.refunds_to_process(10)),
          (select array_agg(id order by id) from (values (pg_temp.pm('l2')), (pg_temp.pm('l4')), (pg_temp.pm('l5'))) v(id)),
          'refunds_to_process : plus le paiement remboursé');
select is((select count(*)::int from public.refunds_to_process(0)), 0, 'refunds_to_process(0) : rien');
select throws_ok(format('select public.mark_refunded(%L)', pg_temp.pm('f1ch')), '22023', null,
                 'mark_refunded d''un paiement non remboursable → 22023');
reset role;
select is(pg_temp.pst(pg_temp.pm('t11')), 'refunded', 'mark_refunded : paiement refunded');
select is(pg_temp.bst(pg_temp.b('t11')), 'refunded true', 'mark_refunded : réservation refunded');
select isnt((select refunded_at from public.payments where id = pg_temp.pm('t11')), null, 'refunded_at renseigné');

-- ---------------------------------------------------------------------------
-- Compteur d'essais : désinscription et cours annulé
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select public.unbook_course(pg_temp.k('t1'));
reset role;
select is(public.trial_used(pg_temp.k('n')), 9, 'désinscription d''un essai → trial_used baisse');
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select pg_temp.bk('t12', pg_temp.k('t12'));
reset role;
select is((select amount || ' ' || needs from bk where k = 't12'), '0.00 false', 'essai libéré : réutilisable');
select is(public.trial_used(pg_temp.k('n')), 10, 'trial_used = 10');
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select public.cancel_course(pg_temp.k('t2'), 'one');
reset role;
select is(public.trial_used(pg_temp.k('n')), 9, 'essai sur un cours annulé : ne compte plus');

-- ---------------------------------------------------------------------------
-- payments : RLS
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.payments where payer_profile_id <> pg_temp.k('n')), 0,
          'n ne voit que ses paiements');
select ok((select count(*)::int from public.payments) >= 6, 'n voit ses paiements');
select throws_ok($$ update public.payments set status = 'succeeded' $$, '42501', null, 'update direct refusé');
select throws_ok(format($$ insert into public.payments (kind, amount, description) values ('course', 1, 'x') $$),
                 '42501', null, 'insert direct refusé');
reset role;
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select is((select array_agg(id) from public.payments), array[pg_temp.pm('f1ch')], 'parent : paiement de son enfant');
reset role;
select pg_temp.login('9b000000-0000-0000-0000-00000000009b');
select is((select count(*)::int from public.payments), 0, 'autre parent : aucun paiement');
reset role;
select pg_temp.login('b1000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.payments), 0, 'prof : aucun paiement');
reset role;
select pg_temp.login('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.payments), (select count(*)::int from pay p
            where p.k in ('t11', 'f1ch', 'fp', 'fp2', 'l1', 'l2', 'l3', 'l4', 'l5')), 'admin : tous les paiements');
reset role;
-- bénéficiaire (paiement fait par un autre) : superuser crée un paiement de pa pour lui-même, payé par o
insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, amount, description)
values ('membership', pg_temp.k('o'), pg_temp.k('pa'), 10, 'test');
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select is((select count(*)::int from public.payments where beneficiary_profile_id = pg_temp.k('pa')), 1,
          'bénéficiaire : voit le paiement');
reset role;
select pg_temp.login('9b000000-0000-0000-0000-00000000009b');
select is((select count(*)::int from public.payments), 1, 'payeur : voit le paiement');
reset role;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------
select pg_temp.login('11000000-0000-0000-0000-000000000011');
select throws_ok(format('select * from public.start_course_payment(%L, %L)', pg_temp.b('fp'), pg_temp.k('n')),
                 '42501', null, 'authenticated : start_course_payment refusé');
select throws_ok(format('select public.attach_payment_intent(%L, %L)', pg_temp.pm('fp2'), 'pi_x'),
                 '42501', null, 'authenticated : attach_payment_intent refusé');
select throws_ok($$ select public.confirm_payment('pi_fp', 'card') $$, '42501', null,
                 'authenticated : confirm_payment refusé');
select throws_ok($$ select public.fail_payment('pi_fp') $$, '42501', null, 'authenticated : fail_payment refusé');
select throws_ok($$ select * from public.refunds_to_process(10) $$, '42501', null,
                 'authenticated : refunds_to_process refusé');
select throws_ok(format('select public.mark_refunded(%L)', pg_temp.pm('l2')), '42501', null,
                 'authenticated : mark_refunded refusé');
select throws_ok(format('select public.trial_used(%L)', pg_temp.k('n')), '42501', null,
                 'authenticated : trial_used refusé');
reset role;
set local role anon;
select throws_ok($$ select * from public.my_trial_status() $$, '42501', null, 'anon : my_trial_status refusé');
select throws_ok($$ select * from public.payments $$, '42501', null, 'anon : payments illisible');
select throws_ok($$ select * from public.book_course(gen_random_uuid()) $$, '42501', null, 'anon : book_course refusé');
reset role;
select is((select count(*)::int from information_schema.routine_privileges
            where routine_schema = 'public' and grantee = 'anon'
              and routine_name in ('trial_used', 'my_trial_status', 'book_course', 'unbook_course',
                                   'start_course_payment', 'attach_payment_intent', 'confirm_payment',
                                   'fail_payment', 'refunds_to_process', 'mark_refunded')), 0,
          'anon : aucun droit d''exécution');

select * from finish();
rollback;
