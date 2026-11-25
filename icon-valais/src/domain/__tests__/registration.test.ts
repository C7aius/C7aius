import { needsParentConsent, registrationSchema } from '../registration';

const base = {
  role: 'eleve' as const,
  firstName: 'Ana',
  lastName: 'Roux',
  email: 'ana@example.com',
  password: 'password1',
  age: 30,
  sports: ['grappling', 'mma'],
  yearsGrappling: 2,
  yearsMma: 1,
};

describe('needsParentConsent', () => {
  it('works', () => {
    expect(needsParentConsent(15, false)).toBe(true);
    expect(needsParentConsent(16, false)).toBe(false);
    expect(needsParentConsent(10, true)).toBe(false);
  });
});

describe('registrationSchema', () => {
  const ok = (v: unknown) => registrationSchema.safeParse(v).success;
  it('accepts a valid adult student', () => {
    expect(ok(base)).toBe(true);
  });
  it.each([-1, 101, 12.5, ''])('rejects age %p', (age) => {
    expect(ok({ ...base, age })).toBe(false);
  });
  it('rejects empty sports', () => {
    expect(ok({ ...base, sports: [] })).toBe(false);
  });
  it('requires belt for jjb', () => {
    const v = { ...base, sports: ['jjb'] };
    expect(ok(v)).toBe(false);
    expect(ok({ ...v, bjjBelt: 'bleue' })).toBe(true);
  });
  it('rejects grise at 18', () => {
    expect(ok({ ...base, sports: ['jjb'], bjjBelt: 'grise', age: 18 })).toBe(false);
    expect(ok({ ...base, sports: ['jjb'], bjjBelt: 'grise', age: 17, parentEmail: 'p@example.com' })).toBe(true);
  });
  it('requires years for grappling/mma', () => {
    expect(ok({ ...base, yearsMma: undefined })).toBe(false);
    expect(ok({ ...base, yearsGrappling: -1 })).toBe(false);
  });
  it('requires parentEmail under 16', () => {
    expect(ok({ ...base, age: 15 })).toBe(false);
    expect(ok({ ...base, age: 15, parentEmail: 'p@example.com' })).toBe(true);
  });
  it('requires coachYears for prof', () => {
    expect(ok({ ...base, role: 'prof' })).toBe(false);
    expect(ok({ ...base, role: 'prof', coachYears: 5 })).toBe(true);
  });
  it('uses i18n keys as messages', () => {
    const r = registrationSchema.safeParse({ ...base, age: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain('errors.ageRange');
  });
});
