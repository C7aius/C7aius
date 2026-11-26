import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminGuard } from '@/src/components/admin/AdminGuard';
import { Button, ErrorText } from '@/src/components/ui';
import { rpcErrorKey } from '@/src/domain/adminErrors';
import { formatDay } from '@/src/domain/paymentsView';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

type Proof = { id: string; profile_id: string; path: string; submitted_at: string; first_name: string; last_name: string; age: number };
const SIGNED_SECONDS = 300;

function Preview({ path }: { path: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data, error } = await supabase.storage.from('student-proofs').createSignedUrl(path, SIGNED_SECONDS);
        if (!live) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [path]);
  if (failed) return <Text style={styles.meta}>{t('admin.proofUnavailable')}</Text>;
  if (!url) return <Text style={styles.meta}>{t('common.loading')}</Text>;
  if (/\.pdf$/i.test(path)) {
    return (
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
        <Text style={styles.link}>{t('admin.proofOpen')}</Text>
      </Pressable>
    );
  }
  return <Image source={{ uri: url }} style={styles.image} resizeMode="contain" accessibilityLabel={t('admin.proofOpen')} />;
}

function StudentProofs() {
  const { t } = useTranslation();
  const router = useRouter();
  const [rows, setRows] = useState<Proof[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.from('pending_student_proofs').select('*').order('submitted_at');
      if (e) setError('errors.generic');
      else {
        setRows((data ?? []) as Proof[]);
        setError(null);
      }
    } catch {
      setError('errors.network');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const decide = async (id: string, valid: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('admin_decide_student', { p_proof: id, p_valid: valid });
      if (e) setError(rpcErrorKey(e));
      await load();
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Text style={styles.title}>{t('admin.studentsTitle')}</Text>
      <ErrorText>{error ? t(error) : null}</ErrorText>
      {rows && rows.length === 0 && !error ? <Text style={styles.body}>{t('admin.studentsNone')}</Text> : null}
      {(rows ?? []).map((r) => (
        <View key={r.id} style={styles.item}>
          <Text style={styles.name}>{`${r.first_name} ${r.last_name}`}</Text>
          <Text style={styles.meta}>{`${t('admin.studentAge', { age: r.age })} - ${formatDay(r.submitted_at)}`}</Text>
          <Preview path={r.path} />
          <Button title={t('admin.validate')} disabled={busy} onPress={() => void decide(r.id, true)} />
          <Button title={t('admin.reject')} variant="secondary" disabled={busy} onPress={() => void decide(r.id, false)} />
        </View>
      ))}
    </ScrollView>
  );
}

export default function Students() {
  return (
    <AdminGuard>
      <StudentProofs />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white, marginBottom: 8 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.grey },
  name: { color: colors.white, fontSize: 16 },
  meta: { color: colors.grey, fontSize: 13, marginBottom: 6 },
  link: { color: colors.orange, textDecorationLine: 'underline', padding: 8 },
  image: { width: '100%', height: 260, marginVertical: 8 },
});
