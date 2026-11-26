import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { colors } from '@/src/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.grey,
        tabBarStyle: { backgroundColor: colors.anthracite },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.courses') }} />
      {/* Pile de détail des cours : pas d'onglet visible, mais jamais `href: null` (route « masquée » =
          redirigée vers « / » par expo-router, donc /courses/new et /courses/[id] seraient inaccessibles). */}
      <Tabs.Screen name="courses" options={{ tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="ranking/index" options={{ title: t('tabs.ranking') }} />
      <Tabs.Screen name="competition/index" options={{ title: t('tabs.competition') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
      {/* Onglet masqué pour un non-admin par le style, pas par `href: null` : à l'ouverture directe d'une URL
          /admin/..., le profil n'est pas encore chargé, la route serait « masquée » et expo-router
          redirigerait vers « / ». Les écrans restent protégés par AdminGuard. */}
      <Tabs.Screen
        name="admin"
        options={{ title: t('tabs.admin'), ...(isAdmin ? {} : { tabBarItemStyle: { display: 'none' as const } }) }}
      />
    </Tabs>
  );
}
