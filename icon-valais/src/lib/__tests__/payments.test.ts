import { Platform } from 'react-native';

const mockInvoke = jest.fn();
let mockBookingRows: unknown[][] = [];
const mockBookingQuery = jest.fn();
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    from: (table: string) => {
      mockBookingQuery(table);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: mockBookingRows.shift() ?? [], error: null }).then(res);
      return q;
    },
  },
}));

const mockInitStripe = jest.fn();
const mockInitSheet = jest.fn();
const mockPresent = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: (...a: unknown[]) => mockInitStripe(...a),
  initPaymentSheet: (...a: unknown[]) => mockInitSheet(...a),
  presentPaymentSheet: (...a: unknown[]) => mockPresent(...a),
}));

import { payBooking, payMembership, paymentErrorKey } from '../payments';
import fr from '@/src/i18n/locales/fr.json';

const native = {
  paymentIntentClientSecret: 'pi_secret',
  customerId: 'cus_1',
  ephemeralKeySecret: 'ek_1',
  publishableKey: 'pk_test_1',
  amount: 20,
};

const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(() => {
  jest.clearAllMocks();
  mockBookingRows = [];
  setOS('ios');
  mockInvoke.mockResolvedValue({ data: native, error: null });
  mockInitSheet.mockResolvedValue({});
  mockPresent.mockResolvedValue({});
});

describe('payBooking (native)', () => {
  it('calls create-payment with the booking id only (no amount) and presents the sheet', async () => {
    mockBookingRows = [[{ payment_status: 'paid' }]];
    expect(await payBooking('b1')).toBe('paid');
    expect(mockInvoke).toHaveBeenCalledWith('create-payment', {
      body: { kind: 'course', bookingId: 'b1', platform: 'native' },
    });
    expect(mockInitStripe).toHaveBeenCalledWith(expect.objectContaining({ publishableKey: 'pk_test_1' }));
    expect(mockInitSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantDisplayName: 'Icon Valais',
        allowsDelayedPaymentMethods: true,
        returnURL: 'iconvalais://stripe-redirect',
        customerId: 'cus_1',
        customerEphemeralKeySecret: 'ek_1',
        paymentIntentClientSecret: 'pi_secret',
        applePay: { merchantCountryCode: 'CH' },
        googlePay: expect.objectContaining({ merchantCountryCode: 'CH' }),
      }),
    );
  });

  it('polls every second up to 10 s then reports pending', async () => {
    jest.useFakeTimers();
    try {
      mockBookingRows = []; // jamais payé
      const p = payBooking('b1');
      await jest.advanceTimersByTimeAsync(11_000);
      expect(await p).toBe('pending');
      expect(mockBookingQuery.mock.calls.length).toBeGreaterThanOrEqual(10);
    } finally {
      jest.useRealTimers();
    }
  });

  it('turns paid once the webhook has confirmed', async () => {
    jest.useFakeTimers();
    try {
      mockBookingRows = [[{ payment_status: 'pending' }], [{ payment_status: 'pending' }], [{ payment_status: 'paid' }]];
      const p = payBooking('b1');
      await jest.advanceTimersByTimeAsync(3_000);
      expect(await p).toBe('paid');
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancelled sheet is cancelled, never paid', async () => {
    mockPresent.mockResolvedValue({ error: { code: 'Canceled' } });
    expect(await payBooking('b1')).toBe('cancelled');
    expect(mockBookingQuery).not.toHaveBeenCalled();
  });

  it('sheet failure is an error', async () => {
    mockPresent.mockResolvedValue({ error: { code: 'Failed' } });
    expect(await payBooking('b1')).toBe('error');
  });

  it('init failure is an error and the sheet is not shown', async () => {
    mockInitSheet.mockResolvedValue({ error: { code: 'Failed' } });
    expect(await payBooking('b1')).toBe('error');
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('server refusal (409 already_covered) is an error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'already_covered' }) } } });
    expect(await payBooking('b1')).toBe('error');
  });

  it('network exception is an error', async () => {
    mockInvoke.mockRejectedValue(new Error('offline'));
    expect(await payBooking('b1')).toBe('error');
  });
});

describe('payBooking (web)', () => {
  it('redirects to checkoutUrl', async () => {
    setOS('web');
    const assign = jest.fn();
    (globalThis as unknown as { window: unknown }).window = { location: { assign } };
    mockInvoke.mockResolvedValue({ data: { checkoutUrl: 'https://checkout.stripe.com/c/x' }, error: null });
    expect(await payBooking('b1')).toBe('redirected');
    expect(mockInvoke).toHaveBeenCalledWith('create-payment', {
      body: { kind: 'course', bookingId: 'b1', platform: 'web' },
    });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/x');
    expect(mockInitSheet).not.toHaveBeenCalled();
    delete (globalThis as unknown as { window?: unknown }).window;
  });
});

describe('payMembership', () => {
  it('sends profile, months and method (native) and pays without polling bookings', async () => {
    expect(await payMembership('p1', 3, 'twint')).toBe('paid');
    expect(mockInvoke).toHaveBeenCalledWith('create-payment', {
      body: { kind: 'membership', profileId: 'p1', months: 3, method: 'twint', platform: 'native' },
    });
    expect(mockBookingQuery).not.toHaveBeenCalled();
  });

  it('cancelled', async () => {
    mockPresent.mockResolvedValue({ error: { code: 'Canceled' } });
    expect(await payMembership('p1', 1, 'card')).toBe('cancelled');
  });
});

describe('paymentErrorKey', () => {
  it('maps create-payment errors to specific messages', () => {
    expect(paymentErrorKey('already_covered')).toBe('payments.alreadyCovered');
    expect(paymentErrorKey('already_paid')).toBe('payments.alreadyPaid');
    expect(paymentErrorKey('not_pending')).toBe('payments.expired');
    expect(paymentErrorKey('course_closed')).toBe('payments.expired');
    expect(paymentErrorKey('payment_conflict')).toBe('payments.conflict');
    expect(paymentErrorKey('weird')).toBe('payments.error');
  });
  it('uses wording that fits each case', () => {
    expect(fr.payments.alreadyCovered).toBe('Vous êtes déjà couvert par un abonnement en cours.');
    expect(fr.payments.alreadyPaid).toBe('Ce cours est déjà payé.');
    expect(fr.payments.expired).toBe("Le délai de paiement est dépassé ou le cours n'est plus ouvert. Réservez à nouveau.");
  });
});
