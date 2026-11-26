// POST (utilisateur connecté) : supprime le compte de l'appelant. Supprimer
// l'utilisateur auth supprime en cascade son profil (auth_user_id ON DELETE
// CASCADE), ses profils enfants (parent_profile_id ON DELETE CASCADE) et leurs
// demandes de consentement. L'identité vient du jeton, jamais du corps.
// Les justificatifs étudiants (bucket student-proofs, dossiers <profile_id>/ du
// profil et de ses enfants) sont supprimés AVANT l'utilisateur : ils sont
// retrouvés par les profils, qui disparaissent en cascade. Si la purge échoue
// → 500 et le compte reste intact (réessayable) ; supprimer l'utilisateur
// d'abord laisserait des fichiers orphelins irrécupérables.
// 409 { error: 'last_admin' } si l'appelant est le dernier administrateur.
import { decideDelete, purgeProofFolders } from '../_shared/account.ts';
import { authenticate, corsHeaders, json, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const user = await authenticate(req);
  if (!user) return json(401, { error: 'unauthorized' });

  const db = serviceClient();
  const { data: me, error: pErr } = await db.from('profiles').select('id, role').eq('auth_user_id', user.id).maybeSingle();
  if (pErr) return json(500, { error: 'profile lookup failed' });
  let otherAdmins = 0;
  if (me?.role === 'admin') {
    const { count, error: cErr } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .neq('id', me.id);
    if (cErr) return json(500, { error: 'admin lookup failed' });
    otherAdmins = count ?? 0;
  }
  const decision = decideDelete(me?.role, otherAdmins);
  if (!decision.ok) return json(decision.status, { error: decision.error });

  if (me) {
    const { data: kids, error: kErr } = await db.from('profiles').select('id').eq('parent_profile_id', me.id);
    if (kErr) return json(500, { error: 'children lookup failed' });
    try {
      await purgeProofFolders(db.storage.from('student-proofs'), [me.id, ...(kids ?? []).map((k) => k.id as string)]);
    } catch (e) {
      console.error('proof purge failed', (e as Error).message);
      return json(500, { error: 'could not delete files' });
    }
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('deleteUser failed', error.message);
    return json(500, { error: 'could not delete account' });
  }
  return json(200, { ok: true });
});
