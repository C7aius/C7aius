import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import { BeltEditor } from '@/src/components/BeltEditor';
import AdminList from '../index';
import AdminUser from '../user/[id]';

const mockRpc = jest.fn();
const mockAuthRefresh = jest.fn();
const mockUpdate = jest.fn();
const mockPush = jest.fn();
let mockRole = 'admin';
let mockReady = true;
let mockFocusCb: (() => void) | null = null;
let mockSelectError: { code?: string } | null = null;
let mockParams: { id?: string } = {};
let mockRows: Record<string, unknown>[] = [];
const mockSideQuery = () => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'order', 'limit']) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return q;
};

const year = new Date().getFullYear();
const base = {
  email: null, phone: null, sports: ['jjb'], language: 'fr', paid_until: null, bjj_belt: null,
  auth_user_id: 'a', parent_profile_id: null,
};
const prof = (id: string, first: string, prof_status: string | null, role = 'prof') => ({
  ...base, id, first_name: first, last_name: 'Test', role, prof_status, age: 30,
});

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: mockReady ? { id: 'admin1', role: mockRole } : null, ready: mockReady, refresh: mockAuthRefresh }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    mockFocusCb = cb;
    require('react').useEffect(cb, []);
  },
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => table !== 'profiles' ? mockSideQuery() : ({
      update: (patch: unknown) => ({ eq: (...a: unknown[]) => mockUpdate(patch, ...a) }),
      select: () => ({
        order: async () => ({ data: mockRows, error: mockSelectError }),
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => ({
            data: mockSelectError ? null : (mockRows.find((r) => r.id === id) ?? null),
            error: mockSelectError,
          }),
        }),
      }),
    }),
  },
}));

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockRole = 'admin';
  mockReady = true;
  mockSelectError = null;
  mockParams = {};
  mockRows = [
    prof('p1', 'Alice', 'en_attente'),
    prof('p2', 'Bruno', 'valide'),
    prof('e1', 'Chloe', null, 'eleve'),
  ];
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockUpdate.mockResolvedValue({ error: null });
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
});

const press = async (label: string) => fireEvent.press(screen.getByText(label));

describe('account list', () => {
  it('links to the locations screen', async () => {
    await render(<AdminList />);
    await waitFor(() => expect(screen.getByText('Chloe Test')).toBeTruthy());
    await fireEvent.press(screen.getByText('Lieux'));
    expect(mockPush).toHaveBeenCalledWith('/admin/locations');
  });

  it('shows membership and trial badges from admin_member_overview', async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'admin_member_overview'
        ? {
            data: [
              { profile_id: 'p2', member_until: '2027-03-31', trial_used: 0 },
              { profile_id: 'e1', member_until: null, trial_used: 3 },
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    await render(<AdminList />);
    expect(await screen.findByText("Adhérent jusqu'au 31.03.2027")).toBeTruthy();
    expect(screen.getByText('Non-adhérent - Essais 3/10')).toBeTruthy();
  });

  it('links to pricing, student proofs and payments', async () => {
    await render(<AdminList />);
    await waitFor(() => expect(screen.getByText('Chloe Test')).toBeTruthy());
    await fireEvent.press(screen.getByText('Tarifs'));
    await fireEvent.press(screen.getByText('Justificatifs étudiants'));
    await fireEvent.press(screen.getByText('Paiements'));
    expect(mockPush).toHaveBeenCalledWith('/admin/pricing');
    expect(mockPush).toHaveBeenCalledWith('/admin/students');
    expect(mockPush).toHaveBeenCalledWith('/admin/payments');
  });

  it('lists everyone, then only pending profs with the pending filter', async () => {
    await render(<AdminList />);
    await waitFor(() => expect(screen.getByText('Chloe Test')).toBeTruthy());
    expect(screen.getByText('Bruno Test')).toBeTruthy();
    await press('Profs en attente');
    expect(screen.getByText('Alice Test')).toBeTruthy();
    expect(screen.queryByText('Bruno Test')).toBeNull();
    expect(screen.queryByText('Chloe Test')).toBeNull();
  });

  it('searches by name', async () => {
    await render(<AdminList />);
    await waitFor(() => expect(screen.getByText('Chloe Test')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Rechercher'), 'bru');
    expect(screen.getByText('Bruno Test')).toBeTruthy();
    expect(screen.queryByText('Alice Test')).toBeNull();
  });

  it('reloads the list when the screen regains focus', async () => {
    await render(<AdminList />);
    await waitFor(() => expect(screen.getByText('Alice Test')).toBeTruthy());
    mockRows = [prof('p1', 'Alice', 'valide'), prof('p2', 'Bruno', 'valide'), prof('e1', 'Chloe', null, 'eleve')];
    await act(async () => {
      mockFocusCb?.();
    });
    await press('Profs en attente');
    expect(screen.queryByText('Alice Test')).toBeNull();
  });

  it('shows loading, not forbidden, while the profile is loading', async () => {
    mockReady = false;
    await render(<AdminList />);
    expect(screen.getByText(i18n.t('common.loading'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('admin.forbidden'))).toBeNull();
  });

  it('refuses non-admins', async () => {
    mockRole = 'prof';
    await render(<AdminList />);
    expect(screen.getByText(i18n.t('admin.forbidden'))).toBeTruthy();
    expect(screen.queryByText('Alice Test')).toBeNull();
  });
});

describe('account detail', () => {
  it('validates a pending prof via admin_set_prof_status', async () => {
    mockParams = { id: 'p1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Valider')).toBeTruthy());
    await press('Valider');
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('admin_set_prof_status', { p_profile: 'p1', p_status: 'valide' }),
    );
  });

  it('marks paid for the year and then shows the membership end', async () => {
    mockParams = { id: 'e1' };
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'admin_mark_paid_current_year') mockRows[2] = { ...mockRows[2], paid_until: `${year}-12-31` };
      return { data: null, error: null };
    });
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText("Payé pour l'année")).toBeTruthy());
    await press("Payé pour l'année");
    await waitFor(() => expect(screen.getByText(`Adhérent jusqu'au 31.12.${year}`)).toBeTruthy());
    expect(mockRpc).toHaveBeenCalledWith('admin_mark_paid_current_year', { p_profile: 'e1' });
  });

  it('changes the role via admin_set_role', async () => {
    mockParams = { id: 'e1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Professeur')).toBeTruthy());
    await press('Professeur');
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('admin_set_role', { p_profile: 'e1', p_role: 'prof' }),
    );
  });

  it('shows a translated message when the RPC fails', async () => {
    mockParams = { id: 'p1' };
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Valider')).toBeTruthy());
    await press('Valider');
    await waitFor(() => expect(screen.getByText(i18n.t('errors.notAllowed'))).toBeTruthy());
    expect(i18n.t('errors.notAllowed')).not.toBe('errors.notAllowed');
  });

  it('shows loading, not forbidden, while the profile is loading', async () => {
    mockReady = false;
    mockParams = { id: 'p1' };
    await render(<AdminUser />);
    expect(screen.getByText(i18n.t('common.loading'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('admin.forbidden'))).toBeNull();
  });

  it('shows a translated error, not "not found", when loading the account fails', async () => {
    mockSelectError = { code: '42501' };
    mockParams = { id: 'p1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText(i18n.t('errors.notAllowed'))).toBeTruthy());
    expect(screen.queryByText(i18n.t('admin.notFound'))).toBeNull();
  });

  it('maps P0002 to the not-found message', async () => {
    mockParams = { id: 'p1' };
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0002' } });
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Valider')).toBeTruthy());
    await press('Valider');
    await waitFor(() => expect(screen.getByText(i18n.t('errors.notFound'))).toBeTruthy());
  });

  it('shows an expired membership', async () => {
    mockRows[2] = { ...mockRows[2], paid_until: '2020-12-31' };
    mockParams = { id: 'e1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Cotisation échue le 31.12.2020')).toBeTruthy());
  });

  it('refuses non-admins', async () => {
    mockRole = 'eleve';
    mockParams = { id: 'p1' };
    await render(<AdminUser />);
    expect(screen.getByText(i18n.t('admin.forbidden'))).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('account detail: last admin, child profiles, parent email', () => {
  it('asks for confirmation before an admin changes their own role', async () => {
    mockRows.push(prof('admin1', 'Ada', null, 'admin'));
    mockParams = { id: 'admin1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Élève')).toBeTruthy());
    await press('Élève');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t('admin.confirmOwnRole', { role: 'Élève' }))).toBeTruthy();
    await press('Annuler');
    expect(mockRpc).not.toHaveBeenCalled();
    await press('Élève');
    await press('Confirmer');
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('admin_set_role', { p_profile: 'admin1', p_role: 'eleve' }));
    await waitFor(() => expect(mockAuthRefresh).toHaveBeenCalled());
  });

  it('shows the last-admin message', async () => {
    mockRows.push(prof('admin1', 'Ada', null, 'admin'));
    mockParams = { id: 'admin1' };
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', hint: 'last_admin' } });
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('Élève')).toBeTruthy());
    await press('Élève');
    await press('Confirmer');
    expect(await screen.findByText(i18n.t('errors.lastAdmin'))).toBeTruthy();
  });

  it('does not offer roles for a child profile', async () => {
    mockRows.push({ ...prof('k1', 'Kid', null, 'eleve'), auth_user_id: null, parent_profile_id: 'x', age: 8 });
    mockParams = { id: 'k1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText(i18n.t('admin.childProfile'))).toBeTruthy());
    expect(screen.queryByText('Professeur')).toBeNull();
  });

  it('shows and edits the parent email', async () => {
    mockRows.push({ ...prof('m1', 'Max', null, 'eleve'), age: 14, parent_email: 'tpyo@test.ch' });
    mockParams = { id: 'm1' };
    await render(<AdminUser />);
    await waitFor(() => expect(screen.getByText('tpyo@test.ch')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText(i18n.t('admin.parentEmailEdit')), 'pas-un-email');
    await press(i18n.t('admin.parentEmailSave'));
    expect(screen.getByText(i18n.t('errors.invalidEmail'))).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText(i18n.t('admin.parentEmailEdit')), ' Typo@Test.ch ');
    await press(i18n.t('admin.parentEmailSave'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ parent_email: 'typo@test.ch' }, 'id', 'm1'));
    expect(await screen.findByText(i18n.t('admin.parentEmailSaved'))).toBeTruthy();
  });
});

describe('BeltEditor', () => {
  it('offers Grise to a 12 year old', async () => {
    await render(<BeltEditor profileId="x" age={12} current={null} onSaved={jest.fn()} />);
    expect(screen.getByText('Grise')).toBeTruthy();
  });

  it('does not offer Grise to an adult', async () => {
    await render(<BeltEditor profileId="x" age={30} current={null} onSaved={jest.fn()} />);
    expect(screen.queryByText('Grise')).toBeNull();
  });

  it('saves via set_belt and reports the belt', async () => {
    const onSaved = jest.fn();
    await render(<BeltEditor profileId="x" age={12} current="blanche" onSaved={onSaved} />);
    await press('Grise');
    await press('Enregistrer');
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('set_belt', { p_profile: 'x', p_belt: 'grise' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('grise'));
  });

  it('shows a translated message on a belt/age error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23514' } });
    const onSaved = jest.fn();
    await render(<BeltEditor profileId="x" age={12} current="blanche" onSaved={onSaved} />);
    await press('Grise');
    await press('Enregistrer');
    await waitFor(() => expect(screen.getByText(i18n.t('errors.beltAge'))).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
