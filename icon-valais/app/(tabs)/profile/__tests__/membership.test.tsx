import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import Membership from '../membership';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockPay = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/src/lib/payments', () => ({
  payMembershipDetail: (...a: unknown[]) => mockPay(...a),
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ limit: async () => ({ data: [{ id: 'm1' }], error: null }) }),
          }),
        }),
      }),
    }),
  },
}));

type Member = { is_member: boolean; until: string | null; source: string | null; auto_renew: boolean; cancel_at_period_end: boolean };
let member: Member;
let reason: 'none' | 'student' | 'child';

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  reason = 'none';
  member = { is_member: false, until: null, source: null, auto_renew: false, cancel_at_period_end: false };
  mockRpc.mockImplementation(async (fn: string, args: { p_months?: number }) => {
    if (fn === 'my_membership') return { data: [member], error: null };
    if (fn === 'membership_price') {
      const base = (args.p_months ?? 1) * 40;
      const pct = reason === 'child' ? 50 : reason === 'student' ? 30 : 0;
      return { data: [{ base, discount_pct: pct, reason, amount: base * (1 - pct / 100) }], error: null };
    }
    return { data: null, error: null };
  });
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  mockPay.mockResolvedValue({ outcome: 'paid' });
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
});

describe('Membership screen', () => {
  it('shows the 4 server-computed prices', async () => {
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText('480.00 CHF')).toBeTruthy());
    expect(screen.getByText('40.00 CHF')).toBeTruthy();
    expect(screen.getByText('120.00 CHF')).toBeTruthy();
    expect(screen.getByText('240.00 CHF')).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith('membership_price', { p_profile: 'me', p_months: 12 });
  });

  it('shows the child discount', async () => {
    reason = 'child';
    mockParams = { profileId: 'kid' };
    await render(<Membership />);
    await waitFor(() => expect(screen.getAllByText('−50 % enfant').length).toBe(4));
    expect(mockRpc).toHaveBeenCalledWith('membership_price', { p_profile: 'kid', p_months: 3 });
  });

  it('shows the student discount', async () => {
    reason = 'student';
    await render(<Membership />);
    await waitFor(() => expect(screen.getAllByText('−30 % étudiant').length).toBe(4));
  });

  it('pays 3 months by TWINT', async () => {
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText('120.00 CHF')).toBeTruthy());
    await fireEvent.press(screen.getByText('120.00 CHF'));
    await fireEvent.press(screen.getByText('TWINT (paiement unique)'));
    await fireEvent.press(screen.getByText('Payer 120.00 CHF'));
    await waitFor(() => expect(mockPay).toHaveBeenCalledWith('me', 3, 'twint'));
    await waitFor(() => expect(screen.getByText('Paiement confirmé, merci !')).toBeTruthy());
  });

  it('pays for the child when opened from the child screen', async () => {
    mockParams = { profileId: 'kid' };
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText('40.00 CHF')).toBeTruthy());
    await fireEvent.press(screen.getByText('40.00 CHF'));
    await fireEvent.press(screen.getByText('Payer 40.00 CHF'));
    await waitFor(() => expect(mockPay).toHaveBeenCalledWith('kid', 1, 'card'));
  });

  it('shows the translated payment error', async () => {
    mockPay.mockResolvedValue({ outcome: 'error', errorKey: 'payments.alreadyCovered' });
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText('40.00 CHF')).toBeTruthy());
    await fireEvent.press(screen.getByText('40.00 CHF'));
    await fireEvent.press(screen.getByText('Payer 40.00 CHF'));
    await waitFor(() => expect(screen.getByText("Vous êtes déjà couvert par un abonnement en cours.")).toBeTruthy());
  });

  it('shows member status and asks confirmation before cancelling', async () => {
    member = { is_member: true, until: '2027-03-31', source: 'stripe_subscription', auto_renew: true, cancel_at_period_end: false };
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText("Adhérent jusqu'au 31.03.2027")).toBeTruthy());
    expect(screen.getByText('Renouvellement automatique actif')).toBeTruthy();
    await fireEvent.press(screen.getByText('Résilier'));
    expect(mockInvoke).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Oui, résilier'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('cancel-subscription', { body: { membershipId: 'm1' } }),
    );
    await waitFor(() => expect(screen.getByText('Résiliation enregistrée.')).toBeTruthy());
  });

  it('can back out of the cancellation', async () => {
    member = { is_member: true, until: '2027-03-31', source: 'stripe_subscription', auto_renew: true, cancel_at_period_end: false };
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText('Résilier')).toBeTruthy());
    await fireEvent.press(screen.getByText('Résilier'));
    await fireEvent.press(screen.getByText('Garder'));
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(screen.getByText('Résilier')).toBeTruthy();
  });

  it('shows scheduled cancellation and hides the cancel button', async () => {
    member = { is_member: true, until: '2027-03-31', source: 'stripe_subscription', auto_renew: true, cancel_at_period_end: true };
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText(/Résiliation programmée/)).toBeTruthy());
    expect(screen.queryByText('Résilier')).toBeNull();
  });

  it('hides cancel for a one-time membership', async () => {
    member = { is_member: true, until: '2027-03-31', source: 'one_time', auto_renew: false, cancel_at_period_end: false };
    await render(<Membership />);
    await waitFor(() => expect(screen.getByText('Sans renouvellement automatique')).toBeTruthy());
    expect(screen.queryByText('Résilier')).toBeNull();
  });
});
