import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import ForgotPassword from '../forgot-password';
import Login from '../login';
import ResetPassword from '../reset-password';

const mockSignIn = jest.fn();
const mockReset = jest.fn();
const mockUpdateUser = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn();
const mockEndRecovery = jest.fn();
let mockAuth: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: string }) => {
    const { Text } = require('react-native');
    return <Text>{children}</Text>;
  },
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-linking', () => ({ useLinkingURL: () => null }));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
      resetPasswordForEmail: (...a: unknown[]) => mockReset(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      setSession: jest.fn(),
    },
  },
}));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

beforeAll(() => initI18n('fr'));
beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
  mockAuth = {
    session: { user: { id: 'u1' } },
    recovering: true,
    startRecovery: jest.fn(),
    endRecovery: mockEndRecovery,
    signOut: mockSignOut,
  };
});

const press = async (label: string) => fireEvent.press(screen.getByText(label));
const type = async (label: string, v: string) => fireEvent.changeText(screen.getByLabelText(label), v);

describe('login', () => {
  async function loginWith(error: unknown) {
    mockSignIn.mockResolvedValue({ data: {}, error });
    await render(<Login />);
    await type('E-mail', 'a@b.ch');
    await type('Mot de passe', 'x');
    await press('Se connecter');
  }
  it('maps error.code invalid_credentials to the credentials message', async () => {
    await loginWith({ code: 'invalid_credentials', message: 'Invalid login credentials' });
    expect(await screen.findByText(i18n.t('auth.invalidCredentials'))).toBeTruthy();
  });
  it('does not rely on the message text', async () => {
    await loginWith({ code: 'email_not_confirmed', message: 'invalid something' });
    expect(await screen.findByText(i18n.t('errors.generic'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('auth.invalidCredentials'))).toBeNull();
  });
});

describe('forgot password', () => {
  it('sends the reset email with a redirectTo to /reset-password', async () => {
    mockReset.mockResolvedValue({ error: null });
    await render(<ForgotPassword />);
    await type('E-mail', ' a@b.ch ');
    await press('Envoyer le lien');
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    const [email, opts] = mockReset.mock.calls[0];
    expect(email).toBe('a@b.ch');
    expect(opts.redirectTo).toMatch(/\/reset-password$/);
  });
});

describe('reset password', () => {
  it('requires 8 characters and a matching confirmation', async () => {
    await render(<ResetPassword />);
    await type('Nouveau mot de passe', 'short');
    await type('Confirmer le mot de passe', 'short');
    await press('Changer le mot de passe');
    expect(screen.getByText(i18n.t('errors.passwordTooShort'))).toBeTruthy();
    await type('Nouveau mot de passe', 'longenough1');
    await type('Confirmer le mot de passe', 'longenough2');
    await press('Changer le mot de passe');
    expect(screen.getByText(i18n.t('errors.passwordMismatch'))).toBeTruthy();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('updates the password, ends the recovery, signs out and goes to login', async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: null });
    await render(<ResetPassword />);
    await type('Nouveau mot de passe', 'longenough1');
    await type('Confirmer le mot de passe', 'longenough1');
    await press('Changer le mot de passe');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/login', params: { reset: '1' } }));
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'longenough1' });
    expect(mockEndRecovery).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
    // déconnexion d'abord : AuthGate ne doit jamais voir une session active hors récupération
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(mockEndRecovery.mock.invocationCallOrder[0]);
  });

  it('shows an error and stays when updateUser fails', async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: { code: 'same_password' } });
    await render(<ResetPassword />);
    await type('Nouveau mot de passe', 'longenough1');
    await type('Confirmer le mot de passe', 'longenough1');
    await press('Changer le mot de passe');
    expect(await screen.findByText(i18n.t('auth.samePassword'))).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('explains an invalid or expired link when there is no recovery session', async () => {
    mockAuth = { ...mockAuth, session: null, recovering: false };
    await render(<ResetPassword />);
    expect(screen.getByText(i18n.t('auth.resetLinkInvalid'))).toBeTruthy();
    expect(screen.queryByLabelText('Nouveau mot de passe')).toBeNull();
  });
});
