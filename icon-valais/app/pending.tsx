import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { getConsentSendResult, setConsentSendResult, subscribeConsentSendResult } from '@/src/auth/consentNotice';
import { Button } from '@/src/components/ui';
import { consentSendErrorKey } from '@/src/domain/functionErrors';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

type Kind = 'prof' | 'profRefused' | 'minor' | 'unknown';

export default function Pending() {
  const { t } = useTranslation();
  const { profile, refresh, signOut } = useAuth();
  // échec de l'envoi fait à l'inscription : on ne prétend pas que l'e-mail est parti
  const [notSent, setNotSent] = useState(() => typeof getConsentSendResult() === 'string');
  const [message, setMessage] = useState<string | null>(() => getConsentSendResult() ?? null);
  const [busy, setBusy] = useState(false);

  // envoi de l'inscription encore en cours quand l'écran s'affiche
  useEffect(
    () =>
      subscribeConsentSendResult((errorKey) => {
        if (errorKey === undefined) return;
        setNotSent(errorKey !== null);
        setMessage(errorKey);
      }),
    [],
  );

  const kind: Kind = !profile
    ? 'unknown'
    : profile.role === 'prof' && profile.prof_status !== 'valide'
      ? profile.prof_status === 'refuse'
        ? 'profRefused'
        : 'prof'
      : 'minor';

  const title = { prof: 'pending.profTitle', profRefused: 'pending.profTitle', minor: 'pending.minorTitle', unknown: 'pending.unknownTitle' }[kind];
  const body = {
    prof: 'pending.profBody',
    profRefused: 'pending.profRefused',
    minor: notSent ? 'pending.minorBodyNotSent' : 'pending.minorBody',
    unknown: 'pending.unknownBody',
  }[kind];
  const parentEmail = kind === 'minor' ? profile?.parent_email : null;

  const resend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.functions.invoke('send-parent-consent', { body: {} });
      if (!error) {
        setConsentSendResult(null);
        setNotSent(false);
        setMessage('pending.resent');
        return;
      }
      setMessage(await consentSendErrorKey(error));
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
      {parentEmail ? (
        <>
          <Text style={styles.body}>{t('pending.parentEmailIs', { email: parentEmail })}</Text>
          <Text style={styles.hint}>{t('pending.wrongAddress')}</Text>
        </>
      ) : null}
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
  hint: { color: colors.grey, marginBottom: 16, lineHeight: 20 },
});
