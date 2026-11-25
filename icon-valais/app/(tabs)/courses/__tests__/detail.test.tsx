import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import CourseDetail from '../[id]';

const mockRpc = jest.fn();
const mockPush = jest.fn();
let mockTables: Record<string, unknown[]> = {};
let mockAuth: { profile: { id: string; role: string }; isActive: boolean };

jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({ id: 'c1' }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, [cb]);
  },
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'ilike', 'or', 'neq']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'profiles' ? [] : (mockTables[table] ?? []), error: null }).then(res);
      return q;
    },
  },
}));

const future = new Date(Date.now() + 2 * 24 * 3600 * 1000);
const iso = (d: Date, addH = 0) => new Date(d.getTime() + addH * 3600 * 1000).toISOString();
const loc = { id: 'l1', name: 'Dojo Sion', address: 'Rue du Rhône 1, Sion', maps_url: 'https://maps.google.com/?q=sion' };
const course = (over: Record<string, unknown> = {}) => ({
  id: 'c1', sport: 'jjb', level: 'adulte', kind: 'normal', status: 'prevu', prof_id: null, created_by: 'pr1',
  series_id: null, location_id: 'l1', starts_at: iso(future), ends_at: iso(future, 1.5), places: 20,
  price_member: 0, price_non_member: 25, is_private: false, location: loc, ...over,
});
const participants = [
  { profile_id: 'st1', first_name: 'Anna', last_name: 'Eleve', age: 25, bjj_belt: 'bleue', present: false },
  { profile_id: 'pr1', first_name: 'Marc', last_name: 'Prof', age: 40, bjj_belt: 'noire', present: false },
];

// laisse finir les rechargements en cours avant la fin du test (évite les fuites d'act entre tests)
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { profile: { id: 'me', role: 'eleve' }, isActive: true };
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === 'course_participants' ? participants : null, error: null }),
  );
  mockTables = {
    courses: [course()],
    public_profiles: [{ id: 'pr1', first_name: 'Marc', last_name: 'Prof', display_role: 'prof' }],
    course_booking_counts: [{ course_id: 'c1', booked: 3 }],
    bookings: [],
  };
});

it('student sees no prof/admin action', async () => {
  await render(<CourseDetail />);
  expect(await screen.findByText('Dojo Sion ▾')).toBeTruthy();
  expect(screen.queryByText('Prendre ce cours')).toBeNull();
  expect(screen.queryByText('Assigner un prof')).toBeNull();
  expect(screen.queryByText('Annuler le cours')).toBeNull();
  expect(screen.queryByText('Modifier')).toBeNull();
  expect(screen.queryByText('Participants')).toBeNull();
});

it('creator prof can edit a non-private course', async () => {
  mockAuth = { profile: { id: 'pr1', role: 'prof' }, isActive: true };
  mockTables.courses = [course({ created_by: 'pr1' })];
  await render(<CourseDetail />);
  await fireEvent.press(await screen.findByText('Modifier'));
  expect(mockPush).toHaveBeenCalledWith('/courses/c1/edit');
  await settle();
});

it('creator prof cannot edit a private course', async () => {
  mockAuth = { profile: { id: 'pr1', role: 'prof' }, isActive: true };
  mockTables.courses = [course({ created_by: 'pr1', is_private: true })];
  await render(<CourseDetail />);
  expect(await screen.findByText('Dojo Sion ▾')).toBeTruthy();
  expect(screen.queryByText('Modifier')).toBeNull();
  await settle();
});

it('admin can edit a private course', async () => {
  mockAuth = { profile: { id: 'ad', role: 'admin' }, isActive: true };
  mockTables.courses = [course({ is_private: true })];
  await render(<CourseDetail />);
  expect(await screen.findByText('Modifier')).toBeTruthy();
  await settle();
});

it('prof takes a vacant slot; slot_taken shows message and reloads', async () => {
  mockAuth = { profile: { id: 'pr2', role: 'prof' }, isActive: true };
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: '22023', hint: 'slot_taken' } });
  await render(<CourseDetail />);
  fireEvent.press(await screen.findByText('Prendre ce cours'));
  expect(await screen.findByText('Ce créneau est déjà pris.')).toBeTruthy();
  expect(mockRpc).toHaveBeenCalledWith('take_slot', { p_course: 'c1' });
  mockTables.courses = [course({ prof_id: 'pr1' })];
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: '22023', hint: 'slot_taken' } });
  fireEvent.press(screen.getByText('Prendre ce cours'));
  await waitFor(() => expect(screen.queryByText('Prendre ce cours')).toBeNull());
  await settle();
});

it('assigned prof can leave', async () => {
  mockAuth = { profile: { id: 'pr1', role: 'prof' }, isActive: true };
  mockTables.courses = [course({ prof_id: 'pr1' })];
  await render(<CourseDetail />);
  fireEvent.press(await screen.findByText('Me retirer'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('leave_slot', { p_course: 'c1' }));
  await settle();
});

it('admin sees assign + cancel; series cancel offers scopes and sends following', async () => {
  mockAuth = { profile: { id: 'ad', role: 'admin' }, isActive: true };
  mockTables.courses = [course({ series_id: 's1' })];
  await render(<CourseDetail />);
  expect(await screen.findByText('Assigner un prof')).toBeTruthy();
  fireEvent.press(screen.getByText('Annuler le cours'));
  fireEvent.press(await screen.findByText('Ce cours et les suivants'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ce cours et les suivants', selected: true })).toBeTruthy());
  expect(mockRpc).not.toHaveBeenCalledWith('cancel_course', expect.anything());
  fireEvent.press(screen.getByText("Confirmer l'annulation"));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('cancel_course', { p_course: 'c1', p_scope: 'following' }));
  await settle();
});

it('admin assigns a prof', async () => {
  mockAuth = { profile: { id: 'ad', role: 'admin' }, isActive: true };
  mockRpc.mockResolvedValue({ data: [], error: null });
  await render(<CourseDetail />);
  fireEvent.press(await screen.findByText('Assigner un prof'));
  fireEvent.press(await screen.findByText('Marc Prof'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('assign_prof', { p_course: 'c1', p_prof: 'pr1' }));
  await settle();
});

describe('attendance', () => {
  beforeEach(() => {
    mockAuth = { profile: { id: 'pr1', role: 'prof' }, isActive: true };
    mockTables.courses = [course({ prof_id: 'pr1' })];
  });

  it('assigned prof ticks a participant', async () => {
    await render(<CourseDetail />);
    fireEvent.press(await screen.findByLabelText('Présent : Anna Eleve'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('set_attendance', { p_course: 'c1', p_profile: 'st1', p_present: true }),
    );
    await settle();
  });

  it('too_early shows a translated message', async () => {
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'course_participants'
          ? { data: participants, error: null }
          : { data: null, error: { code: '22023', hint: 'too_early' } },
      ),
    );
    await render(<CourseDetail />);
    fireEvent.press(await screen.findByLabelText('Présent : Anna Eleve'));
    expect(await screen.findByText("Action impossible avant le début du cours.")).toBeTruthy();
  });

  // Régression (vu dans le navigateur) : un élève sans ceinture de jjb affichait la clé brute « belts.null ».
  it('shows no belt text for a participant without bjj belt', async () => {
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve({
        data: fn === 'course_participants' ? [{ ...participants[0], bjj_belt: null }] : null,
        error: null,
      }),
    );
    await render(<CourseDetail />);
    await screen.findByLabelText('Présent : Anna Eleve');
    expect(screen.queryByText(/belts\./)).toBeNull();
    expect(screen.getByText(/25 ans/)).toBeTruthy();
  });

  it('no Belt button on the prof own row', async () => {
    await render(<CourseDetail />);
    await screen.findByLabelText('Présent : Anna Eleve');
    expect(screen.getByLabelText('Ceinture : Anna Eleve')).toBeTruthy();
    expect(screen.queryByLabelText('Ceinture : Marc Prof')).toBeNull();
  });
});
