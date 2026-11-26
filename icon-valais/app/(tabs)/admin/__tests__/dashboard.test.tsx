import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Dashboard from '../dashboard';

let mockRole = 'admin';
const mockRpc = jest.fn();
const mockPush = jest.fn();

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'a', role: mockRole }, ready: true }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, [cb]);
  },
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'profiles' ? [{ id: 'p1' }, { id: 'p2' }] : [{ id: 'x' }], error: null }).then(res);
      return q;
    },
  },
}));

jest.mock('@/src/domain/courses', () => ({
  ...jest.requireActual('@/src/domain/courses'),
  zurichToday: () => '2026-03-15',
}));

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'admin';
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'admin_teaching_hours')
      return {
        data: [
          { prof_id: 'p1', first_name: 'Alice', last_name: 'Prof', courses: 3, hours: 4.5 },
          { prof_id: 'p2', first_name: 'Bruno', last_name: 'Coach', courses: 2, hours: 3 },
        ],
        error: null,
      };
    return { data: [{ profile_id: 'm1', first_name: 'Chloé', last_name: 'Membre', sessions: 5, hours: 7.25 }], error: null };
  });
});

describe('admin dashboard', () => {
  it('queries both RPCs for the current Zurich month and shows the teaching total', async () => {
    await render(<Dashboard />);
    expect(await screen.findByText('Total : 7.5 h')).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith('admin_teaching_hours', { p_from: '2026-03-01', p_to: '2026-03-31' });
    expect(mockRpc).toHaveBeenCalledWith('admin_member_hours', { p_from: '2026-03-01', p_to: '2026-03-31' });
    expect(screen.getByText('Alice Prof')).toBeTruthy();
    expect(screen.getByText('Chloé Membre')).toBeTruthy();
  });

  it('reloads both RPCs with the new bounds when the period changes', async () => {
    await render(<Dashboard />);
    await screen.findByText('Total : 7.5 h');
    mockRpc.mockClear();
    await fireEvent.press(screen.getByText('Cette année'));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('admin_teaching_hours', { p_from: '2026-01-01', p_to: '2026-12-31' });
      expect(mockRpc).toHaveBeenCalledWith('admin_member_hours', { p_from: '2026-01-01', p_to: '2026-12-31' });
    });
  });

  it('custom dates: invalid range shows an error and does not query; valid range queries', async () => {
    await render(<Dashboard />);
    await screen.findByText('Total : 7.5 h');
    await fireEvent.press(screen.getByText('Dates libres'));
    await fireEvent.changeText(screen.getByLabelText('Du (AAAA-MM-JJ)'), '2026-02-10');
    await fireEvent.changeText(screen.getByLabelText('Au (AAAA-MM-JJ)'), '2026-02-01');
    mockRpc.mockClear();
    await fireEvent.press(screen.getByText('Appliquer'));
    expect(screen.getByText(/Période invalide/)).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Au (AAAA-MM-JJ)'), '2026-02-20');
    await fireEvent.press(screen.getByText('Appliquer'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('admin_teaching_hours', { p_from: '2026-02-10', p_to: '2026-02-20' }),
    );
  });

  it('shows pending counters linking to the existing screens', async () => {
    await render(<Dashboard />);
    await fireEvent.press(await screen.findByText('2 profs en attente'));
    expect(mockPush).toHaveBeenCalledWith('/admin');
    await fireEvent.press(screen.getByText('1 justificatif en attente'));
    expect(mockPush).toHaveBeenCalledWith('/admin/students');
  });

  it('limits the member list to 50 with a see-all toggle', async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'admin_member_hours'
        ? {
            data: Array.from({ length: 60 }, (_, i) => ({ profile_id: `m${i}`, first_name: `N${i}`, last_name: 'X', sessions: 1, hours: 1 })),
            error: null,
          }
        : { data: [], error: null },
    );
    await render(<Dashboard />);
    await screen.findByText('N0 X');
    expect(screen.queryByText('N55 X')).toBeNull();
    await fireEvent.press(screen.getByText('Voir tout'));
    expect(screen.getByText('N55 X')).toBeTruthy();
  });

  it('denies access to non-admins', async () => {
    mockRole = 'eleve';
    await render(<Dashboard />);
    expect(screen.getByText('Accès réservé aux administrateurs.')).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
