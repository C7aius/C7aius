// POST (utilisateur connecté) : supprime le compte de l'appelant. Supprimer
// l'utilisateur auth supprime en cascade son profil (auth_user_id ON DELETE
// CASCADE), ses profils enfants (parent_profile_id ON DELETE CASCADE) et leurs
// demandes de consentement. L'identité vient du jeton, jamais du corps.
import { authenticate, corsHeaders, json, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const user = await authenticate(req);
  if (!user) return json(401, { error: 'unauthorized' });

  const { error } = await serviceClient().auth.admin.deleteUser(user.id);
  if (error) {
    console.error('deleteUser failed', error.message);
    return json(500, { error: 'could not delete account' });
  }
  return json(200, { ok: true });
});
