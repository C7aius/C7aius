import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import AdminPayments from '../payments';

let mockRole = 'admin';
const mockGte = jest.fn();
const row = (o: Record<string, unknown>) => ({
  id: 'p', receipt_no: 1, kind: 'course', amount: 20, status: 'succeeded', description: 'Cours', method: 'card',
  paid_at: '2026-11-20T18:00:00Z', created_at: '2026-11-20T18:00:00Z', refunded_at: null, error: null, ...o,
});
const mockRows = [
  row({ id: 'a', amount: 100, description: 'Adhésion 1 mois' }),
  row({ id: 'b', amount: 20, status: 'refunded', description: 'Cours annulé' }),
  row({ id: 'c', amount: 30, status: 'refund_pending', description: 'Cours en remboursement' }),
  row({ id: 'd', amount: 50, status: 'succeeded', description: 'Cours payé' }),
  row({ id: 'e', amount: 40, status: 'refund_failed', description: 'Remboursement refusé', created_at: '2025-01-01T10:00:00Z' }),
];

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: mockRole }, ready: true }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, [cb]);
  },
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      let status: unknown = null;
      for (const m of ['select', 'order', 'limit']) q[m] = () => q;
      q.eq = (col: string, v: unknown) => {
        if (col === 'status') status = v;
        return q;
      };
      q.gte = (...a: unknown[]) => {
        mockGte(...a);
        return q;
      };
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: status ? mockRows.filter((r) => r.status === status) : mockRows, error: null }).then(res);
      return q;
    },
  },
}));

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'admin';
});

it('shows access denied to a non-admin', async () => {
  mockRole = 'prof';
  await render(<AdminPayments />);
  expect(await screen.findByText('Accès réservé aux administrateurs.')).toBeTruthy();
  await settle();
});

it('collected total excludes refunded and refund-pending payments', async () => {
  await render(<AdminPayments />);
  await screen.findByText('Adhésion 1 mois');
  expect(screen.getByTestId('total-collected').props.children).toBe('150.00 CHF');
  expect(screen.getByTestId('total-refunded').props.children).toBe('20.00 CHF');
});

it('filters by period', async () => {
  await render(<AdminPayments />);
  await screen.findByText('Adhésion 1 mois');
  await fireEvent.press(screen.getByText('30 jours'));
  await waitFor(() => expect(mockGte).toHaveBeenCalledWith('created_at', expect.any(String)));
});

it('lists failed refunds (all periods) for manual handling', async () => {
  await render(<AdminPayments />);
  await screen.findByText('Remboursements échoués (1)');
  expect(screen.getByText(/tableau de bord Stripe/)).toBeTruthy();
  // la ligne apparaît dans le bloc dédié (et dans la liste), libellé « Remboursement à traiter par le club »
  expect(screen.getAllByText('Remboursement refusé').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('Remboursement à traiter par le club').length).toBeGreaterThanOrEqual(1);
  // non compté dans l'encaissé
  expect(screen.getByTestId('total-collected').props.children).toBe('150.00 CHF');
});
