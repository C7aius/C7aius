-- pgTAP : corrections de la revue finale du plan 3 (migration 0015) —
-- remboursements réessayés / refund_failed, refund.failed, orphelins Stripe
-- (compte supprimé), double abonnement, renouvellement d'une adhésion
-- terminée, adhésions abandonnées, suppression d'un enfant abonné.
begin;
create extension if not exists pgtap with schema extensions;

select plan(67);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
create temp table mp (k text primary key, membership_id uuid, payment_id uuid);
grant all on mp to authenticated, service_role;

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

create function pg_temp.as_service() returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
$$;

-- superuser, sans jeton (comme GoTrue / pg_cron)
create function pg_temp.as_postgres() returns void
language sql as $$
  reset role;
  select set_config('request.jwt.claims', '', true);
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

create function pg_temp.smp(p_key text, p_profile uuid, p_months int, p_source public.membership_source) returns void
language plpgsql as $$
begin
  insert into mp select p_key, r.membership_id, r.payment_id
    from public.start_membership_payment(p_profile, p_profile, p_months, p_source) r;
end;
$$;

create function pg_temp.mid(p_k text) returns uuid
language sql stable as $$ select membership_id from mp where k = p_k $$;

create function pg_temp.pmid(p_k text) returns uuid
language sql stable as $$ select payment_id from mp where k = p_k $$;

create function pg_temp.p(p_payment uuid) returns public.payments
language sql security definer as $$ select * from public.payments where id = p_payment $$;

create function pg_temp.m(p_membership uuid) returns public.memberships
language sql security definer as $$ select * from public.memberships where id = p_membership $$;

create function pg_temp.today_z() returns date
language sql stable as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- cours à venir + réservation payée + paiement de cours dans l'état voulu
create function pg_temp.course_payment(p_key text, p_profile uuid, p_intent text, p_status text) returns void
language sql security definer as $$
  with c as (
    insert into public.courses (sport, level, location_id, starts_at, ends_at, price_non_member, created_by)
    values ('jjb', 'adulte', (select id from public.locations where is_default),
            now() + interval '2 days', now() + interval '2 days 90 minutes', 20, p_profile)
    returning id
  ), b as (
    insert into public.bookings (course_id, profile_id, booked_by, price, payment_status)
    select c.id, p_profile, p_profile, 20, case when p_status = 'refunded' then 'refunded' else 'refund_pending' end from c
    returning id
  ), p as (
    insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, booking_id, amount,
                                 description, stripe_payment_intent_id, status, paid_at)
    select 'course', p_profile, p_profile, b.id, 20, 'Cours JJB', p_intent, p_status::public.payment_state, now() from b
    returning id, booking_id
  )
  insert into ids select p_key, p.id from p
  union all select p_key || '_b', p.booking_id from p;
$$;

create function pg_temp.bst(p_booking uuid) returns text
language sql security definer as $$ select payment_status from public.bookings where id = p_booking $$;

create function pg_temp.orphan(p_where text) returns text
language plpgsql security definer as $$
declare v text;
begin
  execute format('select string_agg(concat_ws(''|'', kind, stripe_id, intent, invoice, amount), '','' order by stripe_id)
                    from public.orphan_stripe_items where %s', p_where) into v;
  return v;
end;
$$;

select pg_temp.signup('b1000000-0000-0000-0000-0000000000b1', 'rf1@t.ch', '{"first_name":"Ref","last_name":"Und","age":30,"sports":["jjb"]}');
select pg_temp.signup('b2000000-0000-0000-0000-0000000000b2', 'rf2@t.ch', '{"first_name":"Dup","last_name":"Sub","age":31,"sports":["jjb"]}');
select pg_temp.signup('b3000000-0000-0000-0000-0000000000b3', 'rf3@t.ch', '{"first_name":"Gone","last_name":"User","age":32,"sports":["jjb"]}');
select pg_temp.signup('b4000000-0000-0000-0000-0000000000b4', 'rf4@t.ch', '{"first_name":"Gone","last_name":"Two","age":33,"sports":["jjb"]}');
select pg_temp.signup('b5000000-0000-0000-0000-0000000000b5', 'rf5@t.ch', '{"first_name":"End","last_name":"Ed","age":34,"sports":["jjb"]}');
select pg_temp.signup('b6000000-0000-0000-0000-0000000000b6', 'rf6@t.ch', '{"first_name":"Par","last_name":"Ent","age":40,"sports":["jjb"]}');
insert into ids values
  ('u', pg_temp.pid('b1000000-0000-0000-0000-0000000000b1')),
  ('d', pg_temp.pid('b2000000-0000-0000-0000-0000000000b2')),
  ('g', pg_temp.pid('b3000000-0000-0000-0000-0000000000b3')),
  ('h', pg_temp.pid('b4000000-0000-0000-0000-0000000000b4')),
  ('e', pg_temp.pid('b5000000-0000-0000-0000-0000000000b5')),
  ('par', pg_temp.pid('b6000000-0000-0000-0000-0000000000b6'));

-- ---------------------------------------------------------------------------
-- Structure et droits
-- ---------------------------------------------------------------------------
select ok('refund_failed' = any (enum_range(null::public.payment_state)::text[]), 'payment_state : refund_failed');
select has_column('public', 'payments', 'refund_attempts', 'payments.refund_attempts');
select has_column('public', 'payments', 'refund_next_attempt_at', 'payments.refund_next_attempt_at');
select has_table('public', 'orphan_stripe_items', 'table orphan_stripe_items');
select is((select count(*)::int from unnest(array[
            'refund_attempt_failed(uuid,text)', 'mark_refund_failed(text,uuid,text)',
            'record_orphan(text,text,text,text,numeric)', 'orphans_to_process(integer)',
            'mark_orphan_done(uuid,text)', 'orphan_attempt_failed(uuid,text)', 'refunds_to_process(integer)',
            'fail_unrefundable_payments()', 'has_live_subscription(uuid)']) f
            where has_function_privilege('anon', 'public.' || f, 'execute')
               or has_function_privilege('authenticated', 'public.' || f, 'execute')), 0,
          'nouvelles fonctions : ni anon ni authenticated');
select ok(has_function_privilege('service_role', 'public.refund_attempt_failed(uuid,text)', 'execute')
          and has_function_privilege('service_role', 'public.orphans_to_process(integer)', 'execute')
          and has_function_privilege('service_role', 'public.mark_refund_failed(text,uuid,text)', 'execute'),
          'service_role exécute les fonctions de process-refunds / du webhook');
select ok(not has_table_privilege('anon', 'public.orphan_stripe_items', 'select')
          and not has_table_privilege('authenticated', 'public.orphan_stripe_items', 'insert'),
          'orphan_stripe_items : pas d''accès anon, pas d''écriture client');
select is(public.refund_backoff(1), interval '5 minutes', 'refund_backoff(1) = 5 min');
select is(public.refund_backoff(4), interval '40 minutes', 'refund_backoff(4) = 40 min (exponentiel)');

-- ---------------------------------------------------------------------------
-- Remboursements : tentatives, délai, refund_failed
-- ---------------------------------------------------------------------------
select pg_temp.course_payment('r1', pg_temp.k('u'), 'pi_r1', 'refund_pending');
select pg_temp.course_payment('r0', pg_temp.k('u'), null, 'refund_pending');
select pg_temp.as_service();
select is((select array_agg(id) from public.refunds_to_process(50)), array[pg_temp.k('r1')],
          'refunds_to_process : la ligne avec intent ; celle sans intent écartée');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.k('r0'))).status::text, 'refund_failed', 'sans intent → refund_failed directement (visible)');
select ok((pg_temp.p(pg_temp.k('r0'))).error like '%missing_intent%', 'sans intent : note missing_intent');
select pg_temp.as_service();
select is(public.refund_attempt_failed(pg_temp.k('r1'), '500 api_error'), 'retry', '1er échec → retry');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.k('r1'))).refund_attempts, 1, '1 tentative comptée');
select ok((pg_temp.p(pg_temp.k('r1'))).refund_next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes',
          'tentative suivante dans 5 minutes');
select pg_temp.as_service();
select is((select count(*)::int from public.refunds_to_process(50) where id = pg_temp.k('r1')), 0,
          'refunds_to_process : tentative pas encore due → écartée');
select pg_temp.as_postgres();
update public.payments set refund_next_attempt_at = now() - interval '1 second' where id = pg_temp.k('r1');
select pg_temp.as_service();
select is((select count(*)::int from public.refunds_to_process(50) where id = pg_temp.k('r1')), 1,
          'refunds_to_process : tentative due → reprise');
select is((select array_agg(public.refund_attempt_failed(pg_temp.k('r1'), '500 api_error')) from generate_series(2, 7)),
          array['retry','retry','retry','retry','retry','retry'], 'échecs 2 à 7 → retry');
select is(public.refund_attempt_failed(pg_temp.k('r1'), '400 charge_disputed'), 'refund_failed', '8e échec → refund_failed');
select is(public.refund_attempt_failed(pg_temp.k('r1'), 'x'), 'ignored', 'refund_failed : plus de tentative');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.k('r1'))).status::text || ' ' || (pg_temp.p(pg_temp.k('r1'))).refund_attempts,
          'refund_failed 8', 'paiement refund_failed après 8 tentatives');
select ok((pg_temp.p(pg_temp.k('r1'))).error like '%charge_disputed%', 'refund_failed : dernière erreur notée');
select pg_temp.as_service();
select is((select count(*)::int from public.refunds_to_process(50) where id = pg_temp.k('r1')), 0,
          'refund_failed : plus traité automatiquement');
-- l'admin rembourse depuis le tableau de bord Stripe : charge.refunded règle la ligne
select is(public.mark_refunded_by_intent('pi_r1'), 'refunded', 'refund_failed puis charge.refunded → refunded');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
-- refund.failed : remboursement refusé par Stripe après coup
-- ---------------------------------------------------------------------------
select pg_temp.course_payment('rf', pg_temp.k('u'), 'pi_rf', 'refunded');
select pg_temp.as_service();
select is(public.apply_stripe_event('evt_rf1', 'refund.failed', 'mark_refund_failed',
            jsonb_build_object('p_intent', 'pi_rf', 'p_payment', pg_temp.k('rf'), 'p_reason', 'expired_or_canceled_card')),
          'refund_failed', 'refund.failed → mark_refund_failed → refund_failed');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.k('rf'))).status::text, 'refund_failed', 'paiement refund_failed');
select ok((pg_temp.p(pg_temp.k('rf'))).refunded_at is null and (pg_temp.p(pg_temp.k('rf'))).error like '%expired_or_canceled_card%',
          'refunded_at effacé, motif noté');
select is(pg_temp.bst(pg_temp.k('rf_b')), 'refund_pending', 'réservation : de nouveau en attente de remboursement');
select pg_temp.as_service();
select is(public.mark_refund_failed('pi_rf', null, 'x'), 'ignored', 'déjà refund_failed → ignored');
select is(public.mark_refund_failed('pi_none', null, 'x'), 'unknown', 'intent inconnu → unknown');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
-- Double activation d'abonnement
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('d1', pg_temp.k('d'), 1, 'stripe_subscription');
select pg_temp.smp('d2', pg_temp.k('d'), 1, 'stripe_subscription');
select public.attach_payment_intent(pg_temp.pmid('d1'), 'pi_d1');
select public.attach_payment_intent(pg_temp.pmid('d2'), 'pi_d2');
select is(public.activate_membership('pi_d1', 'sub_d1', pg_temp.today_z() + 30, pg_temp.mid('d1'), 'card', 10000, 'chf'),
          'activated', 'premier abonnement : activated');
select is(public.activate_membership('pi_d2', 'sub_d2', pg_temp.today_z() + 30, pg_temp.mid('d2'), 'card', 10000, 'chf'),
          'duplicate_subscription', 'second abonnement actif pour le même profil → duplicate_subscription');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.pmid('d2'))).status::text || ' ' || (pg_temp.p(pg_temp.pmid('d2'))).error,
          'refund_pending duplicate_subscription', 'second paiement : remboursé');
select is((pg_temp.m(pg_temp.mid('d2'))).status::text || ' ' || (pg_temp.m(pg_temp.mid('d2'))).stripe_cancel_pending
            || ' ' || (pg_temp.m(pg_temp.mid('d2'))).stripe_subscription_id,
          'pending true sub_d2', 'second abonnement : non activé, annulé immédiatement chez Stripe');
select is((pg_temp.m(pg_temp.mid('d1'))).status::text, 'active', 'premier abonnement : inchangé');
select pg_temp.as_service();
select is(public.activate_membership('pi_d2', 'sub_d2', pg_temp.today_z() + 30, pg_temp.mid('d2'), 'card', 10000, 'chf'),
          'already', 'rejoué → already');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
-- renew_membership sur une adhésion terminée : remboursée, abonnement annulé
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('e1', pg_temp.k('e'), 1, 'stripe_subscription');
select public.attach_payment_intent(pg_temp.pmid('e1'), 'pi_e1');
select is(public.activate_membership('pi_e1', 'sub_e', pg_temp.today_z() + 30, pg_temp.mid('e1'), 'card', 10000, 'chf'),
          'activated', 'abonnement E : activated');
select public.end_membership('sub_e');
select is(public.renew_membership('sub_e', 'in_e2', 100, pg_temp.today_z() + 60, 'chf', 'pi_e2'), 'ended_refund',
          'facture d''une adhésion terminée → ended_refund');
select is(public.renew_membership('sub_e', 'in_e2', 100, pg_temp.today_z() + 60, 'chf', 'pi_e2'), 'already',
          'même facture rejouée → already');
select pg_temp.as_postgres();
select is((select status::text || ' ' || error from public.payments where stripe_invoice_id = 'in_e2'),
          'refund_pending membership_ended', 'facture : remboursée (refund_pending)');
select is((pg_temp.m(pg_temp.mid('e1'))).status::text || ' ' || (pg_temp.m(pg_temp.mid('e1'))).ends_on
            || ' ' || (pg_temp.m(pg_temp.mid('e1'))).stripe_cancel_pending,
          'ended ' || (pg_temp.today_z() + 30) || ' true', 'adhésion non prolongée ; abonnement à annuler');

-- ---------------------------------------------------------------------------
-- Compte supprimé : abonnement / paiement orphelins (plus de P0002 sans fin)
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('g1', pg_temp.k('g'), 1, 'stripe_subscription');
select public.attach_payment_intent(pg_temp.pmid('g1'), 'pi_g1');
select is(public.activate_membership('pi_g1', 'sub_g', pg_temp.today_z() + 30, pg_temp.mid('g1'), 'card', 10000, 'chf'),
          'activated', 'abonnement G : activated');
select pg_temp.smp('h1', pg_temp.k('h'), 1, 'stripe_subscription');
select public.attach_payment_intent(pg_temp.pmid('h1'), 'pi_h1');
select pg_temp.as_postgres();
-- suppression des comptes (comme GoTrue, sans jeton) : la cascade passe malgré l'abonnement actif
select lives_ok($$ delete from auth.users where id in ('b3000000-0000-0000-0000-0000000000b3',
                                                       'b4000000-0000-0000-0000-0000000000b4') $$,
                'suppression du compte (cascade) : pas bloquée par l''abonnement actif');
select pg_temp.as_service();
select is(public.renew_membership('sub_g', 'in_g2', 100, pg_temp.today_z() + 60, 'chf', 'pi_g2'), 'orphan',
          'renouvellement d''un abonnement inconnu → orphan (pas de P0002)');
select is(public.renew_membership('sub_g', 'in_g2', 100, pg_temp.today_z() + 60, 'chf', 'pi_g2'), 'already',
          'orphelin rejoué → already');
select is(public.activate_membership('pi_h1', 'sub_h', pg_temp.today_z() + 30, pg_temp.mid('h1'), 'card', 10000, 'chf'),
          'orphan', 'première facture d''une adhésion supprimée → orphan');
select is(public.activate_membership('pi_x9', null, null, gen_random_uuid(), 'twint', 5000, 'chf'),
          'orphan', 'paiement unique d''une adhésion supprimée (intent inconnu) → orphan');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.pmid('h1'))).status::text || ' ' || (pg_temp.p(pg_temp.pmid('h1'))).error,
          'refund_pending orphan', 'paiement encore en base : remboursé par process-refunds');
select is(pg_temp.orphan('true'), 'payment|pi_x9|pi_x9|50.00,subscription|sub_g|pi_g2|in_g2|100.00,subscription|sub_h',
          'orphelins : facture G (à rembourser + annuler), abonnement H (à annuler), paiement X (à rembourser)');
select pg_temp.as_service();
select is((select count(*)::int from public.orphans_to_process(50)), 3, 'orphans_to_process : les trois');
select lives_ok(format('select public.mark_orphan_done(%L, ''cancelled'')',
                       (select id from public.orphan_stripe_items where stripe_id = 'sub_g')), 'G : annulé');
select is((select count(*)::int from public.orphans_to_process(50) where stripe_id = 'sub_g'), 1,
          'G annulé mais pas encore remboursé : encore à traiter');
select lives_ok(format('select public.mark_orphan_done(%L, ''refunded'')',
                       (select id from public.orphan_stripe_items where stripe_id = 'sub_g')), 'G : remboursé');
select is((select count(*)::int from public.orphans_to_process(50) where stripe_id = 'sub_g'), 0, 'G : terminé');
select is((select array_agg(public.orphan_attempt_failed((select id from public.orphan_stripe_items where stripe_id = 'pi_x9'), 'boom'))
             from generate_series(1, 8))::text,
          '{retry,retry,retry,retry,retry,retry,retry,failed}', 'orphelin : 8 échecs → failed');
select is((select count(*)::int from public.orphans_to_process(50) where stripe_id = 'pi_x9'), 0, 'orphelin failed : abandonné');
select throws_ok($$ select public.mark_orphan_done(gen_random_uuid(), 'refunded') $$, 'P0002', null,
                 'mark_orphan_done : orphelin inconnu → P0002');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
-- Adhésion abandonnée (pending > 24 h) → ended ; paiement tardif remboursé
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('a1', pg_temp.k('u'), 1, 'one_time');
select public.attach_payment_intent(pg_temp.pmid('a1'), 'pi_a1');
select pg_temp.smp('a2', pg_temp.k('u'), 3, 'one_time');
select pg_temp.as_postgres();
update public.memberships set created_at = now() - interval '25 hours' where id = pg_temp.mid('a1');
select public.process_course_schedule();
select is((pg_temp.m(pg_temp.mid('a1'))).status::text || ' ' || (pg_temp.p(pg_temp.pmid('a1'))).status
            || ' ' || (pg_temp.p(pg_temp.pmid('a1'))).error,
          'ended failed expired', 'pending depuis > 24 h : adhésion ended, paiement failed (expired)');
select is((pg_temp.m(pg_temp.mid('a2'))).status::text || ' ' || (pg_temp.p(pg_temp.pmid('a2'))).status,
          'pending pending', 'pending récent : inchangé');
select pg_temp.as_service();
select is(public.activate_membership('pi_a1', null, null, pg_temp.mid('a1'), 'twint', 10000, 'chf'), 'late_refund',
          'paiement qui aboutit après l''expiration → late_refund');
select pg_temp.as_postgres();
select is((pg_temp.p(pg_temp.pmid('a1'))).status::text || ' ' || (pg_temp.m(pg_temp.mid('a1'))).status,
          'refund_pending ended', 'paiement tardif remboursé, adhésion non activée');

-- ---------------------------------------------------------------------------
-- Suppression d'un enfant abonné par l'API : refusée (live_subscription)
-- ---------------------------------------------------------------------------
select pg_temp.login('b6000000-0000-0000-0000-0000000000b6');
insert into ids select 'kid', public.create_child_profile('{"first_name":"Kid","last_name":"Sub","age":10,"sports":["jjb"]}');
insert into ids select 'kid2', public.create_child_profile('{"first_name":"Kid","last_name":"Free","age":9,"sports":["jjb"]}');
select pg_temp.as_postgres();
insert into public.memberships (profile_id, paid_by, source, months, status, starts_on, ends_on, auto_renew,
                                stripe_subscription_id, amount)
values (pg_temp.k('kid'), pg_temp.k('par'), 'stripe_subscription', 1, 'active', pg_temp.today_z(),
        pg_temp.today_z() + 30, true, 'sub_kid', 50);
select ok(public.has_live_subscription(pg_temp.k('kid')) and not public.has_live_subscription(pg_temp.k('kid2')),
          'has_live_subscription : enfant abonné seulement');
select pg_temp.login('b6000000-0000-0000-0000-0000000000b6');
select throws_ok(format('delete from public.profiles where id = %L', pg_temp.k('kid')), '42501', null,
                 'parent : suppression de l''enfant abonné → 42501');
select is(pg_temp.hint_of(format('delete from public.profiles where id = %L', pg_temp.k('kid'))), 'live_subscription',
          'hint live_subscription');
select lives_ok(format('delete from public.profiles where id = %L', pg_temp.k('kid2')),
                'parent : enfant sans abonnement → supprimé');
select pg_temp.as_postgres();
select is((select count(*)::int from public.profiles where id in (pg_temp.k('kid'), pg_temp.k('kid2'))), 1,
          'enfant abonné conservé, l''autre supprimé');
update public.memberships set status = 'cancelled', auto_renew = false, cancel_at_period_end = true
 where stripe_subscription_id = 'sub_kid';
select pg_temp.login('b6000000-0000-0000-0000-0000000000b6');
select lives_ok(format('delete from public.profiles where id = %L', pg_temp.k('kid')),
                'abonnement résilié (plus de facturation) → suppression permise');
select pg_temp.as_postgres();

select * from finish();
rollback;
