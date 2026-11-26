// POST (utilisateur connecté) : supprime le compte de l'appelant. Supprimer
// l'utilisateur auth supprime en cascade son profil (auth_user_id ON DELETE
// CASCADE), ses profils enfants (parent_profile_id ON DELETE CASCADE), leurs
// adhésions et leurs demandes de consentement. L'identité vient du jeton,
// jamais du corps.
// Avant l'utilisateur, dans cet ordre (logique dans _shared/account.ts) :
//  1. les abonnements Stripe encore vivants (adhésions non terminées avec
//     stripe_subscription_id, de l'appelant et de ses enfants, ou payées par
//     lui) sont annulés immédiatement (DELETE /v1/subscriptions/<id>) : sinon
//     Stripe continuerait de facturer ;
//  2. les justificatifs étudiants (bucket student-proofs, dossiers
//     <profile_id>/) sont supprimés : ils sont retrouvés par les profils, qui
//     disparaissent en cascade.
// Une étape en échec → 500 et le compte reste intact (réessayable).
// 409 { error: 'last_admin' } si l'appelant est le dernier administrateur.
import { handleDeleteAccount, purgeProofFolders } from '../_shared/account.ts';
import { authenticate, corsHeaders, json, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = serviceClient();
  const res = await handleDeleteAccount(req, {
    secretKey: Deno.env.get('STRIPE_SECRET_KEY') || undefined,
    fetch,
    async authenticate(r) {
      return (await authenticate(r))?.id ?? null;
    },
    async profile(authUserId) {
      const { data, error } = await db.from('profiles').select('id, role').eq('auth_user_id', authUserId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: string; role: string } | null) ?? null;
    },
    async otherAdmins(profileId) {
      const { count, error } = await db
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .neq('id', profileId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async children(profileId) {
      const { data, error } = await db.from('profiles').select('id').eq('parent_profile_id', profileId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((k) => k.id as string);
    },
    async liveSubscriptions(ids) {
      const { data, error } = await db
        .from('memberships')
        .select('id, stripe_subscription_id')
        .or(`profile_id.in.(${ids.join(',')}),paid_by.eq.${ids[0]}`)
        .neq('status', 'ended')
        .not('stripe_subscription_id', 'is', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; stripe_subscription_id: string }[];
    },
    async purgeProofs(ids) {
      await purgeProofFolders(db.storage.from('student-proofs'), ids);
    },
    async deleteUser(authUserId) {
      const { error } = await db.auth.admin.deleteUser(authUserId);
      if (error) throw new Error(error.message);
    },
  });
  return json(res.status, res.body);
});
