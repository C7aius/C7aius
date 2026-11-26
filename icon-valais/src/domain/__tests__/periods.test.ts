import { periodRange, zurichStartOfDay } from '../periods';

describe('periodRange', () => {
  it('month: first to last day', () => {
    expect(periodRange('month', '2026-03-15')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
  it('year: 1 January to 31 December', () => {
    expect(periodRange('year', '2026-03-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('custom: returns the given dates, inclusive', () => {
    expect(periodRange('custom', '2026-03-15', '2026-02-01', '2026-02-01')).toEqual({ from: '2026-02-01', to: '2026-02-01' });
  });
  it('custom: end before start throws', () => {
    expect(() => periodRange('custom', '2026-03-15', '2026-03-10', '2026-03-09')).toThrow();
  });
  it('custom: missing or malformed dates throw', () => {
    expect(() => periodRange('custom', '2026-03-15')).toThrow();
    expect(() => periodRange('custom', '2026-03-15', '2026-13-01', '2026-13-02')).toThrow();
    expect(() => periodRange('custom', '2026-03-15', '2026-02-30', '2026-03-02')).toThrow();
  });
});

describe('zurichStartOfDay', () => {
  it('is local midnight in Zurich (winter and summer)', () => {
    expect(zurichStartOfDay('2026-01-01')).toBe('2025-12-31T23:00:00.000Z');
    expect(zurichStartOfDay('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
  });
});

import { periodStart } from '../paymentsView';
describe('payments periodStart uses Zurich boundaries', () => {
  it('month/year start at Zurich midnight, not UTC', () => {
    // 2026-03-31 23:30 UTC is already 1 April in Zurich (CEST, UTC+2)
    expect(periodStart('month', new Date('2026-03-31T23:30:00Z'))).toBe('2026-03-31T22:00:00.000Z');
    expect(periodStart('year', new Date('2026-06-15T10:00:00Z'))).toBe('2025-12-31T23:00:00.000Z');
    expect(periodStart('all')).toBeNull();
  });
});
