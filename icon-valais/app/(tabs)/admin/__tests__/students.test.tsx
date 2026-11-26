import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Students from '../students';

const mockRpc = jest.fn();
const mockSigned = jest.fn();
let mockRole = 'admin';

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
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => mockSigned(...a) }) },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'order']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({
          data: [{ id: 'sp1', profile_id: 'c1', path: 'c1/x.jpg', submitted_at: '2026-11-01T10:00:00Z', first_name: 'Ute', last_name: 'Muller', age: 22 }],
          error: null,
        }).then(res);
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
  mockSigned.mockResolvedValue({ data: { signedUrl: 'https://signed.example/x.jpg' }, error: null });
});

it('shows access denied to a non-admin', async () => {
  mockRole = 'eleve';
  await render(<Students />);
  expect(await screen.findByText('Accès réservé aux administrateurs.')).toBeTruthy();
  await settle();
});

it('lists pending proofs with a signed preview', async () => {
  await render(<Students />);
  expect(await screen.findByText('Ute Muller')).toBeTruthy();
  await waitFor(() => expect(mockSigned).toHaveBeenCalledWith('c1/x.jpg', expect.any(Number)));
  await settle();
});

it('Valider calls admin_decide_student(id, true)', async () => {
  await render(<Students />);
  await screen.findByText('Ute Muller');
  await fireEvent.press(screen.getByText('Valider'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('admin_decide_student', { p_proof: 'sp1', p_valid: true }));
});

it('Refuser calls admin_decide_student(id, false)', async () => {
  await render(<Students />);
  await screen.findByText('Ute Muller');
  await fireEvent.press(screen.getByText('Refuser'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('admin_decide_student', { p_proof: 'sp1', p_valid: false }));
});
