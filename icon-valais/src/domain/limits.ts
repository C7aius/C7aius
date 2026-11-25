/** Longueurs maximales des champs libres ; identiques aux contraintes CHECK de la migration 0004. */
export const LIMITS = {
  name: 50,
  phone: 30,
  trainingPlaces: 1000,
  competitionAwards: 1000,
  cv: 3000,
} as const;

/** Longueur en caractères (points de code), comme char_length() en SQL. */
export const charLength = (s: string): number => Array.from(s).length;
