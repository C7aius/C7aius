// Logique de delete-account (I/O injectées). Testée avec Deno (account.test.ts).
import { StripeError, stripeRequest } from './stripe.ts';

export type DeleteDecision = { ok: true } | { ok: false; status: 409; error: 'last_admin' };

/**
 * Le dernier administrateur ne peut pas supprimer son compte : le club se
 * retrouverait sans personne pour valider les profs ou promouvoir un admin.
 * `otherAdmins` : nombre d'admins autres que l'appelant.
 */
export function decideDelete(callerRole: string | null | undefined, otherAdmins: number): DeleteDecision {
  if (callerRole === 'admin' && otherAdmins < 1) return { ok: false, status: 409, error: 'last_admin' };
  return { ok: true };
}

/** Sous-ensemble de supabase.storage.from(bucket) utilisé pour la purge. */
export interface ProofBucket {
  list(prefix: string, opts: { limit: number; offset: number }): Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

/**
 * Supprime tous les fichiers des dossiers `<profile_id>/` du bucket
 * student-proofs. Lève une erreur au premier échec : l'appelant n'a alors pas
 * encore supprimé le compte (les dossiers sont retrouvés par les profils, qui
 * disparaissent en cascade avec l'utilisateur), donc on peut réessayer.
 */
export async function purgeProofFolders(bucket: ProofBucket, profileIds: string[]): Promise<number> {
  const PAGE = 100;
  let removed = 0;
  for (const id of profileIds) {
    // La suppression décale la liste : on relit toujours depuis le début.
    for (;;) {
      const { data, error } = await bucket.list(id, { limit: PAGE, offset: 0 });
      if (error) throw new Error(`list ${id}: ${error.message}`);
      const names = (data ?? []).map((o) => o.name);
      if (names.length === 0) break;
      const { error: rErr } = await bucket.remove(names.map((n) => `${id}/${n}`));
      if (rErr) throw new Error(`remove ${id}: ${rErr.message}`);
      removed += names.length;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Abonnements Stripe à annuler avant la suppression du compte
// ---------------------------------------------------------------------------

/** Adhésion non terminée liée à un abonnement Stripe (appelant ou ses enfants). */
export type LiveSubscription = { id: string; stripe_subscription_id: string };

/**
 * Annule immédiatement chez Stripe (DELETE /v1/subscriptions/<id>,
 * Idempotency-Key delete-account-<membership_id>) chaque abonnement : sinon
 * Stripe continuerait de facturer un compte supprimé. Déjà supprimé
 * (resource_missing) → fait. Toute autre erreur est levée : le compte n'est
 * alors pas supprimé (réessayable).
 */
export async function cancelLiveSubscriptions(
  subs: LiveSubscription[],
  secretKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  let n = 0;
  for (const s of subs) {
    try {
      await stripeRequest(`subscriptions/${encodeURIComponent(s.stripe_subscription_id)}`, {}, secretKey, fetchFn,
        `delete-account-${s.id}`, 'DELETE');
    } catch (e) {
      if (!(e instanceof StripeError && e.code === 'resource_missing')) throw e;
    }
    n++;
  }
  return n;
}

export type DeleteAccountDeps = {
  secretKey: string | undefined; // STRIPE_SECRET_KEY
  fetch: typeof fetch;
  // utilisateur auth du jeton Bearer, ou null
  authenticate(req: Request): Promise<string | null>;
  profile(authUserId: string): Promise<{ id: string; role: string } | null>;
  otherAdmins(profileId: string): Promise<number>;
  children(profileId: string): Promise<string[]>;
  // adhésions non terminées avec abonnement Stripe, des profils donnés (ou payées par le premier)
  liveSubscriptions(profileIds: string[]): Promise<LiveSubscription[]>;
  purgeProofs(profileIds: string[]): Promise<void>;
  deleteUser(authUserId: string): Promise<void>;
};

export type DeleteAccountResult = { status: number; body: Record<string, unknown> };

/**
 * delete-account : 401 sans jeton ; 409 last_admin ; abonnements Stripe
 * annulés, puis justificatifs purgés, puis utilisateur supprimé (cascade :
 * profil, enfants, adhésions). Toute étape en échec → 500 et le compte reste
 * intact (on peut réessayer : les annulations déjà faites sont sans effet).
 */
export async function handleDeleteAccount(req: Request, deps: DeleteAccountDeps): Promise<DeleteAccountResult> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const user = await deps.authenticate(req);
  if (!user) return { status: 401, body: { error: 'unauthorized' } };

  let me: { id: string; role: string } | null;
  try {
    me = await deps.profile(user);
  } catch {
    return { status: 500, body: { error: 'profile lookup failed' } };
  }
  let otherAdmins = 0;
  if (me?.role === 'admin') {
    try {
      otherAdmins = await deps.otherAdmins(me.id);
    } catch {
      return { status: 500, body: { error: 'admin lookup failed' } };
    }
  }
  const decision = decideDelete(me?.role, otherAdmins);
  if (!decision.ok) return { status: decision.status, body: { error: decision.error } };

  if (me) {
    let ids: string[];
    try {
      ids = [me.id, ...(await deps.children(me.id))];
    } catch {
      return { status: 500, body: { error: 'children lookup failed' } };
    }
    try {
      const subs = await deps.liveSubscriptions(ids);
      if (subs.length > 0) {
        if (!deps.secretKey) {
          console.error('delete-account: STRIPE_SECRET_KEY is not set, cannot cancel subscriptions');
          return { status: 500, body: { error: 'could not cancel subscriptions' } };
        }
        await cancelLiveSubscriptions(subs, deps.secretKey, deps.fetch);
      }
    } catch (e) {
      console.error('subscription cancel failed', e instanceof StripeError ? `${e.status} ${e.code ?? '-'}` : 'unknown');
      return { status: 500, body: { error: 'could not cancel subscriptions' } };
    }
    try {
      await deps.purgeProofs(ids);
    } catch (e) {
      console.error('proof purge failed', (e as Error).message);
      return { status: 500, body: { error: 'could not delete files' } };
    }
  }

  try {
    await deps.deleteUser(user);
  } catch (e) {
    console.error('deleteUser failed', (e as Error).message);
    return { status: 500, body: { error: 'could not delete account' } };
  }
  return { status: 200, body: { ok: true } };
}
