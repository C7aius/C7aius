// POST (utilisateur connecté) { membershipId } : résilie l'abonnement Stripe à
// l'échéance (cancel_at_period_end=true), puis set_membership_cancel. Payeur
// ou bénéficiaire seulement (vérifié avant l'appel Stripe). Logique dans
// _shared/payments.ts. STRIPE_SECRET_KEY jamais journalisée.
import { authenticate, corsHeaders, json, serviceClient } from '../_shared/http.ts';
import { handleCancelSubscription, type MembershipForCancel } from '../_shared/payments.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = serviceClient();
  try {
    const res = await handleCancelSubscription(req, {
      secretKey: Deno.env.get('STRIPE_SECRET_KEY') || undefined,
      fetch,
      async authenticate(r) {
        return (await authenticate(r))?.id ?? null;
      },
      async profileId(authUserId) {
        const { data, error } = await db.from('profiles').select('id').eq('auth_user_id', authUserId).maybeSingle();
        if (error) throw new Error(`profile lookup: ${error.message}`);
        return data?.id ?? null;
      },
      async loadMembership(id) {
        const { data, error } = await db
          .from('memberships')
          .select('id, profile_id, paid_by, source, status, stripe_subscription_id, ends_on')
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(`membership lookup: ${error.message}`);
        return (data as MembershipForCancel | null) ?? null;
      },
      async setCancel(subscription, flag) {
        const { error } = await db.rpc('set_membership_cancel', { p_subscription: subscription, p_cancel_at_period_end: flag });
        if (error) throw new Error(`set_membership_cancel: ${error.message}`);
      },
    });
    return json(res.status, res.body);
  } catch (e) {
    console.error('cancel-subscription failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'cancel-subscription failed' });
  }
});
