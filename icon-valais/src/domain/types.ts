export type Sport = 'jjb' | 'grappling' | 'mma';
export type Role = 'eleve' | 'prof' | 'admin';
export type ProfStatus = 'en_attente' | 'valide' | 'refuse';
export const BELTS = [
  'blanche', 'grise', 'jaune', 'orange', 'verte',
  'bleue', 'violette', 'marron', 'noire',
] as const;
export type Belt = (typeof BELTS)[number];
