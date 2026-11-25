import { beltOptions } from '../belts';

describe('beltOptions', () => {
  it('includes grise at 17, not at 18', () => {
    expect(beltOptions(17)).toContain('grise');
    expect(beltOptions(18)).not.toContain('grise');
  });
  it('starts with blanche', () => {
    expect(beltOptions(0)[0]).toBe('blanche');
  });
  it('orders kids belts then adult belts', () => {
    expect(beltOptions(10)).toEqual(['blanche','grise','jaune','orange','verte','bleue','violette','marron','noire']);
    expect(beltOptions(30)).toEqual(['blanche','bleue','violette','marron','noire']);
  });
});
