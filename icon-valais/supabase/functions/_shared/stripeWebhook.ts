// Webhook Stripe : vérification de la signature, routage des événements vers
// les fonctions SQL (service_role), traitement d'une requête avec I/O
// injectées. Logique pure, testée avec Deno (stripeWebhook.test.ts).
//
// Ne journalise jamais le secret, la signature ni le corps de l'événement
// (données personnelles) : seulement le type, l'id de l'événement et l'action.
import { CLUB_TIME_ZONE } from './push.ts';

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type Action = { fn: string; args: Record<string, unknown> } | { ignore: true };

// ---------------------------------------------------------------------------
// Signature : en-tête Stripe-Signature « t=<unix>,v1=<hex>[,v1=...] »,
// v1 = HMAC-SHA256(secret, "<t>.<corps brut>").
// ---------------------------------------------------------------------------
const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparaison en temps constant (longueurs égales ; la longueur, fixe pour un
// HMAC-SHA256 hexadécimal, n'est pas secrète).
function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!secret || !header) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && v) sigs.push(v.toLowerCase());
  }
  if (t === null || sigs.length === 0) return false;
  // trop ancien (rejeu) ou trop dans le futur
  if (Math.abs(nowSec - t) > toleranceSec) return false;

  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`))));
  let ok = false;
  for (const s of sigs) ok = safeEqual(expected, s) || ok; // toutes comparées
  return ok;
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

// identifiant d'un champ qui peut être un id ou un objet développé (expand)
function idOf(v: unknown): string | null {
  return str(v) ?? str(obj(v)?.id);
}

function uuidOf(v: unknown): string | null {
  const s = str(v);
  return s && UUID.test(s) ? s.toLowerCase() : null;
}

// Date (YYYY-MM-DD) à Zurich d'un horodatage Unix (secondes).
export function unixToZurichDate(sec: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(sec * 1000));
}

// Moyen de paiement d'un PaymentIntent, si l'événement le donne : objet
// payment_method développé, charge incluse (anciennes versions de l'API), ou
// un seul type autorisé. Sinon null.
function paymentMethodOf(pi: Obj): string | null {
  const pm = str(obj(pi.payment_method)?.type);
  if (pm) return pm;
  const charges = obj(pi.charges)?.data;
  if (Array.isArray(charges)) {
    const t = str(obj(obj(charges[0])?.payment_method_details)?.type);
    if (t) return t;
  }
  const types = pi.payment_method_types;
  if (Array.isArray(types) && types.length === 1) return str(types[0]);
  return null;
}

// Abonnement d'une facture : `subscription` (API jusqu'à 2025-02) ou
// `parent.subscription_details.subscription` (API 2025-03 et suivantes).
function invoiceSubscription(inv: Obj): { id: string | null; metadata: Obj } {
  const parent = obj(obj(inv.parent)?.subscription_details);
  const id = idOf(inv.subscription) ?? idOf(parent?.subscription);
  const metadata = obj(obj(inv.subscription_details)?.metadata) ?? obj(parent?.metadata) ?? {};
  return { id, metadata };
}

// PaymentIntent d'une facture, s'il figure dans l'événement.
function invoicePaymentIntent(inv: Obj): string | null {
  const direct = idOf(inv.payment_intent);
  if (direct) return direct;
  const payments = obj(inv.payments)?.data;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      const id = idOf(obj(obj(p)?.payment)?.payment_intent);
      if (id) return id;
    }
  }
  return null;
}

// Fin de la période facturée : la plus tardive des lignes, en date de Zurich.
function invoicePeriodEnd(inv: Obj): string | null {
  const lines = obj(inv.lines)?.data;
  let end: number | null = null;
  if (Array.isArray(lines)) {
    for (const l of lines) {
      const e = obj(obj(l)?.period)?.end;
      if (typeof e === 'number' && Number.isFinite(e) && (end === null || e > end)) end = e;
    }
  }
  return end === null ? null : unixToZurichDate(end);
}

const IGNORE: Action = { ignore: true };

export function routeStripeEvent(event: StripeEvent): Action {
  const o = obj(obj(event?.data)?.object);
  if (!o) return IGNORE;
  const id = str(o.id);
  if (!id) return IGNORE;

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const meta = obj(o.metadata) ?? {};
      const method = paymentMethodOf(o);
      const membership = uuidOf(meta.membership_id);
      if (membership) {
        return {
          fn: 'activate_membership',
          args: { p_payment_intent: id, p_subscription: null, p_period_end: null, p_membership: membership, p_method: method },
        };
      }
      if (uuidOf(meta.booking_id)) return { fn: 'confirm_payment', args: { p_intent: id, p_method: method } };
      // sans metadata (ex. facture d'abonnement) : routage par l'intent en base
      return { fn: 'settle_payment_intent', args: { p_intent: id, p_method: method } };
    }
    case 'payment_intent.payment_failed':
      return { fn: 'fail_payment', args: { p_intent: id } };
    case 'invoice.paid': {
      const sub = invoiceSubscription(o);
      if (!sub.id) return IGNORE;
      const periodEnd = invoicePeriodEnd(o);
      if (o.billing_reason === 'subscription_create') {
        return {
          fn: 'activate_membership',
          args: {
            p_payment_intent: invoicePaymentIntent(o),
            p_subscription: sub.id,
            p_period_end: periodEnd,
            p_membership: uuidOf(sub.metadata.membership_id),
            p_method: 'card', // abonnements : carte / Apple Pay / Google Pay
          },
        };
      }
      if (o.billing_reason === 'subscription_cycle') {
        const paid = typeof o.amount_paid === 'number' ? o.amount_paid : 0;
        return {
          fn: 'renew_membership',
          args: { p_subscription: sub.id, p_invoice: id, p_amount: paid / 100, p_period_end: periodEnd },
        };
      }
      return IGNORE;
    }
    case 'customer.subscription.updated':
      return {
        fn: 'set_membership_cancel',
        args: { p_subscription: id, p_cancel_at_period_end: o.cancel_at_period_end === true || o.cancel_at != null },
      };
    case 'customer.subscription.deleted':
      return { fn: 'end_membership', args: { p_subscription: id } };
    case 'charge.refunded': {
      // remboursement total seulement (le club ne rembourse que des montants entiers)
      const intent = idOf(o.payment_intent);
      if (o.refunded !== true || !intent) return IGNORE;
      return { fn: 'mark_refunded_by_intent', args: { p_intent: intent } };
    }
    default:
      return IGNORE;
  }
}

// ---------------------------------------------------------------------------
// Traitement d'une requête (I/O injectées)
// ---------------------------------------------------------------------------
export type StripeWebhookDeps = {
  secret: string | undefined; // STRIPE_WEBHOOK_SECRET
  nowSec(): number;
  // insère stripe_events ; false si l'événement était déjà enregistré
  recordEvent(id: string, type: string): Promise<boolean>;
  // supprime l'événement (action en échec : Stripe le renverra)
  forgetEvent(id: string): Promise<void>;
  // appelle la fonction SQL (rpc service_role) ; rejette en cas d'erreur
  call(fn: string, args: Record<string, unknown>): Promise<unknown>;
};

export type StripeWebhookResult = { status: number; body: Record<string, unknown> };

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown';
}

export async function handleStripeWebhook(req: Request, deps: StripeWebhookDeps): Promise<StripeWebhookResult> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!deps.secret) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not set');
    return { status: 500, body: { error: 'not configured' } };
  }

  // corps brut : la signature porte sur les octets reçus, avant tout parsing
  const raw = await req.text();
  const header = req.headers.get('Stripe-Signature') ?? '';
  if (!(await verifyStripeSignature(raw, header, deps.secret, deps.nowSec()))) {
    console.warn('stripe-webhook: invalid signature');
    return { status: 400, body: { error: 'invalid signature' } };
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'invalid payload' } };
  }
  if (!str(event?.id) || !str(event?.type)) return { status: 400, body: { error: 'invalid payload' } };

  const action = routeStripeEvent(event);
  if ('ignore' in action) return { status: 200, body: { received: true, ignored: true } };

  if (!(await deps.recordEvent(event.id, event.type))) {
    console.log('stripe-webhook: duplicate', event.type, event.id);
    return { status: 200, body: { received: true, duplicate: true } };
  }
  try {
    const result = await deps.call(action.fn, action.args);
    console.log('stripe-webhook:', event.type, event.id, '→', action.fn, typeof result === 'string' ? result : '');
    return { status: 200, body: { received: true, result: typeof result === 'string' ? result : null } };
  } catch (e) {
    console.error('stripe-webhook: action failed', event.type, event.id, action.fn, errMessage(e));
    try {
      await deps.forgetEvent(event.id);
    } catch (e2) {
      console.error('stripe-webhook: could not forget event', event.id, errMessage(e2));
    }
    return { status: 500, body: { error: 'processing failed' } };
  }
}
