/** Traduit une erreur RPC (administration, ceintures) en clé i18n. */
export function rpcErrorKey(error: { code?: string; hint?: string | null } | null | undefined): string {
  // HINT stables posés par la base (migration 0004)
  switch (error?.hint) {
    case 'last_admin':
      return 'errors.lastAdmin';
    case 'child_profile_role':
      return 'errors.childProfileRole';
    case 'child_must_be_minor':
      return 'errors.childMustBeMinor';
  }
  switch (error?.code) {
    case '42501':
      return 'errors.notAllowed';
    case '23514':
      return 'errors.beltAge';
    case 'P0002':
      return 'errors.notFound';
    default:
      return 'errors.generic';
  }
}

/** '2026-12-31' -> '31.12.2026' */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
