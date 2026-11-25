import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import ProfileHome from '../index';
import Children from '../children';
import Edit from '../edit';

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
const mockSignOut = jest.fn();
const mockRefresh = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();

const profile = {
  id: 'p1', role: 'eleve', first_name: 'Ana', last_name: 'Roux', age: 30, phone: null,
  sports: ['jjb'], bjj_belt: 'bleue', years_grappling: null, years_mma: null, language: 'fr',
  coach_years: null, training_places: null, competition_awards: null, cv: null,
};

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile, signOut: mockSignOut, refresh: mockRefresh }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, []),
  Link: ({ children }: { children: unknown }) => <>{children}</>,
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      update: (patch: unknown) => ({ eq: (...a: unknown[]) => mockEq(patch, ...a) }),
    }),
  },
}));

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  mockRpc.mockResolvedValue({ data: 'c1', error: null });
  mockEq.mockResolvedValue({ error: null });
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
});

const press = async (label: string) => fireEvent.press(screen.getByText(label));

describe('account deletion', () => {
  it('asks two confirmations before calling delete-account, then signs out', async () => {
    await render(<ProfileHome />);
    await press('Supprimer mon compte');
    expect(mockInvoke).not.toHaveBeenCalled();
    await press('Continuer');
    expect(mockInvoke).not.toHaveBeenCalled();
    await press('Supprimer définitivement');
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('delete-account'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('does not sign out when deletion fails', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('x') });
    await render(<ProfileHome />);
    await press('Supprimer mon compte');
    await press('Continuer');
    await press('Supprimer définitivement');
    await waitFor(() => expect(screen.getByText('Une erreur est survenue')).toBeTruthy());
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('account deletion: last admin', () => {
  it('explains the 409 returned for the last admin', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { context: { status: 409, json: async () => ({ error: 'last_admin' }) } } });
    await render(<ProfileHome />);
    await press('Supprimer mon compte');
    await press('Continuer');
    await press('Supprimer définitivement');
    expect(await screen.findByText(i18n.t('errors.lastAdminDelete'))).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('children', () => {
  it('refuses a child of 18 or more before calling the server', async () => {
    await render(<Children />);
    await waitFor(() => expect(screen.getByText('Ajouter un enfant')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Prénom'), 'Leo');
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Roux');
    await fireEvent.changeText(screen.getByLabelText('Âge'), '18');
    await press('Grappling');
    await fireEvent.changeText(screen.getByLabelText('Années de grappling'), '1');
    await press('Ajouter');
    expect(screen.getByText(i18n.t('errors.childMustBeMinor'))).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });


  it('creates a child of 8 years via create_child_profile', async () => {
    await render(<Children />);
    await waitFor(() => expect(screen.getByText('Ajouter un enfant')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Prénom'), 'Leo');
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Roux');
    await fireEvent.changeText(screen.getByLabelText('Âge'), '8');
    await press('Grappling');
    await fireEvent.changeText(screen.getByLabelText('Années de grappling'), '1');
    await press('Ajouter');
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith(
      'create_child_profile',
      { p: expect.objectContaining({ first_name: 'Leo', last_name: 'Roux', age: 8, sports: ['grappling'], years_grappling: 1 }) },
    );
  });
});

describe('profile edit', () => {
  it('shows the belt read-only and saves the editable fields', async () => {
    await render(<Edit />);
    expect(screen.getByText('Bleue')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Téléphone (facultatif)'), '079 123');
    await press('Enregistrer');
    await waitFor(() => expect(mockEq).toHaveBeenCalled());
    expect(mockEq).toHaveBeenCalledWith(expect.objectContaining({ phone: '079 123', age: 30 }), 'id', 'p1');
    expect(mockEq.mock.calls[0][0]).not.toHaveProperty('bjj_belt');
  });

  it('explains when a kid belt blocks an age of 18 or more', async () => {
    mockEq.mockResolvedValue({ error: { code: '23514' } });
    await render(<Edit />);
    await fireEvent.changeText(screen.getByLabelText('Âge'), '19');
    await press('Enregistrer');
    await waitFor(() => expect(screen.getByText(i18n.t('errors.kidBeltAdult'))).toBeTruthy());
  });

  it('explains that the age cannot go below 16 without consent', async () => {
    mockEq.mockResolvedValue({ error: { code: '42501', hint: 'age_lower_requires_consent' } });
    await render(<Edit />);
    await fireEvent.changeText(screen.getByLabelText('Âge'), '15');
    await press('Enregistrer');
    expect(await screen.findByText(i18n.t('errors.ageLowerRequiresConsent'))).toBeTruthy();
  });

  it('keeps the UI language when saving the language fails', async () => {
    mockEq.mockResolvedValue({ error: { code: 'XX' } });
    await render(<Edit />);
    await press('Deutsch');
    await waitFor(() => expect(mockEq).toHaveBeenCalledWith({ language: 'de' }, 'id', 'p1'));
    expect(await screen.findByText('Une erreur est survenue')).toBeTruthy();
    expect(i18n.language).toBe('fr');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('persists the language and switches the UI', async () => {
    await render(<Edit />);
    await press('Русский');
    await waitFor(() => expect(mockEq).toHaveBeenCalledWith({ language: 'ru' }, 'id', 'p1'));
    expect(i18n.language).toBe('ru');
  });
});
