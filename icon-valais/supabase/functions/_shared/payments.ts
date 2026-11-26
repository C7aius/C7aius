// Paiements Stripe : paramètres des appels (purs), et traitement des requêtes
// create-payment, cancel-subscription et process-refunds avec I/O injectées.
// Testé avec Deno (payments.test.ts).
//
// Règles :
//  * le montant vient toujours de la base (start_course_payment /
//    start_membership_payment), jamais du corps de la requête ;
//  * le droit de payer (ou de résilier) est vérifié en base / ici AVANT tout
//    appel Stripe ;
//  * chaque écriture Stripe porte une Idempotency-Key (sauf la clé éphémère,
//    sans effet de bord, qui doit rester fraîche) ;
//  * la clé secrète n'est jamais journalisée ni renvoyée (seule la clé
//    publiable l'est) ; les erreurs Stripe ne sont journalisées que par
//    statut / type / code.
//
// Metadata (le webhook en dépend, voir stripeWebhook.ts) :
//  * PaymentIntent : payment_id + booking_id (cours) ou membership_id
//    (adhésion payée en une fois) ;
//  * Subscription : membership_id + payment_id ;
//  * Checkout : payment_intent_data[metadata] / subscription_data[metadata]
//    identiques, plus metadata et client_reference_id = payment_id.
import { isServiceRoleRequest } from './push.ts';
import { StripeError, type StripeMethod, stripeRequest, toCents } from './stripe.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Produit Stripe unique des adhésions (id fixe : créé au premier abonnement).
export const MEMBERSHIP_PRODUCT_ID = 'icon_valais_membership';
const MEMBERSHIP_PRODUCT_NAME = 'Adhésion Icon Valais Conthey';

// Affiché sous le bouton de paiement Stripe Checkout d'un cours.
export const COURSE_REFUND_NOTICE = 'Remboursé uniquement si le cours est annulé par le professeur.';

export type Result = { status: number; body: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Paramètres Stripe (purs)
// ---------------------------------------------------------------------------
export type PaymentRow = {
  payment_id: string;
  amount: number; // CHF, lu en base
  description: string;
  booking_id?: string | null;
  membership_id?: string | null;
};

export type SubscriptionRow = PaymentRow & { membership_id: string; months: number; product_id: string };

export type CheckoutRow = PaymentRow & { months?: number; subscription?: boolean; customer_id?: string | null };

function cents(chf: number): string {
  return String(toCents(Number(chf)));
}

function metadata(prefix: string, row: PaymentRow): Record<string, string> {
  const out: Record<string, string> = { [`${prefix}[payment_id]`]: row.payment_id };
  if (row.booking_id) out[`${prefix}[booking_id]`] = row.booking_id;
  if (row.membership_id) out[`${prefix}[membership_id]`] = row.membership_id;
  return out;
}

// PaymentIntent d'un cours ou d'une adhésion payée en une fois (TWINT) :
// carte (Apple Pay / Google Pay compris) et TWINT.
export function buildCoursePaymentParams(row: PaymentRow, customerId: string): Record<string, string> {
  return {
    amount: cents(row.amount),
    currency: 'chf',
    'payment_method_types[0]': 'card',
    'payment_method_types[1]': 'twint',
    customer: customerId,
    description: row.description,
    ...metadata('metadata', row),
  };
}

// Abonnement : prix mensuel en ligne (interval_count = months), première
// facture à payer par la PaymentSheet (default_incomplete).
export function buildSubscriptionParams(row: SubscriptionRow, customerId: string): Record<string, string> {
  return {
    customer: customerId,
    'items[0][price_data][currency]': 'chf',
    'items[0][price_data][product]': row.product_id,
    'items[0][price_data][unit_amount]': cents(row.amount),
    'items[0][price_data][recurring][interval]': 'month',
    'items[0][price_data][recurring][interval_count]': String(row.months),
    payment_behavior: 'default_incomplete',
    'payment_settings[save_default_payment_method]': 'on_subscription',
    'payment_settings[payment_method_types][0]': 'card',
    'expand[0]': 'latest_invoice.payment_intent',
    description: row.description,
    ...metadata('metadata', row),
  };
}

// Stripe Checkout (web) : paiement (carte + TWINT) ou abonnement (carte).
export function buildCheckoutParams(row: CheckoutRow, successUrl: string, cancelUrl: string): Record<string, string> {
  const p: Record<string, string> = {
    mode: row.subscription ? 'subscription' : 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: row.payment_id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'chf',
    'line_items[0][price_data][unit_amount]': cents(row.amount),
    'line_items[0][price_data][product_data][name]': row.description,
    ...metadata('metadata', row),
  };
  if (row.customer_id) p.customer = row.customer_id;
  if (row.subscription) {
    p['line_items[0][price_data][recurring][interval]'] = 'month';
    p['line_items[0][price_data][recurring][interval_count]'] = String(row.months ?? 1);
    p['payment_method_types[0]'] = 'card';
    Object.assign(p, metadata('subscription_data[metadata]', row));
  } else {
    p['payment_method_types[0]'] = 'card';
    p['payment_method_types[1]'] = 'twint';
    p['payment_intent_data[description]'] = row.description;
    if (row.booking_id) p['custom_text[submit][message]'] = COURSE_REFUND_NOTICE;
    Object.assign(p, metadata('payment_intent_data[metadata]', row));
  }
  return p;
}

// Base de l'app web : PUBLIC_APP_URL (sans / final), http(s) seulement ;
// null sinon. L'en-tête Origin n'est jamais utilisé (retour Stripe vers une
// adresse choisie par l'appelant).
export function resolveAppOrigin(publicAppUrl: string | undefined): string | null {
  const u = parseHttp(publicAppUrl);
  return u ? u.href.replace(/\/+$/, '') : null;
}

function parseHttp(v: string | null | undefined): URL | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

export function resultUrls(origin: string, paymentId: string): { success: string; cancel: string } {
  const base = `${origin}/payment-result?status=`;
  const p = encodeURIComponent(paymentId);
  return { success: `${base}success&payment=${p}`, cancel: `${base}cancel&payment=${p}` };
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------
// Erreur d'une fonction SQL (PostgREST : code SQLSTATE, hint).
export class DbError extends Error {
  constructor(readonly code: string | null, readonly hint: string | null, message: string) {
    super(message);
    this.name = 'DbError';
  }
}

function dbErrorResult(e: unknown, where: string): Result {
  if (e instanceof DbError) {
    if (e.code === '42501') return { status: 403, body: { error: 'forbidden' } };
    if (e.code === 'P0002') return { status: 404, body: { error: 'not_found' } };
    if (e.code === '22023') return { status: 409, body: { error: e.hint ?? 'invalid' } };
  }
  console.error(`${where}: database error`, e instanceof DbError ? `${e.code ?? ''} ${e.hint ?? ''}` : 'unknown');
  return { status: 500, body: { error: 'internal_error' } };
}

function stripeErrorResult(e: StripeError, where: string): Result {
  // jamais le message (il pourrait citer des données) ni la clé
  console.error(`${where}: stripe error`, e.status, e.type ?? '-', e.code ?? '-');
  return { status: 502, body: { error: 'payment_provider_error' } };
}

// ---------------------------------------------------------------------------
// create-payment
// ---------------------------------------------------------------------------
export type Payer = { id: string; stripe_customer_id: string | null; email: string | null; name: string };

export type CreatePaymentDeps = {
  secretKey: string | undefined; // STRIPE_SECRET_KEY
  publishableKey: string | undefined; // STRIPE_PUBLISHABLE_KEY
  publicAppUrl: string | undefined; // PUBLIC_APP_URL
  fetch: typeof fetch;
  // id de l'utilisateur auth du jeton Bearer, ou null
  authenticate(req: Request): Promise<string | null>;
  // profil (payeur) de l'utilisateur
  payer(authUserId: string): Promise<Payer | null>;
  // start_course_payment + intent déjà lié au paiement ; DbError en cas de refus
  startCoursePayment(
    bookingId: string,
    payerId: string,
  ): Promise<{ payment_id: string; amount: number; description: string; stripe_payment_intent_id: string | null }>;
  startMembershipPayment(
    profileId: string,
    payerId: string,
    months: number,
    source: 'stripe_subscription' | 'one_time',
  ): Promise<{ membership_id: string; payment_id: string; amount: number; description: string }>;
  // attach_payment_intent : renvoie l'intent à utiliser
  attachIntent(paymentId: string, intentId: string): Promise<string>;
  // record_customer : renvoie le client à utiliser
  recordCustomer(profileId: string, customerId: string): Promise<string>;
};

type Body =
  | { kind: 'course'; bookingId: string; platform: 'native' | 'web' }
  | { kind: 'membership'; profileId: string; months: number; method: 'card' | 'twint'; platform: 'native' | 'web' };

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.platform !== 'native' && b.platform !== 'web') return null;
  if (b.kind === 'course') {
    return typeof b.bookingId === 'string' && UUID.test(b.bookingId)
      ? { kind: 'course', bookingId: b.bookingId, platform: b.platform }
      : null;
  }
  if (b.kind === 'membership') {
    if (typeof b.profileId !== 'string' || !UUID.test(b.profileId)) return null;
    if (typeof b.months !== 'number' || ![1, 3, 6, 12].includes(b.months)) return null;
    if (b.method !== 'card' && b.method !== 'twint') return null;
    return { kind: 'membership', profileId: b.profileId, months: b.months, method: b.method, platform: b.platform };
  }
  return null;
}

type PI = { id: string; client_secret?: string; customer?: string | { id?: string } | null; status?: string };

function customerOf(pi: PI): string | null {
  const c = pi.customer;
  return typeof c === 'string' ? c : c && typeof c.id === 'string' ? c.id : null;
}

export async function handleCreatePayment(req: Request, deps: CreatePaymentDeps): Promise<Result> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const authUser = await deps.authenticate(req);
  if (!authUser) return { status: 401, body: { error: 'unauthorized' } };

  let body: Body | null;
  try {
    body = parseBody(await req.json());
  } catch {
    body = null;
  }
  if (!body) return { status: 400, body: { error: 'invalid_body' } };
  if (!deps.secretKey || (body.platform === 'native' && !deps.publishableKey)) {
    console.error('create-payment: Stripe keys are not set');
    return { status: 500, body: { error: 'not_configured' } };
  }
  let origin: string | null = null;
  if (body.platform === 'web') {
    origin = resolveAppOrigin(deps.publicAppUrl);
    if (!origin) {
      console.error('create-payment: PUBLIC_APP_URL is not set');
      return { status: 500, body: { error: 'not_configured' } };
    }
  }

  const payer = await deps.payer(authUser);
  if (!payer) return { status: 403, body: { error: 'forbidden' } };

  const key = deps.secretKey;
  const stripe = (path: string, params: Record<string, string>, idem?: string, method: StripeMethod = 'POST') =>
    stripeRequest(path, params, key, deps.fetch, idem, method);

  // 1. Droit de payer et montant : en base, avant tout appel Stripe
  let row: PaymentRow & { existingIntent?: string | null; months?: number; subscription?: boolean };
  try {
    if (body.kind === 'course') {
      const r = await deps.startCoursePayment(body.bookingId, payer.id);
      row = { payment_id: r.payment_id, amount: Number(r.amount), description: r.description, booking_id: body.bookingId, existingIntent: r.stripe_payment_intent_id };
    } else {
      const source = body.method === 'card' ? 'stripe_subscription' : 'one_time';
      const r = await deps.startMembershipPayment(body.profileId, payer.id, body.months, source);
      row = {
        payment_id: r.payment_id,
        amount: Number(r.amount),
        description: r.description,
        membership_id: r.membership_id,
        months: body.months,
        subscription: source === 'stripe_subscription',
      };
    }
  } catch (e) {
    return dbErrorResult(e, 'create-payment');
  }

  try {
    // 2. Client Stripe du payeur : créé une fois, puis réutilisé
    let customer = payer.stripe_customer_id;
    if (!customer) {
      const params: Record<string, string> = { name: payer.name, 'metadata[profile_id]': payer.id };
      if (payer.email) params.email = payer.email;
      const created = (await stripe('customers', params, `customer-${payer.id}`)) as { id: string };
      customer = await deps.recordCustomer(payer.id, created.id);
    }

    // 3a. Web : Stripe Checkout
    if (body.platform === 'web') {
      const urls = resultUrls(origin!, row.payment_id);
      const session = (await stripe(
        'checkout/sessions',
        buildCheckoutParams({ ...row, customer_id: customer }, urls.success, urls.cancel),
        `checkout-${row.payment_id}`,
      )) as { url?: string };
      if (!session.url) throw new StripeError(200, null, 'missing_url', 'checkout session without url');
      return { status: 200, body: { checkoutUrl: session.url } };
    }

    // 3b. Natif : PaymentSheet
    let pi: PI;
    if (row.subscription) {
      await ensureMembershipProduct(stripe);
      const sub = (await stripe(
        'subscriptions',
        buildSubscriptionParams(
          { ...row, membership_id: row.membership_id!, months: row.months!, product_id: MEMBERSHIP_PRODUCT_ID },
          customer,
        ),
        `sub-${row.payment_id}`,
      )) as { id: string; latest_invoice?: { payment_intent?: PI | string | null } | null };
      const inv = sub.latest_invoice?.payment_intent;
      if (!inv || typeof inv === 'string' || !inv.client_secret) {
        throw new StripeError(200, null, 'missing_payment_intent', 'subscription without first invoice payment intent');
      }
      pi = inv;
      // intent de la première facture lié au paiement (remboursement possible)
      const use = await deps.attachIntent(row.payment_id, pi.id);
      if (use !== pi.id) {
        // paiement déjà lié à un autre intent : cet abonnement est abandonné
        try {
          await stripe(`subscriptions/${sub.id}`, {}, `cancel-now-sub-${row.payment_id}`, 'DELETE');
        } catch (e) {
          console.error('create-payment: could not cancel unused subscription', e instanceof StripeError ? e.code ?? e.status : 'unknown');
        }
        return { status: 409, body: { error: 'payment_conflict' } };
      }
    } else if (row.existingIntent) {
      pi = (await stripe(`payment_intents/${row.existingIntent}`, {}, undefined, 'GET')) as PI;
    } else {
      const created = (await stripe('payment_intents', buildCoursePaymentParams(row, customer), `pi-${row.payment_id}`)) as PI;
      const use = await deps.attachIntent(row.payment_id, created.id);
      if (use === created.id) {
        pi = created;
      } else {
        // un autre intent est déjà lié (requête concurrente) : celui-ci est abandonné
        try {
          await stripe(`payment_intents/${created.id}/cancel`, {}, `cancel-${created.id}`);
        } catch (e) {
          console.warn('create-payment: could not cancel unused intent', e instanceof StripeError ? e.code ?? e.status : 'unknown');
        }
        pi = (await stripe(`payment_intents/${use}`, {}, undefined, 'GET')) as PI;
      }
    }

    if (pi.status === 'succeeded' || pi.status === 'processing') return { status: 409, body: { error: 'already_paid' } };
    if (pi.status === 'canceled' || !pi.client_secret) return { status: 409, body: { error: 'payment_unavailable' } };

    // clé éphémère seulement pour le client du payeur (jamais celui d'un autre)
    const piCustomer = customerOf(pi) ?? customer;
    let ephemeralKeySecret: string | null = null;
    let customerId: string | null = null;
    if (piCustomer === customer) {
      // sans Idempotency-Key : une clé rejouée pourrait être déjà expirée (sans effet de bord)
      const ek = (await stripe('ephemeral_keys', { customer })) as { secret: string };
      ephemeralKeySecret = ek.secret;
      customerId = customer;
    }
    return {
      status: 200,
      body: {
        paymentIntentClientSecret: pi.client_secret,
        customerId,
        ephemeralKeySecret,
        publishableKey: deps.publishableKey!,
        amount: row.amount,
      },
    };
  } catch (e) {
    if (e instanceof StripeError) return stripeErrorResult(e, 'create-payment');
    return dbErrorResult(e, 'create-payment');
  }
}

// Produit des adhésions, créé avec un id fixe (déjà existant → réutilisé).
async function ensureMembershipProduct(
  stripe: (path: string, params: Record<string, string>, idem?: string) => Promise<unknown>,
): Promise<void> {
  try {
    await stripe('products', { id: MEMBERSHIP_PRODUCT_ID, name: MEMBERSHIP_PRODUCT_NAME }, `product-${MEMBERSHIP_PRODUCT_ID}`);
  } catch (e) {
    if (e instanceof StripeError && e.code === 'resource_already_exists') return;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// cancel-subscription
// ---------------------------------------------------------------------------
export type MembershipForCancel = {
  id: string;
  profile_id: string;
  paid_by: string | null;
  source: string;
  status: string;
  stripe_subscription_id: string | null;
  ends_on: string | null;
};

export type CancelSubscriptionDeps = {
  secretKey: string | undefined;
  fetch: typeof fetch;
  authenticate(req: Request): Promise<string | null>;
  profileId(authUserId: string): Promise<string | null>;
  loadMembership(id: string): Promise<MembershipForCancel | null>;
  // set_membership_cancel(subscription, true)
  setCancel(subscription: string, cancelAtPeriodEnd: boolean): Promise<void>;
};

export type CancelDecision =
  | { ok: true; subscription: string }
  | { ok: false; status: number; error: string };

// Payeur ou bénéficiaire ; abonnement Stripe actif. Déjà résilié → 200 (already).
export function decideCancelSubscription(m: MembershipForCancel | null, callerProfileId: string | null): CancelDecision {
  if (!m) return { ok: false, status: 404, error: 'not_found' };
  if (!callerProfileId || (callerProfileId !== m.paid_by && callerProfileId !== m.profile_id)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (m.source !== 'stripe_subscription' || !m.stripe_subscription_id) return { ok: false, status: 409, error: 'not_subscription' };
  if (m.status === 'cancelled') return { ok: false, status: 200, error: 'already' };
  if (m.status !== 'active') return { ok: false, status: 409, error: 'not_active' };
  return { ok: true, subscription: m.stripe_subscription_id };
}

export async function handleCancelSubscription(req: Request, deps: CancelSubscriptionDeps): Promise<Result> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const authUser = await deps.authenticate(req);
  if (!authUser) return { status: 401, body: { error: 'unauthorized' } };
  let membershipId: unknown;
  try {
    membershipId = ((await req.json()) as Record<string, unknown> | null)?.membershipId;
  } catch {
    membershipId = null;
  }
  if (typeof membershipId !== 'string' || !UUID.test(membershipId)) return { status: 400, body: { error: 'invalid_body' } };
  if (!deps.secretKey) {
    console.error('cancel-subscription: STRIPE_SECRET_KEY is not set');
    return { status: 500, body: { error: 'not_configured' } };
  }

  const m = await deps.loadMembership(membershipId);
  const decision = decideCancelSubscription(m, await deps.profileId(authUser));
  if (!decision.ok) {
    if (decision.status === 200) return { status: 200, body: { ok: true, already: true, endsOn: m?.ends_on ?? null } };
    return { status: decision.status, body: { error: decision.error } };
  }

  try {
    await stripeRequest(
      `subscriptions/${decision.subscription}`,
      { cancel_at_period_end: 'true' },
      deps.secretKey,
      deps.fetch,
      `cancel-sub-${membershipId}`,
    );
  } catch (e) {
    if (e instanceof StripeError) return stripeErrorResult(e, 'cancel-subscription');
    throw e;
  }
  // le webhook customer.subscription.updated le confirmera aussi
  await deps.setCancel(decision.subscription, true);
  return { status: 200, body: { ok: true, endsOn: m!.ends_on } };
}

// ---------------------------------------------------------------------------
// process-refunds
// ---------------------------------------------------------------------------
export type RefundRow = { id: string; stripe_payment_intent_id: string | null };
export type SubscriptionToCancel = { membership_id: string; stripe_subscription_id: string };

export type ProcessRefundsDeps = {
  serviceKey: string | undefined; // SUPABASE_SERVICE_ROLE_KEY
  secretKey: string | undefined; // STRIPE_SECRET_KEY
  fetch: typeof fetch;
  refundsToProcess(limit: number): Promise<RefundRow[]>;
  markRefunded(paymentId: string): Promise<void>;
  subscriptionsToCancel(limit: number): Promise<SubscriptionToCancel[]>;
  markSubscriptionCancelled(membershipId: string): Promise<void>;
};

export const REFUND_BATCH = 20;

// statut / code Stripe, ou le nom de l'erreur (jamais de message Stripe)
function errInfo(e: unknown): string {
  if (e instanceof StripeError) return `${e.status} ${e.code ?? '-'}`;
  return e instanceof Error ? e.name : 'unknown';
}

// Erreur Stripe qui signifie « déjà fait » (rien à refaire).
export function refundAlreadyDone(e: unknown): boolean {
  return e instanceof StripeError && e.code === 'charge_already_refunded';
}

export function subscriptionAlreadyGone(e: unknown): boolean {
  return e instanceof StripeError && e.code === 'resource_missing';
}

export async function handleProcessRefunds(req: Request, deps: ProcessRefundsDeps): Promise<Result> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!isServiceRoleRequest(req.headers.get('Authorization'), deps.serviceKey)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  if (!deps.secretKey) {
    console.error('process-refunds: STRIPE_SECRET_KEY is not set');
    return { status: 500, body: { error: 'not_configured' } };
  }
  const key = deps.secretKey;
  let refunded = 0;
  let cancelled = 0;
  let failed = 0;

  // 1. Abonnements à annuler tout de suite (première facture au mauvais
  //    montant) : Stripe ne doit plus facturer
  for (const s of await deps.subscriptionsToCancel(REFUND_BATCH)) {
    // chaque ligne isolée : une erreur (Stripe, réseau, base) la laisse pour
    // le passage suivant sans interrompre le lot
    try {
      try {
        await stripeRequest(`subscriptions/${s.stripe_subscription_id}`, {}, key, deps.fetch, `cancel-now-${s.membership_id}`, 'DELETE');
      } catch (e) {
        if (!subscriptionAlreadyGone(e)) throw e;
      }
      await deps.markSubscriptionCancelled(s.membership_id);
      cancelled++;
    } catch (e) {
      failed++;
      console.error('process-refunds: subscription cancel failed', s.membership_id, errInfo(e));
    }
  }

  // 2. Remboursements (montant total de l'intent)
  for (const r of await deps.refundsToProcess(REFUND_BATCH)) {
    if (!r.stripe_payment_intent_id) continue;
    try {
      try {
        await stripeRequest(
          'refunds',
          { payment_intent: r.stripe_payment_intent_id, 'metadata[payment_id]': r.id },
          key,
          deps.fetch,
          `refund-${r.id}`,
        );
      } catch (e) {
        if (!refundAlreadyDone(e)) throw e;
      }
      await deps.markRefunded(r.id);
      refunded++;
    } catch (e) {
      failed++;
      console.error('process-refunds: refund failed', r.id, errInfo(e));
    }
  }
  return { status: 200, body: { refunded, cancelled, failed } };
}
