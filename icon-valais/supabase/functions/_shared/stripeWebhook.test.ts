import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import {
  fetchInvoicePaymentIntent,
  handleStripeWebhook,
  routeStripeEvent,
  unixToZurichDate,
  verifyStripeSignature,
  type StripeEvent,
  type StripeWebhookDeps,
} from './stripeWebhook.ts';

const SECRET = 'whsec_test_secret';
const NOW = 1_800_000_000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(payload: string, t = NOW, secret = SECRET): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}

// ---------------------------------------------------------------------------
// verifyStripeSignature
// ---------------------------------------------------------------------------
const BODY = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });

Deno.test('verifyStripeSignature: signature valide → vrai', async () => {
  assert(await verifyStripeSignature(BODY, await sign(BODY), SECRET, NOW));
  // horloge décalée dans la tolérance
  assert(await verifyStripeSignature(BODY, await sign(BODY, NOW - 299), SECRET, NOW));
});

Deno.test('verifyStripeSignature: corps modifié → faux', async () => {
  const header = await sign(BODY);
  assertFalse(await verifyStripeSignature(BODY.replace('pi_1', 'pi_2'), header, SECRET, NOW));
  assertFalse(await verifyStripeSignature(BODY + ' ', header, SECRET, NOW));
});

Deno.test('verifyStripeSignature: horodatage vieux de 10 min (ou dans le futur) → faux', async () => {
  assertFalse(await verifyStripeSignature(BODY, await sign(BODY, NOW - 600), SECRET, NOW));
  assertFalse(await verifyStripeSignature(BODY, await sign(BODY, NOW + 600), SECRET, NOW));
  // tolérance explicite
  assert(await verifyStripeSignature(BODY, await sign(BODY, NOW - 600), SECRET, NOW, 900));
});

Deno.test('verifyStripeSignature: secret faux → faux', async () => {
  assertFalse(await verifyStripeSignature(BODY, await sign(BODY, NOW, 'whsec_other'), SECRET, NOW));
  assertFalse(await verifyStripeSignature(BODY, await sign(BODY), '', NOW));
});

Deno.test('verifyStripeSignature: plusieurs v1 (rotation du secret), v0 ignoré, en-tête invalide', async () => {
  const good = await hmacHex(SECRET, `${NOW}.${BODY}`);
  const other = await hmacHex('whsec_old', `${NOW}.${BODY}`);
  assert(await verifyStripeSignature(BODY, `t=${NOW},v1=${other},v1=${good}`, SECRET, NOW));
  assertFalse(await verifyStripeSignature(BODY, `t=${NOW},v0=${good}`, SECRET, NOW));
  for (const h of ['', 'garbage', `v1=${good}`, `t=abc,v1=${good}`, `t=${NOW}`, `t=${NOW},v1=${good.slice(0, 10)}`]) {
    assertFalse(await verifyStripeSignature(BODY, h, SECRET, NOW), h);
  }
});

// ---------------------------------------------------------------------------
// routeStripeEvent
// ---------------------------------------------------------------------------
const ev = (type: string, object: Record<string, unknown>, created?: number): StripeEvent => ({
  id: 'evt_x',
  type,
  created,
  data: { object },
});
const MID = '0b1e3c3a-1d2f-4c55-9a77-0f3c1c2b9a10';
const BID = '7c9a1e52-3b4d-4f6e-8a9b-1c2d3e4f5a6b';
// 26 décembre 2026 10:00 UTC (11:00 à Zurich) ; 31 décembre 2026 23:30 UTC = 1er janvier à Zurich
const END = Date.UTC(2026, 11, 26, 10) / 1000;
const NEW_YEAR = Date.UTC(2026, 11, 31, 23, 30) / 1000;

Deno.test('unixToZurichDate: date locale de Zurich', () => {
  assertEquals(unixToZurichDate(END), '2026-12-26');
  assertEquals(unixToZurichDate(NEW_YEAR), '2027-01-01');
});

Deno.test('routeStripeEvent: payment_intent.succeeded adhésion (metadata.membership_id) → activate_membership', () => {
  assertEquals(
    routeStripeEvent(
      ev('payment_intent.succeeded', {
        id: 'pi_m',
        metadata: { payment_id: 'x', membership_id: MID },
        payment_method_types: ['twint'],
        amount: 10000,
        amount_received: 10000,
        currency: 'chf',
      }),
    ),
    {
      fn: 'activate_membership',
      args: {
        p_payment_intent: 'pi_m',
        p_subscription: null,
        p_period_end: null,
        p_membership: MID,
        p_method: 'twint',
        p_amount_cents: 10000,
        p_currency: 'chf',
      },
    },
  );
});

Deno.test('routeStripeEvent: payment_intent.succeeded cours (metadata.booking_id) → confirm_payment', () => {
  assertEquals(
    routeStripeEvent(
      ev('payment_intent.succeeded', {
        id: 'pi_c',
        metadata: { payment_id: 'x', booking_id: BID },
        payment_method_types: ['card', 'twint'],
        payment_method: { id: 'pm_1', type: 'card' },
        amount: 2000,
        currency: 'chf',
      }),
    ),
    {
      fn: 'confirm_payment',
      args: { p_intent: 'pi_c', p_method: 'card', p_amount_cents: 2000, p_currency: 'chf', p_payment: null },
    },
  );
  // moyen lu dans la charge (anciennes versions de l'API)
  assertEquals(
    routeStripeEvent(
      ev('payment_intent.succeeded', {
        id: 'pi_c',
        metadata: { booking_id: BID },
        payment_method_types: ['card', 'twint'],
        charges: { data: [{ payment_method_details: { type: 'twint' } }] },
      }),
    ),
    {
      fn: 'confirm_payment',
      args: { p_intent: 'pi_c', p_method: 'twint', p_amount_cents: null, p_currency: null, p_payment: null },
    },
  );
  // Checkout : l'intent n'est connu qu'au paiement → paiement retrouvé par metadata.payment_id
  assertEquals(
    routeStripeEvent(
      ev('payment_intent.succeeded', {
        id: 'pi_cs',
        metadata: { payment_id: MID.toUpperCase(), booking_id: BID },
        payment_method: { type: 'twint' },
        amount_received: 2000,
        currency: 'chf',
      }),
    ),
    {
      fn: 'confirm_payment',
      args: { p_intent: 'pi_cs', p_method: 'twint', p_amount_cents: 2000, p_currency: 'chf', p_payment: MID },
    },
  );
});

Deno.test('routeStripeEvent: payment_intent.succeeded sans metadata (ou metadata invalide) → settle_payment_intent', () => {
  const expected = { fn: 'settle_payment_intent', args: { p_intent: 'pi_s', p_method: null, p_amount_cents: null, p_currency: null } };
  assertEquals(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_s', payment_method_types: ['card', 'twint'] })), expected);
  assertEquals(
    routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_s', metadata: { membership_id: 'not-a-uuid' } })),
    expected,
  );
});

Deno.test('routeStripeEvent: payment_intent.payment_failed → fail_payment', () => {
  assertEquals(routeStripeEvent(ev('payment_intent.payment_failed', { id: 'pi_f', metadata: { booking_id: BID } })), {
    fn: 'fail_payment',
    args: { p_intent: 'pi_f' },
  });
});

const invoice = (billing_reason: string, extra: Record<string, unknown> = {}) => ({
  id: 'in_1',
  billing_reason,
  subscription: 'sub_1',
  payment_intent: 'pi_inv',
  amount_paid: 10000,
  currency: 'chf',
  subscription_details: { metadata: { membership_id: MID } },
  lines: { data: [{ period: { start: END - 30 * 86400, end: END } }] },
  ...extra,
});

Deno.test('routeStripeEvent: invoice.paid subscription_create → activate_membership (fin de période)', () => {
  assertEquals(routeStripeEvent(ev('invoice.paid', invoice('subscription_create'))), {
    fn: 'activate_membership',
    args: {
      p_payment_intent: 'pi_inv',
      p_subscription: 'sub_1',
      p_period_end: '2026-12-26',
      p_membership: MID,
      p_method: 'card',
      p_amount_cents: 10000,
      p_currency: 'chf',
    },
  });
});

Deno.test('routeStripeEvent: invoice.paid, format récent de l\'API (parent.subscription_details, sans payment_intent)', () => {
  const obj = invoice('subscription_create', {
    subscription: undefined,
    payment_intent: undefined,
    subscription_details: undefined,
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_2', metadata: { membership_id: MID } } },
  });
  assertEquals(routeStripeEvent(ev('invoice.paid', obj)), {
    fn: 'activate_membership',
    args: {
      p_payment_intent: null,
      p_subscription: 'sub_2',
      p_period_end: '2026-12-26',
      p_membership: MID,
      p_method: 'card',
      p_amount_cents: 10000,
      p_currency: 'chf',
    },
  });
});

Deno.test('routeStripeEvent: invoice.paid subscription_cycle → renew_membership (montant en CHF)', () => {
  assertEquals(routeStripeEvent(ev('invoice.paid', invoice('subscription_cycle', { amount_paid: 12550 }))), {
    fn: 'renew_membership',
    args: {
      p_subscription: 'sub_1',
      p_invoice: 'in_1',
      p_amount: 125.5,
      p_period_end: '2026-12-26',
      p_currency: 'chf',
      p_intent: 'pi_inv',
    },
  });
  // plusieurs lignes : la fin de période la plus tardive
  const lines = { data: [{ period: { end: END - 86400 } }, { period: { end: NEW_YEAR } }] };
  assertEquals(
    (routeStripeEvent(ev('invoice.paid', invoice('subscription_cycle', { lines }))) as { args: Record<string, unknown> }).args
      .p_period_end,
    '2027-01-01',
  );
});

Deno.test('routeStripeEvent: invoice.paid autre motif, ou hors abonnement → ignore', () => {
  assertEquals(routeStripeEvent(ev('invoice.paid', invoice('subscription_update'))), { ignore: true });
  assertEquals(routeStripeEvent(ev('invoice.paid', invoice('manual', { subscription: null }))), { ignore: true });
  assertEquals(routeStripeEvent(ev('invoice.paid', invoice('subscription_cycle', { subscription: null }))), { ignore: true });
});

Deno.test('routeStripeEvent: customer.subscription.updated → set_membership_cancel (avec la date de l\'événement)', () => {
  assertEquals(routeStripeEvent(ev('customer.subscription.updated', { id: 'sub_1', cancel_at_period_end: true }, END)), {
    fn: 'set_membership_cancel',
    args: { p_subscription: 'sub_1', p_cancel_at_period_end: true, p_event_at: '2026-12-26T10:00:00.000Z' },
  });
  assertEquals(routeStripeEvent(ev('customer.subscription.updated', { id: 'sub_1', cancel_at_period_end: false, cancel_at: null })), {
    fn: 'set_membership_cancel',
    args: { p_subscription: 'sub_1', p_cancel_at_period_end: false, p_event_at: null },
  });
  // résiliation programmée par cancel_at (versions récentes de l'API)
  assertEquals(routeStripeEvent(ev('customer.subscription.updated', { id: 'sub_1', cancel_at_period_end: false, cancel_at: END })), {
    fn: 'set_membership_cancel',
    args: { p_subscription: 'sub_1', p_cancel_at_period_end: true, p_event_at: null },
  });
});

Deno.test('routeStripeEvent: customer.subscription.deleted → end_membership', () => {
  assertEquals(routeStripeEvent(ev('customer.subscription.deleted', { id: 'sub_1' })), {
    fn: 'end_membership',
    args: { p_subscription: 'sub_1' },
  });
});

Deno.test('routeStripeEvent: charge.refunded total → mark_refunded_by_intent (intent et facture) ; partiel → ignore', () => {
  assertEquals(routeStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_r', refunded: true })), {
    fn: 'mark_refunded_by_intent',
    args: { p_intent: 'pi_r', p_invoice: null },
  });
  assertEquals(routeStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_r', invoice: 'in_9', refunded: true })), {
    fn: 'mark_refunded_by_intent',
    args: { p_intent: 'pi_r', p_invoice: 'in_9' },
  });
  assertEquals(routeStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: null, invoice: 'in_9', refunded: true })), {
    fn: 'mark_refunded_by_intent',
    args: { p_intent: null, p_invoice: 'in_9' },
  });
  assertEquals(routeStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_r', refunded: false })), { ignore: true });
  assertEquals(routeStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: null, refunded: true })), { ignore: true });
});

Deno.test('routeStripeEvent: refund.failed / charge.refund.updated failed → mark_refund_failed ; autre statut → ignore', () => {
  const PAYID = '11111111-1111-4111-8111-111111111111';
  const refund = { id: 're_1', object: 'refund', payment_intent: 'pi_r', status: 'failed', failure_reason: 'expired_or_canceled_card', metadata: { payment_id: PAYID } };
  const want = { fn: 'mark_refund_failed', args: { p_intent: 'pi_r', p_payment: PAYID, p_reason: 'expired_or_canceled_card' } };
  assertEquals(routeStripeEvent(ev('refund.failed', refund)), want);
  assertEquals(routeStripeEvent(ev('charge.refund.updated', refund)), want);
  assertEquals(routeStripeEvent(ev('refund.updated', refund)), want);
  // remboursement d'un orphelin : pas de payment_id, retrouvé par l'intent
  assertEquals(routeStripeEvent(ev('refund.failed', { id: 're_2', payment_intent: { id: 'pi_o' }, status: 'failed' })), {
    fn: 'mark_refund_failed',
    args: { p_intent: 'pi_o', p_payment: null, p_reason: null },
  });
  assertEquals(routeStripeEvent(ev('charge.refund.updated', { ...refund, status: 'succeeded' })), { ignore: true });
  assertEquals(routeStripeEvent(ev('charge.refund.updated', { ...refund, status: 'pending' })), { ignore: true });
  assertEquals(routeStripeEvent(ev('refund.failed', { id: 're_3', status: 'failed', payment_intent: null })), { ignore: true });
});

Deno.test('routeStripeEvent: type inconnu ou objet sans id → ignore', () => {
  assertEquals(routeStripeEvent(ev('customer.created', { id: 'cus_1' })), { ignore: true });
  assertEquals(routeStripeEvent(ev('payment_intent.succeeded', {})), { ignore: true });
  assertEquals(routeStripeEvent(ev('customer.subscription.deleted', { id: 42 })), { ignore: true });
  assertEquals(routeStripeEvent({ id: 'evt', type: 'payment_intent.succeeded' } as unknown as StripeEvent), { ignore: true });
});

// ---------------------------------------------------------------------------
// handleStripeWebhook (I/O simulées)
// ---------------------------------------------------------------------------
type Calls = { applied: { id: string; type: string; fn: string; args: Record<string, unknown> }[] };

// apply_stripe_event simulée : événement et action dans la même « transaction »
function deps(over: Partial<StripeWebhookDeps> = {}, seen: string[] = []): { deps: StripeWebhookDeps; log: Calls } {
  const log: Calls = { applied: [] };
  const known = new Set(seen);
  return {
    log,
    deps: {
      secret: SECRET,
      nowSec: () => NOW,
      async apply(id, type, fn, args) {
        if (known.has(id)) return 'duplicate';
        known.add(id);
        log.applied.push({ id, type, fn, args });
        return 'confirmed';
      },
      ...over,
    },
  };
}

const SUCCEEDED = JSON.stringify({
  id: 'evt_ok',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_c', metadata: { booking_id: BID }, payment_method_types: ['card'] } },
});

async function post(body: string, header: string | null): Promise<Request> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (header !== null) headers.set('Stripe-Signature', header);
  return new Request('http://localhost/stripe-webhook', { method: 'POST', headers, body });
}

Deno.test('handleStripeWebhook: signature invalide ou absente → 400, rien enregistré', async () => {
  for (const header of [null, 't=1,v1=00', await sign(SUCCEEDED, NOW, 'whsec_other'), await sign(SUCCEEDED, NOW - 600)]) {
    const { deps: d, log } = deps();
    const res = await handleStripeWebhook(await post(SUCCEEDED, header), d);
    assertEquals(res.status, 400, String(header));
    assertEquals(log.applied, []);
  }
});

Deno.test('handleStripeWebhook: action routée appelée, événement enregistré → 200', async () => {
  const { deps: d, log } = deps();
  const res = await handleStripeWebhook(await post(SUCCEEDED, await sign(SUCCEEDED)), d);
  assertEquals(res.status, 200);
  assertEquals(res.body, { received: true, result: 'confirmed' });
  assertEquals(log.applied, [
    {
      id: 'evt_ok',
      type: 'payment_intent.succeeded',
      fn: 'confirm_payment',
      args: { p_intent: 'pi_c', p_method: 'card', p_amount_cents: null, p_currency: null, p_payment: null },
    },
  ]);
});

Deno.test('handleStripeWebhook: événement déjà reçu → 200 sans effet', async () => {
  const { deps: d, log } = deps({}, ['evt_ok']);
  const res = await handleStripeWebhook(await post(SUCCEEDED, await sign(SUCCEEDED)), d);
  assertEquals(res.status, 200);
  assertEquals(res.body, { received: true, duplicate: true });
  assertEquals(log.applied, []);
});

Deno.test('handleStripeWebhook: même événement livré deux fois → une seule action', async () => {
  const { deps: d, log } = deps();
  const header = await sign(SUCCEEDED);
  await handleStripeWebhook(await post(SUCCEEDED, header), d);
  const res = await handleStripeWebhook(await post(SUCCEEDED, header), d);
  assertEquals(res.status, 200);
  assertEquals(res.body, { received: true, duplicate: true });
  assertEquals(log.applied.length, 1);
});

Deno.test('handleStripeWebhook: type ignoré → 200, ni enregistrement ni action', async () => {
  const body = JSON.stringify({ id: 'evt_ign', type: 'customer.created', data: { object: { id: 'cus_1' } } });
  const { deps: d, log } = deps();
  const res = await handleStripeWebhook(await post(body, await sign(body)), d);
  assertEquals(res.status, 200);
  assertEquals(res.body, { received: true, ignored: true });
  assertEquals(log.applied, []);
});

Deno.test('handleStripeWebhook: action en échec → 500 (rien enregistré : Stripe réessaiera, puis appliqué)', async () => {
  let fail = true;
  const { deps: d, log } = deps();
  const apply = d.apply;
  d.apply = (id, type, fn, args) => (fail ? Promise.reject(new Error('confirm_payment: payment not found')) : apply(id, type, fn, args));
  const header = await sign(SUCCEEDED);
  const res = await handleStripeWebhook(await post(SUCCEEDED, header), d);
  assertEquals(res.status, 500);
  assertFalse(JSON.stringify(res.body).includes('payment not found'));
  fail = false;
  const retry = await handleStripeWebhook(await post(SUCCEEDED, header), d);
  assertEquals(retry.status, 200);
  assertEquals(log.applied.length, 1);
});

Deno.test('handleStripeWebhook: secret absent → 500 ; GET → 405 ; JSON invalide signé → 400', async () => {
  const { deps: noSecret } = deps({ secret: undefined });
  assertEquals((await handleStripeWebhook(await post(SUCCEEDED, await sign(SUCCEEDED)), noSecret)).status, 500);
  const { deps: d } = deps();
  assertEquals((await handleStripeWebhook(new Request('http://localhost/stripe-webhook'), d)).status, 405);
  const bad = '{not json';
  assertEquals((await handleStripeWebhook(await post(bad, await sign(bad)), d)).status, 400);
  const noId = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi' } } });
  assertEquals((await handleStripeWebhook(await post(noId, await sign(noId)), d)).status, 400);
});

Deno.test('handleStripeWebhook: ne journalise ni le secret, ni la signature, ni le corps', async () => {
  const lines: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const capture = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  try {
    const body = JSON.stringify({
      id: 'evt_pii',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_c', metadata: { booking_id: BID }, receipt_email: 'someone@example.com' } },
    });
    const header = await sign(body);
    const { deps: ok } = deps();
    await handleStripeWebhook(await post(body, header), ok);
    const { deps: failing } = deps({ apply: () => Promise.reject(new Error('boom')) });
    await handleStripeWebhook(await post(body, header), failing);
    await handleStripeWebhook(await post(body, 't=1,v1=00'), ok);
    const all = lines.join('\n');
    assertFalse(all.includes(SECRET));
    assertFalse(all.includes(header.split('v1=')[1]));
    assertFalse(all.includes('someone@example.com'));
  } finally {
    Object.assign(console, orig);
  }
});

// ---------------------------------------------------------------------------
// invoice.paid sans payment_intent (format récent de l'API) : intent résolu
// auprès de Stripe avant apply_stripe_event
// ---------------------------------------------------------------------------
const NO_INTENT = (reason: string) =>
  JSON.stringify({
    id: `evt_${reason}`,
    type: 'invoice.paid',
    data: { object: invoice(reason, { payment_intent: undefined }) },
  });

Deno.test('handleStripeWebhook: invoice.paid sans intent → résolu (resolveInvoiceIntent) puis appliqué', async () => {
  const asked: string[] = [];
  for (const [reason, key] of [['subscription_create', 'p_payment_intent'], ['subscription_cycle', 'p_intent']]) {
    const { deps: d, log } = deps({
      resolveInvoiceIntent: (inv) => {
        asked.push(inv);
        return Promise.resolve('pi_resolved');
      },
    });
    const body = NO_INTENT(reason);
    const res = await handleStripeWebhook(await post(body, await sign(body)), d);
    assertEquals(res.status, 200);
    assertEquals(log.applied[0].args[key], 'pi_resolved');
  }
  assertEquals(asked, ['in_1', 'in_1']);
});

Deno.test('handleStripeWebhook: intent présent → pas de résolution ; résolution en échec → 500, rien appliqué', async () => {
  let called = 0;
  const { deps: d1 } = deps({ resolveInvoiceIntent: () => (called++, Promise.resolve('x')) });
  const withIntent = JSON.stringify({ id: 'evt_w', type: 'invoice.paid', data: { object: invoice('subscription_create') } });
  assertEquals((await handleStripeWebhook(await post(withIntent, await sign(withIntent)), d1)).status, 200);
  assertEquals(called, 0);
  const { deps: d2, log } = deps({ resolveInvoiceIntent: () => Promise.reject(new Error('stripe down')) });
  const body = NO_INTENT('subscription_create');
  const res = await handleStripeWebhook(await post(body, await sign(body)), d2);
  assertEquals(res.status, 500);
  assertEquals(log.applied, []);
});

function invoiceFetch(routes: Record<string, { status?: number; body: unknown }>, seen: string[]): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    seen.push(`${init?.method} ${u.pathname}${u.search} ${new Headers(init?.headers).get('Stripe-Version')}`);
    const r = routes[`${u.pathname}${u.search}`] ?? { status: 404, body: { error: { code: 'resource_missing', message: 'x' } } };
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status ?? 200 }));
  }) as typeof fetch;
}

Deno.test('fetchInvoicePaymentIntent: GET /v1/invoices/<id> (version épinglée), sinon /v1/invoice_payments', async () => {
  const seen: string[] = [];
  assertEquals(
    await fetchInvoicePaymentIntent('in_1', 'sk', invoiceFetch({ '/v1/invoices/in_1': { body: { id: 'in_1', payment_intent: 'pi_a' } } }, seen)),
    'pi_a',
  );
  assertEquals(seen, ['GET /v1/invoices/in_1 2024-06-20']);
  const seen2: string[] = [];
  assertEquals(
    await fetchInvoicePaymentIntent(
      'in_2',
      'sk',
      invoiceFetch({
        '/v1/invoices/in_2': { body: { id: 'in_2' } },
        '/v1/invoice_payments?invoice=in_2': { body: { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_b' } }] } },
      }, seen2),
    ),
    'pi_b',
  );
  assertEquals(seen2.length, 2);
  // rien trouvé : null (la base refusera, Stripe réessaiera)
  assertEquals(await fetchInvoicePaymentIntent('in_3', 'sk', invoiceFetch({ '/v1/invoices/in_3': { body: { id: 'in_3' } } }, [])), null);
});
