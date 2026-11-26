const mockRpc = jest.fn();
const mockOr = jest.fn();

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'order', 'limit']) q[m] = () => q;
      q.or = (f: string) => {
        mockOr(f);
        return q;
      };
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'c1', prof_id: null }], error: null }).then(res);
      return q;
    },
  },
}));

import { bookCourse, fetchWeek, unbookCourse } from '../coursesApi';

beforeEach(() => jest.clearAllMocks());

it('bookCourse returns the booking id, amount and payment flag', async () => {
  mockRpc.mockResolvedValue({ data: [{ booking_id: 'b1', amount: 20, needs_payment: true }], error: null });
  await expect(bookCourse('c1', 'k1')).resolves.toEqual({
    error: null,
    bookingId: 'b1',
    amount: 20,
    needsPayment: true,
  });
  expect(mockRpc).toHaveBeenCalledWith('book_course', { p_course: 'c1', p_profile: 'k1' });
});

it('bookCourse maps an RPC error to its i18n key', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '22023', hint: 'course_closed' } });
  const r = await bookCourse('c1');
  expect(r.bookingId).toBeNull();
  expect(r.needsPayment).toBe(false);
  expect(r.error).toEqual(expect.any(String));
});

it('bookCourse reports a network error', async () => {
  mockRpc.mockRejectedValue(new Error('offline'));
  await expect(bookCourse('c1')).resolves.toMatchObject({ error: 'errors.network', bookingId: null });
});

it('unbookCourse returns null on success', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  await expect(unbookCourse('c1')).resolves.toBeNull();
  expect(mockRpc).toHaveBeenCalledWith('unbook_course', { p_course: 'c1' });
});

it('my bookings exclude expired pending payments', async () => {
  await fetchWeek(new Date(), new Date());
  expect(mockOr).toHaveBeenCalledWith(expect.stringMatching(/^payment_status\.neq\.pending,pending_until\.gt\."/));
});
