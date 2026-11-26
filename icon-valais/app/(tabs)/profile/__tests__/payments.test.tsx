import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Payments from '../payments';

let mockRows: unknown[] = [];
const mockShare = jest.fn();
const mockFetch = jest.fn();

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'me', role: 'eleve' }, ready: true }),
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
      for (const m of ['select', 'order', 'or', 'limit']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: mockRows, error: null }).then(res);
      return q;
    },
  },
}));
jest.mock('expo-file-system', () => {
  class File {
    uri = 'file:///cache/quittance.pdf';
    constructor(..._a: unknown[]) {}
    create() {}
    write() {}
  }
  return { File, Paths: { cache: 'cache' } };
});
jest.mock('expo-sharing', () => ({ shareAsync: (...a: unknown[]) => mockShare(...a) }));

const pay = (o: Record<string, unknown>) => ({
  id: 'p1', receipt_no: 12, kind: 'course', amount: 20, status: 'succeeded', description: 'Cours JJB',
  method: 'card', paid_at: '2026-11-20T18:00:00Z', created_at: '2026-11-20T17:59:00Z', refunded_at: null, error: null, ...o,
});

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [pay({}), pay({ id: 'p2', status: 'refunded', description: 'Cours annulé', refunded_at: '2026-11-21T10:00:00Z' })];
  mockFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  global.fetch = mockFetch as unknown as typeof fetch;
});

it('lists payments and marks a refunded one', async () => {
  await render(<Payments />);
  expect(await screen.findByText('Cours JJB')).toBeTruthy();
  expect(screen.getByText('Cours annulé')).toBeTruthy();
  expect(screen.getAllByText('Remboursé')).toHaveLength(1);
});

it('Quittance calls the receipt function with the payment id and shares the PDF', async () => {
  await render(<Payments />);
  await screen.findByText('Cours JJB');
  await fireEvent.press(screen.getAllByText('Quittance')[0]);
  await waitFor(() => expect(mockShare).toHaveBeenCalled());
  const [url, init] = mockFetch.mock.calls[0];
  expect(String(url)).toContain('/functions/v1/receipt?payment=p1');
  expect(init.headers.Authorization).toBe('Bearer tok');
});

it('shows an error when the receipt is not receiptable', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 409, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
  await render(<Payments />);
  await screen.findByText('Cours JJB');
  await fireEvent.press(screen.getAllByText('Quittance')[0]);
  expect(await screen.findByText("Cette quittance n'est pas disponible.")).toBeTruthy();
  expect(mockShare).not.toHaveBeenCalled();
  await act(async () => new Promise((r) => setTimeout(r, 10)));
});
