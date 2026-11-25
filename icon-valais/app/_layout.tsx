import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import { AuthGate } from '@/src/auth/AuthGate';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { initI18n } from '@/src/i18n';

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
