import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import { BeltEditor } from '@/src/components/BeltEditor';
import AdminList from '../index';
import AdminUser from '../user/[id]';

const mockRpc = jest.fn();
const mockPush = jest.fn();
let mockRole = 'admin';
let mockParams: { id?: string } = {};
let mockRows: Record<string, unknown>[] = [];

const year = new Date().getFullYear();
const base = {
  email: null, phone: null, sports: ['jjb'], language: 'fr', paid_until: null, bjj_belt: null,
  auth_user_id: 'a', parent_profile_id: null,
};
const prof = (id: string, first: string, prof_status: string | null, role = 'prof') => ({
  ...base, id, first_name: first, last_name: 'Test', role, prof_status, age: 30,
});

jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'admin1', role: mockRole } }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({
      select: () => ({
        order: async () => ({ data: mockRows, error: null }),
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => ({ data: mockRows.find((r) => r.id === id) ?? null, error: null }),
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
  mockParams = {};
  mockRows = [
    prof('p1', 'Alice', 'en_attente'),
    prof('p2', 'Bruno', 'valide'),
    prof('e1', 'Chloe', null, 'eleve'),
  ];
  mockRpc.mockResolvedValue({ data: null, error: null });
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
});

const press = async (label: string) => fireEvent.press(screen.getByText(label));

describe('account list', () => {
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

  it('refuses non-admins', async () => {
    mockRole = 'eleve';
    mockParams = { id: 'p1' };
    await render(<AdminUser />);
    expect(screen.getByText(i18n.t('admin.forbidden'))).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
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
