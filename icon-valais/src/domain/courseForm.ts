import { z } from 'zod';

import type { Role } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `YYYY-MM-DD` qui existe réellement au calendrier (pas de 31 février). */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Dernière date de répétition autorisée (reflète create_course) :
 * prof → 31.12 de l'année de `today` ; admin → `localDate` + 5 ans (29.02 → 28.02 si l'année n'est pas bissextile).
 */
export function maxRepeatUntil(role: Role, localDate: string, today: string): string {
  if (role === 'admin') {
    const [y, m, d] = localDate.split('-').map(Number);
    const ny = y + 5;
    const lastDay = new Date(Date.UTC(ny, m, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${ny}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
  }
  return `${today.slice(0, 4)}-12-31`;
}

const key = (k: string) => `courses.form.err.${k}`;

export const courseFormSchema = z
  .object({
    sport: z.enum(['jjb', 'grappling', 'mma']),
    level: z.enum(['adulte', 'enfant']),
    kind: z.enum(['normal', 'competition']),
    isPrivate: z.boolean(),
    locationId: z.string().min(1, key('location')),
    localDate: z.string().refine(isValidDate, key('date')),
    startTime: z.string().regex(TIME_RE, key('time')),
    endTime: z.string().regex(TIME_RE, key('time')),
    profId: z.string().min(1).optional(),
    places: z.number(key('places')).int(key('places')).min(1, key('places')).max(100, key('places')),
    priceMember: z.number(key('price')).min(0, key('price')).max(9999, key('price')),
    priceNonMember: z.number(key('price')).min(0, key('price')).max(9999, key('price')),
    recurring: z.boolean(),
    repeatUntil: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (TIME_RE.test(v.startTime) && TIME_RE.test(v.endTime) && v.endTime <= v.startTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: key('endBeforeStart') });
    }
    if (v.recurring) {
      if (!v.repeatUntil) {
        ctx.addIssue({ code: 'custom', path: ['repeatUntil'], message: key('repeatRequired') });
      } else if (!isValidDate(v.repeatUntil)) {
        ctx.addIssue({ code: 'custom', path: ['repeatUntil'], message: key('date') });
      } else if (isValidDate(v.localDate) && v.repeatUntil < v.localDate) {
        ctx.addIssue({ code: 'custom', path: ['repeatUntil'], message: key('repeatBeforeStart') });
      }
    }
  });

export type CourseFormValues = z.infer<typeof courseFormSchema>;

/** Valide le formulaire, y compris le plafond de répétition qui dépend du rôle et de la date du jour (Zurich). */
export function validateCourseForm(
  v: CourseFormValues,
  role: Role,
  today: string,
): { values: CourseFormValues } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const r = courseFormSchema.safeParse(v);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (!errors[field]) errors[field] = issue.message;
    }
  }
  // prof : la répétition s'arrête au 31.12 de l'année en cours ; un cours d'une année suivante ne peut donc pas être récurrent
  if (
    role !== 'admin' && v.recurring && isValidDate(v.localDate) &&
    maxRepeatUntil(role, v.localDate, today) < v.localDate
  ) {
    errors.repeatUntil = key('profYearOnly');
  }
  if (
    v.recurring && v.repeatUntil && isValidDate(v.repeatUntil) && isValidDate(v.localDate) &&
    !errors.repeatUntil && v.repeatUntil > maxRepeatUntil(role, v.localDate, today)
  ) {
    errors.repeatUntil = key('repeatTooFar');
  }
  return Object.keys(errors).length ? { errors } : { values: v };
}

/** Clés snake_case attendues par create_course. */
export function toCreateCoursePayload(v: CourseFormValues): { p: Record<string, unknown>; p_repeat_until: string | null } {
  const p: Record<string, unknown> = {
    sport: v.sport,
    level: v.level,
    kind: v.kind,
    is_private: v.isPrivate,
    location_id: v.locationId,
    local_date: v.localDate,
    start_time: v.startTime,
    end_time: v.endTime,
    places: v.places,
    price_member: v.priceMember,
    price_non_member: v.priceNonMember,
  };
  if (v.profId) p.prof_id = v.profId;
  return { p, p_repeat_until: v.recurring && v.repeatUntil ? v.repeatUntil : null };
}

/**
 * Clés attendues par update_course (date, privé, prof et récurrence ne sont pas modifiables).
 * `location_id` n'est envoyé que s'il change par rapport à `currentLocationId` : le lieu actuel
 * peut avoir été archivé depuis (update_course refuse un lieu archivé).
 */
export function toUpdateCoursePayload(v: CourseFormValues, currentLocationId?: string): Record<string, unknown> {
  const p: Record<string, unknown> = {
    sport: v.sport,
    level: v.level,
    kind: v.kind,
    start_time: v.startTime,
    end_time: v.endTime,
    places: v.places,
    price_member: v.priceMember,
    price_non_member: v.priceNonMember,
  };
  if (v.locationId !== currentLocationId) p.location_id = v.locationId;
  return p;
}

export type LocationFormValues = { name: string; address: string; mapsUrl: string };

export function validateLocation(v: LocationFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = v.name.trim();
  if (!name) errors.name = 'errors.required';
  else if (Array.from(name).length > 60) errors.name = 'courses.form.err.nameTooLong';
  if (Array.from(v.address).length > 200) errors.address = 'courses.form.err.addressTooLong';
  const url = v.mapsUrl.trim();
  if (url && !url.startsWith('https://')) errors.mapsUrl = 'courses.form.err.mapsUrl';
  return errors;
}
