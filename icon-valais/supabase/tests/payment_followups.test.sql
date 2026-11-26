-- pgTAP : suites du paiement (migration 0012) — montant différent remboursé,
-- abonnement annulé, intent Checkout rattaché par metadata.payment_id,
-- process-refunds planifié.
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

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

-- cours à venir + réservation en attente (superuser) + paiement de cours pending
create function pg_temp.course_payment(p_key text, p_profile uuid, p_intent text) returns void
language sql security definer as $$
  with c as (
    insert into public.courses (sport, level, location_id, starts_at, ends_at, price_non_member, created_by)
    values ('jjb', 'adulte', (select id from public.locations where is_default),
            now() + interval '2 days', now() + interval '2 days 90 minutes', 20, p_profile)
    returning id
  ), b as (
    insert into public.bookings (course_id, profile_id, booked_by, price, payment_status, pending_until)
    select c.id, p_profile, p_profile, 20, 'pending', now() + interval '15 minutes' from c
    returning id
  ), p as (
    insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, booking_id, amount,
                                 description, stripe_payment_intent_id)
    select 'course', p_profile, p_profile, b.id, 20, 'Cours JJB', p_intent from b
    returning id, booking_id
  )
  insert into ids select p_key, p.id from p
  union all select p_key || '_b', p.booking_id from p;
$$;

create function pg_temp.bst(p_booking uuid) returns text
language sql security definer as $$ select payment_status from public.bookings where id = p_booking $$;

select pg_temp.signup('a1000000-0000-0000-0000-0000000000a1', 'pf1@t.ch', '{"first_name":"Pay","last_name":"Er","age":30,"sports":["jjb"]}');
select pg_temp.signup('a2000000-0000-0000-0000-0000000000a2', 'pf2@t.ch', '{"first_name":"Sub","last_name":"Er","age":31,"sports":["jjb"]}');
insert into ids values
  ('u', pg_temp.pid('a1000000-0000-0000-0000-0000000000a1')),
  ('v', pg_temp.pid('a2000000-0000-0000-0000-0000000000a2'));

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_column('public', 'memberships', 'stripe_cancel_pending', 'memberships.stripe_cancel_pending');
select col_default_is('public', 'memberships', 'stripe_cancel_pending', 'false', 'stripe_cancel_pending : faux par défaut');

-- ---------------------------------------------------------------------------
-- Cours : montant différent → remboursement automatique
-- ---------------------------------------------------------------------------
select pg_temp.course_payment('c1', pg_temp.k('u'), 'pi_c1');
select pg_temp.as_service();
select is(public.confirm_payment('pi_c1', 'card', 1500, 'chf'), 'amount_mismatch', 'cours : montant différent → amount_mismatch');
reset role;
select is((pg_temp.p(pg_temp.k('c1'))).status, 'refund_pending'::public.payment_state,
          'cours : montant différent → paiement refund_pending (remboursé automatiquement)');
select is((pg_temp.p(pg_temp.k('c1'))).error, 'amount_mismatch: received 1500 chf, expected 2000 chf',
          'cours : note d''erreur');
select is((pg_temp.p(pg_temp.k('c1'))).method, 'card', 'cours : moyen de paiement gardé');
select is(pg_temp.bst(pg_temp.k('c1_b')), 'pending', 'cours : réservation inchangée (elle expire)');
select pg_temp.as_service();
select ok(pg_temp.k('c1') in (select id from public.refunds_to_process(50)), 'cours : dans refunds_to_process');
select is(public.confirm_payment('pi_c1', 'card', 2000, 'chf'), 'already', 'cours : rejoué ensuite → already');
select is(public.settle_payment_intent('pi_c1', 'card', 2000, 'chf'), 'already', 'settle : rejoué → already');
reset role;

-- devise différente
select pg_temp.course_payment('c2', pg_temp.k('u'), 'pi_c2');
select pg_temp.as_service();
select is(public.settle_payment_intent('pi_c2', 'twint', 2000, 'eur'), 'amount_mismatch', 'settle : devise différente');
reset role;
select is((pg_temp.p(pg_temp.k('c2'))).status, 'refund_pending'::public.payment_state, 'devise différente → refund_pending');

-- ---------------------------------------------------------------------------
-- Cours : intent inconnu (Stripe Checkout) rattaché par metadata.payment_id
-- ---------------------------------------------------------------------------
select pg_temp.course_payment('c3', pg_temp.k('u'), null);
select pg_temp.as_service();
select is(public.confirm_payment('pi_cs3', 'card', 2000, 'chf', pg_temp.k('c3')), 'confirmed',
          'Checkout : intent inconnu, paiement sans intent → rattaché et confirmé');
reset role;
select is((pg_temp.p(pg_temp.k('c3'))).stripe_payment_intent_id, 'pi_cs3', 'Checkout : intent enregistré');
select is(pg_temp.bst(pg_temp.k('c3_b')), 'paid', 'Checkout : réservation payée');
select pg_temp.as_service();
select is(public.confirm_payment('pi_cs3', 'card', 2000, 'chf', pg_temp.k('c3')), 'already', 'Checkout : rejoué → already');

-- un second intent payé pour le même paiement (ex. app puis web) → remboursé
select is(public.confirm_payment('pi_dup3', 'card', 2000, 'chf', pg_temp.k('c3')), 'duplicate_refund',
          'second intent payé pour le même paiement → duplicate_refund');
reset role;
select is((select status::text || ' ' || amount || ' ' || coalesce(booking_id::text, '-')
             from public.payments where stripe_payment_intent_id = 'pi_dup3'),
          'refund_pending 20.00 ' || pg_temp.k('c3_b'), 'second intent : nouveau paiement refund_pending');
select is((pg_temp.p(pg_temp.k('c3'))).stripe_payment_intent_id, 'pi_cs3', 'second intent : paiement d''origine inchangé');
select is(pg_temp.bst(pg_temp.k('c3_b')), 'paid', 'second intent : réservation toujours payée');
select pg_temp.as_service();
select is(public.confirm_payment('pi_dup3', 'card', 2000, 'chf', pg_temp.k('c3')), 'already', 'second intent rejoué → already');
select throws_ok(format('select public.confirm_payment(%L, %L, 2000, %L, %L)', 'pi_none', 'card', 'chf', gen_random_uuid()),
                 'P0002', null, 'intent et paiement inconnus → P0002');

-- intent non payé remplacé par celui qui paie en premier ; l'ancien, s'il
-- aboutit ensuite, est remboursé
reset role;
select pg_temp.course_payment('c5', pg_temp.k('u'), 'pi_a5');
select pg_temp.as_service();
select is(public.confirm_payment('pi_b5', 'card', 2000, 'chf', pg_temp.k('c5')), 'confirmed',
          'paiement en attente, autre intent payé en premier → confirmed');
reset role;
select is((pg_temp.p(pg_temp.k('c5'))).stripe_payment_intent_id, 'pi_b5', 'intent payé rattaché');
select pg_temp.as_service();
select is(public.confirm_payment('pi_a5', 'card', 2000, 'chf', pg_temp.k('c5')), 'duplicate_refund',
          'ancien intent payé ensuite → duplicate_refund');

-- apply_stripe_event transmet p_payment
reset role;
select pg_temp.course_payment('c4', pg_temp.k('u'), null);
select pg_temp.as_service();
select is(public.apply_stripe_event('evt_c4', 'payment_intent.succeeded', 'confirm_payment',
            jsonb_build_object('p_intent', 'pi_cs4', 'p_method', 'twint', 'p_amount_cents', 2000,
                               'p_currency', 'chf', 'p_payment', pg_temp.k('c4'))),
          'confirmed', 'apply_stripe_event : p_payment transmis à confirm_payment');
reset role;

-- ---------------------------------------------------------------------------
-- Adhésions : montant différent → remboursement ; abonnement → annulation
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('o1', pg_temp.k('u'), 1, 'one_time');
select public.attach_payment_intent(pg_temp.pmid('o1'), 'pi_o1');
select is(public.activate_membership('pi_o1', null, null, null, 'twint', 5000, 'chf'), 'amount_mismatch',
          'adhésion unique : montant différent → amount_mismatch');
reset role;
select is((pg_temp.p(pg_temp.pmid('o1'))).status, 'refund_pending'::public.payment_state,
          'adhésion unique : paiement refund_pending');
select is((pg_temp.m(pg_temp.mid('o1'))).status::text || ' ' || (pg_temp.m(pg_temp.mid('o1'))).stripe_cancel_pending,
          'pending false', 'adhésion unique : non activée, rien à annuler chez Stripe');
select pg_temp.as_service();
select is(public.activate_membership('pi_o1', null, null, null, 'twint', 10000, 'chf'), 'already',
          'adhésion unique : rejoué → already');

-- première facture d'abonnement au mauvais montant
select pg_temp.smp('s1', pg_temp.k('v'), 1, 'stripe_subscription');
select public.attach_payment_intent(pg_temp.pmid('s1'), 'pi_s1');
select is(public.activate_membership(null, 'sub_bad', (now() at time zone 'Europe/Zurich')::date + 30,
                                     pg_temp.mid('s1'), 'card', 100, 'chf'),
          'amount_mismatch', 'abonnement : première facture au mauvais montant → amount_mismatch');
reset role;
select is((pg_temp.p(pg_temp.pmid('s1'))).status, 'refund_pending'::public.payment_state,
          'abonnement : paiement refund_pending');
select is((pg_temp.m(pg_temp.mid('s1'))).stripe_subscription_id || ' ' || (pg_temp.m(pg_temp.mid('s1'))).stripe_cancel_pending
            || ' ' || (pg_temp.m(pg_temp.mid('s1'))).status,
          'sub_bad true pending', 'abonnement : à annuler immédiatement chez Stripe, non activé');
select pg_temp.as_service();
select is((select array_agg(stripe_subscription_id) from public.subscriptions_to_cancel(20)), array['sub_bad'],
          'subscriptions_to_cancel : l''abonnement à annuler');
select lives_ok(format('select public.mark_subscription_cancelled(%L)', pg_temp.mid('s1')), 'mark_subscription_cancelled');
select is((select count(*)::int from public.subscriptions_to_cancel(20)), 0, 'annulé : plus dans la liste');
reset role;
select is((pg_temp.m(pg_temp.mid('s1'))).status::text || ' ' || (pg_temp.m(pg_temp.mid('s1'))).stripe_cancel_pending,
          'ended false', 'annulé : adhésion terminée');

-- ---------------------------------------------------------------------------
-- Intent obligatoire pour régler une adhésion ; renouvellement au mauvais montant
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('s2', pg_temp.k('u'), 1, 'stripe_subscription');
select is(pg_temp.hint_of(format('select public.activate_membership(null, %L, %L, %L, %L, 10000, %L)',
                                 'sub_ok', (now() at time zone 'Europe/Zurich')::date + 30, pg_temp.mid('s2'), 'card', 'chf')),
          'missing_intent', 'première facture sans intent connu → missing_intent (Stripe réessaiera)');
reset role;
select is((pg_temp.p(pg_temp.pmid('s2'))).status, 'pending'::public.payment_state, 'missing_intent : rien enregistré');
select pg_temp.as_service();
select is(public.activate_membership('pi_s2_inv', 'sub_ok', (now() at time zone 'Europe/Zurich')::date + 30,
                                     pg_temp.mid('s2'), 'card', 10000, 'chf'),
          'activated', 'intent résolu (webhook) : activated');
select is(pg_temp.hint_of($$ select public.renew_membership('sub_ok', 'in_r1', 100, current_date + 60, 'chf') $$),
          'missing_intent', 'renouvellement sans intent → missing_intent');
select is((select count(*)::int from public.payments where stripe_invoice_id = 'in_r1'), 0, 'missing_intent : aucun paiement');
select is(public.renew_membership('sub_ok', 'in_r2', 80, current_date + 60, 'chf', 'pi_r2'), 'amount_mismatch',
          'renouvellement au mauvais montant → amount_mismatch');
reset role;
select is((select status::text || ' ' || (paid_at is not null) || ' ' || stripe_payment_intent_id || ' ' || (error is not null)
             from public.payments where stripe_invoice_id = 'in_r2'),
          'refund_pending true pi_r2 true', 'renouvellement au mauvais montant : refund_pending, payé, intent, note');
select is((pg_temp.m(pg_temp.mid('s2'))).stripe_cancel_pending::text || ' ' || (pg_temp.m(pg_temp.mid('s2'))).auto_renew,
          'true false', 'renouvellement au mauvais montant : abonnement à annuler immédiatement');
select pg_temp.as_service();
select is(public.renew_membership('sub_ok', 'in_r2', 80, current_date + 60, 'chf', 'pi_r2'), 'already',
          'facture rejouée → already (idempotent)');
select ok('sub_ok' in (select stripe_subscription_id from public.subscriptions_to_cancel(20)), 'listé dans subscriptions_to_cancel');
select ok(pg_temp.pmid('s2') is not null
          and (select id from public.payments where stripe_invoice_id = 'in_r2') in (select id from public.refunds_to_process(50)),
          'listé dans refunds_to_process');
reset role;

-- ---------------------------------------------------------------------------
-- Planification et droits
-- ---------------------------------------------------------------------------
select is(public.invoke_process_refunds(), null::bigint, 'invoke_process_refunds : sans secrets Vault → null, sans erreur');
select is((select schedule from cron.job where jobname = 'process-refunds'), '*/5 * * * *',
          'pg_cron : process-refunds toutes les 5 minutes');

select pg_temp.login('a1000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select * from public.subscriptions_to_cancel(10) $$, '42501', null,
                 'authenticated : subscriptions_to_cancel refusé');
reset role;
select is((select count(*)::int from information_schema.routine_privileges
            where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
              and routine_name in ('subscriptions_to_cancel', 'mark_subscription_cancelled', 'invoke_process_refunds',
                                   'confirm_payment', 'activate_membership', 'apply_stripe_event')), 0,
          'anon / authenticated : aucun droit d''exécution');

select * from finish();
rollback;
