import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { LanguagePicker } from '@/src/components/LanguagePicker';
import { ProfileForm } from '@/src/components/profile/ProfileForm';
import { Button } from '@/src/components/ui';
import { colors } from '@/src/theme';

export default function EditProfile() {
  const { t } = useTranslation();
  const { profile, refresh } = useAuth();
  const router = useRouter();
  if (!profile) return null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('profile.edit')}</Text>
      <Text style={styles.label}>{t('profile.language')}</Text>
      <LanguagePicker />
      <ProfileForm profile={profile} onSaved={() => void refresh()} />
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  label: { color: colors.white, marginBottom: 6 },
});
