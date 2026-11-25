import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { parseRecoveryUrl } from '@/src/auth/passwordReset';
import { Button, ErrorText, Field } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

/**
 * Nouveau mot de passe, après le lien « mot de passe oublié ».
 * Web : supabase-js ouvre la session depuis l'URL et émet PASSWORD_RECOVERY (AuthProvider).
 * Natif : la session est posée ici depuis le lien profond iconvalais://reset-password#…
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, recovering, startRecovery, endRecovery, signOut } = useAuth();
  const url = Linking.useLinkingURL();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const link = parseRecoveryUrl(url);
    if (link.kind === 'error') setLinkError(true);
    if (link.kind !== 'tokens') return;
    startRecovery();
    supabase.auth
      .setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      .then(({ error: e }) => {
        if (e) {
          setLinkError(true);
          endRecovery();
        }
      })
      .catch(() => setLinkError(true));
  }, [url, startRecovery, endRecovery]);

  const canReset = !!session && recovering && !linkError;

  const submit = async () => {
    if (password.length < 8) {
      setError('errors.passwordTooShort');
      return;
    }
    if (password !== confirm) {
      setError('errors.passwordMismatch');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) {
        setError(e.code === 'same_password' ? 'auth.samePassword' : e.code === 'weak_password' ? 'errors.passwordTooShort' : 'errors.generic');
        return;
      }
      endRecovery();
      await signOut();
      router.replace({ pathname: '/login', params: { reset: '1' } });
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    endRecovery();
    void signOut().finally(() => router.replace('/login'));
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('auth.newPasswordTitle')}</Text>
      {canReset ? (
        <>
          <Field label={t('auth.newPassword')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          <Field label={t('signup.confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
          {error ? <ErrorText>{t(error)}</ErrorText> : null}
          <Button title={t('auth.updatePassword')} onPress={() => void submit()} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={styles.body}>{t(linkError || !recovering ? 'auth.resetLinkInvalid' : 'common.loading')}</Text>
          <Button title={t('auth.resetSend')} variant="secondary" onPress={() => { endRecovery(); router.replace('/forgot-password'); }} />
        </>
      )}
      <Text accessibilityRole="link" style={styles.link} onPress={backToLogin}>{t('auth.backToLogin')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 24 },
  body: { color: colors.white, marginVertical: 8, lineHeight: 22 },
  link: { color: colors.orange, marginTop: 24, textAlign: 'center' },
});
