// POST (utilisateur connecté) : supprime le compte de l'appelant. Supprimer
// l'utilisateur auth supprime en cascade son profil (auth_user_id ON DELETE
// CASCADE), ses profils enfants (parent_profile_id ON DELETE CASCADE) et leurs
// demandes de consentement. L'identité vient du jeton, jamais du corps.
// 409 { error: 'last_admin' } si l'appelant est le dernier administrateur.
import { decideDelete } from '../_shared/account.ts';
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

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('deleteUser failed', error.message);
    return json(500, { error: 'could not delete account' });
  }
  return json(200, { ok: true });
});
