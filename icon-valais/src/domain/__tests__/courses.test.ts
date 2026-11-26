import i18n, { initI18n } from '@/src/i18n';
import { courseLabelStatus, formatChf, formatCourseTime, weekRange } from '../courses';
import { rpcErrorKey } from '../adminErrors';

beforeAll(async () => {
  await initI18n('fr');
});

describe('courseLabelStatus', () => {
  const now = new Date('2026-03-24T12:00:00Z');
  it('vacant when no prof and not started', () => {
    expect(courseLabelStatus({ status: 'prevu', prof_id: null, starts_at: '2026-03-24T18:00:00Z' }, now)).toBe('vacant');
  });
  it('open mat when no prof and started', () => {
    expect(courseLabelStatus({ status: 'prevu', prof_id: null, starts_at: '2026-03-24T11:00:00Z' }, now)).toBe('open_mat');
  });
  it('cancelled wins', () => {
    expect(courseLabelStatus({ status: 'annule', prof_id: null, starts_at: '2026-03-24T18:00:00Z' }, now)).toBe('annule');
  });
  it('prevu with a prof', () => {
    expect(courseLabelStatus({ status: 'prevu', prof_id: 'p', starts_at: '2026-03-24T11:00:00Z' }, now)).toBe('prevu');
  });
});

describe('weekRange', () => {
  it('spans Monday to next Monday in Zurich across DST change', () => {
    const { from, to } = weekRange(new Date('2026-03-29T12:00:00Z'));
    expect(from.toISOString()).toBe('2026-03-22T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });
  it('uses the Zurich day near midnight', () => {
    // Sunday 22:30Z = Monday 00:30 Zurich (CET)
    const { from } = weekRange(new Date('2026-03-01T23:30:00Z'));
    expect(from.toISOString()).toBe('2026-03-01T23:00:00.000Z');
  });
});

describe('formatCourseTime', () => {
  it('formats in Swiss time', () => {
    expect(formatCourseTime('2026-03-24T18:00:00Z', '2026-03-24T19:30:00Z', 'fr')).toBe('mar. 24.03 · 19:00–20:30');
  });
});

describe('formatChf', () => {
  it('free and priced', () => {
    expect(formatChf(0)).toBe(i18n.t('courses.free'));
    expect(formatChf(25)).toBe('25.00 CHF');
  });
});

describe('rpcErrorKey course hints', () => {
  it.each([
    ['slot_taken', 'errors.slotTaken'],
    ['course_closed', 'errors.courseClosed'],
    ['too_early', 'errors.tooEarly'],
    ['repeat_too_far', 'errors.repeatTooFar'],
    ['course_started', 'errors.courseStarted'],
    ['course_cancelled', 'errors.courseCancelled'],
    ['date_in_past', 'errors.dateInPast'],
    ['inactive_profile', 'errors.inactiveProfile'],
    ['not_booked', 'errors.notBooked'],
    ['invalid_field', 'errors.invalidField'],
    ['location_archived', 'errors.locationArchived'],
    ['no_default_location', 'errors.noDefaultLocation'],
  ])('%s', (hint, key) => {
    expect(rpcErrorKey({ code: 'P0001', hint })).toBe(key);
  });
});
