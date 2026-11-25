import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '@/src/auth/AuthProvider';
import { initI18n } from '@/src/i18n';
import { colors } from '@/src/theme';

/** Redirige selon la session et is_account_active. */
function AuthGate() {
  const { session, isActive, ready } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] as string | undefined;

  useEffect(() => {
    if (!ready) return;
    const inAuth = first === '(auth)';
    const inPending = first === 'pending';
    if (!session) {
      if (!inAuth) router.replace('/login');
    } else if (!isActive) {
      if (!inPending) router.replace('/pending');
    } else if (inAuth || inPending) {
      router.replace('/');
    }
  }, [ready, session, isActive, first, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.anthracite },
      }}
    />
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initI18n()
      .catch(() => initI18n('fr'))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AuthGate />
    </AuthProvider>
  );
}
