import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { decideDelete, purgeProofFolders, type ProofBucket } from './account.ts';

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
