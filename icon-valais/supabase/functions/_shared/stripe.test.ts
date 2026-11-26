import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import { encodeForm, STRIPE_API_VERSION, StripeError, stripeRequest, toCents } from './stripe.ts';

Deno.test('toCents: arrondi au centime, sans erreur de virgule flottante', () => {
  assertEquals(toCents(19.99), 1999);
  assertEquals(toCents(20), 2000);
  assertEquals(toCents(0.1 + 0.2), 30);
  assertEquals(toCents(0), 0);
  assertThrows(() => toCents(-1), RangeError);
  assertThrows(() => toCents(Number.NaN), RangeError);
  assertThrows(() => toCents(Number.POSITIVE_INFINITY), RangeError);
});

Deno.test('encodeForm: notation a[b][0]= de Stripe', () => {
  assertEquals(encodeForm({ metadata: { a: '1' }, items: [{ price: 'p' }] }), 'metadata[a]=1&items[0][price]=p');
  assertEquals(
    encodeForm({ amount: 2000, currency: 'chf', payment_method_types: ['card', 'twint'] }),
    'amount=2000&currency=chf&payment_method_types[0]=card&payment_method_types[1]=twint',
  );
  assertEquals(encodeForm({ a: true, b: false, c: null, d: undefined }), 'a=true&b=false');
  assertEquals(encodeForm({ description: 'Cours JJB & co = 20.00 CHF' }), 'description=Cours%20JJB%20%26%20co%20%3D%2020.00%20CHF');
  assertEquals(encodeForm({ 'metadata[x]': 'y' }), 'metadata[x]=y');
  assertEquals(encodeForm({}), '');
});

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, seen: Captured[]): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
}

Deno.test('stripeRequest: POST form-urlencoded vers api.stripe.com, clé en Bearer, Idempotency-Key', async () => {
  const seen: Captured[] = [];
  const res = await stripeRequest(
    'payment_intents',
    { amount: '2000', 'metadata[payment_id]': 'pay-1' },
    'sk_test_123',
    fakeFetch(200, { id: 'pi_1' }, seen),
    'pay-pay-1',
  );
  assertEquals(res, { id: 'pi_1' });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, 'https://api.stripe.com/v1/payment_intents');
  assertEquals(seen[0].init.method, 'POST');
  const h = new Headers(seen[0].init.headers);
  assertEquals(h.get('Authorization'), 'Bearer sk_test_123');
  assertEquals(h.get('Content-Type'), 'application/x-www-form-urlencoded');
  assertEquals(h.get('Idempotency-Key'), 'pay-pay-1');
  assertEquals(String(seen[0].init.body), 'amount=2000&metadata[payment_id]=pay-1');
});

Deno.test('stripeRequest: chemin avec / initial, sans Idempotency-Key', async () => {
  const seen: Captured[] = [];
  await stripeRequest('/v1/refunds', { payment_intent: 'pi_1' }, 'sk', fakeFetch(200, {}, seen));
  assertEquals(seen[0].url, 'https://api.stripe.com/v1/refunds');
  assertEquals(new Headers(seen[0].init.headers).get('Idempotency-Key'), null);
});

Deno.test('stripeRequest: erreur Stripe → StripeError (statut, code), sans la clé', async () => {
  const seen: Captured[] = [];
  const err = await assertRejects(
    () =>
      stripeRequest(
        'payment_intents',
        {},
        'sk_live_secret',
        fakeFetch(402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } }, seen),
      ),
    StripeError,
  );
  assertEquals(err.status, 402);
  assertEquals(err.code, 'card_declined');
  assertStringIncludes(err.message, '402');
  assertEquals(err.message.includes('sk_live_secret'), false);
});

Deno.test('stripeRequest: réseau en échec ou réponse illisible → StripeError', async () => {
  const down = (() => Promise.reject(new TypeError('network down'))) as typeof fetch;
  const e1 = await assertRejects(() => stripeRequest('customers', {}, 'sk', down), StripeError);
  assertEquals(e1.status, 0);
  const garbage = (() => Promise.resolve(new Response('<html>', { status: 200 }))) as typeof fetch;
  await assertRejects(() => stripeRequest('customers', {}, 'sk', garbage), StripeError);
});

Deno.test('stripeRequest: version de l\'API épinglée (Stripe-Version) sur chaque appel', async () => {
  assertEquals(STRIPE_API_VERSION, '2024-06-20');
  const seen: Captured[] = [];
  await stripeRequest('customers', {}, 'sk', fakeFetch(200, {}, seen));
  assertEquals(new Headers(seen[0].init.headers).get('Stripe-Version'), '2024-06-20');
});

Deno.test('stripeRequest: GET / DELETE — paramètres dans l\'URL, sans corps', async () => {
  const seen: Captured[] = [];
  await stripeRequest('payment_intents/pi_1', { 'expand[0]': 'customer' }, 'sk', fakeFetch(200, {}, seen), undefined, 'GET');
  assertEquals(seen[0].url, 'https://api.stripe.com/v1/payment_intents/pi_1?expand[0]=customer');
  assertEquals(seen[0].init.method, 'GET');
  assertEquals(seen[0].init.body, undefined);
  assertEquals(new Headers(seen[0].init.headers).get('Content-Type'), null);
  await stripeRequest('subscriptions/sub_1', {}, 'sk', fakeFetch(200, {}, seen), 'cancel-1', 'DELETE');
  assertEquals(seen[1].url, 'https://api.stripe.com/v1/subscriptions/sub_1');
  assertEquals(seen[1].init.method, 'DELETE');
  assertEquals(new Headers(seen[1].init.headers).get('Idempotency-Key'), 'cancel-1');
});
