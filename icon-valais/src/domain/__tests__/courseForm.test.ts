import { courseFormSchema, maxRepeatUntil, toCreateCoursePayload, validateCourseForm, type CourseFormValues } from '../courseForm';
import { zurichToday } from '../courses';

const base: CourseFormValues = {
  sport: 'jjb',
  level: 'adulte',
  kind: 'normal',
  isPrivate: false,
  locationId: 'l1',
  localDate: '2026-03-24',
  startTime: '18:30',
  endTime: '20:00',
  profId: undefined,
  places: 20,
  priceMember: 0,
  priceNonMember: 25,
  recurring: false,
  repeatUntil: undefined,
};

describe('maxRepeatUntil', () => {
  it('prof: 31 December of the current year', () => {
    expect(maxRepeatUntil('prof', '2026-03-24', '2026-03-01')).toBe('2026-12-31');
  });
  it('admin: start date + 5 years', () => {
    expect(maxRepeatUntil('admin', '2026-03-24', '2026-03-01')).toBe('2031-03-24');
  });
  it('admin: 29 February lands on 28 February (non leap year)', () => {
    expect(maxRepeatUntil('admin', '2028-02-29', '2028-02-01')).toBe('2033-02-28');
  });
});

describe('courseFormSchema', () => {
  const errs = (v: Partial<CourseFormValues>, role: 'prof' | 'admin' = 'prof') => {
    const r = validateCourseForm({ ...base, ...v }, role, '2026-03-01');
    return 'errors' in r ? r.errors : {};
  };

  it('accepts a valid form', () => {
    expect(courseFormSchema.safeParse(base).success).toBe(true);
    expect('values' in validateCourseForm(base, 'prof', '2026-03-01')).toBe(true);
  });
  it('rejects 0 places', () => {
    expect(errs({ places: 0 }).places).toBeDefined();
    expect(errs({ places: 101 }).places).toBeDefined();
    expect(errs({ places: NaN }).places).toBeDefined();
  });
  it('rejects negative prices', () => {
    expect(errs({ priceMember: -1 }).priceMember).toBeDefined();
    expect(errs({ priceNonMember: -1 }).priceNonMember).toBeDefined();
  });
  it('rejects end before or equal to start', () => {
    expect(errs({ startTime: '20:00', endTime: '19:00' }).endTime).toBeDefined();
    expect(errs({ startTime: '20:00', endTime: '20:00' }).endTime).toBeDefined();
  });
  it('rejects malformed date and times', () => {
    expect(errs({ localDate: '24.03.2026' }).localDate).toBeDefined();
    expect(errs({ localDate: '2026-02-31' }).localDate).toBeDefined();
    expect(errs({ startTime: '25:00' }).startTime).toBeDefined();
  });
  it('requires an end date when recurring', () => {
    expect(errs({ recurring: true, repeatUntil: undefined }).repeatUntil).toBeDefined();
  });
  it('rejects an end date before the start', () => {
    expect(errs({ recurring: true, repeatUntil: '2026-03-17' }).repeatUntil).toBeDefined();
  });
  it('prof recurring in a later year gets the dedicated message', () => {
    const r = validateCourseForm({ ...base, localDate: '2027-01-12', recurring: true, repeatUntil: '2026-12-31' }, 'prof', '2026-03-01');
    expect('errors' in r && r.errors.repeatUntil).toBe('courses.form.err.profYearOnly');
    const a = validateCourseForm({ ...base, localDate: '2027-01-12', recurring: true, repeatUntil: '2027-06-01' }, 'admin', '2026-03-01');
    expect('values' in a).toBe(true);
  });
  it('rejects an end date beyond the maximum', () => {
    expect(errs({ recurring: true, repeatUntil: '2027-01-07' }, 'prof').repeatUntil).toBeDefined();
    expect(errs({ recurring: true, repeatUntil: '2026-12-31' }, 'prof').repeatUntil).toBeUndefined();
    expect(errs({ recurring: true, repeatUntil: '2031-03-24' }, 'admin').repeatUntil).toBeUndefined();
    expect(errs({ recurring: true, repeatUntil: '2031-03-25' }, 'admin').repeatUntil).toBeDefined();
  });
});

describe('toCreateCoursePayload', () => {
  it('non recurring gives a null repeat date', () => {
    const r = toCreateCoursePayload(base);
    expect(r.p_repeat_until).toBeNull();
    expect(r.p).toEqual({
      sport: 'jjb', level: 'adulte', kind: 'normal', is_private: false, location_id: 'l1',
      local_date: '2026-03-24', start_time: '18:30', end_time: '20:00',
      places: 20, price_member: 0, price_non_member: 25,
    });
  });
  it('recurring carries the repeat date and the prof', () => {
    const r = toCreateCoursePayload({ ...base, recurring: true, repeatUntil: '2026-12-31', profId: 'p1', isPrivate: true });
    expect(r.p_repeat_until).toBe('2026-12-31');
    expect(r.p).toMatchObject({ prof_id: 'p1', is_private: true });
  });
});

describe('zurichToday', () => {
  it('uses the Zurich calendar day', () => {
    expect(zurichToday(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-02');
    expect(zurichToday(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
  });
});
