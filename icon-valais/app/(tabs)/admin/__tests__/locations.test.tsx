import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Locations from '../locations';

const mockRpc = jest.fn();
let mockRole = 'admin';
let mockLocs: unknown[] = [];

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
      for (const m of ['select', 'order']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: mockLocs, error: null }).then(res);
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
  mockRpc.mockResolvedValue({ data: 'l9', error: null });
  mockLocs = [
    { id: 'l1', name: 'Conthey', address: 'Rue 1', maps_url: 'https://maps.example/x', is_default: true, archived: false },
    { id: 'l2', name: 'Sion', address: '', maps_url: '', is_default: false, archived: false },
  ];
});

it('shows access denied to a prof', async () => {
  mockRole = 'prof';
  await render(<Locations />);
  expect(await screen.findByText('Accès réservé aux administrateurs.')).toBeTruthy();
  expect(screen.queryByText('Conthey')).toBeNull();
  await settle();
});

it('lists locations for an admin', async () => {
  await render(<Locations />);
  expect(await screen.findByText('Conthey')).toBeTruthy();
  expect(screen.getByText('Sion')).toBeTruthy();
  expect(screen.getByText('Par défaut')).toBeTruthy();
  await settle();
});

it('rejects an http:// maps link without calling the database', async () => {
  await render(<Locations />);
  await screen.findByText('Sion');
  await fireEvent.press(screen.getByText('Ajouter un lieu'));
  await fireEvent.changeText(await screen.findByLabelText('Nom'), 'Martigny');
  await fireEvent.changeText(screen.getByLabelText('Lien Google Maps (https://)'), 'http://maps.example/y');
  await fireEvent.press(screen.getByText('Enregistrer'));
  expect(await screen.findByText('Le lien doit commencer par https://')).toBeTruthy();
  expect(mockRpc).not.toHaveBeenCalled();
});

it('adds a location', async () => {
  await render(<Locations />);
  await screen.findByText('Sion');
  await fireEvent.press(screen.getByText('Ajouter un lieu'));
  await fireEvent.changeText(await screen.findByLabelText('Nom'), 'Martigny');
  await fireEvent.changeText(screen.getByLabelText('Lien Google Maps (https://)'), 'https://maps.example/y');
  await fireEvent.press(screen.getByText('Enregistrer'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalled());
  expect(mockRpc).toHaveBeenCalledWith('admin_upsert_location', {
    p: { name: 'Martigny', address: '', maps_url: 'https://maps.example/y', is_default: false, archived: false },
  });
});

it('archives a location and translates a refusal', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '22023', hint: 'default_location_archived' } });
  await render(<Locations />);
  await screen.findByText('Sion');
  await fireEvent.press(screen.getAllByText('Archiver')[0]);
  await waitFor(() => expect(mockRpc).toHaveBeenCalled());
  expect(mockRpc.mock.calls[0][1].p).toMatchObject({ id: 'l2', archived: true });
  expect(await screen.findByText('Le lieu par défaut ne peut pas être archivé.')).toBeTruthy();
});
