import type { ProfStatus, Role } from './types';

export function displayRole(role: Role): 'eleve' | 'prof' {
  return role === 'eleve' ? 'eleve' : 'prof';
}

export function canEditBelt(role: Role, profStatus: ProfStatus | null): boolean {
  return role === 'admin' || (role === 'prof' && profStatus === 'valide');
}
