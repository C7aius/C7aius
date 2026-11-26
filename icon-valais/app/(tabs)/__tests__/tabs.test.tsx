import { act, render, screen } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import TabsLayout from '../_layout';
import AdminLayout from '../admin/_layout';
import Competition from '../competition/index';

let mockProfile: { role: string } | null = null;
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: mockProfile }),
}));
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const Tabs = ({ children }: { children: unknown }) => <>{children}</>;
  Tabs.Screen = ({ name, options }: { name: string; options?: { title?: string; href?: null; tabBarItemStyle?: { display?: string } } }) =>
    options?.href === null ? null : (
      <Text testID={`tab-${name}`} accessibilityState={{ disabled: options?.tabBarItemStyle?.display === 'none' }}>
        {options?.title}
      </Text>
    );
  const Stack = () => <Text testID="admin-stack">stack</Text>;
  return { Tabs, Stack };
});

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
});

describe('tabs layout', () => {
  it.each(['eleve', 'prof'])('hides the Admin tab for %s', async (role) => {
    mockProfile = { role };
    await render(<TabsLayout />);
    expect(screen.getByTestId('tab-profile')).toBeTruthy();
    expect(screen.getByTestId('tab-admin').props.accessibilityState.disabled).toBe(true); // masqué par le style
  });

  // Régression : `href: null` sur l'onglet Admin faisait rediriger l'ouverture directe de /admin/students
  // (profil pas encore chargé) vers « / » (vérifié dans le navigateur, e2e du plan 3).
  it('never hides the Admin route with href:null, even before the profile is loaded', async () => {
    mockProfile = null;
    await render(<TabsLayout />);
    expect(screen.getByTestId('tab-admin')).toBeTruthy();
  });

  it('shows the Admin tab for the admin', async () => {
    mockProfile = { role: 'admin' };
    await render(<TabsLayout />);
    expect(screen.getByTestId('tab-admin').props.accessibilityState.disabled).toBe(false);
  });

  it('retitles the Profile tab when the language changes to ru', async () => {
    mockProfile = { role: 'eleve' };
    await render(<TabsLayout />);
    expect(screen.getByTestId('tab-profile').props.children).toBe('Profil');
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    expect(screen.getByTestId('tab-profile').props.children).toBe('Профиль');
  });
});

describe('admin layout', () => {
  // Régression : sans Stack propre à /admin, router.push('/admin/user/[id]') retombait sur « / »
  // (vérifié dans le navigateur) car la fiche était un onglet masqué du Tabs parent.
  it('wraps the admin screens in their own Stack', async () => {
    await render(<AdminLayout />);
    expect(screen.getByTestId('admin-stack')).toBeTruthy();
  });

  // Régression : `href: null` masque la route et expo-router redirige alors vers « / » (vérifié dans le
  // navigateur : le bouton « + » et /courses/[id] ne menaient nulle part).
  it('keeps the courses stack navigable (not a hidden href:null tab)', async () => {
    mockProfile = { role: 'eleve' };
    await render(<TabsLayout />);
    expect(screen.getByTestId('tab-courses')).toBeTruthy();
  });

  it('does not register the account detail as a hidden tab', async () => {
    mockProfile = { role: 'admin' };
    await render(<TabsLayout />);
    expect(screen.queryByTestId('tab-admin/user/[id]')).toBeNull();
  });
});

describe('Competition tab', () => {
  it('shows the coming-soon message', async () => {
    await render(<Competition />);
    expect(screen.getByText(i18n.t('tabs.competitionSoon'))).toBeTruthy();
    expect(i18n.t('tabs.competitionSoon')).not.toBe('tabs.competitionSoon');
  });
});
