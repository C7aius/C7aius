import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';

import { colors } from '@/src/theme';
import { useAuth } from './AuthProvider';

/** Redirige selon la session et is_account_active. */
export function AuthGate() {
  const { session, isActive, ready, recovering } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] as string | undefined;
  const second = segments[1] as string | undefined;

  useEffect(() => {
    const inReset = first === '(auth)' && second === 'reset-password';
    // lien « mot de passe oublié » : toujours l'écran de nouveau mot de passe, jamais les onglets
    if (recovering) {
      if (!inReset) router.replace('/reset-password');
      return;
    }
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
  }, [ready, session, isActive, recovering, first, second, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.anthracite },
      }}
    />
  );
}
