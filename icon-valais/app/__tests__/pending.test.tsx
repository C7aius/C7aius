import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Pending from '../pending';

const mockInvoke = jest.fn();
jest.mock('@/src/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { role: 'eleve', age: 12, prof_status: null },
    refresh: jest.fn(),
    signOut: jest.fn(),
  }),
}));

beforeAll(() => initI18n('fr'));
beforeEach(() => jest.clearAllMocks());

async function resend(result: unknown) {
  mockInvoke.mockResolvedValue(result);
  await render(<Pending />);
  await fireEvent.press(screen.getByText("Renvoyer l'e-mail au parent"));
}

describe('pending resend', () => {
  it('maps 429 to tooMany', async () => {
    await resend({ data: null, error: { context: { status: 429 } } });
    expect(await screen.findByText('Trop de demandes : réessayez plus tard.')).toBeTruthy();
  });
  it('maps 409 to notEligible', async () => {
    await resend({ data: null, error: { context: { status: 409 } } });
    expect(await screen.findByText('Aucun e-mail ne peut être envoyé pour ce compte.')).toBeTruthy();
  });
  it('maps other errors to generic and success to resent', async () => {
    await resend({ data: null, error: { context: { status: 500 } } });
    expect(await screen.findByText('Une erreur est survenue')).toBeTruthy();
  });
  it('shows resent on success', async () => {
    await resend({ data: { ok: true }, error: null });
    await waitFor(() => expect(screen.getByText('E-mail envoyé au parent.')).toBeTruthy());
  });
});
