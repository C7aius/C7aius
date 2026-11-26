import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Pricing from '../pricing';

const mockRpc = jest.fn();
let mockRole = 'admin';
const SETTINGS = {
  price_1m: 100, price_3m: 250, price_6m: 450, price_12m: 650,
  student_discount_pct: 30, child_discount_pct: 50, child_max_age: 15, default_course_price: 20,
};

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
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'limit']) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve({ data: SETTINGS, error: null });
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
  mockRpc.mockResolvedValue({ data: null, error: null });
});

it('shows access denied to a non-admin', async () => {
  mockRole = 'prof';
  await render(<Pricing />);
  expect(await screen.findByText('Accès réservé aux administrateurs.')).toBeTruthy();
  await settle();
});

it('refuses a 95 % discount without calling the server', async () => {
  await render(<Pricing />);
  const field = await screen.findByLabelText('Réduction étudiant (%)');
  await fireEvent.changeText(field, '95');
  await fireEvent.press(screen.getByText('Enregistrer'));
  expect(await screen.findByText('Pourcentage entier entre 0 et 90.')).toBeTruthy();
  expect(mockRpc).not.toHaveBeenCalled();
});

it('saves valid pricing through admin_update_pricing', async () => {
  await render(<Pricing />);
  const field = await screen.findByLabelText('Adhésion 1 mois (CHF)');
  await fireEvent.changeText(field, '120,50');
  await fireEvent.press(screen.getByText('Enregistrer'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('admin_update_pricing', { p: { ...SETTINGS, price_1m: 120.5 } }));
  expect(await screen.findByText('Tarifs enregistrés.')).toBeTruthy();
});

it('maps invalid_field from the server', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '22023', hint: 'invalid_field' } });
  await render(<Pricing />);
  await screen.findByLabelText('Adhésion 1 mois (CHF)');
  await fireEvent.press(screen.getByText('Enregistrer'));
  expect(await screen.findByText('Un champ n\'est pas valide.')).toBeTruthy();
});
