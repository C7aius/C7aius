import type { Profile } from '@/src/auth/AuthProvider';
import type { Sport } from './types';

export type ProfileFormValues = {
  phone: string;
  age: string;
  sports: Sport[];
  yearsGrappling: string;
  yearsMma: string;
  coachYears: string;
  trainingPlaces: string;
  competitionAwards: string;
  cv: string;
};

export type ProfilePatch = Partial<
  Pick<
    Profile,
    | 'phone' | 'age' | 'sports' | 'years_grappling' | 'years_mma'
    | 'coach_years' | 'training_places' | 'competition_awards' | 'cv'
  >
>;

export function valuesFromProfile(p: Profile): ProfileFormValues {
  const s = (n: number | null) => (n === null ? '' : String(n));
  return {
    phone: p.phone ?? '',
    age: String(p.age),
    sports: p.sports,
    yearsGrappling: s(p.years_grappling),
    yearsMma: s(p.years_mma),
    coachYears: s(p.coach_years),
    trainingPlaces: p.training_places ?? '',
    competitionAwards: p.competition_awards ?? '',
    cv: p.cv ?? '',
  };
}

const intIn = (raw: string, min: number, max = Infinity): number | undefined => {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** Valide le formulaire ; retourne soit les erreurs (clés i18n), soit le patch à envoyer. */
export function buildProfilePatch(
  v: ProfileFormValues,
  role: Profile['role'],
): { errors: Record<string, string> } | { patch: ProfilePatch } {
  const errors: Record<string, string> = {};
  const age = intIn(v.age, 0, 100);
  if (age === undefined) errors.age = 'errors.ageRange';
  if (v.sports.length === 0) errors.sports = 'errors.sportRequired';

  const years = (field: string, raw: string, needed: boolean): number | null => {
    if (!needed) return null;
    const n = intIn(raw, 0);
    if (n === undefined) errors[field] = raw.trim() === '' ? 'errors.yearsRequired' : 'errors.yearsInvalid';
    return n ?? null;
  };
  const yg = years('yearsGrappling', v.yearsGrappling, v.sports.includes('grappling'));
  const ym = years('yearsMma', v.yearsMma, v.sports.includes('mma'));

  const patch: ProfilePatch = {
    phone: v.phone.trim() === '' ? null : v.phone.trim(),
    age,
    sports: v.sports,
    years_grappling: yg,
    years_mma: ym,
  };
  if (role === 'prof') {
    const cy = intIn(v.coachYears, 0);
    if (cy === undefined) errors.coachYears = 'errors.coachYearsRequired';
    patch.coach_years = cy ?? null;
    patch.training_places = v.trainingPlaces.trim() || null;
    patch.competition_awards = v.competitionAwards.trim() || null;
    patch.cv = v.cv.trim() || null;
  }
  return Object.keys(errors).length ? { errors } : { patch };
}

/** Traduit une erreur Postgres/PostgREST en clé i18n. */
export function profileErrorKey(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case '23514':
      return 'errors.kidBeltAdult';
    case '42501':
      return 'errors.consentRequiredForAge';
    default:
      return 'errors.generic';
  }
}
