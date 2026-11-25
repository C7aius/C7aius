import type { Belt } from './types';

export const ALL_BELTS: readonly Belt[] = [
  'blanche', 'grise', 'jaune', 'orange', 'verte', 'bleue', 'violette', 'marron', 'noire',
];

const KID_ONLY: readonly Belt[] = ['grise', 'jaune', 'orange', 'verte'];

export function beltOptions(age: number): Belt[] {
  return ALL_BELTS.filter((b) => age < 18 || !KID_ONLY.includes(b));
}
