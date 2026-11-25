// Logique pure (sans I/O) de delete-account. Testée avec Deno (account.test.ts).

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
