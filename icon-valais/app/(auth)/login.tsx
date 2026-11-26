import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, ErrorText, Field } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function Login() {
  const { t } = useTranslation();
  const { reset } = useLocalSearchParams<{ reset?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('errors.required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      // la redirection est faite par le garde du layout racine
      if (e) setError(e.code === 'invalid_credentials' ? 'auth.invalidCredentials' : 'errors.generic');
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('common.appName')}</Text>
      {reset === '1' ? <Text style={styles.ok}>{t('auth.passwordUpdated')}</Text> : null}
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      {error ? <ErrorText>{t(error)}</ErrorText> : null}
      <Button title={t('auth.login')} onPress={submit} disabled={busy} />
      <Link href="/forgot-password" style={styles.link}>{t('auth.forgotPassword')}</Link>
      <Text style={styles.muted}>{t('auth.noAccount')}</Text>
      <Link href="/signup" style={styles.link}>{t('signup.title')}</Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80 },
  title: { color: colors.orange, fontSize: 32, fontWeight: '700', marginBottom: 32, textAlign: 'center' },
  ok: { color: colors.white, marginBottom: 16, textAlign: 'center' },
  link: { color: colors.orange, marginTop: 16, textAlign: 'center' },
  muted: { color: colors.grey, marginTop: 24, textAlign: 'center' },
});
