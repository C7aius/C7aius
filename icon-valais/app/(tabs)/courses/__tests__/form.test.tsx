import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import { zurichToday } from '@/src/domain/courses';
import NewCourse from '../new';
import EditCourse from '../[id]/edit';

const mockRpc = jest.fn();
const mockReplace = jest.fn();
let mockTables: Record<string, unknown[]> = {};
let mockAuth: { profile: { id: string; role: string }; isActive: boolean };

jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: mockReplace, push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: mockTables[table] ?? [], error: null }).then(res);
      return q;
    },
  },
}));

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const locs = [
  { id: 'l1', name: 'Conthey', address: '', maps_url: '', is_default: true, archived: false },
  { id: 'l2', name: 'Sion', address: '', maps_url: '', is_default: false, archived: false },
  { id: 'l3', name: 'Vieux dojo', address: '', maps_url: '', is_default: false, archived: true },
];
const loc = { id: 'l1', name: 'Conthey', address: '', maps_url: '' };
const course = (over: Record<string, unknown> = {}) => ({
  id: 'c1', sport: 'jjb', level: 'adulte', kind: 'normal', status: 'prevu', prof_id: 'me', created_by: 'me',
  series_id: null, location_id: 'l1', starts_at: '2099-01-10T17:30:00.000Z', ends_at: '2099-01-10T19:00:00.000Z', places: 20,
  price_member: 0, price_non_member: 25, is_private: false, location: loc, ...over,
});

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { profile: { id: 'me', role: 'prof' }, isActive: true };
  mockRpc.mockResolvedValue({ data: ['c1'], error: null });
  mockTables = {
    locations: locs,
    public_profiles: [{ id: 'pr1', first_name: 'Marc', last_name: 'Prof', display_role: 'prof' }],
    courses: [course()],
    course_booking_counts: [],
    bookings: [],
  };
});

const fill = async (date: string) => {
  await screen.findByText('Conthey'); // lieux chargés, lieu par défaut sélectionné
  await fireEvent.changeText(await screen.findByLabelText('Date (AAAA-MM-JJ)'), date);
  await fireEvent.changeText(screen.getByLabelText('Début (HH:MM)'), '18:30');
  await fireEvent.changeText(screen.getByLabelText('Fin (HH:MM)'), '20:00');
};

describe('new course', () => {
  it('prof sees neither the private switch nor the prof picker', async () => {
    await render(<NewCourse />);
    expect(await screen.findByText('Cours récurrent')).toBeTruthy();
    expect(screen.queryByText('Cours privé')).toBeNull();
    expect(screen.queryByText('Prof')).toBeNull();
    expect(screen.queryByText('Vieux dojo')).toBeNull(); // lieu archivé non proposé
    await settle();
  });

  it('admin sees the private switch and the prof picker', async () => {
    mockAuth = { profile: { id: 'me', role: 'admin' }, isActive: true };
    await render(<NewCourse />);
    expect(await screen.findByText('Cours privé')).toBeTruthy();
    expect(screen.getByText('Prof')).toBeTruthy();
    expect(await screen.findByText('Marc Prof')).toBeTruthy();
    await settle();
  });

  it('submits create_course with the right payload (non recurring)', async () => {
    await render(<NewCourse />);
    await fill('2026-12-01');
    await fireEvent.changeText(screen.getByLabelText('Prix non-adhérent (CHF)'), '25');
    await fireEvent.press(screen.getByText('Créer le cours'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith('create_course', {
      p: {
        sport: 'jjb', level: 'adulte', kind: 'normal', is_private: false, location_id: 'l1',
        local_date: '2026-12-01', start_time: '18:30', end_time: '20:00',
        places: 20, price_member: 0, price_non_member: 25,
      },
      p_repeat_until: null,
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });

  it('prof recurring repeats until 31 December', async () => {
    await render(<NewCourse />);
    await fill(`${zurichToday().slice(0, 4)}-06-15`);
    await fireEvent(screen.getByLabelText('Cours récurrent'), 'valueChange', true);
    expect(await screen.findByText(`Chaque semaine jusqu'au 31.12.${zurichToday().slice(0, 4)}`)).toBeTruthy();
    await fireEvent.press(screen.getByText('Créer le cours'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc.mock.calls[0][1].p_repeat_until).toBe(`${zurichToday().slice(0, 4)}-12-31`);
  });

  it('admin recurring beyond the maximum is refused client side', async () => {
    mockAuth = { profile: { id: 'me', role: 'admin' }, isActive: true };
    await render(<NewCourse />);
    await fill('2026-12-01');
    await fireEvent(screen.getByLabelText('Cours récurrent'), 'valueChange', true);
    await fireEvent.changeText(await screen.findByLabelText("Répéter chaque semaine jusqu'au (AAAA-MM-JJ)"), '2032-01-01');
    await fireEvent.press(screen.getByText('Créer le cours'));
    expect(await screen.findByText('Date de fin trop lointaine')).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('shows a validation error for 0 places', async () => {
    await render(<NewCourse />);
    await fill('2026-12-01');
    await fireEvent.changeText(screen.getByLabelText('Places'), '0');
    await fireEvent.press(screen.getByText('Créer le cours'));
    expect(await screen.findByText('Entre 1 et 100 places')).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('translates the repeat_too_far error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', hint: 'repeat_too_far' } });
    await render(<NewCourse />);
    await fill('2026-12-01');
    await fireEvent.press(screen.getByText('Créer le cours'));
    expect(await screen.findByText('La répétition va trop loin dans le futur.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('edit course', () => {
  it('submits update_course with scope for a series occurrence', async () => {
    mockTables.courses = [course({ series_id: 's1' })];
    await render(<EditCourse />);
    await fireEvent.press(await screen.findByText('Ce cours et les suivants'));
    await fireEvent.changeText(screen.getByLabelText('Places'), '12');
    await fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith('update_course', {
      p_course: 'c1',
      p: expect.objectContaining({ places: 12, location_id: 'l1', sport: 'jjb', start_time: '18:30', end_time: '20:00' }),
      p_scope: 'following',
    });
    const p = mockRpc.mock.calls[0][1].p;
    expect(Object.keys(p).sort()).toEqual(
      ['end_time', 'kind', 'level', 'location_id', 'places', 'price_member', 'price_non_member', 'sport', 'start_time'],
    );
  });

  it('refuses a prof who is not the creator', async () => {
    mockTables.courses = [course({ created_by: 'other' })];
    await render(<EditCourse />);
    expect(await screen.findByText('Vous ne pouvez pas modifier ce cours.')).toBeTruthy();
    expect(screen.queryByText('Enregistrer')).toBeNull();
    await settle();
  });
});
