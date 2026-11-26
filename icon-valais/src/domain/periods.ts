import { zurichToUtc } from '@/src/domain/courses';

export type PeriodKind = 'month' | 'year' | 'custom';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

function parse(s: string | undefined): [number, number, number] {
  const m = s ? DATE.exec(s) : null;
  if (!m) throw new Error('invalid date');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) throw new Error('invalid date');
  return [y, mo, d];
}

/**
 * Bornes `YYYY-MM-DD` (incluses, calendrier de Zurich) d'une période. `today` est la date du jour à Zurich ;
 * `custom` exige `from` et `to` valides avec `to >= from`.
 */
export function periodRange(kind: PeriodKind, today: string, from?: string, to?: string): { from: string; to: string } {
  if (kind === 'custom') {
    parse(from);
    parse(to);
    if ((to as string) < (from as string)) throw new Error('end before start');
    return { from: from as string, to: to as string };
  }
  const [y, m] = parse(today);
  if (kind === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** Instant ISO (UTC) de minuit à Zurich pour une date `YYYY-MM-DD`. */
export function zurichStartOfDay(day: string): string {
  const [y, m, d] = parse(day);
  return zurichToUtc(y, m, d).toISOString();
}
