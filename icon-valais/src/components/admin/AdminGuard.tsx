import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { colors } from '@/src/theme';

/** Chargement → « accès réservé » pour un non-admin ; sinon le contenu. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { profile, ready } = useAuth();
  if (profile?.role === 'admin') return <>{children}</>;
  return (
    <View style={styles.center}>
      <Text style={styles.body}>{ready ? t('admin.forbidden') : t('common.loading')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.anthracite, padding: 24 },
  body: { color: colors.white, marginBottom: 8 },
});
