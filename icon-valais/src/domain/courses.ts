import i18n, { type Lang } from '@/src/i18n';
import type { Database } from '@/src/lib/database.types';

export const TZ = 'Europe/Zurich';

type CourseRowDb = Database['public']['Tables']['courses']['Row'];
type LocationDb = Database['public']['Tables']['locations']['Row'];

export type CourseRow = CourseRowDb & {
  location: Pick<LocationDb, 'id' | 'name' | 'address' | 'maps_url'>;
  prof: { first_name: string; last_name: string } | null;
  booked: number;
  /** ids des profils (soi et enfants) inscrits à ce cours */
  myBookings: string[];
  /** réservations en attente de paiement, par profil (id de réservation et fin de la retenue) */
  myPending: Record<string, { bookingId: string; until: string }>;
};

export type CourseLabel = 'annule' | 'open_mat' | 'vacant' | 'prevu';

export function courseLabelStatus(
  c: Pick<CourseRow, 'status' | 'prof_id' | 'starts_at'>,
  now: Date,
): CourseLabel {
  if (c.status === 'annule') return 'annule';
  if (c.prof_id === null) return new Date(c.starts_at).getTime() <= now.getTime() ? 'open_mat' : 'vacant';
  return 'prevu';
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; wd: number };

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Composantes de l'instant en heure de Zurich (wd : 0 = lundi). */
function zurichParts(date: Date): Parts {
  const get: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(date)) get[p.type] = p.value;
  return {
    y: Number(get.year),
    m: Number(get.month),
    d: Number(get.day),
    h: Number(get.hour),
    mi: Number(get.minute),
    wd: WD.indexOf(get.weekday),
  };
}

/** Instant UTC correspondant à une heure murale de Zurich. */
function zurichToUtc(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zurichParts(new Date(guess));
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += wall - seen;
  }
  return new Date(guess);
}

/** Lundi 00:00 → lundi suivant 00:00, heure de Zurich. */
export function weekRange(anchor: Date): { from: Date; to: Date } {
  const p = zurichParts(anchor);
  // Date.UTC normalise les débordements de jour
  const from = zurichToUtc(p.y, p.m, p.d - p.wd);
  const to = zurichToUtc(p.y, p.m, p.d - p.wd + 7);
  return { from, to };
}

const WEEKDAYS: Record<Lang, string[]> = {
  fr: ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'],
  de: ['Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.', 'So.'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ru: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
};
const pad = (n: number) => String(n).padStart(2, '0');

export function weekdayLabel(date: Date, lang: Lang): string {
  return WEEKDAYS[lang][zurichParts(date).wd];
}

/** Clé de jour (heure suisse) `YYYY-MM-DD`. */
export function zurichDayKey(iso: string): string {
  const p = zurichParts(new Date(iso));
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Date du jour `YYYY-MM-DD` en heure de Zurich. */
export function zurichToday(now: Date = new Date()): string {
  return zurichDayKey(now.toISOString());
}

/** Heure `HH:MM` (heure suisse). */
export function zurichTimeKey(iso: string): string {
  const p = zurichParts(new Date(iso));
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function formatDayHeading(iso: string, lang: Lang): string {
  const p = zurichParts(new Date(iso));
  return `${WEEKDAYS[lang][p.wd]} ${pad(p.d)}.${pad(p.m)}`;
}

export function formatCourseTime(startsAt: string, endsAt: string, lang: Lang): string {
  const s = zurichParts(new Date(startsAt));
  const e = zurichParts(new Date(endsAt));
  return `${WEEKDAYS[lang][s.wd]} ${pad(s.d)}.${pad(s.m)} · ${pad(s.h)}:${pad(s.mi)}–${pad(e.h)}:${pad(e.mi)}`;
}

export function formatWeekLabel(from: Date, to: Date): string {
  const a = zurichParts(from);
  const b = zurichParts(new Date(to.getTime() - 1));
  return `${pad(a.d)}.${pad(a.m)} – ${pad(b.d)}.${pad(b.m)}.${b.y}`;
}

export function formatChf(amount: number): string {
  return amount === 0 ? i18n.t('courses.free') : `${amount.toFixed(2)} CHF`;
}
