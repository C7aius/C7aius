import { needsParentConsent, registrationSchema, type RegistrationInput } from '@/src/domain/registration';
import { beltOptions } from '@/src/domain/belts';
import type { Belt, Sport } from '@/src/domain/types';
import type { Lang } from '@/src/i18n';

export type Draft = {
  role: 'eleve' | 'prof';
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  age: string;
  sports: Sport[];
  bjjBelt: Belt | '';
  yearsGrappling: string;
  yearsMma: string;
  parentEmail: string;
  coachYears: string;
  trainingPlaces: string;
  competitionAwards: string;
  cv: string;
};

export const emptyDraft: Draft = {
  role: 'eleve',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  phone: '',
  age: '',
  sports: [],
  bjjBelt: '',
  yearsGrappling: '',
  yearsMma: '',
  parentEmail: '',
  coachYears: '',
  trainingPlaces: '',
  competitionAwards: '',
  cv: '',
};

export type StepId = 'role' | 'identity' | 'sports' | 'coach' | 'parent';

export const STEP_FIELDS: Record<StepId, string[]> = {
  role: ['role'],
  identity: ['firstName', 'lastName', 'email', 'password', 'phone', 'age'],
  sports: ['sports', 'bjjBelt', 'yearsGrappling', 'yearsMma'],
  coach: ['coachYears', 'trainingPlaces', 'competitionAwards', 'cv'],
  parent: ['parentEmail'],
};

/** Âge saisi, ou undefined tant que ce n'est pas un nombre. */
export function parseAge(age: string): number | undefined {
  const n = age.trim() === '' ? NaN : Number(age);
  return Number.isNaN(n) ? undefined : n;
}

export function stepsFor(d: Draft): StepId[] {
  const age = parseAge(d.age);
  return [
    'role',
    'identity',
    'sports',
    ...(d.role === 'prof' ? (['coach'] as const) : []),
    ...(age !== undefined && needsParentConsent(age, false) ? (['parent'] as const) : []),
  ];
}

/** Ceinture conservée seulement si elle est encore proposée pour l'âge saisi. */
export function validBelt(belt: Belt | '', age: string): Belt | '' {
  const n = parseAge(age);
  return belt !== '' && n !== undefined && beltOptions(n).includes(belt) ? belt : '';
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
const text = (s: string) => (s.trim() === '' ? undefined : s.trim());

/** Brouillon (chaînes) → entrée du schéma ; ne garde que ce qui concerne les choix faits. */
export function toCandidate(d: Draft): Record<string, unknown> {
  const age = parseAge(d.age);
  const jjb = d.sports.includes('jjb');
  const prof = d.role === 'prof';
  return {
    role: d.role,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email.trim(),
    password: d.password,
    phone: text(d.phone),
    age,
    sports: d.sports,
    bjjBelt: jjb && d.bjjBelt ? d.bjjBelt : undefined,
    yearsGrappling: d.sports.includes('grappling') ? num(d.yearsGrappling) : undefined,
    yearsMma: d.sports.includes('mma') ? num(d.yearsMma) : undefined,
    parentEmail: age !== undefined && needsParentConsent(age, false) ? text(d.parentEmail) : undefined,
    coachYears: prof ? num(d.coachYears) : undefined,
    trainingPlaces: prof ? text(d.trainingPlaces) : undefined,
    competitionAwards: prof ? text(d.competitionAwards) : undefined,
    cv: prof ? text(d.cv) : undefined,
  };
}

/** Erreurs (clé i18n) par champ, limitées aux champs de l'étape. */
export function stepErrors(d: Draft, step: StepId): Record<string, string> {
  const errors: Record<string, string> = {};
  const res = registrationSchema.safeParse(toCandidate(d));
  if (!res.success) {
    for (const issue of res.error.issues) {
      const key = String(issue.path[0]);
      if (STEP_FIELDS[step].includes(key) && !errors[key]) errors[key] = issue.message;
    }
  }
  if (step === 'identity' && !errors.password && d.password !== d.confirmPassword) {
    errors.confirmPassword = 'errors.passwordMismatch';
  }
  return errors;
}

/** Métadonnées lues par le trigger handle_new_user (clés snake_case). */
export function toSignUpMetadata(input: RegistrationInput, language: Lang): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    first_name: input.firstName,
    last_name: input.lastName,
    age: input.age,
    sports: input.sports,
    bjj_belt: input.bjjBelt,
    years_grappling: input.yearsGrappling,
    years_mma: input.yearsMma,
    coach_years: input.coachYears,
    training_places: input.trainingPlaces,
    competition_awards: input.competitionAwards,
    cv: input.cv,
    phone: input.phone,
    parent_email: input.parentEmail,
    role: input.role,
    language,
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
}

export function signUpErrorKey(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already registered')) return 'errors.emailTaken';
  if (m.includes('database error')) return 'errors.signupFailed';
  if (m.includes('fetch') || m.includes('network')) return 'errors.network';
  return 'errors.generic';
}
