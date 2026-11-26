-- pgTAP : abonnements, webhook Stripe, rappel TWINT (migration 0011)
begin;
create extension if not exists pgtap with schema extensions;

select plan(143);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
-- résultats de start_membership_payment
create temp table mp (k text primary key, membership_id uuid, payment_id uuid, amount numeric, description text);
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

create function pg_temp.today_z() returns date
language sql stable as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- démarre un paiement d'adhésion (appelant courant) et garde le résultat sous p_key
create function pg_temp.smp(p_key text, p_profile uuid, p_payer uuid, p_months int,
                            p_source public.membership_source default 'one_time') returns void
language plpgsql as $$
begin
  insert into mp select p_key, r.membership_id, r.payment_id, r.amount, r.description
    from public.start_membership_payment(p_profile, p_payer, p_months, p_source) r;
end;
$$;

create function pg_temp.mid(p_k text) returns uuid
language sql stable as $$ select membership_id from mp where k = p_k $$;

create function pg_temp.pmid(p_k text) returns uuid
language sql stable as $$ select payment_id from mp where k = p_k $$;

-- adhésion (superuser) : statut, dates, source, paiement
create function pg_temp.m(p_k text) returns public.memberships
language sql security definer as $$ select * from public.memberships where id = (select membership_id from mp where k = p_k) $$;

create function pg_temp.pst(p_payment uuid) returns text
language sql security definer as $$ select status::text from public.payments where id = p_payment $$;

-- lie un intent (superuser, comme attach_payment_intent)
create function pg_temp.intent(p_payment uuid, p_intent text) returns void
language sql security definer as $$
  update public.payments set stripe_payment_intent_id = p_intent where id = p_payment;
$$;

-- pa : parent de ch (12 ans) ; o : autre parent (de ko) ; s : adulte seul ;
-- mi : mineur sans consentement (inactif) ; t : adulte avec abonnement Stripe
select pg_temp.signup('9a000000-0000-0000-0000-00000000009a', 'sbpa@t.ch', '{"first_name":"Pa","last_name":"Rent","age":42,"sports":["jjb"]}');
select pg_temp.signup('9b000000-0000-0000-0000-00000000009b', 'sbo@t.ch', '{"first_name":"Oth","last_name":"Er","age":44,"sports":["jjb"]}');
select pg_temp.signup('55000000-0000-0000-0000-000000000055', 'sbs@t.ch', '{"first_name":"Solo","last_name":"Adult","age":30,"sports":["jjb"]}');
select pg_temp.signup('e0000000-0000-0000-0000-00000000000e', 'sbmi@t.ch', '{"first_name":"Min","last_name":"Or","age":13,"sports":["jjb"],"parent_email":"pp@t.ch"}');
select pg_temp.signup('77000000-0000-0000-0000-000000000077', 'sbt@t.ch', '{"first_name":"Sub","last_name":"Scriber","age":35,"sports":["jjb"]}');
insert into ids values
  ('pa', pg_temp.pid('9a000000-0000-0000-0000-00000000009a')),
  ('o',  pg_temp.pid('9b000000-0000-0000-0000-00000000009b')),
  ('s',  pg_temp.pid('55000000-0000-0000-0000-000000000055')),
  ('mi', pg_temp.pid('e0000000-0000-0000-0000-00000000000e')),
  ('t',  pg_temp.pid('77000000-0000-0000-0000-000000000077'));
-- w : adulte avec « payé pour l'année » (chevauchements)
select pg_temp.signup('88000000-0000-0000-0000-000000000088', 'sbw@t.ch', '{"first_name":"Wid","last_name":"Year","age":33,"sports":["jjb"]}');
insert into ids values ('w', pg_temp.pid('88000000-0000-0000-0000-000000000088'));
insert into public.profiles (parent_profile_id, first_name, last_name, age, sports)
values (pg_temp.k('pa'), 'Kid', 'Rent', 12, '{jjb}'),
       (pg_temp.k('o'), 'Kid', 'Other', 8, '{jjb}');
insert into ids values
  ('ch', (select id from public.profiles where parent_profile_id = pg_temp.k('pa'))),
  ('ko', (select id from public.profiles where parent_profile_id = pg_temp.k('o')));

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_table('public', 'stripe_events', 'table stripe_events');
select col_is_pk('public', 'stripe_events', 'id', 'stripe_events : id clé primaire');
select ok((select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass),
          'stripe_events : RLS activée');

-- ---------------------------------------------------------------------------
-- start_membership_payment
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.smp('ch1', pg_temp.k('ch'), pg_temp.k('pa'), 1);
select is((select amount from mp where k = 'ch1'), 50.00, 'parent → enfant de 12 ans, 1 mois : 50');
select is((select description from mp where k = 'ch1'), 'Adhésion 1 mois', 'description');
select throws_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                        pg_temp.k('ko'), pg_temp.k('pa'), 'one_time'),
                 '42501', null, 'parent → enfant d''un autre : 42501');
select throws_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                        pg_temp.k('s'), pg_temp.k('pa'), 'one_time'),
                 '42501', null, 'payeur → autre adulte : 42501');
select throws_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                        pg_temp.k('mi'), pg_temp.k('mi'), 'one_time'),
                 '42501', null, 'payeur inactif (mineur sans consentement) : 42501');
select throws_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                        pg_temp.k('pa'), gen_random_uuid(), 'one_time'),
                 '42501', null, 'payeur inconnu : 42501');
select throws_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                        gen_random_uuid(), pg_temp.k('pa'), 'one_time'),
                 '42501', null, 'bénéficiaire inconnu : 42501');
select is(pg_temp.hint_of(format('select * from public.start_membership_payment(%L, %L, 2, %L)',
                                 pg_temp.k('s'), pg_temp.k('s'), 'one_time')),
          'invalid_field', 'durée invalide : invalid_field');
select is(pg_temp.hint_of(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                                 pg_temp.k('s'), pg_temp.k('s'), 'admin_year')),
          'invalid_field', 'source admin_year : invalid_field');
select pg_temp.smp('s1', pg_temp.k('s'), pg_temp.k('s'), 1);
select pg_temp.smp('s2', pg_temp.k('s'), pg_temp.k('s'), 3);
select pg_temp.smp('t1', pg_temp.k('t'), pg_temp.k('t'), 1, 'stripe_subscription');
reset role;
select is((select amount from mp where k = 's1'), 100.00, 'adulte, 1 mois : 100');
select is((select description from mp where k = 't1'), 'Adhésion 1 mois (abonnement)', 'description : abonnement');
select is((select row(m.profile_id, m.paid_by, m.source, m.months, m.status, m.amount, m.starts_on)::text
             from public.memberships m where m.id = pg_temp.mid('ch1')),
          row(pg_temp.k('ch'), pg_temp.k('pa'), 'one_time'::public.membership_source, 1,
              'pending'::public.membership_status, 50.00, null::date)::text,
          'adhésion pending créée (bénéficiaire, payeur, source, durée, montant)');
select is((select row(p.kind, p.payer_profile_id, p.beneficiary_profile_id, p.membership_id, p.amount, p.status)::text
             from public.payments p where p.id = pg_temp.pmid('ch1')),
          row('membership'::public.payment_kind, pg_temp.k('pa'), pg_temp.k('ch'), pg_temp.mid('ch1'), 50.00,
              'pending'::public.payment_state)::text,
          'paiement pending créé');
select is(public.is_member(pg_temp.k('ch')), false, 'adhésion pending : pas encore adhérent');

-- ---------------------------------------------------------------------------
-- activate_membership (paiement unique)
-- ---------------------------------------------------------------------------
select pg_temp.intent(pg_temp.pmid('ch1'), 'pi_ch1');
select pg_temp.intent(pg_temp.pmid('s1'), 'pi_s1');
select pg_temp.intent(pg_temp.pmid('s2'), 'pi_s2');
select pg_temp.intent(pg_temp.pmid('t1'), 'pi_t1');
select pg_temp.as_service();
select is(public.activate_membership('pi_ch1', null, null), 'activated', 'activate_membership : activated');
select is(public.activate_membership('pi_ch1', null, null), 'already', 'deuxième appel : already');
select throws_ok($$ select public.activate_membership('pi_unknown', null, null) $$, 'P0002', null,
                 'intent inconnu : P0002');
reset role;
select is((select row(status, starts_on, ends_on, auto_renew)::text from pg_temp.m('ch1')),
          row('active'::public.membership_status, pg_temp.today_z(),
              (pg_temp.today_z() + interval '1 month' - interval '1 day')::date, false)::text,
          'actif d''aujourd''hui à aujourd''hui + 1 mois - 1 jour, sans renouvellement');
select is((select count(*)::int from public.memberships where profile_id = pg_temp.k('ch') and status = 'active'), 1,
          'deux appels : une seule activation');
select is(pg_temp.pst(pg_temp.pmid('ch1')), 'succeeded', 'paiement succeeded');
select ok((select paid_at is not null from public.payments where id = pg_temp.pmid('ch1')), 'paid_at renseigné');
select is(public.is_member(pg_temp.k('ch')), true, 'is_member : vrai aujourd''hui');
select is(public.is_member(pg_temp.k('ch'), (pg_temp.m('ch1')).ends_on), true, 'is_member : vrai le jour de ends_on');
select is(public.is_member(pg_temp.k('ch'), (pg_temp.m('ch1')).ends_on + 1), false, 'is_member : faux le lendemain');

-- 2e adhésion payée pendant la 1re : démarre le lendemain de sa fin
select pg_temp.as_service();
select is(public.activate_membership('pi_s1', null, null, null, 'twint'), 'activated', 's1 activée');
select is(public.activate_membership('pi_s2', null, null), 'activated', 's2 activée pendant s1');
reset role;
select is((select method from public.payments where id = pg_temp.pmid('s1')), 'twint', 'moyen de paiement enregistré');
select is((pg_temp.m('s2')).starts_on, (pg_temp.m('s1')).ends_on + 1, '2e adhésion : démarre le lendemain de la 1re');
select is((pg_temp.m('s2')).ends_on,
          ((pg_temp.m('s1')).ends_on + 1 + interval '3 months' - interval '1 day')::date,
          '2e adhésion : 3 mois depuis son début');
select is(public.is_member(pg_temp.k('s'), (pg_temp.m('s2')).ends_on), true, 's : adhérent jusqu''à la fin de la 2e');

-- « payé pour l'année » en cours : l'adhésion payée commence après
update public.profiles set paid_until = pg_temp.today_z() + 10 where id = pg_temp.k('o');
select pg_temp.as_service();
select pg_temp.smp('o1', pg_temp.k('o'), pg_temp.k('o'), 1);
reset role;
select pg_temp.intent(pg_temp.pmid('o1'), 'pi_o1');
select pg_temp.as_service();
select is(public.activate_membership('pi_o1', null, null), 'activated', 'o1 activée');
reset role;
select is((pg_temp.m('o1')).starts_on, pg_temp.today_z() + 11, 'paid_until en cours : démarre le lendemain');

-- paiement échoué puis réussi (même intent) : activée
select pg_temp.as_service();
select pg_temp.smp('o2', pg_temp.k('ko'), pg_temp.k('o'), 1);
reset role;
select pg_temp.intent(pg_temp.pmid('o2'), 'pi_o2');
select pg_temp.as_service();
select public.fail_payment('pi_o2');
select is(public.activate_membership('pi_o2', null, null), 'activated', 'échec puis réussite : activée');
reset role;
select is(pg_temp.pst(pg_temp.pmid('o2')), 'succeeded', 'échec puis réussite : succeeded');

-- paiement de cours : refusé par activate_membership
insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, amount, description,
                             stripe_payment_intent_id)
values ('course', pg_temp.k('s'), pg_temp.k('s'), 20, 'Cours', 'pi_course');
select pg_temp.as_service();
select is(pg_temp.hint_of($$ select public.activate_membership('pi_course', null, null) $$), 'invalid_field',
          'paiement de cours : invalid_field');

-- ---------------------------------------------------------------------------
-- Montant et devise de l'événement comparés au montant en base
-- ---------------------------------------------------------------------------
select pg_temp.smp('am1', pg_temp.k('o'), pg_temp.k('o'), 1);
reset role;
select pg_temp.intent(pg_temp.pmid('am1'), 'pi_am1');
select pg_temp.as_service();
select is(public.activate_membership('pi_am1', null, null, null, null, 5000, 'chf'), 'amount_mismatch',
          'adhésion : montant différent → amount_mismatch');
select is(public.activate_membership('pi_am1', null, null, null, null, 10000, 'eur'), 'already',
          'adhésion : déjà à rembourser (0012) → already');
reset role;
select is((select status::text || ' ' || error from public.payments where id = pg_temp.pmid('am1')),
          'refund_pending amount_mismatch: received 5000 chf, expected 10000 chf',
          'montant différent : paiement refund_pending (0012), note d''erreur');
select is((pg_temp.m('am1')).status, 'pending'::public.membership_status, 'montant différent : adhésion non activée');
select pg_temp.as_service();
select is(public.activate_membership('pi_am1', null, null, null, null, 10000, 'CHF'), 'already',
          'montant conforme ensuite : already (l''argent reçu est rendu)');
reset role;
select is((pg_temp.m('am1')).status, 'pending'::public.membership_status, 'toujours non activée');
select pg_temp.as_service();
select is(public.confirm_payment('pi_course', 'card', 1000, 'chf'), 'amount_mismatch', 'cours : montant différent → amount_mismatch');
select is(public.settle_payment_intent('pi_course', 'card', 2000, 'usd'), 'already',
          'settle : déjà à rembourser → already');
reset role;
select is((select status::text from public.payments where stripe_payment_intent_id = 'pi_course'), 'refund_pending',
          'cours : paiement refund_pending (0012)');
select pg_temp.as_service();

-- ---------------------------------------------------------------------------
-- settle_payment_intent : routage par recherche de l'intent
-- ---------------------------------------------------------------------------
select pg_temp.smp('s3', pg_temp.k('s'), pg_temp.k('s'), 1);
reset role;
select pg_temp.intent(pg_temp.pmid('s3'), 'pi_s3');
select pg_temp.as_service();
select is(public.settle_payment_intent('pi_s3', 'card'), 'activated', 'settle : adhésion → activate_membership');
select is(public.settle_payment_intent('pi_s3', 'card'), 'already', 'settle : deuxième fois → already');
select is(public.settle_payment_intent('pi_nobody', 'card'), 'unknown', 'settle : intent inconnu → unknown, sans erreur');
reset role;
select is((pg_temp.m('s3')).starts_on, (pg_temp.m('s2')).ends_on + 1, 'settle : 3e adhésion empilée après la 2e');

-- ---------------------------------------------------------------------------
-- Abonnement Stripe : activation par invoice.paid (subscription_create)
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
-- payment_intent.succeeded de la première facture : attend la facture
select is(public.activate_membership('pi_t1', null, null), 'awaiting_invoice',
          'abonnement sans p_subscription : awaiting_invoice');
reset role;
select is((pg_temp.m('t1')).status, 'pending'::public.membership_status, 'awaiting_invoice : toujours pending');
select pg_temp.as_service();
select is(public.activate_membership('pi_t1', 'sub_t', pg_temp.today_z() + 30, null, 'card'), 'activated',
          'invoice.paid subscription_create : activated');
select is(public.activate_membership('pi_t1', 'sub_t', pg_temp.today_z() + 30), 'already', 'deuxième fois : already');
reset role;
select is((select row(status, starts_on, ends_on, auto_renew, stripe_subscription_id)::text from pg_temp.m('t1')),
          row('active'::public.membership_status, pg_temp.today_z(), pg_temp.today_z() + 30, true, 'sub_t')::text,
          'abonnement : ends_on = fin de période, auto_renew, id d''abonnement');

-- activation sans intent dans la facture : retrouvée par p_membership
select pg_temp.as_service();
select pg_temp.smp('t2', pg_temp.k('pa'), pg_temp.k('pa'), 3, 'stripe_subscription');
-- intent de la première facture lié par create-payment (0012 : obligatoire)
reset role;
select pg_temp.intent(pg_temp.pmid('t2'), 'pi_t2');
select pg_temp.as_service();
select is(public.activate_membership(null, 'sub_t2', pg_temp.today_z() + 91, pg_temp.mid('t2'), 'card'), 'activated',
          'sans intent : retrouvée par p_membership');
select is(public.activate_membership(null, 'sub_t2', pg_temp.today_z() + 91, pg_temp.mid('t2')), 'already',
          'sans intent, deuxième fois : already');
select throws_ok($$ select public.activate_membership(null, 'sub_none', null) $$, 'P0002', null,
                 'ni intent, ni abonnement, ni adhésion connus : P0002');
reset role;
select is((select row(status, ends_on, stripe_subscription_id)::text from pg_temp.m('t2')),
          row('active'::public.membership_status, pg_temp.today_z() + 91, 'sub_t2')::text,
          'sans intent : active jusqu''à la fin de période');
select is(pg_temp.pst(pg_temp.pmid('t2')), 'succeeded', 'sans intent : paiement succeeded');

-- ---------------------------------------------------------------------------
-- renew_membership
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select is(public.renew_membership('sub_t', 'in_1', 100, pg_temp.today_z() + 60, 'chf', 'pi_in_1'), 'renewed', 'renouvellement : renewed');
select is(public.renew_membership('sub_t', 'in_1', 100, pg_temp.today_z() + 60, 'chf', 'pi_in_1'), 'already',
          'même facture deux fois : already');
select throws_ok($$ select public.renew_membership('sub_unknown', 'in_x', 100, current_date + 30) $$, 'P0002', null,
                 'abonnement inconnu : P0002');
reset role;
select is((pg_temp.m('t1')).ends_on, pg_temp.today_z() + 60, 'renouvellement : ends_on = nouvelle fin de période');
select is((select count(*)::int from public.payments where membership_id = pg_temp.mid('t1')), 2,
          'même facture deux fois : un seul paiement de renouvellement');
select is((select row(status, amount, stripe_invoice_id, payer_profile_id, beneficiary_profile_id, method)::text
             from public.payments where stripe_invoice_id = 'in_1'),
          row('succeeded'::public.payment_state, 100.00, 'in_1', pg_temp.k('t'), pg_temp.k('t'), 'card')::text,
          'paiement de renouvellement succeeded, lié à la même adhésion');
select is(public.is_member(pg_temp.k('t'), pg_temp.today_z() + 60), true, 'adhérent jusqu''à la nouvelle fin');
-- facture plus ancienne rejouée après une plus récente : ends_on ne recule pas
select pg_temp.as_service();
select is(public.renew_membership('sub_t', 'in_0', 100, pg_temp.today_z() + 45, 'chf', 'pi_in_0'), 'renewed', 'facture ancienne : renewed');
reset role;
select is((pg_temp.m('t1')).ends_on, pg_temp.today_z() + 60, 'facture ancienne : ends_on ne recule pas');
select pg_temp.as_service();
select is(public.renew_membership('sub_t', 'in_bad', 50, pg_temp.today_z() + 90, 'chf', 'pi_in_bad'), 'amount_mismatch',
          'renouvellement : montant différent → amount_mismatch');
select is(public.renew_membership('sub_t', 'in_eur', 100, pg_temp.today_z() + 90, 'eur', 'pi_in_eur'), 'amount_mismatch',
          'renouvellement : devise différente → amount_mismatch');
select is(public.renew_membership('sub_t', 'in_bad', 50, pg_temp.today_z() + 90, 'chf', 'pi_in_bad'), 'already',
          'renouvellement refusé rejoué : already');
select is(public.renew_membership('sub_t', 'in_2', 100, pg_temp.today_z() + 60, 'chf', 'pi_in_2'), 'renewed',
          'renouvellement avec l''intent de la facture');
reset role;
select is((pg_temp.m('t1')).ends_on, pg_temp.today_z() + 60, 'montant différent : pas de prolongation');
select is((select status::text || ' ' || (error is not null)::text from public.payments where stripe_invoice_id = 'in_bad'),
          'refund_pending true', 'montant différent : paiement refund_pending (0012) avec note');
select is((select row(stripe_cancel_pending, auto_renew)::text from pg_temp.m('t1')), row(true, false)::text,
          'renouvellement au mauvais montant : abonnement à annuler (0012)');
-- la suite (chevauchements) suppose l'abonnement sub_t toujours reconduit
update public.memberships set stripe_cancel_pending = false, auto_renew = true where id = pg_temp.mid('t1');
select is((select stripe_payment_intent_id from public.payments where stripe_invoice_id = 'in_2'), 'pi_in_2',
          'intent de la facture gardé sur le paiement');
select pg_temp.as_service();
select is(public.mark_refunded_by_intent(null, 'in_1'), 'refunded', 'charge.refunded retrouvé par la facture');
select is(public.mark_refunded_by_intent('pi_in_2', 'in_2'), 'refunded', 'charge.refunded retrouvé par l''intent');
reset role;
select is((select string_agg(status::text, ',' order by stripe_invoice_id) from public.payments
            where stripe_invoice_id in ('in_1', 'in_2')), 'refunded,refunded', 'paiements d''abonnement refunded');
select is((select row(status, ends_on)::text from pg_temp.m('t1')),
          row('active'::public.membership_status, pg_temp.today_z() + 60)::text,
          'paiement d''adhésion remboursé : adhésion inchangée');

-- ---------------------------------------------------------------------------
-- Chevauchements
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select is(pg_temp.hint_of(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                                 pg_temp.k('t'), pg_temp.k('t'), 'one_time')),
          'already_covered', 'abonnement actif qui se renouvelle : paiement unique refusé');
select is(pg_temp.hint_of(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                                 pg_temp.k('t'), pg_temp.k('t'), 'stripe_subscription')),
          'already_covered', 'abonnement actif qui se renouvelle : second abonnement refusé');
select is(pg_temp.hint_of(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                                 pg_temp.k('s'), pg_temp.k('s'), 'stripe_subscription')),
          'already_covered', 'paiement unique couvrant plus de 7 jours : abonnement refusé');
reset role;
update public.profiles set paid_until = pg_temp.today_z() + 20 where id = pg_temp.k('w');
select pg_temp.as_service();
select is(pg_temp.hint_of(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                                 pg_temp.k('w'), pg_temp.k('w'), 'stripe_subscription')),
          'already_covered', '« payé pour l''année » couvrant plus de 7 jours : abonnement refusé');
select lives_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                       pg_temp.k('w'), pg_temp.k('w'), 'one_time'),
                'couverture de plus de 7 jours : paiement unique accepté (empilé)');
reset role;
update public.profiles set paid_until = pg_temp.today_z() + 5 where id = pg_temp.k('w');
select pg_temp.as_service();
select pg_temp.smp('w1', pg_temp.k('w'), pg_temp.k('w'), 1, 'stripe_subscription');
reset role;
select pg_temp.intent(pg_temp.pmid('w1'), 'pi_w1');
select pg_temp.as_service();
select is(public.activate_membership(null, 'sub_w', pg_temp.today_z() + 31, pg_temp.mid('w1'), 'card', 10000, 'chf'),
          'activated', 'dans les 7 derniers jours : abonnement accepté');
reset role;
select is((select row(starts_on, ends_on)::text from pg_temp.m('w1')),
          row(pg_temp.today_z() + 6, pg_temp.today_z() + 31)::text, 'abonnement empilé après la couverture');

-- ---------------------------------------------------------------------------
-- set_membership_cancel / end_membership
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select public.set_membership_cancel('sub_t', true);
select public.set_membership_cancel('sub_t', true, now());
-- événement plus ancien que le dernier appliqué : ignoré
select public.set_membership_cancel('sub_t', false, now() - interval '1 minute');
reset role;
select is((select last_stripe_update_at from public.memberships where id = pg_temp.mid('t1')), now(),
          'last_stripe_update_at = événement appliqué');
select is((select row(status, cancel_at_period_end, auto_renew)::text from pg_temp.m('t1')),
          row('cancelled'::public.membership_status, true, false)::text,
          'résiliation : cancelled, cancel_at_period_end, plus de renouvellement');
select is(public.is_member(pg_temp.k('t')), true, 'résilié : toujours adhérent');
select is(public.is_member(pg_temp.k('t'), pg_temp.today_z() + 60), true, 'résilié : adhérent jusqu''à ends_on');
select pg_temp.login('77000000-0000-0000-0000-000000000077');
select is((select row(is_member, cancel_at_period_end)::text from public.my_membership()),
          row(true, true)::text, 'my_membership : résilié, toujours adhérent');
reset role;
select pg_temp.as_service();
select public.set_membership_cancel('sub_t', false);
reset role;
select is((select row(status, cancel_at_period_end, auto_renew)::text from pg_temp.m('t1')),
          row('active'::public.membership_status, false, true)::text, 'résiliation annulée : de nouveau active');
select pg_temp.as_service();
select public.set_membership_cancel('sub_t', true);
select public.end_membership('sub_t');
select public.end_membership('sub_t');
select lives_ok($$ select public.end_membership('sub_unknown') $$, 'end_membership : abonnement inconnu sans effet');
select lives_ok($$ select public.set_membership_cancel('sub_unknown', true) $$,
                'set_membership_cancel : abonnement inconnu sans effet');
reset role;
select is((pg_temp.m('t1')).status, 'ended'::public.membership_status, 'end_membership : ended');
select is(public.is_member(pg_temp.k('t')), false, 'ended : plus adhérent');
select pg_temp.as_service();
select lives_ok($$ select public.set_membership_cancel('sub_t', false) $$, 'ended : set_membership_cancel sans effet');
reset role;
select is((pg_temp.m('t1')).status, 'ended'::public.membership_status, 'ended : reste ended');

-- ---------------------------------------------------------------------------
-- mark_refunded_by_intent (charge.refunded)
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select is(public.mark_refunded_by_intent('pi_s3'), 'refunded', 'remboursement Stripe : refunded');
select is(public.mark_refunded_by_intent('pi_s3'), 'already', 'deuxième fois : already');
select is(public.mark_refunded_by_intent('pi_nobody'), 'unknown', 'intent inconnu : unknown');
reset role;
select is(pg_temp.pst(pg_temp.pmid('s3')), 'refunded', 'paiement refunded');
select ok((select refunded_at is not null from public.payments where id = pg_temp.pmid('s3')), 'refunded_at renseigné');

-- remboursement d'une réservation de cours depuis le tableau de bord : désinscrite
with c as (
  insert into public.courses (sport, level, location_id, starts_at, ends_at, created_by, price_non_member)
  values ('jjb', 'adulte', (select id from public.locations where is_default),
          now() + interval '2 days', now() + interval '2 days 90 minutes', pg_temp.k('pa'), 20)
  returning id
), b as (
  insert into public.bookings (course_id, profile_id, booked_by, price, payment_status)
  select c.id, pg_temp.k('s'), pg_temp.k('s'), 20, 'paid' from c
  returning id
)
insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, booking_id, amount, status,
                             stripe_payment_intent_id, description)
select 'course', pg_temp.k('s'), pg_temp.k('s'), b.id, 20, 'succeeded', 'pi_bk', 'Cours' from b;
select pg_temp.as_service();
select is(public.mark_refunded_by_intent('pi_bk'), 'refunded', 'cours remboursé depuis Stripe : refunded');
reset role;
select is((select payment_status || ' ' || (cancelled_at is not null)::text from public.bookings
            where id = (select booking_id from public.payments where stripe_payment_intent_id = 'pi_bk')),
          'refunded true', 'réservation remboursée : refunded et désinscrite');

-- ---------------------------------------------------------------------------
-- apply_stripe_event : enregistrement et action dans la même transaction
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select is(public.apply_stripe_event('evt_1', 'invoice.paid', 'renew_membership',
            jsonb_build_object('p_subscription', 'sub_t2', 'p_invoice', 'in_t2_1', 'p_amount', 250,
                               'p_period_end', pg_temp.today_z() + 182, 'p_currency', 'chf', 'p_intent', 'pi_t2_1')),
          'renewed', 'apply_stripe_event : action appliquée');
select is(public.apply_stripe_event('evt_1', 'invoice.paid', 'renew_membership',
            jsonb_build_object('p_subscription', 'sub_t2', 'p_invoice', 'in_t2_2', 'p_amount', 250,
                               'p_period_end', pg_temp.today_z() + 273, 'p_currency', 'chf')),
          'duplicate', 'apply_stripe_event : déjà reçu → duplicate');
select is((select count(*)::int from public.stripe_events where id = 'evt_1'), 1, 'événement enregistré une fois');
select is((select count(*)::int from public.payments where stripe_invoice_id in ('in_t2_1', 'in_t2_2')), 1,
          'duplicate : sans effet');
select throws_ok($$ select public.apply_stripe_event('evt_2', 'invoice.paid', 'renew_membership',
                      '{"p_subscription":"sub_unknown","p_invoice":"in_u","p_amount":1,"p_period_end":"2030-01-01"}') $$,
                 'P0002', null, 'apply_stripe_event : action en échec → erreur');
select is((select count(*)::int from public.stripe_events where id = 'evt_2'), 0,
          'action en échec : aucun événement enregistré (Stripe réessaiera)');
select is(pg_temp.hint_of($$ select public.apply_stripe_event('evt_3', 'x', 'admin_update_pricing', '{}') $$),
          'invalid_field', 'apply_stripe_event : fonction hors liste → invalid_field');
select is((select count(*)::int from public.stripe_events where id = 'evt_3'), 0, 'fonction hors liste : rien enregistré');
select is(public.apply_stripe_event('evt_4', 'customer.subscription.deleted', 'end_membership',
                                    '{"p_subscription":"sub_none"}'), 'ok', 'action sans résultat : ok');
select is(public.apply_stripe_event('evt_5', 'customer.subscription.updated', 'set_membership_cancel',
            jsonb_build_object('p_subscription', 'sub_t2', 'p_cancel_at_period_end', true, 'p_event_at', now())),
          'ok', 'apply_stripe_event : set_membership_cancel');
reset role;
select is((pg_temp.m('t2')).cancel_at_period_end, true, 'apply_stripe_event : résiliation appliquée');

-- ---------------------------------------------------------------------------
-- record_customer
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select is(public.record_customer(pg_temp.k('pa'), 'cus_pa'), 'cus_pa', 'record_customer : enregistré');
select is(public.record_customer(pg_temp.k('pa'), 'cus_other'), 'cus_pa', 'record_customer : jamais remplacé');
select throws_ok(format('select public.record_customer(%L, %L)', gen_random_uuid(), 'cus_x'), 'P0002', null,
                 'record_customer : profil inconnu');
reset role;
select is((select stripe_customer_id from public.profiles where id = pg_temp.k('pa')), 'cus_pa', 'stripe_customer_id');

-- ---------------------------------------------------------------------------
-- Rappel TWINT : membership_expiring
-- ---------------------------------------------------------------------------
select ok(pg_temp.hint_of($$ insert into public.notification_outbox (profile_id, kind)
                             values ((select v from ids where k = 'pa'), 'membership_expiring') $$) is null,
          'outbox : genre membership_expiring accepté');
delete from public.notification_outbox;
-- ch : one_time finissant dans 7 jours (enfant → parent)
update public.memberships set starts_on = pg_temp.today_z() - 23, ends_on = pg_temp.today_z() + 7
 where id = pg_temp.mid('ch1');
-- ko : one_time finissant dans 7 jours, mais une adhésion suit → pas de rappel
update public.memberships set starts_on = pg_temp.today_z() - 23, ends_on = pg_temp.today_z() + 7
 where id = pg_temp.mid('o2');
insert into public.memberships (profile_id, source, months, starts_on, ends_on, status, amount)
values (pg_temp.k('ko'), 'one_time', 1, pg_temp.today_z() + 8, pg_temp.today_z() + 38, 'active', 50);
-- t2 : abonnement finissant dans 7 jours → pas de rappel ; o1 : dans 8 jours → pas de rappel
update public.memberships set ends_on = pg_temp.today_z() + 7 where id = pg_temp.mid('t2');
update public.profiles set paid_until = null where id = pg_temp.k('o');
update public.memberships set starts_on = pg_temp.today_z() - 20, ends_on = pg_temp.today_z() + 8
 where id = pg_temp.mid('o1');
-- s : adulte avec login, one_time finissant dans 7 jours (s3 remboursée ignorée)
update public.memberships set status = 'ended' where id in (pg_temp.mid('s1'), pg_temp.mid('s3'));
update public.memberships set starts_on = pg_temp.today_z() - 20, ends_on = pg_temp.today_z() + 7
 where id = pg_temp.mid('s2');
-- mi : finit dans 3 jours (jamais notifié) → rappel ; w : finie hier → aucun
insert into public.memberships (profile_id, source, months, starts_on, ends_on, status, amount)
values (pg_temp.k('mi'), 'one_time', 1, pg_temp.today_z() - 27, pg_temp.today_z() + 3, 'active', 50),
       (pg_temp.k('w'), 'one_time', 1, pg_temp.today_z() - 31, pg_temp.today_z() - 1, 'active', 100);
select pg_temp.as_service();
select public.process_course_schedule();
reset role;
select is((select count(*)::int from public.notification_outbox where kind = 'membership_expiring'), 3,
          'process_course_schedule : trois rappels (enfant via parent, adulte, fin dans 3 jours)');
select is((select payload from public.notification_outbox where kind = 'membership_expiring' and profile_id = pg_temp.k('mi')),
          jsonb_build_object('ends_on', pg_temp.today_z() + 3), 'fin dans 3 jours, jamais notifié : rappel');
select is((select payload from public.notification_outbox where kind = 'membership_expiring' and profile_id = pg_temp.k('pa')),
          jsonb_build_object('child_profile_id', pg_temp.k('ch'), 'ends_on', pg_temp.today_z() + 7),
          'enfant : rappel au parent, avec l''enfant et la date de fin');
select is((select payload from public.notification_outbox where kind = 'membership_expiring' and profile_id = pg_temp.k('s')),
          jsonb_build_object('ends_on', pg_temp.today_z() + 7), 'adulte : rappel à lui-même');
select pg_temp.as_service();
select public.process_course_schedule();
reset role;
select is((select count(*)::int from public.notification_outbox where kind = 'membership_expiring'), 3,
          'deuxième passage : aucune nouvelle ligne');
select is((select count(*)::int from public.claim_outbox(10) where kind = 'membership_expiring'), 3,
          'claim_outbox : rappels réservés (pas expirés)');

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------
select pg_temp.login('9a000000-0000-0000-0000-00000000009a');
select throws_ok(format('select * from public.start_membership_payment(%L, %L, 1, %L)',
                        pg_temp.k('pa'), pg_temp.k('pa'), 'one_time'),
                 '42501', null, 'authenticated : start_membership_payment refusé');
select throws_ok($$ select public.activate_membership('pi_x', null, null) $$, '42501', null,
                 'authenticated : activate_membership refusé');
select throws_ok($$ select public.renew_membership('sub_t', 'in_9', 1, current_date) $$, '42501', null,
                 'authenticated : renew_membership refusé');
select throws_ok($$ select public.set_membership_cancel('sub_t', true) $$, '42501', null,
                 'authenticated : set_membership_cancel refusé');
select throws_ok($$ select public.end_membership('sub_t') $$, '42501', null, 'authenticated : end_membership refusé');
select throws_ok(format('select public.record_customer(%L, %L)', pg_temp.k('pa'), 'cus_y'), '42501', null,
                 'authenticated : record_customer refusé');
select throws_ok($$ select public.settle_payment_intent('pi_x', null) $$, '42501', null,
                 'authenticated : settle_payment_intent refusé');
select throws_ok($$ select public.mark_refunded_by_intent('pi_x') $$, '42501', null,
                 'authenticated : mark_refunded_by_intent refusé');
select throws_ok($$ select public.apply_stripe_event('e', 't', 'end_membership', '{}') $$, '42501', null,
                 'authenticated : apply_stripe_event refusé');
select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'authenticated : stripe_events illisible');
reset role;
set local role anon;
select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'anon : stripe_events illisible');
reset role;
select is((select count(*)::int from information_schema.routine_privileges
            where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
              and routine_name in ('start_membership_payment', 'activate_membership', 'renew_membership',
                                   'set_membership_cancel', 'end_membership', 'record_customer',
                                   'settle_payment_intent', 'mark_refunded_by_intent', 'apply_stripe_event',
                                   'confirm_payment', 'amount_mismatch')), 0,
          'anon / authenticated : aucun droit d''exécution');
select is((select count(*)::int from information_schema.routine_privileges
            where routine_schema = 'public' and grantee = 'anon'), 0,
          'anon : aucun droit d''exécution sur aucune fonction publique');

select * from finish();
rollback;
