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

describe('buildProfilePatch length limits', () => {
  it('rejects a phone over 30 characters', () => {
    expect(buildProfilePatch({ ...base, phone: '1'.repeat(31) }, 'eleve')).toEqual({ errors: { phone: 'errors.phoneTooLong' } });
  });
  it('rejects too long coach texts', () => {
    const prof = { ...base, coachYears: '2' };
    expect(
      buildProfilePatch({ ...prof, trainingPlaces: 'x'.repeat(1001), competitionAwards: 'x'.repeat(1001), cv: 'x'.repeat(3001) }, 'prof'),
    ).toEqual({ errors: { trainingPlaces: 'errors.textTooLong', competitionAwards: 'errors.textTooLong', cv: 'errors.textTooLong' } });
    expect('patch' in buildProfilePatch({ ...prof, cv: 'x'.repeat(3000) }, 'prof')).toBe(true);
  });
});

describe('profileErrorKey', () => {
  it('maps constraint and RLS codes', () => {
    expect(profileErrorKey({ code: '23514' })).toBe('errors.kidBeltAdult');
    expect(profileErrorKey({ code: '42501' })).toBe('errors.consentRequiredForAge');
    expect(profileErrorKey({ code: 'XX' })).toBe('errors.generic');
  });
  it('maps the age-lowering refusal (hint) to its own message', () => {
    expect(profileErrorKey({ code: '42501', hint: 'age_lower_requires_consent' })).toBe('errors.ageLowerRequiresConsent');
  });
});
