// Appels à l'API Stripe (sans SDK) : montants en centimes, encodage des
// formulaires (notation a[b][0]=), requête POST. La clé secrète n'est jamais
// journalisée ni incluse dans une erreur. Testé avec Deno (stripe.test.ts).

export const STRIPE_API = 'https://api.stripe.com/v1';

// Version de l'API Stripe épinglée (en-tête Stripe-Version de chaque appel ;
// à reprendre pour l'endpoint du webhook dans le tableau de bord, voir
// README). Avec cette version, latest_invoice.payment_intent d'un abonnement
// et invoice.payment_intent des événements existent encore.
export const STRIPE_API_VERSION = '2024-06-20';

export type StripeMethod = 'GET' | 'POST' | 'DELETE';

// CHF → centimes (entier). Montant négatif ou non fini → RangeError.
export function toCents(chf: number): number {
  if (!Number.isFinite(chf) || chf < 0) throw new RangeError('toCents: amount must be a finite number >= 0');
  return Math.round(chf * 100);
}

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };

// Crochets laissés lisibles, comme les bibliothèques Stripe.
function encodeKey(key: string): string {
  return encodeURIComponent(key).replace(/%5B/gi, '[').replace(/%5D/gi, ']');
}

function walk(prefix: string, value: FormValue, out: string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(`${prefix}[${i}]`, v, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}[${k}]` : k, v, out);
  } else {
    out.push(`${encodeKey(prefix)}=${encodeURIComponent(String(value))}`);
  }
}

// { metadata: { a: '1' }, items: [{ price: 'p' }] } → metadata[a]=1&items[0][price]=p
// null / undefined : omis.
export function encodeForm(obj: Record<string, unknown>): string {
  const out: string[] = [];
  walk('', obj as { [k: string]: FormValue }, out);
  return out.join('&');
}

// Erreur d'un appel Stripe : statut HTTP (0 = réseau), type et code Stripe.
export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly code: string | null,
    detail: string,
  ) {
    super(`stripe ${status}${type ? ` ${type}` : ''}${code ? ` ${code}` : ''}: ${detail}`);
    this.name = 'StripeError';
  }
}

// Appel https://api.stripe.com/v1/<path> : POST (corps
// application/x-www-form-urlencoded, par défaut), GET ou DELETE (paramètres
// dans l'URL). idempotencyKey : en-tête Idempotency-Key (rejouer la même
// opération sans la refaire). Renvoie le JSON de la réponse ; erreur →
// StripeError.
export async function stripeRequest(
  path: string,
  params: Record<string, string>,
  key: string,
  fetchFn: typeof fetch = fetch,
  idempotencyKey?: string,
  method: StripeMethod = 'POST',
): Promise<unknown> {
  const clean = path.replace(/^\/+/, '').replace(/^v1\//, '');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const form = encodeForm(params);
  let url = `${STRIPE_API}/${clean}`;
  const init: RequestInit = { method, headers };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form;
  } else if (form) {
    url += `?${form}`;
  }

  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    throw new StripeError(0, null, null, e instanceof Error ? e.message : 'network error');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new StripeError(res.status, null, null, 'unreadable response');
  }
  if (!res.ok) {
    const err = (data as { error?: { type?: string; code?: string; message?: string } } | null)?.error ?? {};
    // par précaution : jamais la clé dans le message, même si Stripe la citait
    const message = err.message ?? 'request failed';
    const detail = key ? message.split(key).join('[redacted]') : message;
    throw new StripeError(res.status, err.type ?? null, err.code ?? null, detail);
  }
  return data;
}
