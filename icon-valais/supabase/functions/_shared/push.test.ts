import { assert, assertEquals, assertFalse, assertNotEquals } from 'jsr:@std/assert@1';
import {
  buildPushMessages,
  chunk,
  handleSendPush,
  isServiceRoleRequest,
  pushText,
  summarizeTickets,
  type ExpoMessage,
  type ExpoTicket,
  type Lang,
  type OutboxRow,
  type SendPushDeps,
} from './push.ts';

const row = (id: number, profile_id: string, kind: OutboxRow['kind'], course_id: string | null = 'c-1'): OutboxRow => ({
  id,
  profile_id,
  kind,
  course_id,
  payload: {},
});

const T1 = 'ExponentPushToken[one]';
const T2 = 'ExponentPushToken[two]';
const T3 = 'ExponentPushToken[three]';

Deno.test('buildPushMessages: un message par jeton, data.courseId', () => {
  const rows = [row(1, 'p-a', 'slot_vacant', 'course-42')];
  const tokens = new Map([['p-a', [T1, T2]]]);
  const msgs = buildPushMessages(rows, tokens, new Map());
  assertEquals(msgs.length, 2);
  assertEquals(msgs.map((m) => m.to), [T1, T2]);
  for (const m of msgs) assertEquals(m.data, { courseId: 'course-42' });
});

Deno.test('buildPushMessages: texte allemand pour un profil de', () => {
  const rows = [row(1, 'p-de', 'slot_vacant'), row(2, 'p-fr', 'slot_vacant')];
  const tokens = new Map([['p-de', [T1]], ['p-fr', [T2]]]);
  const langs = new Map<string, Lang>([['p-de', 'de'], ['p-fr', 'fr']]);
  const [de, fr] = buildPushMessages(rows, tokens, langs);
  assertEquals(de.title, pushText('de', 'slot_vacant').title);
  assertEquals(de.body, pushText('de', 'slot_vacant').body);
  assertEquals(fr.title, pushText('fr', 'slot_vacant').title);
  assertNotEquals(de.title, fr.title);
});

Deno.test('buildPushMessages: langue inconnue ou absente → français', () => {
  const rows = [row(1, 'p-x', 'prof_validated', null), row(2, 'p-y', 'course_cancelled')];
  const tokens = new Map([['p-x', [T1]], ['p-y', [T2]]]);
  const langs = new Map<string, Lang>([['p-x', 'xx' as Lang]]);
  const msgs = buildPushMessages(rows, tokens, langs);
  assertEquals(msgs[0].title, pushText('fr', 'prof_validated').title);
  assertEquals(msgs[0].data, { courseId: null });
  assertEquals(msgs[1].title, pushText('fr', 'course_cancelled').title);
});

Deno.test('buildPushMessages: profil sans jeton → aucun message', () => {
  const rows = [row(1, 'p-none', 'slot_vacant')];
  assertEquals(buildPushMessages(rows, new Map([['p-other', [T1]]]), new Map()), []);
  assertEquals(buildPushMessages(rows, new Map([['p-none', []]]), new Map()), []);
});

Deno.test('pushText: titre et texte non vides et distincts, 4 langues x 3 types', () => {
  const langs: Lang[] = ['fr', 'de', 'en', 'ru'];
  for (const kind of ['slot_vacant', 'prof_validated', 'course_cancelled'] as const) {
    const titles = langs.map((l) => pushText(l, kind).title);
    for (const l of langs) {
      const t = pushText(l, kind);
      assert(t.title.trim() && t.body.trim(), `${l}/${kind}`);
    }
    assertEquals(new Set(titles).size, 4, kind);
  }
});

Deno.test('chunk: 250 → 100/100/50 ; vide → []', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const parts = chunk(items, 100);
  assertEquals(parts.map((p) => p.length), [100, 100, 50]);
  assertEquals(parts.flat(), items);
  assertEquals(chunk([], 100), []);
});

Deno.test('summarizeTickets: envoyé si au moins un ticket ok ; erreur sinon ; en attente si paquet échoué', () => {
  // ligne 1 : T1 ok, T2 DeviceNotRegistered ; ligne 2 : T3 erreur ; ligne 3 : paquet échoué ; ligne 4 : sans jeton
  const owners = [1, 1, 2, 3];
  const tos = [T1, T2, T3, 'ExponentPushToken[four]'];
  const tickets: (ExpoTicket | null)[] = [
    { status: 'ok', id: 'r1' },
    { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
    null,
  ];
  const s = summarizeTickets([1, 2, 3, 4], owners, tos, tickets);
  assertEquals(s.sent, [1]);
  assertEquals(s.errors, [
    { id: 2, error: 'MessageTooBig' },
    { id: 4, error: 'no_push_token' },
  ]);
  assertEquals(s.deadTokens, [T2]);
});

Deno.test('summarizeTickets: tous les jetons DeviceNotRegistered → erreur DeviceNotRegistered', () => {
  const s = summarizeTickets([7], [7], [T1], [{ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }]);
  assertEquals(s.sent, []);
  assertEquals(s.errors, [{ id: 7, error: 'DeviceNotRegistered' }]);
  assertEquals(s.deadTokens, [T1]);
});

Deno.test('isServiceRoleRequest: uniquement Bearer <clé service>', () => {
  const key = 'service-key-123';
  assert(isServiceRoleRequest(`Bearer ${key}`, key));
  assert(isServiceRoleRequest(`bearer ${key}`, key));
  assertFalse(isServiceRoleRequest(null, key));
  assertFalse(isServiceRoleRequest('Bearer other-key-123', key));
  assertFalse(isServiceRoleRequest(`Bearer ${key}x`, key));
  assertFalse(isServiceRoleRequest(key, key));
  assertFalse(isServiceRoleRequest('Bearer ', ''));
  assertFalse(isServiceRoleRequest(`Bearer ${key}`, undefined));
});

// ---------------------------------------------------------------------------
// handleSendPush (I/O simulées)
// ---------------------------------------------------------------------------
const KEY = 'svc-key';

function fakeDeps(opts: {
  rows: OutboxRow[];
  tokens: { token: string; profile_id: string }[];
  langs?: { id: string; language: string | null }[];
  respond?: (batch: ExpoMessage[]) => Response;
}) {
  const log = {
    batches: [] as ExpoMessage[][],
    sent: [] as number[],
    errors: [] as [number[], string][],
    deleted: [] as string[],
    pendingLimit: 0,
    headers: [] as Headers[],
  };
  const deps: SendPushDeps = {
    serviceKey: KEY,
    loadPending: (limit) => {
      log.pendingLimit = limit;
      return Promise.resolve(opts.rows);
    },
    loadTokens: (ids) => Promise.resolve(opts.tokens.filter((t) => ids.includes(t.profile_id))),
    loadLangs: (ids) => Promise.resolve((opts.langs ?? []).filter((p) => ids.includes(p.id))),
    markSent: (ids) => {
      log.sent.push(...ids);
      return Promise.resolve();
    },
    markError: (ids, error) => {
      log.errors.push([ids, error]);
      return Promise.resolve();
    },
    deleteTokens: (tokens) => {
      log.deleted.push(...tokens);
      return Promise.resolve();
    },
    fetch: ((url: string, init: RequestInit) => {
      assertEquals(url, 'https://exp.host/--/api/v2/push/send');
      const batch = JSON.parse(String(init.body)) as ExpoMessage[];
      log.batches.push(batch);
      log.headers.push(new Headers(init.headers));
      const r = opts.respond?.(batch) ??
        new Response(JSON.stringify({ data: batch.map((_, i) => ({ status: 'ok', id: `t${i}` })) }), { status: 200 });
      return Promise.resolve(r);
    }) as typeof fetch,
  };
  return { deps, log };
}

const post = (auth?: string) =>
  new Request('http://x/send-push', { method: 'POST', headers: auth ? { Authorization: auth } : {} });

Deno.test('handleSendPush: refuse sans clé service, avec une autre clé, ou en GET', async () => {
  const { deps, log } = fakeDeps({ rows: [row(1, 'p', 'slot_vacant')], tokens: [] });
  assertEquals((await handleSendPush(post(), deps)).status, 401);
  assertEquals((await handleSendPush(post('Bearer user-jwt'), deps)).status, 401);
  assertEquals((await handleSendPush(new Request('http://x', { method: 'GET' }), deps)).status, 405);
  assertEquals(log.pendingLimit, 0, 'base non lue');
});

Deno.test('handleSendPush: paquets de 100, sent_at, erreurs, jetons DeviceNotRegistered supprimés', async () => {
  // 250 lignes pour p-a (1 jeton) ; ligne 900 pour p-dead ; ligne 901 pour p-none (sans jeton)
  const rows = Array.from({ length: 250 }, (_, i) => row(i + 1, 'p-a', 'slot_vacant'));
  rows.push(row(900, 'p-dead', 'prof_validated', null), row(901, 'p-none', 'slot_vacant'));
  const dead = 'ExponentPushToken[dead]';
  const { deps, log } = fakeDeps({
    rows,
    tokens: [{ token: T1, profile_id: 'p-a' }, { token: dead, profile_id: 'p-dead' }],
    langs: [{ id: 'p-dead', language: 'de' }],
    respond: (batch) =>
      new Response(
        JSON.stringify({
          data: batch.map((m) =>
            m.to === dead
              ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok', id: 'x' }
          ),
        }),
      ),
  });
  const res = await handleSendPush(post(`Bearer ${KEY}`), deps);
  assertEquals(res.status, 200);
  assertEquals(log.pendingLimit, 500);
  assertEquals(log.batches.map((b) => b.length), [100, 100, 51]);
  assertEquals(log.sent.length, 250);
  assertEquals(log.errors, [[[900], 'DeviceNotRegistered'], [[901], 'no_push_token']]);
  assertEquals(log.deleted, [dead]);
  const deMsg = log.batches.flat().find((m) => m.to === dead)!;
  assertEquals(deMsg.title, pushText('de', 'prof_validated').title);
  assertEquals(res.body, { processed: 252, sent: 250, failed: 2, pending: 0, removedTokens: 1 });
  assertFalse(JSON.stringify(res.body).includes('ExponentPushToken'), 'aucun jeton dans la réponse');
  assertFalse(log.headers[0].has('Authorization'), 'pas de jeton Expo configuré');
});

Deno.test('handleSendPush: Expo en échec → lignes laissées en attente', async () => {
  const { deps, log } = fakeDeps({
    rows: [row(1, 'p-a', 'slot_vacant')],
    tokens: [{ token: T1, profile_id: 'p-a' }],
    respond: () => new Response('boom', { status: 503 }),
  });
  const res = await handleSendPush(post(`Bearer ${KEY}`), deps);
  assertEquals(res.status, 200);
  assertEquals(log.sent, []);
  assertEquals(log.errors, []);
  assertEquals(res.body.pending, 1);
});

Deno.test('handleSendPush: aucune ligne → rien envoyé', async () => {
  const { deps, log } = fakeDeps({ rows: [], tokens: [] });
  const res = await handleSendPush(post(`Bearer ${KEY}`), deps);
  assertEquals(res.body.processed, 0);
  assertEquals(log.batches.length, 0);
});
