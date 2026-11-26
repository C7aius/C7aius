// POST (Stripe uniquement, sans JWT : verify_jwt = false dans config.jsonc) :
// webhook Stripe. Corps brut vérifié par la signature (STRIPE_WEBHOOK_SECRET)
// → 400 sinon ; événement enregistré dans stripe_events (déjà reçu → 200 sans
// effet) ; fonction SQL de l'action appelée (service_role) ; 200. Action en
// échec → événement oublié et 500 : Stripe le renverra.
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
      async recordEvent(id, type) {
        const { error } = await db.from('stripe_events').insert({ id, type });
        if (!error) return true;
        if (error.code === '23505') return false; // déjà reçu
        throw new Error(`could not record event: ${error.code ?? ''} ${error.message}`);
      },
      async forgetEvent(id) {
        const { error } = await db.from('stripe_events').delete().eq('id', id);
        if (error) throw new Error(`could not forget event: ${error.message}`);
      },
      async call(fn, args) {
        const { data, error } = await db.rpc(fn, args);
        if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`);
        return data;
      },
    });
    return json(res.status, res.body);
  } catch (e) {
    console.error('stripe-webhook failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'stripe-webhook failed' });
  }
});
