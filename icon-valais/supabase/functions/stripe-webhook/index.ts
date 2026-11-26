// POST (Stripe uniquement, sans JWT : verify_jwt = false dans config.jsonc) :
// webhook Stripe. Corps brut vérifié par la signature (STRIPE_WEBHOOK_SECRET)
// → 400 sinon ; puis apply_stripe_event (service_role) enregistre
// l'événement et applique l'action dans la même transaction (déjà reçu →
// 200 sans effet) ; 200. Action en échec → rien d'enregistré, 500 : Stripe le
// renverra.
// Événements à cocher dans Stripe : payment_intent.succeeded,
// payment_intent.payment_failed, invoice.paid, customer.subscription.updated,
// customer.subscription.deleted, charge.refunded.
// Ne journalise ni le secret, ni la signature, ni le corps de l'événement.
import { json, serviceClient } from '../_shared/http.ts';
import { handleStripeWebhook } from '../_shared/stripeWebhook.ts';

Deno.serve(async (req) => {
  const db = serviceClient();
  try {
    const res = await handleStripeWebhook(req, {
      secret: Deno.env.get('STRIPE_WEBHOOK_SECRET') || undefined,
      nowSec: () => Math.floor(Date.now() / 1000),
      async apply(id, type, fn, args) {
        const { data, error } = await db.rpc('apply_stripe_event', { p_id: id, p_type: type, p_fn: fn, p_args: args });
        if (error) throw new Error(`apply_stripe_event(${fn}): ${error.code ?? ''} ${error.message}`);
        return String(data);
      },
    });
    return json(res.status, res.body);
  } catch (e) {
    console.error('stripe-webhook failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'stripe-webhook failed' });
  }
});
