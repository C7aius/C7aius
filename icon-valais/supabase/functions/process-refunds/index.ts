// POST (service role uniquement, appelée toutes les 5 minutes par pg_cron via
// pg_net, invoke_process_refunds) : annule immédiatement les abonnements dont
// la première facture avait un mauvais montant (subscriptions_to_cancel →
// DELETE /v1/subscriptions/<id> → mark_subscription_cancelled), puis
// rembourse les paiements refund_pending (refunds_to_process(20) → POST
// /v1/refunds, Idempotency-Key refund-<payment_id> → mark_refunded). Une
// erreur Stripe laisse la ligne pour le passage suivant. Logique dans
// _shared/payments.ts. Ne journalise jamais de clé.
import { corsHeaders, json, serviceClient } from '../_shared/http.ts';
import { handleProcessRefunds, type RefundRow, type SubscriptionToCancel } from '../_shared/payments.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = serviceClient();
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`${what}: ${e.message}`);
  };
  try {
    const res = await handleProcessRefunds(req, {
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      secretKey: Deno.env.get('STRIPE_SECRET_KEY') || undefined,
      fetch,
      async refundsToProcess(limit) {
        const { data, error } = await db.rpc('refunds_to_process', { p_limit: limit });
        fail('refunds_to_process', error);
        return ((data ?? []) as RefundRow[]).map((r) => ({ id: r.id, stripe_payment_intent_id: r.stripe_payment_intent_id }));
      },
      async markRefunded(id) {
        const { error } = await db.rpc('mark_refunded', { p_payment: id });
        fail('mark_refunded', error);
      },
      async subscriptionsToCancel(limit) {
        const { data, error } = await db.rpc('subscriptions_to_cancel', { p_limit: limit });
        fail('subscriptions_to_cancel', error);
        return (data ?? []) as SubscriptionToCancel[];
      },
      async markSubscriptionCancelled(id) {
        const { error } = await db.rpc('mark_subscription_cancelled', { p_membership: id });
        fail('mark_subscription_cancelled', error);
      },
    });
    return json(res.status, res.body);
  } catch (e) {
    console.error('process-refunds failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'process-refunds failed' });
  }
});
