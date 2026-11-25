import { buildProfilePatch, profileErrorKey, type ProfileFormValues } from '../profileUpdate';

const base: ProfileFormValues = {
  phone: ' 079 ', age: '30', sports: ['jjb'], yearsGrappling: '', yearsMma: '',
  coachYears: '', trainingPlaces: '', competitionAwards: '', cv: '',
};

describe('buildProfilePatch', () => {
  it('builds a trimmed patch for a student', () => {
    expect(buildProfilePatch(base, 'eleve')).toEqual({
      patch: { phone: '079', age: 30, sports: ['jjb'], years_grappling: null, years_mma: null },
    });
  });
  it('requires years for grappling and coach years for prof', () => {
    const r = buildProfilePatch({ ...base, sports: ['grappling'] }, 'prof');
    expect(r).toEqual({ errors: { yearsGrappling: 'errors.yearsRequired', coachYears: 'errors.coachYearsRequired' } });
  });
  it('rejects a bad age and no sport', () => {
    expect(buildProfilePatch({ ...base, age: '150', sports: [] }, 'eleve')).toEqual({
      errors: { age: 'errors.ageRange', sports: 'errors.sportRequired' },
    });
  });
});

describe('profileErrorKey', () => {
  it('maps constraint and RLS codes', () => {
    expect(profileErrorKey({ code: '23514' })).toBe('errors.kidBeltAdult');
    expect(profileErrorKey({ code: '42501' })).toBe('errors.consentRequiredForAge');
    expect(profileErrorKey({ code: 'XX' })).toBe('errors.generic');
  });
});
