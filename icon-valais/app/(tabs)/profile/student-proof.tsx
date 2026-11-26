import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Button, ErrorText } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, 'pdf' | 'jpg' | 'png'> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
};
type ProofStatus = 'aucun' | 'en_attente' | 'valide' | 'refuse';
type Picked = { uri: string; mimeType?: string | null; size?: number | null };

/** Justificatif étudiant du profil `profileId` : photo ou PDF, envoyé dans le bucket privé puis soumis. */
export default function StudentProof() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const profileId = params.profileId || profile?.id;

  const [status, setStatus] = useState<ProofStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) return;
    try {
      const { data } = await supabase.from('profiles').select('student_status').eq('id', profileId).maybeSingle();
      setStatus(((data as { student_status?: ProofStatus } | null)?.student_status ?? 'aucun') as ProofStatus);
    } catch {
      setErrorKey('errors.network');
    }
  }, [profileId]);
  useEffect(() => {
    void load();
  }, [load]);

  const send = async (file: Picked) => {
    if (!profileId) return;
    const ext = EXT[(file.mimeType ?? '').toLowerCase()];
    if (!ext) return setErrorKey('studentProof.badType');
    if ((file.size ?? 0) > MAX_BYTES) return setErrorKey('studentProof.tooLarge');
    setBusy(true);
    try {
      const body = await (await fetch(file.uri)).arrayBuffer();
      if (body.byteLength > MAX_BYTES) return setErrorKey('studentProof.tooLarge');
      const path = `${profileId}/${randomUUID().toLowerCase()}.${ext}`;
      const up = await supabase.storage
        .from('student-proofs')
        .upload(path, body, { contentType: ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg', upsert: false });
      if (up.error) return setErrorKey('studentProof.error');
      const { error } = await supabase.rpc('submit_student_proof', { p_profile: profileId, p_path: path });
      if (error) return setErrorKey('studentProof.error');
      setStatus('en_attente');
      setMessage('studentProof.sent');
    } catch {
      setErrorKey('errors.network');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setErrorKey(null);
    setMessage(null);
  };

  const takePhoto = async () => {
    reset();
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setErrorKey('studentProof.noCamera');
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      const a = res.canceled ? null : res.assets[0];
      if (a) await send({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize });
    } catch {
      setErrorKey('studentProof.error');
    }
  };

  const pickPdf = async () => {
    reset();
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      const a = res.canceled ? null : res.assets[0];
      if (a) await send({ uri: a.uri, mimeType: a.mimeType ?? 'application/pdf', size: a.size });
    } catch {
      setErrorKey('studentProof.error');
    }
  };

  const canSend = status === 'aucun' || status === 'refuse';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('studentProof.title')}</Text>
      <Text style={styles.row}>{t('studentProof.intro')}</Text>
      {status ? (
        <>
          <Text style={styles.label}>{t('studentProof.status')}</Text>
          <Text style={styles.status}>{t(`studentProof.status_${status}`)}</Text>
        </>
      ) : null}
      {canSend ? (
        <>
          <Button title={t('studentProof.takePhoto')} disabled={busy} onPress={() => void takePhoto()} />
          <Button title={t('studentProof.pickPdf')} variant="secondary" disabled={busy} onPress={() => void pickPdf()} />
        </>
      ) : null}
      {busy ? <Text style={styles.row}>{t('studentProof.uploading')}</Text> : null}
      {message ? <Text style={styles.row}>{t(message)}</Text> : null}
      <ErrorText>{errorKey ? t(errorKey) : undefined}</ErrorText>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  row: { color: colors.white, marginBottom: 12, lineHeight: 22 },
  label: { color: colors.grey, marginBottom: 4 },
  status: { color: colors.white, fontWeight: '700', marginBottom: 16 },
});
