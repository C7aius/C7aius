import { Platform } from 'react-native';

import { supabase } from '@/src/lib/supabase';
// stripeModule.native.ts (natif) / stripeModule.ts (web, jamais appelé) : le SDK natif n'entre pas dans le bundle web
import { MERCHANT_IDENTIFIER } from '@/src/lib/stripeConfig';
import { loadStripe } from '@/src/lib/stripeModule';

/**
 * paid : confirmé ; pending : payé côté Stripe, confirmation du webhook pas encore reçue ;
 * cancelled : feuille fermée sans payer ; redirected : le web quitte l'app pour Stripe Checkout ;
 * error : échec (voir `errorKey` de PayDetail).
 */
export type PayOutcome = 'paid' | 'cancelled' | 'error' | 'pending' | 'redirected';
export type PayDetail = { outcome: PayOutcome; errorKey?: string };

const RETURN_URL = 'iconvalais://stripe-redirect';
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 10;

type NativeResponse = {
  paymentIntentClientSecret: string;
  customerId: string;
  ephemeralKeySecret: string;
  publishableKey: string;
};
type PaymentBody =
  | { kind: 'course'; bookingId: string }
  | { kind: 'membership'; profileId: string; months: 1 | 3 | 6 | 12; method: 'card' | 'twint' };

/** Clé i18n d'une erreur renvoyée par create-payment (corps `{ error }`). */
export function paymentErrorKey(code: unknown): string {
  switch (code) {
    case 'forbidden':
      return 'errors.notAllowed';
    case 'not_found':
      return 'errors.notFound';
    case 'payment_conflict':
      return 'payments.conflict';
    case 'already_covered':
      return 'payments.alreadyCovered';
    case 'not_configured':
      return 'payments.notConfigured';
    case 'payment_provider_error':
      return 'payments.providerError';
    default:
      return 'payments.error';
  }
}

async function errorCodeOf(error: unknown): Promise<unknown> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: unknown }> } }).context;
    return (await ctx?.json?.())?.error;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Le webhook Stripe marque la réservation payée : on relit toutes les secondes, 10 s au plus. */
async function waitForPaid(bookingId: string): Promise<boolean> {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    try {
      const { data } = await supabase.from('bookings').select('payment_status').eq('id', bookingId).limit(1);
      if ((data as { payment_status: string }[] | null)?.[0]?.payment_status === 'paid') return true;
    } catch {
      // réseau : on réessaie au prochain tour
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function run(body: PaymentBody): Promise<PayDetail> {
  try {
    const web = Platform.OS === 'web';
    // aucun montant envoyé : le serveur le calcule
    const { data, error } = await supabase.functions.invoke('create-payment', {
      body: { ...body, platform: web ? 'web' : 'native' },
    });
    if (error || !data) return { outcome: 'error', errorKey: paymentErrorKey(await errorCodeOf(error)) };

    if (web) {
      const url = (data as { checkoutUrl?: string }).checkoutUrl;
      if (!url) return { outcome: 'error', errorKey: 'payments.error' };
      window.location.assign(url);
      return { outcome: 'redirected' };
    }

    const res = data as NativeResponse;
    const stripe = loadStripe();
    await stripe.initStripe({
      publishableKey: res.publishableKey,
      merchantIdentifier: MERCHANT_IDENTIFIER,
      urlScheme: 'iconvalais',
    });
    const init = await stripe.initPaymentSheet({
      merchantDisplayName: 'Icon Valais',
      customerId: res.customerId,
      customerEphemeralKeySecret: res.ephemeralKeySecret,
      paymentIntentClientSecret: res.paymentIntentClientSecret,
      allowsDelayedPaymentMethods: true, // TWINT
      returnURL: RETURN_URL,
      applePay: { merchantCountryCode: 'CH' },
      googlePay: { merchantCountryCode: 'CH', currencyCode: 'CHF', testEnv: __DEV__ },
    });
    if (init.error) return { outcome: 'error', errorKey: 'payments.error' };
    const shown = await stripe.presentPaymentSheet();
    if (shown.error) {
      return shown.error.code === 'Canceled'
        ? { outcome: 'cancelled' }
        : { outcome: 'error', errorKey: 'payments.error' };
    }
    if (body.kind === 'course') return { outcome: (await waitForPaid(body.bookingId)) ? 'paid' : 'pending' };
    return { outcome: 'paid' };
  } catch {
    return { outcome: 'error', errorKey: 'errors.network' };
  }
}

export const payBookingDetail = (bookingId: string) => run({ kind: 'course', bookingId });
export const payMembershipDetail = (profileId: string, months: 1 | 3 | 6 | 12, method: 'card' | 'twint') =>
  run({ kind: 'membership', profileId, months, method });

/** Paie une réservation de cours (feuille Stripe sur natif, Checkout sur web). */
export const payBooking = async (bookingId: string): Promise<PayOutcome> => (await payBookingDetail(bookingId)).outcome;

/** Paie une adhésion (utilisée par l'écran d'abonnement). */
export const payMembership = async (
  profileId: string,
  months: 1 | 3 | 6 | 12,
  method: 'card' | 'twint',
): Promise<PayOutcome> => (await payMembershipDetail(profileId, months, method)).outcome;
