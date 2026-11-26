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
