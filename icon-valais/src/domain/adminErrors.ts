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
    case 'slot_taken':
      return 'errors.slotTaken';
    case 'course_closed':
      return 'errors.courseClosed';
    case 'too_early':
      return 'errors.tooEarly';
    case 'repeat_too_far':
      return 'errors.repeatTooFar';
    case 'course_started':
      return 'errors.courseStarted';
    case 'course_cancelled':
      return 'errors.courseCancelled';
    case 'date_in_past':
      return 'errors.dateInPast';
    case 'inactive_profile':
      return 'errors.inactiveProfile';
    case 'not_booked':
      return 'errors.notBooked';
    case 'invalid_field':
      return 'errors.invalidField';
    case 'location_archived':
      return 'errors.locationArchived';
    case 'no_default_location':
      return 'errors.noDefaultLocation';
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
