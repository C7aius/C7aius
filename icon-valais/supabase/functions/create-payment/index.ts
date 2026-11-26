// POST (utilisateur connecté) : démarre un paiement Stripe.
// Corps : { kind: 'course', bookingId, platform } ou
//         { kind: 'membership', profileId, months, method: 'card' | 'twint', platform }
// platform 'native' → { paymentIntentClientSecret, customerId, ephemeralKeySecret, publishableKey, amount }
// platform 'web'    → { checkoutUrl } (retour <PUBLIC_APP_URL | Origin>/payment-result?status=success|cancel&payment=<id>)
// Droit de payer et montant : en base (start_course_payment /
// start_membership_payment) avant tout appel Stripe ; le montant du corps est
// ignoré. Logique dans _shared/payments.ts. Secrets : STRIPE_SECRET_KEY,
// STRIPE_PUBLISHABLE_KEY (seule renvoyée), PUBLIC_APP_URL ; jamais journalisés.
import { authenticate, corsHeaders, json, serviceClient } from '../_shared/http.ts';
import { DbError, handleCreatePayment } from '../_shared/payments.ts';

type PgErr = { code?: string; hint?: string | null; message: string } | null;
const dbErr = (what: string, e: PgErr) => new DbError(e?.code ?? null, e?.hint ?? null, `${what}: ${e?.message ?? ''}`);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = serviceClient();
  try {
    const res = await handleCreatePayment(req, {
      secretKey: Deno.env.get('STRIPE_SECRET_KEY') || undefined,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY') || undefined,
      publicAppUrl: Deno.env.get('PUBLIC_APP_URL') || undefined,
      fetch,
      async authenticate(r) {
        return (await authenticate(r))?.id ?? null;
      },
      async payer(authUserId) {
        const { data, error } = await db
          .from('profiles')
          .select('id, stripe_customer_id, first_name, last_name')
          .eq('auth_user_id', authUserId)
          .maybeSingle();
        if (error) throw dbErr('profile lookup', error);
        if (!data) return null;
        const { data: u } = await db.auth.admin.getUserById(authUserId);
        return {
          id: data.id,
          stripe_customer_id: data.stripe_customer_id,
          email: u?.user?.email ?? null,
          name: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim(),
        };
      },
      async startCoursePayment(bookingId, payerId) {
        const { data, error } = await db.rpc('start_course_payment', { p_booking: bookingId, p_payer: payerId });
        if (error) throw dbErr('start_course_payment', error);
        const row = (Array.isArray(data) ? data[0] : data) as { payment_id: string; amount: number; description: string };
        const { data: p, error: pErr } = await db.from('payments').select('stripe_payment_intent_id').eq('id', row.payment_id).single();
        if (pErr) throw dbErr('payment lookup', pErr);
        return { ...row, stripe_payment_intent_id: p.stripe_payment_intent_id };
      },
      async startMembershipPayment(profileId, payerId, months, source) {
        const { data, error } = await db.rpc('start_membership_payment', {
          p_profile: profileId,
          p_payer: payerId,
          p_months: months,
          p_source: source,
        });
        if (error) throw dbErr('start_membership_payment', error);
        return (Array.isArray(data) ? data[0] : data) as { membership_id: string; payment_id: string; amount: number; description: string };
      },
      async attachIntent(paymentId, intent) {
        const { data, error } = await db.rpc('attach_payment_intent', { p_payment: paymentId, p_intent: intent });
        if (error) throw dbErr('attach_payment_intent', error);
        return String(data);
      },
      async recordCustomer(profileId, customer) {
        const { data, error } = await db.rpc('record_customer', { p_profile: profileId, p_customer: customer });
        if (error) throw dbErr('record_customer', error);
        return String(data);
      },
    });
    return json(res.status, res.body);
  } catch (e) {
    console.error('create-payment failed', e instanceof Error ? e.name : 'unknown');
    return json(500, { error: 'create-payment failed' });
  }
});
