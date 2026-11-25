import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';

import { colors } from '@/src/theme';
import { useAuth } from './AuthProvider';

/** Redirige selon la session et is_account_active. */
export function AuthGate() {
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
