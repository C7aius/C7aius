import { zurichToday } from '@/src/domain/courses';
import { periodRange, zurichStartOfDay } from '@/src/domain/periods';

export type PaymentRow = {
  id: string;
  receipt_no: number;
  kind: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refund_pending' | 'refunded' | 'refund_failed';
  description: string;
  method: string | null;
  paid_at: string | null;
  created_at: string;
  refunded_at: string | null;
  error: string | null;
};

export const STATUS_KEY: Record<PaymentRow['status'], string> = {
  pending: 'payments.statusPending',
  succeeded: 'payments.statusSucceeded',
  failed: 'payments.statusFailed',
  refund_pending: 'payments.refundPending',
  refunded: 'payments.refunded',
  refund_failed: 'payments.refundFailed',
};

/**
 * « Mes paiements » : paiements en attente (Checkout abandonné, feuille fermée) et échoués
 * masqués aux membres — rien n'a été encaissé. L'admin voit tout.
 */
export const MEMBER_HIDDEN_STATUSES: PaymentRow['status'][] = ['pending', 'failed'];
export const isMemberVisible = (p: Pick<PaymentRow, 'status'>) => !MEMBER_HIDDEN_STATUSES.includes(p.status);

/** Remboursements que Stripe n'a pas pu faire (8 essais, ou refusés) : à traiter par l'admin. */
export const failedRefunds = <T extends Pick<PaymentRow, 'status'>>(rows: T[]) => rows.filter((r) => r.status === 'refund_failed');

/** Une quittance n'existe que pour un paiement abouti (ou remboursé). */
export const isReceiptable = (p: Pick<PaymentRow, 'status'>) => p.status === 'succeeded' || p.status === 'refunded';

const cents = (n: number) => Math.round(Number(n) * 100);

/** Encaissé : paiements aboutis seulement (remboursés et remboursements en cours exclus). Remboursé : status refunded. */
export function paymentTotals(rows: Pick<PaymentRow, 'amount' | 'status'>[]) {
  let collected = 0;
  let refunded = 0;
  for (const r of rows) {
    if (r.status === 'succeeded') collected += cents(r.amount);
    else if (r.status === 'refunded') refunded += cents(r.amount);
  }
  return { collected: collected / 100, refunded: refunded / 100 };
}

export type Period = 'month' | '30d' | 'year' | 'all';

/** Début ISO de la période (null = tout) : minuit à Zurich du premier jour (mois, année) ; 30 jours glissants. */
export function periodStart(period: Period, now: Date = new Date()): string | null {
  switch (period) {
    case 'month':
    case 'year':
      return zurichStartOfDay(periodRange(period, zurichToday(now)).from);
    case '30d':
      return new Date(now.getTime() - 30 * 86400000).toISOString();
    default:
      return null;
  }
}

export const formatAmount = (n: number) => `${n.toFixed(2)} CHF`;

/** '2026-11-20T18:00:00Z' -> '20.11.2026' (fuseau Europe/Zurich) */
export function formatDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  return parts;
}

// ---- tarifs -------------------------------------------------------------

export type PricingForm = {
  price_1m: string;
  price_3m: string;
  price_6m: string;
  price_12m: string;
  student_discount_pct: string;
  child_discount_pct: string;
  child_max_age: string;
  default_course_price: string;
};
export type PricingKey = keyof PricingForm;

export const PRICING_KEYS: PricingKey[] = [
  'price_1m', 'price_3m', 'price_6m', 'price_12m',
  'student_discount_pct', 'child_discount_pct', 'child_max_age', 'default_course_price',
];

const num = (s: string) => Number(s.trim().replace(',', '.'));
const amount = (s: string, allowZero: boolean) => {
  if (!/^\d+([.,]\d{1,2})?$/.test(s.trim())) return false;
  const v = num(s);
  return v < 1000000 && (allowZero ? v >= 0 : v > 0);
};
const intIn = (s: string, lo: number, hi: number) => /^\d+$/.test(s.trim()) && num(s) >= lo && num(s) <= hi;

/** Erreurs par champ (clés i18n) ; objet vide = valide. */
export function validatePricing(f: PricingForm): Partial<Record<PricingKey, string>> {
  const e: Partial<Record<PricingKey, string>> = {};
  for (const k of ['price_1m', 'price_3m', 'price_6m', 'price_12m'] as const) if (!amount(f[k], false)) e[k] = 'admin.errPrice';
  if (!amount(f.default_course_price, true)) e.default_course_price = 'admin.errCoursePrice';
  for (const k of ['student_discount_pct', 'child_discount_pct'] as const) if (!intIn(f[k], 0, 90)) e[k] = 'admin.errPct';
  if (!intIn(f.child_max_age, 0, 100)) e.child_max_age = 'admin.errAge';
  return e;
}

export const toPricingPayload = (f: PricingForm): Record<PricingKey, number> =>
  Object.fromEntries(PRICING_KEYS.map((k) => [k, num(f[k])])) as Record<PricingKey, number>;
