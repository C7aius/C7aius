import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  buildCheckoutParams,
  buildCoursePaymentParams,
  buildSubscriptionParams,
  type CancelSubscriptionDeps,
  type CreatePaymentDeps,
  DbError,
  handleCancelSubscription,
  handleCreatePayment,
  handleProcessRefunds,
  MEMBERSHIP_PRODUCT_ID,
  type ProcessRefundsDeps,
  resolveAppOrigin,
  resultUrls,
} from './payments.ts';

const PAY = '11111111-1111-4111-8111-111111111111';
const BOOK = '22222222-2222-4222-8222-222222222222';
const MEM = '33333333-3333-4333-8333-333333333333';
const ME = '44444444-4444-4444-8444-444444444444';
const KID = '55555555-5555-4555-8555-555555555555';
const SK = 'sk_test_SECRET_never_leak';
const PK = 'pk_test_public';

// ---------------------------------------------------------------------------
// Paramètres Stripe (purs)
// ---------------------------------------------------------------------------
Deno.test('buildCoursePaymentParams: CHF en centimes, carte + TWINT, metadata payment_id / booking_id', () => {
  const p = buildCoursePaymentParams({ payment_id: PAY, amount: 20, description: 'Cours JJB du 03.12.2026 18:30', booking_id: BOOK }, 'cus_1');
  assertEquals(p.amount, '2000');
  assertEquals(p.currency, 'chf');
  assertEquals(p['payment_method_types[0]'], 'card');
  assertEquals(p['payment_method_types[1]'], 'twint');
  assertEquals(p['metadata[payment_id]'], PAY);
  assertEquals(p['metadata[booking_id]'], BOOK);
  assertEquals(p['metadata[membership_id]'], undefined);
  assertEquals(p.customer, 'cus_1');
  assertEquals(p.description, 'Cours JJB du 03.12.2026 18:30');
  // adhésion TWINT (paiement unique) : metadata membership_id
  const m = buildCoursePaymentParams({ payment_id: PAY, amount: 19.99, description: 'Adhésion 1 mois', membership_id: MEM }, 'cus_1');
  assertEquals(m.amount, '1999');
  assertEquals(m['metadata[membership_id]'], MEM);
  assertEquals(m['metadata[booking_id]'], undefined);
});

Deno.test('buildSubscriptionParams: prix récurrent mensuel (interval_count = months), default_incomplete, metadata', () => {
  const p = buildSubscriptionParams(
    { payment_id: PAY, membership_id: MEM, amount: 250, months: 3, description: 'Adhésion 3 mois (abonnement)', product_id: 'prod_x' },
    'cus_1',
  );
  assertEquals(p.customer, 'cus_1');
  assertEquals(p['items[0][price_data][currency]'], 'chf');
  assertEquals(p['items[0][price_data][unit_amount]'], '25000');
  assertEquals(p['items[0][price_data][recurring][interval]'], 'month');
  assertEquals(p['items[0][price_data][recurring][interval_count]'], '3');
  assertEquals(p['items[0][price_data][product]'], 'prod_x');
  assertEquals(p.payment_behavior, 'default_incomplete');
  assertEquals(p['payment_settings[save_default_payment_method]'], 'on_subscription');
  assertEquals(p['expand[0]'], 'latest_invoice.payment_intent');
  assertEquals(p['metadata[membership_id]'], MEM);
  assertEquals(p['metadata[payment_id]'], PAY);
});

Deno.test('buildCheckoutParams: paiement (carte + TWINT) et abonnement, URLs de retour, metadata', () => {
  const urls = resultUrls('https://app.icon-valais.ch', PAY);
  assertEquals(urls.success, `https://app.icon-valais.ch/payment-result?status=success&payment=${PAY}`);
  assertEquals(urls.cancel, `https://app.icon-valais.ch/payment-result?status=cancel&payment=${PAY}`);

  const c = buildCheckoutParams({ payment_id: PAY, amount: 20, description: 'Cours', booking_id: BOOK, customer_id: 'cus_1' }, urls.success, urls.cancel);
  assertEquals(c.mode, 'payment');
  assertEquals(c.success_url, urls.success);
  assertEquals(c.cancel_url, urls.cancel);
  assertEquals(c['line_items[0][price_data][currency]'], 'chf');
  assertEquals(c['line_items[0][price_data][unit_amount]'], '2000');
  assertEquals(c['line_items[0][price_data][product_data][name]'], 'Cours');
  assertEquals(c['line_items[0][quantity]'], '1');
  assertEquals(c['payment_method_types[0]'], 'card');
  assertEquals(c['payment_method_types[1]'], 'twint');
  assertEquals(c['payment_intent_data[metadata][payment_id]'], PAY);
  assertEquals(c['payment_intent_data[metadata][booking_id]'], BOOK);
  assertEquals(c['metadata[payment_id]'], PAY);
  assertEquals(c.client_reference_id, PAY);
  assertEquals(c.customer, 'cus_1');

  const s = buildCheckoutParams(
    { payment_id: PAY, amount: 100, description: 'Adhésion 1 mois (abonnement)', membership_id: MEM, months: 1, subscription: true, customer_id: 'cus_1' },
    urls.success,
    urls.cancel,
  );
  assertEquals(s.mode, 'subscription');
  assertEquals(s['line_items[0][price_data][recurring][interval]'], 'month');
  assertEquals(s['line_items[0][price_data][recurring][interval_count]'], '1');
  assertEquals(s['line_items[0][price_data][unit_amount]'], '10000');
  assertEquals(s['payment_method_types[0]'], 'card');
  assertEquals(s['payment_method_types[1]'], undefined);
  assertEquals(s['subscription_data[metadata][membership_id]'], MEM);
  assertEquals(s['subscription_data[metadata][payment_id]'], PAY);
  assertEquals(s['payment_intent_data[metadata][payment_id]'], undefined);
});

Deno.test('resolveAppOrigin: PUBLIC_APP_URL, sinon en-tête Origin ; http(s) seulement', () => {
  assertEquals(resolveAppOrigin('https://app.icon-valais.ch/', 'https://evil.example'), 'https://app.icon-valais.ch');
  assertEquals(resolveAppOrigin(undefined, 'http://localhost:8081'), 'http://localhost:8081');
  assertEquals(resolveAppOrigin('', 'https://web.example/path'), 'https://web.example');
  assertEquals(resolveAppOrigin(undefined, null), null);
  assertEquals(resolveAppOrigin(undefined, 'javascript:alert(1)'), null);
  assertEquals(resolveAppOrigin('not a url', null), null);
});

// ---------------------------------------------------------------------------
// Faux Stripe : réponses par « MÉTHODE chemin », appels enregistrés
// ---------------------------------------------------------------------------
type Call = { method: string; path: string; params: URLSearchParams; idem: string | null; auth: string | null; version: string | null };
type Reply = { status?: number; body: unknown };

function fakeStripe(routes: Record<string, Reply | ((c: Call) => Reply)>) {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/v1\//, '');
    const h = new Headers(init?.headers);
    const params = method === 'POST' ? new URLSearchParams(String(init?.body ?? '')) : url.searchParams;
    const call = { method, path, params, idem: h.get('Idempotency-Key'), auth: h.get('Authorization'), version: h.get('Stripe-Version') };
    calls.push(call);
    const r = routes[`${method} ${path}`];
    const reply = typeof r === 'function' ? r(call) : r ?? { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: `no route ${method} ${path}` } } };
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

type Log = { attach: [string, string][]; recorded: [string, string][]; course: [string, string][]; membership: unknown[][] };

function createDeps(over: Partial<CreatePaymentDeps>, fetchFn: typeof fetch, log: Log): CreatePaymentDeps {
  return {
    secretKey: SK,
    publishableKey: PK,
    publicAppUrl: 'https://app.icon-valais.ch',
    fetch: fetchFn,
    authenticate: () => Promise.resolve('auth-user-1'),
    payer: () => Promise.resolve({ id: ME, stripe_customer_id: null, email: 'me@t.ch', name: 'Me Myself' }),
    startCoursePayment: (bookingId, payerId) => {
      log.course.push([bookingId, payerId]);
      return Promise.resolve({ payment_id: PAY, amount: 20, description: 'Cours JJB du 03.12.2026 18:30', stripe_payment_intent_id: null });
    },
    startMembershipPayment: (...args) => {
      log.membership.push(args);
      return Promise.resolve({ membership_id: MEM, payment_id: PAY, amount: 100, description: 'Adhésion 1 mois' });
    },
    attachIntent: (paymentId, intent) => {
      log.attach.push([paymentId, intent]);
      return Promise.resolve(intent);
    },
    recordCustomer: (profileId, customer) => {
      log.recorded.push([profileId, customer]);
      return Promise.resolve(customer);
    },
    ...over,
  };
}

const newLog = (): Log => ({ attach: [], recorded: [], course: [], membership: [] });

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/create-payment', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const PI_ROUTES = {
  'POST customers': { body: { id: 'cus_new' } },
  'POST payment_intents': { body: { id: 'pi_new', client_secret: 'pi_new_secret_x', customer: 'cus_new', status: 'requires_payment_method' } },
  'POST ephemeral_keys': { body: { id: 'ephkey_1', secret: 'ek_test_1' } },
};

// ---------------------------------------------------------------------------
// create-payment
// ---------------------------------------------------------------------------
Deno.test('create-payment: sans jeton → 401 ; méthode → 405 ; corps invalide → 400', async () => {
  const { fetchFn, calls } = fakeStripe({});
  const log = newLog();
  assertEquals((await handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'native' }), createDeps({ authenticate: () => Promise.resolve(null) }, fetchFn, log))).status, 401);
  assertEquals((await handleCreatePayment(new Request('http://localhost/x', { method: 'GET' }), createDeps({}, fetchFn, log))).status, 405);
  for (const bad of ['{', { kind: 'course', bookingId: 'nope', platform: 'native' }, { kind: 'course', bookingId: BOOK, platform: 'ios' },
    { kind: 'membership', profileId: KID, months: 2, method: 'card', platform: 'web' }, { kind: 'membership', profileId: KID, months: 1, method: 'cash', platform: 'web' },
    { kind: 'gift' }]) {
    assertEquals((await handleCreatePayment(req(bad), createDeps({}, fetchFn, log))).status, 400, JSON.stringify(bad));
  }
  assertEquals(calls.length, 0);
});

Deno.test('create-payment: réservation de quelqu\'un d\'autre → 403, aucun appel Stripe', async () => {
  const { fetchFn, calls } = fakeStripe(PI_ROUTES);
  const res = await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({ startCoursePayment: () => Promise.reject(new DbError('42501', null, 'payer cannot pay')) }, fetchFn, newLog()),
  );
  assertEquals(res.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test('create-payment: erreurs de la base → 404 / 409 (hint) / 500', async () => {
  const { fetchFn } = fakeStripe(PI_ROUTES);
  const run = (e: unknown) =>
    handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'native' }), createDeps({ startCoursePayment: () => Promise.reject(e) }, fetchFn, newLog()));
  assertEquals((await run(new DbError('P0002', null, 'x'))).status, 404);
  const closed = await run(new DbError('22023', 'course_closed', 'x'));
  assertEquals(closed.status, 409);
  assertEquals(closed.body.error, 'course_closed');
  const covered = await handleCreatePayment(
    req({ kind: 'membership', profileId: KID, months: 1, method: 'card', platform: 'native' }),
    createDeps({ startMembershipPayment: () => Promise.reject(new DbError('22023', 'already_covered', 'x')) }, fetchFn, newLog()),
  );
  assertEquals(covered.status, 409);
  assertEquals(covered.body.error, 'already_covered');
  assertEquals((await run(new Error('boom'))).status, 500);
});

Deno.test('create-payment: cours natif — montant lu en base (pas dans le corps), client créé puis enregistré', async () => {
  const { fetchFn, calls } = fakeStripe(PI_ROUTES);
  const log = newLog();
  const res = await handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'native', amount: 1, price: 0.01 }), createDeps({}, fetchFn, log));
  assertEquals(res.status, 200);
  assertEquals(res.body, {
    paymentIntentClientSecret: 'pi_new_secret_x',
    customerId: 'cus_new',
    ephemeralKeySecret: 'ek_test_1',
    publishableKey: PK,
    amount: 20,
  });
  assertEquals(log.course, [[BOOK, ME]]);
  const cus = calls.find((c) => c.path === 'customers')!;
  assertEquals(cus.idem, `customer-${ME}`);
  assertEquals(cus.params.get('metadata[profile_id]'), ME);
  assertEquals(log.recorded, [[ME, 'cus_new']]);
  const pi = calls.find((c) => c.path === 'payment_intents')!;
  assertEquals(pi.params.get('amount'), '2000');
  assertEquals(pi.params.get('customer'), 'cus_new');
  assertEquals(pi.params.get('metadata[payment_id]'), PAY);
  assertEquals(pi.idem, `pi-${PAY}`);
  assertEquals(log.attach, [[PAY, 'pi_new']]);
  const ek = calls.find((c) => c.path === 'ephemeral_keys')!;
  assertEquals(ek.params.get('customer'), 'cus_new');
  for (const c of calls) {
    assertEquals(c.auth, `Bearer ${SK}`);
    assertEquals(c.version, '2024-06-20');
  }
  assert(!JSON.stringify(res.body).includes(SK));
});

Deno.test('create-payment: client Stripe déjà enregistré → réutilisé, pas de création', async () => {
  const { fetchFn, calls } = fakeStripe(PI_ROUTES);
  const log = newLog();
  const res = await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({ payer: () => Promise.resolve({ id: ME, stripe_customer_id: 'cus_old', email: null, name: 'Me' }) }, fetchFn, log),
  );
  assertEquals(res.status, 200);
  assertEquals(calls.filter((c) => c.path === 'customers').length, 0);
  assertEquals(log.recorded, []);
  assertEquals(calls.find((c) => c.path === 'payment_intents')!.params.get('customer'), 'cus_old');
});

Deno.test('create-payment: record_customer renvoie un autre client (course) → celui-là est utilisé', async () => {
  const { fetchFn, calls } = fakeStripe(PI_ROUTES);
  await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({ recordCustomer: () => Promise.resolve('cus_winner') }, fetchFn, newLog()),
  );
  assertEquals(calls.find((c) => c.path === 'payment_intents')!.params.get('customer'), 'cus_winner');
});

Deno.test('create-payment: un intent déjà lié est réutilisé (aucune création)', async () => {
  const { fetchFn, calls } = fakeStripe({
    ...PI_ROUTES,
    'GET payment_intents/pi_old': { body: { id: 'pi_old', client_secret: 'pi_old_secret', customer: 'cus_old', status: 'requires_payment_method' } },
  });
  const log = newLog();
  const res = await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({
      payer: () => Promise.resolve({ id: ME, stripe_customer_id: 'cus_old', email: null, name: 'Me' }),
      startCoursePayment: () => Promise.resolve({ payment_id: PAY, amount: 20, description: 'Cours', stripe_payment_intent_id: 'pi_old' }),
    }, fetchFn, log),
  );
  assertEquals(res.status, 200);
  assertEquals(res.body.paymentIntentClientSecret, 'pi_old_secret');
  assertEquals(calls.filter((c) => c.method === 'POST' && c.path === 'payment_intents').length, 0);
  assertEquals(log.attach, []);
});

Deno.test('create-payment: attach renvoie un autre intent → le nouvel intent est annulé, l\'existant réutilisé', async () => {
  const { fetchFn, calls } = fakeStripe({
    ...PI_ROUTES,
    'POST payment_intents/pi_new/cancel': { body: { id: 'pi_new', status: 'canceled' } },
    'GET payment_intents/pi_race': { body: { id: 'pi_race', client_secret: 'pi_race_secret', customer: 'cus_new', status: 'requires_payment_method' } },
  });
  const res = await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({ attachIntent: () => Promise.resolve('pi_race') }, fetchFn, newLog()),
  );
  assertEquals(res.status, 200);
  assertEquals(res.body.paymentIntentClientSecret, 'pi_race_secret');
  const cancel = calls.find((c) => c.path === 'payment_intents/pi_new/cancel')!;
  assertEquals(cancel.method, 'POST');
  assertEquals(cancel.idem, 'cancel-pi_new');
});

Deno.test('create-payment: intent existant d\'un autre client → pas de clé éphémère pour ce client', async () => {
  const { fetchFn, calls } = fakeStripe({
    ...PI_ROUTES,
    'GET payment_intents/pi_old': { body: { id: 'pi_old', client_secret: 'pi_old_secret', customer: 'cus_parent', status: 'requires_payment_method' } },
  });
  const res = await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({
      payer: () => Promise.resolve({ id: ME, stripe_customer_id: 'cus_me', email: null, name: 'Me' }),
      startCoursePayment: () => Promise.resolve({ payment_id: PAY, amount: 20, description: 'Cours', stripe_payment_intent_id: 'pi_old' }),
    }, fetchFn, newLog()),
  );
  assertEquals(res.status, 200);
  assertEquals(res.body.customerId, null);
  assertEquals(res.body.ephemeralKeySecret, null);
  assertEquals(calls.filter((c) => c.path === 'ephemeral_keys').length, 0);
});

Deno.test('create-payment: intent existant déjà payé → 409 already_paid', async () => {
  const { fetchFn } = fakeStripe({
    ...PI_ROUTES,
    'GET payment_intents/pi_old': { body: { id: 'pi_old', client_secret: 's', customer: 'cus_old', status: 'succeeded' } },
  });
  const res = await handleCreatePayment(
    req({ kind: 'course', bookingId: BOOK, platform: 'native' }),
    createDeps({
      payer: () => Promise.resolve({ id: ME, stripe_customer_id: 'cus_old', email: null, name: 'Me' }),
      startCoursePayment: () => Promise.resolve({ payment_id: PAY, amount: 20, description: 'Cours', stripe_payment_intent_id: 'pi_old' }),
    }, fetchFn, newLog()),
  );
  assertEquals(res.status, 409);
  assertEquals(res.body.error, 'already_paid');
});

Deno.test('create-payment: Stripe en erreur → 502 sans fuite de clé ni du message Stripe', async () => {
  const { fetchFn } = fakeStripe({
    ...PI_ROUTES,
    'POST payment_intents': { status: 401, body: { error: { type: 'invalid_request_error', message: `Invalid API Key provided: ${SK}` } } },
  });
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '));
  try {
    const res = await handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'native' }), createDeps({}, fetchFn, newLog()));
    assertEquals(res.status, 502);
    assertEquals(res.body, { error: 'payment_provider_error' });
  } finally {
    console.error = orig;
  }
  assert(errors.length > 0);
  for (const e of errors) assertEquals(e.includes(SK), false);
});

Deno.test('create-payment: clé secrète absente → 500 not configured, aucun appel', async () => {
  const { fetchFn, calls } = fakeStripe(PI_ROUTES);
  const res = await handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'native' }), createDeps({ secretKey: undefined }, fetchFn, newLog()));
  assertEquals(res.status, 500);
  assertEquals(calls.length, 0);
});

Deno.test('create-payment: adhésion TWINT native → PaymentIntent (metadata membership_id), source one_time', async () => {
  const { fetchFn, calls } = fakeStripe(PI_ROUTES);
  const log = newLog();
  const res = await handleCreatePayment(req({ kind: 'membership', profileId: KID, months: 1, method: 'twint', platform: 'native', amount: 1 }), createDeps({}, fetchFn, log));
  assertEquals(res.status, 200);
  assertEquals(res.body.amount, 100);
  assertEquals(log.membership, [[KID, ME, 1, 'one_time']]);
  const pi = calls.find((c) => c.path === 'payment_intents')!;
  assertEquals(pi.params.get('amount'), '10000');
  assertEquals(pi.params.get('metadata[membership_id]'), MEM);
  assertEquals(pi.params.get('metadata[payment_id]'), PAY);
  assertEquals(pi.params.get('payment_method_types[1]'), 'twint');
  assertEquals(log.attach, [[PAY, 'pi_new']]);
});

Deno.test('create-payment: adhésion carte native → produit, abonnement default_incomplete, secret de la première facture', async () => {
  const { fetchFn, calls } = fakeStripe({
    ...PI_ROUTES,
    'POST products': { status: 400, body: { error: { type: 'invalid_request_error', code: 'resource_already_exists', message: 'exists' } } },
    'POST subscriptions': {
      body: { id: 'sub_1', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_inv', client_secret: 'pi_inv_secret' } } },
    },
  });
  const log = newLog();
  const res = await handleCreatePayment(req({ kind: 'membership', profileId: KID, months: 3, method: 'card', platform: 'native' }), createDeps({
    startMembershipPayment: (...args) => {
      log.membership.push(args);
      return Promise.resolve({ membership_id: MEM, payment_id: PAY, amount: 250, description: 'Adhésion 3 mois (abonnement)' });
    },
  }, fetchFn, log));
  assertEquals(res.status, 200);
  assertEquals(res.body, { paymentIntentClientSecret: 'pi_inv_secret', customerId: 'cus_new', ephemeralKeySecret: 'ek_test_1', publishableKey: PK, amount: 250 });
  assertEquals(log.membership, [[KID, ME, 3, 'stripe_subscription']]);
  assertEquals(calls.find((c) => c.path === 'products')!.params.get('id'), MEMBERSHIP_PRODUCT_ID);
  const sub = calls.find((c) => c.path === 'subscriptions')!;
  assertEquals(sub.idem, `sub-${PAY}`);
  assertEquals(sub.params.get('items[0][price_data][unit_amount]'), '25000');
  assertEquals(sub.params.get('items[0][price_data][recurring][interval_count]'), '3');
  assertEquals(sub.params.get('items[0][price_data][product]'), MEMBERSHIP_PRODUCT_ID);
  assertEquals(sub.params.get('metadata[membership_id]'), MEM);
  assertEquals(calls.filter((c) => c.method === 'POST' && c.path === 'payment_intents').length, 0);
  // l'intent de la première facture est lié au paiement (remboursements)
  assertEquals(log.attach, [[PAY, 'pi_inv']]);
});

Deno.test('create-payment: web → URL Stripe Checkout, retours <origin>/payment-result', async () => {
  const { fetchFn, calls } = fakeStripe({ ...PI_ROUTES, 'POST checkout/sessions': { body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } } });
  const res = await handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'web' }), createDeps({ publicAppUrl: undefined }, fetchFn, newLog()));
  // ni PUBLIC_APP_URL ni Origin → 400
  assertEquals(res.status, 400);
  const ok = await handleCreatePayment(req({ kind: 'course', bookingId: BOOK, platform: 'web' }, { Origin: 'http://localhost:8081' }), createDeps({ publicAppUrl: undefined }, fetchFn, newLog()));
  assertEquals(ok.status, 200);
  assertEquals(ok.body, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1' });
  const cs = calls.find((c) => c.path === 'checkout/sessions')!;
  assertEquals(cs.params.get('success_url'), `http://localhost:8081/payment-result?status=success&payment=${PAY}`);
  assertEquals(cs.params.get('cancel_url'), `http://localhost:8081/payment-result?status=cancel&payment=${PAY}`);
  assertEquals(cs.params.get('line_items[0][price_data][unit_amount]'), '2000');
  assertEquals(cs.params.get('payment_intent_data[metadata][booking_id]'), BOOK);
  assertEquals(cs.idem, `checkout-${PAY}`);
  assertEquals(calls.filter((c) => c.path === 'payment_intents').length, 0);
});

Deno.test('create-payment: web abonnement → Checkout mode subscription (PUBLIC_APP_URL prioritaire)', async () => {
  const { fetchFn, calls } = fakeStripe({ ...PI_ROUTES, 'POST checkout/sessions': { body: { id: 'cs_2', url: 'https://checkout.stripe.com/c/pay/cs_2' } } });
  const res = await handleCreatePayment(
    req({ kind: 'membership', profileId: KID, months: 1, method: 'card', platform: 'web' }, { Origin: 'https://evil.example' }),
    createDeps({}, fetchFn, newLog()),
  );
  assertEquals(res.status, 200);
  const cs = calls.find((c) => c.path === 'checkout/sessions')!;
  assertEquals(cs.params.get('mode'), 'subscription');
  assertEquals(cs.params.get('subscription_data[metadata][membership_id]'), MEM);
  assertStringIncludes(cs.params.get('success_url')!, 'https://app.icon-valais.ch/payment-result?status=success');
});

// ---------------------------------------------------------------------------
// cancel-subscription
// ---------------------------------------------------------------------------
function cancelDeps(over: Partial<CancelSubscriptionDeps>, fetchFn: typeof fetch, set: unknown[][]): CancelSubscriptionDeps {
  return {
    secretKey: SK,
    fetch: fetchFn,
    authenticate: () => Promise.resolve('auth-user-1'),
    profileId: () => Promise.resolve(ME),
    loadMembership: () =>
      Promise.resolve({ id: MEM, profile_id: KID, paid_by: ME, source: 'stripe_subscription', status: 'active', stripe_subscription_id: 'sub_1', ends_on: '2027-01-31' }),
    setCancel: (sub, flag) => {
      set.push([sub, flag]);
      return Promise.resolve();
    },
    ...over,
  };
}

function cancelReq(body: unknown): Request {
  return new Request('http://localhost/cancel-subscription', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(body) });
}

Deno.test('cancel-subscription: payeur → Stripe cancel_at_period_end=true puis set_membership_cancel', async () => {
  const { fetchFn, calls } = fakeStripe({ 'POST subscriptions/sub_1': { body: { id: 'sub_1', cancel_at_period_end: true } } });
  const set: unknown[][] = [];
  const res = await handleCancelSubscription(cancelReq({ membershipId: MEM }), cancelDeps({}, fetchFn, set));
  assertEquals(res.status, 200);
  assertEquals(res.body, { ok: true, endsOn: '2027-01-31' });
  assertEquals(calls[0].params.get('cancel_at_period_end'), 'true');
  assertEquals(calls[0].idem, `cancel-sub-${MEM}`);
  assertEquals(set, [['sub_1', true]]);
});

Deno.test('cancel-subscription: bénéficiaire autorisé ; autre profil → 403 sans appel Stripe', async () => {
  const { fetchFn, calls } = fakeStripe({ 'POST subscriptions/sub_1': { body: { id: 'sub_1' } } });
  const ben = await handleCancelSubscription(cancelReq({ membershipId: MEM }), cancelDeps({ profileId: () => Promise.resolve(KID) }, fetchFn, []));
  assertEquals(ben.status, 200);
  const before = calls.length;
  const other = await handleCancelSubscription(
    cancelReq({ membershipId: MEM }),
    cancelDeps({ profileId: () => Promise.resolve('66666666-6666-4666-8666-666666666666') }, fetchFn, []),
  );
  assertEquals(other.status, 403);
  assertEquals(calls.length, before);
});

Deno.test('cancel-subscription: inconnue → 404 ; pas un abonnement / pas active → 409 ; déjà résiliée → 200', async () => {
  const { fetchFn, calls } = fakeStripe({});
  const base = { id: MEM, profile_id: KID, paid_by: ME, source: 'stripe_subscription', status: 'active', stripe_subscription_id: 'sub_1', ends_on: '2027-01-31' };
  const run = (m: unknown) => handleCancelSubscription(cancelReq({ membershipId: MEM }), cancelDeps({ loadMembership: () => Promise.resolve(m as never) }, fetchFn, []));
  assertEquals((await run(null)).status, 404);
  assertEquals((await run({ ...base, source: 'one_time', stripe_subscription_id: null })).status, 409);
  assertEquals((await run({ ...base, status: 'ended' })).status, 409);
  const already = await run({ ...base, status: 'cancelled' });
  assertEquals(already.status, 200);
  assertEquals(calls.length, 0);
  assertEquals((await handleCancelSubscription(cancelReq({ membershipId: 'x' }), cancelDeps({}, fetchFn, []))).status, 400);
  assertEquals((await handleCancelSubscription(cancelReq({ membershipId: MEM }), cancelDeps({ authenticate: () => Promise.resolve(null) }, fetchFn, []))).status, 401);
});

Deno.test('cancel-subscription: Stripe en erreur → 502, rien en base', async () => {
  const { fetchFn } = fakeStripe({ 'POST subscriptions/sub_1': { status: 500, body: { error: { type: 'api_error', message: 'boom' } } } });
  const set: unknown[][] = [];
  const res = await handleCancelSubscription(cancelReq({ membershipId: MEM }), cancelDeps({}, fetchFn, set));
  assertEquals(res.status, 502);
  assertEquals(set, []);
});

// ---------------------------------------------------------------------------
// process-refunds
// ---------------------------------------------------------------------------
type RefundLog = { refunded: string[]; cancelled: string[] };

function refundDeps(over: Partial<ProcessRefundsDeps>, fetchFn: typeof fetch, log: RefundLog): ProcessRefundsDeps {
  return {
    serviceKey: 'service-key',
    secretKey: SK,
    fetch: fetchFn,
    refundsToProcess: () => Promise.resolve([{ id: 'p1', stripe_payment_intent_id: 'pi_1' }, { id: 'p2', stripe_payment_intent_id: 'pi_2' }]),
    markRefunded: (id) => {
      log.refunded.push(id);
      return Promise.resolve();
    },
    subscriptionsToCancel: () => Promise.resolve([]),
    markSubscriptionCancelled: (id) => {
      log.cancelled.push(id);
      return Promise.resolve();
    },
    ...over,
  };
}

const svcReq = (key = 'service-key') => new Request('http://localhost/process-refunds', { method: 'POST', headers: { Authorization: `Bearer ${key}` } });

Deno.test('process-refunds: service role seulement', async () => {
  const { fetchFn, calls } = fakeStripe({});
  const log = { refunded: [], cancelled: [] };
  assertEquals((await handleProcessRefunds(svcReq('user-jwt'), refundDeps({}, fetchFn, log))).status, 401);
  assertEquals((await handleProcessRefunds(new Request('http://localhost/x'), refundDeps({}, fetchFn, log))).status, 405);
  assertEquals(calls.length, 0);
});

Deno.test('process-refunds: POST /v1/refunds (Idempotency-Key refund-<id>) → mark_refunded ; erreur Stripe → ligne laissée', async () => {
  const { fetchFn, calls } = fakeStripe({
    'POST refunds': (c) =>
      c.params.get('payment_intent') === 'pi_2'
        ? { status: 500, body: { error: { type: 'api_error', message: 'try later' } } }
        : { body: { id: 're_1', status: 'succeeded' } },
  });
  const log: RefundLog = { refunded: [], cancelled: [] };
  const res = await handleProcessRefunds(svcReq(), refundDeps({}, fetchFn, log));
  assertEquals(res.status, 200);
  assertEquals(res.body, { refunded: 1, cancelled: 0, failed: 1 });
  assertEquals(calls.map((c) => [c.path, c.params.get('payment_intent'), c.idem]), [['refunds', 'pi_1', 'refund-p1'], ['refunds', 'pi_2', 'refund-p2']]);
  assertEquals(log.refunded, ['p1']);
});

Deno.test('process-refunds: déjà remboursé chez Stripe (charge_already_refunded) → marqué remboursé', async () => {
  const { fetchFn } = fakeStripe({ 'POST refunds': { status: 400, body: { error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'x' } } } });
  const log: RefundLog = { refunded: [], cancelled: [] };
  await handleProcessRefunds(svcReq(), refundDeps({}, fetchFn, log));
  assertEquals(log.refunded, ['p1', 'p2']);
});

Deno.test('process-refunds: abonnement au mauvais montant annulé immédiatement (DELETE), avant les remboursements', async () => {
  const { fetchFn, calls } = fakeStripe({
    'DELETE subscriptions/sub_bad': { body: { id: 'sub_bad', status: 'canceled' } },
    'DELETE subscriptions/sub_gone': { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such subscription' } } },
    'DELETE subscriptions/sub_err': { status: 500, body: { error: { type: 'api_error', message: 'boom' } } },
    'POST refunds': { body: { id: 're_1' } },
  });
  const log: RefundLog = { refunded: [], cancelled: [] };
  const res = await handleProcessRefunds(
    svcReq(),
    refundDeps({
      refundsToProcess: () => Promise.resolve([{ id: 'p9', stripe_payment_intent_id: 'pi_9' }]),
      subscriptionsToCancel: () =>
        Promise.resolve([
          { membership_id: 'm1', stripe_subscription_id: 'sub_bad' },
          { membership_id: 'm2', stripe_subscription_id: 'sub_gone' },
          { membership_id: 'm3', stripe_subscription_id: 'sub_err' },
        ]),
    }, fetchFn, log),
  );
  assertEquals(res.body, { refunded: 1, cancelled: 2, failed: 1 });
  assertEquals(log.cancelled, ['m1', 'm2']);
  assertEquals(calls[0].method, 'DELETE');
  assertEquals(calls[0].idem, 'cancel-now-m1');
  assertEquals(calls[calls.length - 1].path, 'refunds');
});
