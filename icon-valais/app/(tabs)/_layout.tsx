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
      <Tabs.Screen name="courses" options={{ href: null }} />
      <Tabs.Screen name="ranking/index" options={{ title: t('tabs.ranking') }} />
      <Tabs.Screen name="competition/index" options={{ title: t('tabs.competition') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
      <Tabs.Screen name="admin" options={{ title: t('tabs.admin'), href: isAdmin ? undefined : null }} />
    </Tabs>
  );
}
