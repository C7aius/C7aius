import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthGate } from '@/src/auth/AuthGate';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { PaymentsProvider } from '@/src/components/payments/PaymentsProvider';
import { initI18n } from '@/src/i18n';
import { listenForNotificationTaps } from '@/src/lib/push';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    initI18n()
      .catch(() => initI18n('fr'))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return listenForNotificationTaps((route) => router.push(route as any));
  }, [ready, router]);

  if (!ready) return null;

  return (
    <PaymentsProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <AuthGate />
      </AuthProvider>
    </PaymentsProvider>
  );
}
