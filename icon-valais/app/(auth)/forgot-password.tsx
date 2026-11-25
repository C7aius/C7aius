import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { resetRedirectUrl } from '@/src/auth/passwordReset';
import { Button, ErrorText, Field } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      setError('errors.required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: resetRedirectUrl() });
      if (e) setError('errors.generic');
      else setSent(true);
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('auth.resetTitle')}</Text>
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      {error ? <ErrorText>{t(error)}</ErrorText> : null}
      {sent ? <Text style={styles.ok}>{t('auth.resetSent')}</Text> : null}
      <Button title={t('auth.resetSend')} onPress={submit} disabled={busy} />
      <Link href="/login" style={styles.link}>{t('auth.backToLogin')}</Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 24 },
  ok: { color: colors.white, marginVertical: 8 },
  link: { color: colors.orange, marginTop: 24, textAlign: 'center' },
});
