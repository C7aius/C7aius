import { assertEquals } from 'jsr:@std/assert@1';
import { decideDelete } from './account.ts';

Deno.test('decideDelete: le dernier admin ne peut pas supprimer son compte (409)', () => {
  assertEquals(decideDelete('admin', 0), { ok: false, status: 409, error: 'last_admin' });
});

Deno.test('decideDelete: admin avec un autre admin, élève, prof, sans profil → autorisé', () => {
  assertEquals(decideDelete('admin', 1), { ok: true });
  assertEquals(decideDelete('eleve', 0), { ok: true });
  assertEquals(decideDelete('prof', 0), { ok: true });
  assertEquals(decideDelete(null, 0), { ok: true });
});
