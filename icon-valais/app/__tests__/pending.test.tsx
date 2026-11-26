import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import { act } from '@testing-library/react-native';
import { setConsentSendResult } from '@/src/auth/consentNotice';
import Pending from '../pending';

const mockInvoke = jest.fn();
jest.mock('@/src/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { role: 'eleve', age: 12, prof_status: null, parent_email: 'maman@test.ch' },
    refresh: jest.fn(),
    signOut: jest.fn(),
  }),
}));

beforeAll(() => initI18n('fr'));
beforeEach(() => {
  jest.clearAllMocks();
  setConsentSendResult(undefined);
});

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
  it('maps 400 (own email) and 409 (locked) using the response body', async () => {
    const res = (status: number, error: string) => ({ data: null, error: { context: { status, json: async () => ({ error }) } } });
    await resend(res(400, 'parent_email must differ from own email'));
    expect(await screen.findByText(i18n.t('pending.ownEmail'))).toBeTruthy();
    await fireEvent.press(screen.getByText("Renvoyer l'e-mail au parent"));
    mockInvoke.mockResolvedValue(res(409, 'parent_email_locked'));
    await fireEvent.press(screen.getByText("Renvoyer l'e-mail au parent"));
    expect(await screen.findByText(i18n.t('pending.locked'))).toBeTruthy();
  });
});

describe('pending consent screen', () => {
  it('shows the address the email was sent to', async () => {
    await render(<Pending />);
    expect(screen.getByText('Adresse du parent : maman@test.ch')).toBeTruthy();
    expect(screen.getByText(i18n.t('pending.minorBody'))).toBeTruthy();
  });

  it('does not claim the email was sent when the signup send failed', async () => {
    setConsentSendResult('pending.deliveryFailed');
    await render(<Pending />);
    expect(screen.getByText(i18n.t('pending.minorBodyNotSent'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('pending.minorBody'))).toBeNull();
    expect(screen.getByText(i18n.t('pending.deliveryFailed'))).toBeTruthy();
    expect(screen.getByText("Renvoyer l'e-mail au parent")).toBeTruthy();
    // un renvoi réussi rétablit le texte normal
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await fireEvent.press(screen.getByText("Renvoyer l'e-mail au parent"));
    expect(await screen.findByText(i18n.t('pending.minorBody'))).toBeTruthy();
  });

  it('updates when the signup send fails after the screen is shown', async () => {
    await render(<Pending />);
    expect(screen.getByText(i18n.t('pending.minorBody'))).toBeTruthy();
    await act(async () => setConsentSendResult('pending.deliveryFailed'));
    expect(screen.getByText(i18n.t('pending.minorBodyNotSent'))).toBeTruthy();
    expect(screen.getByText(i18n.t('pending.deliveryFailed'))).toBeTruthy();
  });
});
