import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Button, ErrorText } from '@/src/components/ui';
import { deleteAccountErrorKey } from '@/src/domain/functionErrors';
import { displayRole } from '@/src/domain/roles';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function ProfileHome() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.functions.invoke('delete-account');
      if (e) {
        setError(await deleteAccountErrorKey(e));
        return;
      }
      await signOut();
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('profile.title')}</Text>
      <Text style={styles.row}>{profile.first_name} {profile.last_name}</Text>
      <Text style={styles.row}>{t('profile.role')} : {t(`roles.${displayRole(profile.role) === 'prof' ? 'coach' : 'member'}`)}</Text>
      <Text style={styles.row}>{t('profile.belt')} : {profile.bjj_belt ? t(`belts.${profile.bjj_belt}`) : '—'}</Text>
      <Text style={styles.row}>{t('signup.age')} : {profile.age}</Text>
      {profile.phone ? <Text style={styles.row}>{t('profile.phone')} : {profile.phone}</Text> : null}
      <Text style={styles.row}>{t('profile.sport')} : {profile.sports.map((s) => t(`sports.${s}`)).join(', ')}</Text>

      <Button title={t('profile.edit')} onPress={() => router.push('/profile/edit')} />
      {profile.age >= 18 ? <Button title={t('profile.children')} variant="secondary" onPress={() => router.push('/profile/children')} /> : null}
      <Button title={t('auth.logout')} variant="secondary" onPress={() => void signOut()} />

      {step === 0 ? (
        <Button title={t('profile.deleteAccount')} variant="secondary" onPress={() => setStep(1)} />
      ) : (
        <>
          <Text style={styles.warn}>{t(step === 1 ? 'profile.deleteWarn1' : 'profile.deleteWarn2')}</Text>
          {step === 1 ? (
            <Button title={t('profile.deleteContinue')} onPress={() => setStep(2)} />
          ) : (
            <Button title={t('profile.deleteFinal')} onPress={() => void deleteAccount()} disabled={busy} />
          )}
          <Button title={t('common.cancel')} variant="secondary" onPress={() => setStep(0)} disabled={busy} />
        </>
      )}
      <ErrorText>{error ? t(error) : undefined}</ErrorText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  row: { color: colors.white, marginBottom: 6, fontSize: 16 },
  warn: { color: colors.white, marginTop: 16, lineHeight: 22 },
});
