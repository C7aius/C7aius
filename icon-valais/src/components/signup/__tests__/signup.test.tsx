import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import { SignupWizard } from '../SignupWizard';

const mockSignUp = jest.fn();
const mockInvoke = jest.fn();
const mockRefresh = jest.fn();

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: { signUp: (...a: unknown[]) => mockSignUp(...a) },
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
  },
}));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ refresh: mockRefresh }),
}));

const press = async (label: string) => fireEvent.press(screen.getByText(label));
const type = async (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);

async function fillIdentity(age: string) {
  await type('Prénom', 'Ana');
  await type('Nom', 'Roux');
  await type('E-mail', 'ana@example.com');
  await type('Mot de passe', 'password1');
  await type('Confirmer le mot de passe', 'password1');
  await type('Âge', age);
}

async function goToSports(age: string, role: 'Élève' | 'Professeur' = 'Élève') {
  await press(role);
  await press('Suivant');
  await fillIdentity(age);
  await press('Suivant');
}

beforeAll(async () => {
  await initI18n('fr');
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('SignupWizard', () => {
  it('shows the Grise belt option at age 12 with JJB', async () => {
    await render(<SignupWizard />);
    await goToSports('12');
    await press('Jiu-jitsu brésilien');
    expect(screen.getByText('Grise')).toBeTruthy();
  });

  it('does not show the Grise belt option at age 25', async () => {
    await render(<SignupWizard />);
    await goToSports('25');
    await press('Jiu-jitsu brésilien');
    expect(screen.getByText('Bleue')).toBeTruthy();
    expect(screen.queryByText('Grise')).toBeNull();
  });

  it('adds the parent email step at age 14 but not at 16', async () => {
    const { unmount } = await render(<SignupWizard />);
    await goToSports('14');
    await press('Grappling');
    await type('Années de grappling', '1');
    await press('Suivant');
    expect(screen.getByText('Vous avez moins de 16 ans', { exact: false })).toBeTruthy();
    await unmount();

    await render(<SignupWizard />);
    await goToSports('16');
    await press('Grappling');
    await type('Années de grappling', '1');
    expect(screen.getByText("S'inscrire")).toBeTruthy();
    expect(screen.queryByText('Suivant')).toBeNull();
  });

  it('adds the coach step for the Professeur role', async () => {
    await render(<SignupWizard />);
    await goToSports('30', 'Professeur');
    await press('Grappling');
    await type('Années de grappling', '1');
    await press('Suivant');
    expect(screen.getByLabelText("Années d'expérience de coach")).toBeTruthy();
  });

  it('shows emailTaken and keeps the field values when the email already exists', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    });
    await render(<SignupWizard />);
    await goToSports('30');
    await press('MMA');
    await type('Années de MMA', '2');
    await press("S'inscrire");

    expect(await screen.findByText('Cette adresse e-mail est déjà utilisée')).toBeTruthy();
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    expect(mockSignUp.mock.calls[0][0]).toMatchObject({
      email: 'ana@example.com',
      options: { data: { first_name: 'Ana', age: 30, sports: ['mma'], years_mma: 2, role: 'eleve' } },
    });

    // values kept after going back to the identity step
    await press('Retour');
    expect(screen.getByLabelText('E-mail').props.value).toBe('ana@example.com');
    expect(screen.getByLabelText('Prénom').props.value).toBe('Ana');
    expect(screen.getByLabelText('Âge').props.value).toBe('30');
  });

  it('sends the consent email after signUp for a minor', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: 't' }, user: { id: 'u' } },
      error: null,
    });
    await render(<SignupWizard />);
    await goToSports('12');
    await press('Grappling');
    await type('Années de grappling', '1');
    await press('Suivant');
    await type('E-mail du parent', 'parent@example.com');
    await press("S'inscrire");

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith('send-parent-consent', {
      body: { parent_email: 'parent@example.com' },
    });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
