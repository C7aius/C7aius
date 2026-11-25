import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Courses from '../index';

const mockRpc = jest.fn();
const mockPush = jest.fn();
let mockTables: Record<string, unknown[]> = {};
let mockCoursesQueue: Promise<unknown[]>[] | null = null;
let mockCoursesCalls = 0;
let mockKids: { id: string; first_name: string }[] = [];

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'me', role: 'eleve' }, ready: true }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, [cb]);
  },
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'order']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => {
        if (table === 'courses' && mockCoursesQueue) {
          mockCoursesCalls++;
          return mockCoursesQueue.shift()!.then((data) => ({ data, error: null })).then(res);
        }
        return Promise.resolve({ data: table === 'profiles' ? mockKids : (mockTables[table] ?? []), error: null }).then(res);
      };
      return q;
    },
  },
}));

const future = new Date(Date.now() + 2 * 24 * 3600 * 1000);
const iso = (d: Date, addH = 0) => new Date(d.getTime() + addH * 3600 * 1000).toISOString();
const loc = { id: 'l1', name: 'Dojo Sion', address: 'Rue du Rhône 1, Sion', maps_url: 'https://maps.google.com/?q=sion' };
const course = (over: Record<string, unknown>) => ({
  id: 'c1', sport: 'jjb', level: 'adulte', kind: 'normal', status: 'prevu', prof_id: 'pr1', location_id: 'l1',
  starts_at: iso(future), ends_at: iso(future, 1.5), places: 20, price_member: 0, price_non_member: 25,
  is_private: false, location: loc, ...over,
});

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCoursesQueue = null;
  mockCoursesCalls = 0;
  mockRpc.mockResolvedValue({ data: 'b1', error: null });
  mockKids = [];
  mockTables = {
    courses: [course({})],
    public_profiles: [{ id: 'pr1', first_name: 'Marc', last_name: 'Prof' }],
    course_booking_counts: [{ course_id: 'c1', booked: 3 }],
    bookings: [],
  };
});

it('shows prof, counts and prices', async () => {
  await render(<Courses />);
  expect(await screen.findByText(/Marc Prof/)).toBeTruthy();
  expect(screen.getByText('3 / 20 inscrits')).toBeTruthy();
  expect(screen.getByText('Adhérent : Gratuit')).toBeTruthy();
  expect(screen.getByText('Non-adhérent : 25.00 CHF')).toBeTruthy();
});

it('cancelled course has no book button', async () => {
  mockTables.courses = [course({ status: 'annule' })];
  await render(<Courses />);
  expect(await screen.findByText('Annulé')).toBeTruthy();
  expect(screen.queryByText('Réserver')).toBeNull();
});

it('vacant course shows Créneau libre', async () => {
  mockTables.courses = [course({ prof_id: null })];
  await render(<Courses />);
  expect(await screen.findByText('Créneau libre')).toBeTruthy();
});

it('book calls book_course', async () => {
  await render(<Courses />);
  await fireEvent.press(await screen.findByText('Réserver'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('book_course', { p_course: 'c1' }));
});

it('unbook when already booked', async () => {
  mockTables.bookings = [{ course_id: 'c1', profile_id: 'me' }];
  await render(<Courses />);
  await fireEvent.press(await screen.findByText('Se désinscrire'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('unbook_course', { p_course: 'c1' }));
});

it('parent books for a child', async () => {
  mockKids = [{ id: 'k1', first_name: 'Léo' }];
  await render(<Courses />);
  await fireEvent.press(await screen.findByText('Léo'));
  await fireEvent.press(screen.getByText('Réserver'));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('book_course', { p_course: 'c1', p_profile: 'k1' }));
});

it('shows translated error for course_closed', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', hint: 'course_closed' } });
  await render(<Courses />);
  await fireEvent.press(await screen.findByText('Réserver'));
  expect(await screen.findByText('Ce cours est annulé ou a déjà commencé.')).toBeTruthy();
});

it('expands location with address and https link', async () => {
  await render(<Courses />);
  await fireEvent.press(await screen.findByLabelText("Lieu Dojo Sion"));
  expect(screen.getByText('Rue du Rhône 1, Sion')).toBeTruthy();
  const link = screen.getByRole('link');
  expect(link.props.href).toMatch(/^https:\/\//);
});

it('tapping a card navigates to the detail', async () => {
  await render(<Courses />);
  await fireEvent.press(await screen.findByLabelText(/Jiu-jitsu brésilien/));
  expect(mockPush).toHaveBeenCalledWith('/courses/c1');
});

it('pressing book, a child chip or the location toggle does not open the detail', async () => {
  mockKids = [{ id: 'k1', first_name: 'Léo' }];
  await render(<Courses />);
  await fireEvent.press(await screen.findByText('Léo'));
  await fireEvent.press(screen.getByText('Réserver'));
  await fireEvent.press(screen.getByLabelText('Lieu Dojo Sion'));
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText(/Jiu-jitsu brésilien/));
  expect(mockPush).toHaveBeenCalledWith('/courses/c1');
});

it('ignores a stale response after a quick week switch', async () => {
  let resolveA!: (v: unknown[]) => void;
  let resolveB!: (v: unknown[]) => void;
  mockCoursesQueue = [
    new Promise((r) => { resolveA = r; }),
    new Promise((r) => { resolveB = r; }),
  ];
  await render(<Courses />);
  await waitFor(() => expect(mockCoursesCalls).toBe(1));
  await fireEvent.press(screen.getByLabelText('Semaine suivante'));
  await waitFor(() => expect(mockCoursesCalls).toBe(2));
  await act(async () => { resolveB([course({ id: 'c2', price_non_member: 22 })]); });
  expect(await screen.findByText('Non-adhérent : 22.00 CHF')).toBeTruthy();
  await act(async () => { resolveA([course({ id: 'c1', price_non_member: 11 })]); });
  expect(screen.getByText('Non-adhérent : 22.00 CHF')).toBeTruthy();
  expect(screen.queryByText('Non-adhérent : 11.00 CHF')).toBeNull();
});
