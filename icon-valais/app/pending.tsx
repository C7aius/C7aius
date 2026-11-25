import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Button } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

type Kind = 'prof' | 'profRefused' | 'minor' | 'unknown';

export default function Pending() {
  const { t } = useTranslation();
  const { profile, refresh, signOut } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kind: Kind = !profile
    ? 'unknown'
    : profile.role === 'prof' && profile.prof_status !== 'valide'
      ? profile.prof_status === 'refuse'
        ? 'profRefused'
        : 'prof'
      : 'minor';

  const title = { prof: 'pending.profTitle', profRefused: 'pending.profTitle', minor: 'pending.minorTitle', unknown: 'pending.unknownTitle' }[kind];
  const body = { prof: 'pending.profBody', profRefused: 'pending.profRefused', minor: 'pending.minorBody', unknown: 'pending.unknownBody' }[kind];

  const resend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.functions.invoke('send-parent-consent', { body: {} });
      if (!error) {
        setMessage('pending.resent');
        return;
      }
      const status = (error as { context?: { status?: number } }).context?.status;
      setMessage(status === 429 ? 'pending.tooMany' : status === 409 ? 'pending.notEligible' : 'errors.generic');
    } catch {
      setMessage('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t(title)}</Text>
      <Text style={styles.body}>{t(body)}</Text>
      {message ? <Text style={styles.body}>{t(message)}</Text> : null}
      {kind === 'minor' ? <Button title={t('pending.resend')} onPress={resend} disabled={busy} /> : null}
      <Button title={t('pending.refresh')} onPress={() => void refresh()} variant="secondary" disabled={busy} />
      <Button title={t('auth.logout')} onPress={() => void signOut()} variant="secondary" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 80 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  body: { color: colors.white, marginBottom: 16, lineHeight: 22 },
});
