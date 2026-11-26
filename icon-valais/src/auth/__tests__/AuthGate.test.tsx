import { act, render, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
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

const mockRegisterForPush = jest.fn();
jest.mock('@/src/lib/push', () => ({ registerForPush: () => mockRegisterForPush() }));

const session = { user: { id: 'u1' } };
const targets = () => mockReplace.mock.calls.map((c) => c[0]);

beforeAll(() => initI18n('fr'));

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  jest.clearAllMocks();
  mockSession = null;
  mockSegments = [];
  mockProfile = null;
  mockActive = true;
  mockGate = Promise.resolve();
  mockRegisterForPush.mockResolvedValue('registered');
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

  it('routes a PASSWORD_RECOVERY session to /reset-password, never to the tabs', async () => {
    mockSegments = ['(auth)', 'login'];
    mockProfile = { role: 'eleve', language: 'fr' };
    await mount();
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalledWith('/'));
    await act(async () => {
      authCb?.('PASSWORD_RECOVERY', session);
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reset-password'));
    // déjà sur l'écran : pas de redirection vers les onglets même avec un compte actif
    mockReplace.mockClear();
    mockSegments = ['(auth)', 'reset-password'];
    await act(async () => {
      authCb?.('TOKEN_REFRESHED', { user: { id: 'u1' } });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(targets()).not.toContain('/');
    expect(targets()).not.toContain('/reset-password');
  });

  it('restores the language saved in the profile when it loads', async () => {
    mockSession = session;
    mockProfile = { role: 'eleve', language: 'de' };
    await mount();
    await waitFor(() => expect(i18n.language).toBe('de'));
  });
});

describe('push registration', () => {
  it('pending prof registers (inactive account, to receive prof_validated)', async () => {
    mockSession = session;
    mockProfile = { role: 'prof', prof_status: 'en_attente' };
    mockActive = false;
    await mount();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/pending'));
    await waitFor(() => expect(mockRegisterForPush).toHaveBeenCalledTimes(1));
  });

  it('active user registers once', async () => {
    mockSession = session;
    mockProfile = { role: 'eleve', language: 'fr' };
    await mount();
    await waitFor(() => expect(mockRegisterForPush).toHaveBeenCalledTimes(1));
    await act(async () => {
      authCb?.('TOKEN_REFRESHED', { user: { id: 'u1' } });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRegisterForPush).toHaveBeenCalledTimes(1);
  });

  it('does not register without a session or a profile', async () => {
    await mount();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    mockSession = session;
    mockProfile = null;
    await act(async () => {
      authCb?.('SIGNED_IN', session);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRegisterForPush).not.toHaveBeenCalled();
  });
});
