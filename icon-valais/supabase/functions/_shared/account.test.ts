import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { cancelLiveSubscriptions, decideDelete, type DeleteAccountDeps, handleDeleteAccount, purgeProofFolders, type ProofBucket } from './account.ts';

Deno.test('decideDelete: le dernier admin ne peut pas supprimer son compte (409)', () => {
  assertEquals(decideDelete('admin', 0), { ok: false, status: 409, error: 'last_admin' });
});

Deno.test('decideDelete: admin avec un autre admin, élève, prof, sans profil → autorisé', () => {
  assertEquals(decideDelete('admin', 1), { ok: true });
  assertEquals(decideDelete('eleve', 0), { ok: true });
  assertEquals(decideDelete('prof', 0), { ok: true });
  assertEquals(decideDelete(null, 0), { ok: true });
});

function fakeBucket(files: string[], failRemove = false): ProofBucket & { files: string[] } {
  const state = { files: [...files] };
  return {
    get files() { return state.files; },
    list: (prefix, { limit }) =>
      Promise.resolve({
        data: state.files.filter((f) => f.startsWith(prefix + '/')).slice(0, limit).map((f) => ({ name: f.slice(prefix.length + 1) })),
        error: null,
      }),
    remove: (paths) => {
      if (failRemove) return Promise.resolve({ error: { message: 'boom' } });
      state.files = state.files.filter((f) => !paths.includes(f));
      return Promise.resolve({ error: null });
    },
  };
}

Deno.test('purgeProofFolders: vide le dossier du profil et ceux de ses enfants, rien d\'autre', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `p1/f${i}.pdf`);
  const b = fakeBucket([...many, 'c1/a.jpg', 'other/x.png']);
  assertEquals(await purgeProofFolders(b, ['p1', 'c1']), 251);
  assertEquals(b.files, ['other/x.png']);
});

Deno.test('purgeProofFolders: échec de suppression → erreur (compte non supprimé)', async () => {
  const b = fakeBucket(['p1/a.pdf'], true);
  await assertRejects(() => purgeProofFolders(b, ['p1']), Error, 'remove p1');
});

// ---------------------------------------------------------------------------
// Abonnements Stripe annulés avant la suppression
// ---------------------------------------------------------------------------
type Call = { method: string; path: string; idem: string | null };

function fakeStripe(replies: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/v1\//, '');
    calls.push({ method, path, idem: new Headers(init?.headers).get('Idempotency-Key') });
    const r = replies[`${method} ${path}`] ?? { status: 500, body: { error: { type: 'api_error', message: 'boom' } } };
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status ?? 200 }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

const GONE = { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such subscription' } } };

Deno.test('cancelLiveSubscriptions: DELETE /v1/subscriptions/<id> avec Idempotency-Key ; déjà supprimé → fait', async () => {
  const { fetchFn, calls } = fakeStripe({ 'DELETE subscriptions/sub_a': { body: { id: 'sub_a', status: 'canceled' } }, 'DELETE subscriptions/sub_b': GONE });
  const n = await cancelLiveSubscriptions([{ id: 'm1', stripe_subscription_id: 'sub_a' }, { id: 'm2', stripe_subscription_id: 'sub_b' }], 'sk_test', fetchFn);
  assertEquals(n, 2);
  assertEquals(calls, [
    { method: 'DELETE', path: 'subscriptions/sub_a', idem: 'delete-account-m1' },
    { method: 'DELETE', path: 'subscriptions/sub_b', idem: 'delete-account-m2' },
  ]);
});

Deno.test('cancelLiveSubscriptions: autre erreur Stripe → rejet', async () => {
  const { fetchFn } = fakeStripe({});
  await assertRejects(() => cancelLiveSubscriptions([{ id: 'm1', stripe_subscription_id: 'sub_x' }], 'sk_test', fetchFn));
});

type DelLog = { steps: string[] };

function delDeps(over: Partial<DeleteAccountDeps>, log: DelLog, fetchFn: typeof fetch): DeleteAccountDeps {
  return {
    secretKey: 'sk_test',
    fetch: fetchFn,
    authenticate: () => Promise.resolve('auth-1'),
    profile: () => Promise.resolve({ id: 'p1', role: 'eleve' }),
    otherAdmins: () => Promise.resolve(0),
    children: () => Promise.resolve(['c1']),
    liveSubscriptions: (ids) => {
      log.steps.push(`subs:${ids.join(',')}`);
      return Promise.resolve([{ id: 'm1', stripe_subscription_id: 'sub_a' }]);
    },
    purgeProofs: (ids) => {
      log.steps.push(`purge:${ids.join(',')}`);
      return Promise.resolve();
    },
    deleteUser: (id) => {
      log.steps.push(`delete:${id}`);
      return Promise.resolve();
    },
    ...over,
  };
}

const delReq = () => new Request('http://localhost/delete-account', { method: 'POST', headers: { Authorization: 'Bearer jwt' } });

Deno.test('delete-account: abonnements annulés chez Stripe, puis justificatifs, puis utilisateur', async () => {
  const { fetchFn, calls } = fakeStripe({ 'DELETE subscriptions/sub_a': { body: { id: 'sub_a' } } });
  const log: DelLog = { steps: [] };
  const res = await handleDeleteAccount(delReq(), delDeps({}, log, fetchFn));
  assertEquals(res, { status: 200, body: { ok: true } });
  assertEquals(log.steps, ['subs:p1,c1', 'purge:p1,c1', 'delete:auth-1']);
  assertEquals(calls.map((c) => `${c.method} ${c.path}`), ['DELETE subscriptions/sub_a']);
});

Deno.test('delete-account: annulation Stripe en échec → 500, compte intact (ni purge ni suppression)', async () => {
  const { fetchFn } = fakeStripe({});
  const log: DelLog = { steps: [] };
  const res = await handleDeleteAccount(delReq(), delDeps({}, log, fetchFn));
  assertEquals(res, { status: 500, body: { error: 'could not cancel subscriptions' } });
  assertEquals(log.steps, ['subs:p1,c1']);
});

Deno.test('delete-account: abonnement vivant sans STRIPE_SECRET_KEY → 500, compte intact', async () => {
  const { fetchFn, calls } = fakeStripe({});
  const log: DelLog = { steps: [] };
  const res = await handleDeleteAccount(delReq(), delDeps({ secretKey: undefined }, log, fetchFn));
  assertEquals(res.status, 500);
  assertEquals(log.steps, ['subs:p1,c1']);
  assertEquals(calls.length, 0);
});

Deno.test('delete-account: sans abonnement → aucun appel Stripe (clé non requise) ; purge en échec → 500', async () => {
  const { fetchFn, calls } = fakeStripe({});
  const log: DelLog = { steps: [] };
  const none = { liveSubscriptions: () => Promise.resolve([]), secretKey: undefined };
  assertEquals((await handleDeleteAccount(delReq(), delDeps(none, log, fetchFn))).status, 200);
  assertEquals(calls.length, 0);
  const log2: DelLog = { steps: [] };
  const res = await handleDeleteAccount(delReq(), delDeps({ ...none, purgeProofs: () => Promise.reject(new Error('x')) }, log2, fetchFn));
  assertEquals(res, { status: 500, body: { error: 'could not delete files' } });
  assertEquals(log2.steps, []);
});

Deno.test('delete-account: sans jeton → 401 ; dernier admin → 409, rien annulé', async () => {
  const { fetchFn, calls } = fakeStripe({});
  const log: DelLog = { steps: [] };
  assertEquals((await handleDeleteAccount(delReq(), delDeps({ authenticate: () => Promise.resolve(null) }, log, fetchFn))).status, 401);
  const res = await handleDeleteAccount(delReq(), delDeps({ profile: () => Promise.resolve({ id: 'p1', role: 'admin' }) }, log, fetchFn));
  assertEquals(res, { status: 409, body: { error: 'last_admin' } });
  assertEquals(log.steps, []);
  assertEquals(calls.length, 0);
});
