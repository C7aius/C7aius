import { act, render, waitFor } from '@testing-library/react-native';

import { AuthGate } from '../AuthGate';
import { AuthProvider } from '../AuthProvider';

const mockReplace = jest.fn();
let mockSegments: string[] = [];
jest.mock('expo-router', () => ({
  Stack: () => null,
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockSegments,
}));

let mockSession: unknown = null;
let authCb: ((e: string, s: unknown) => void) | null = null;
let mockProfile: unknown = null;
let mockActive = true;
let mockGate: Promise<void> = Promise.resolve();

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      signOut: jest.fn(),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            await mockGate;
            return { data: mockProfile, error: null };
          },
        }),
      }),
    }),
    rpc: async () => ({ data: mockActive, error: null }),
  },
}));

const session = { user: { id: 'u1' } };
const targets = () => mockReplace.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockSegments = [];
  mockProfile = null;
  mockActive = true;
  mockGate = Promise.resolve();
});

const mount = () =>
  render(
    <AuthProvider>
      <AuthGate />
    </AuthProvider>,
  );

describe('AuthGate', () => {
  it('sends a visitor without session to /login', async () => {
    await mount();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('sends an inactive prof to /pending', async () => {
    mockSession = session;
    mockProfile = { role: 'prof', prof_status: 'en_attente' };
    mockActive = false;
    await mount();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/pending'));
  });

  it('never routes an active user to /pending while the profile loads after login', async () => {
    mockSegments = ['(auth)'];
    mockProfile = { role: 'eleve' };
    let release!: () => void;
    mockGate = new Promise((r) => (release = r));
    await mount();
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalledWith('/pending'));
    mockReplace.mockClear();

    await act(async () => {
      authCb?.('SIGNED_IN', session); // login: session arrives, profile still loading
    });
    expect(targets()).not.toContain('/pending');
    await act(async () => release());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(targets()).not.toContain('/pending');
  });
});
