// POST (service role uniquement, appelée chaque minute par pg_cron via pg_net) :
// envoie les notifications en attente de notification_outbox par Expo Push.
// Jusqu'à 500 lignes par appel, paquets de 100 ; sent_at ou error renseigné ;
// jetons DeviceNotRegistered supprimés. Optionnel : EXPO_ACCESS_TOKEN (si la
// sécurité renforcée des notifications push est activée sur le projet Expo).
// Ne journalise ni ne renvoie jamais de jeton push ni de clé.
import { corsHeaders, json, serviceClient } from '../_shared/http.ts';
import { chunk, handleSendPush, type OutboxRow } from '../_shared/push.ts';

// Filtres .in() découpés : l'URL PostgREST reste courte (500 uuid ≈ 18 ko sinon).
const IN_BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const db = serviceClient();
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`${what}: ${e.message}`);
  };

  try {
    const res = await handleSendPush(req, {
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN') || undefined,
      async loadPending(limit) {
        const { data, error } = await db
          .from('notification_outbox')
          .select('id, profile_id, kind, course_id, payload')
          .is('sent_at', null)
          .is('error', null)
          .order('created_at', { ascending: true })
          .limit(limit);
        fail('outbox lookup failed', error);
        return (data ?? []) as OutboxRow[];
      },
      async loadTokens(profileIds) {
        const out: { token: string; profile_id: string }[] = [];
        for (const ids of chunk(profileIds, IN_BATCH)) {
          const { data, error } = await db.from('push_tokens').select('token, profile_id').in('profile_id', ids);
          fail('token lookup failed', error);
          out.push(...(data ?? []));
        }
        return out;
      },
      async loadLangs(profileIds) {
        const out: { id: string; language: string | null }[] = [];
        for (const ids of chunk(profileIds, IN_BATCH)) {
          const { data, error } = await db.from('profiles').select('id, language').in('id', ids);
          fail('profile lookup failed', error);
          out.push(...(data ?? []));
        }
        return out;
      },
      async markSent(ids) {
        const { error } = await db.from('notification_outbox').update({ sent_at: new Date().toISOString() }).in('id', ids);
        fail('could not mark sent', error);
      },
      async markError(ids, message) {
        const { error } = await db.from('notification_outbox').update({ error: message }).in('id', ids);
        fail('could not mark error', error);
      },
      async deleteTokens(tokens) {
        for (const part of chunk(tokens, IN_BATCH)) {
          const { error } = await db.from('push_tokens').delete().in('token', part);
          fail('could not delete tokens', error);
        }
      },
      fetch,
    });
    return json(res.status, res.body);
  } catch (e) {
    console.error('send-push failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'send-push failed' });
  }
});
