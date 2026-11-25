import { displayRole, canEditBelt } from '../roles';

describe('roles', () => {
  it('displays admin as prof', () => {
    expect(displayRole('admin')).toBe('prof');
    expect(displayRole('prof')).toBe('prof');
    expect(displayRole('eleve')).toBe('eleve');
  });
  it('canEditBelt', () => {
    expect(canEditBelt('prof', 'en_attente')).toBe(false);
    expect(canEditBelt('prof', 'refuse')).toBe(false);
    expect(canEditBelt('prof', null)).toBe(false);
    expect(canEditBelt('prof', 'valide')).toBe(true);
    expect(canEditBelt('admin', null)).toBe(true);
    expect(canEditBelt('eleve', 'valide')).toBe(false);
  });
});
