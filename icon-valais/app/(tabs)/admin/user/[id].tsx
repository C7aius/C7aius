import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { AccountDetail } from '@/src/components/admin/AccountDetail';
import { Button } from '@/src/components/ui';
import { colors } from '@/src/theme';

export default function AdminUser() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {profile?.role === 'admin' && id ? (
        <AccountDetail id={id} />
      ) : (
        <Text style={styles.body}>{t('admin.forbidden')}</Text>
      )}
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 24, paddingTop: 60 },
  body: { color: colors.white, marginBottom: 12 },
});
