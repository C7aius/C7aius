import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminGuard } from '@/src/components/admin/AdminGuard';
import { Button, Chip, ErrorText, Field } from '@/src/components/ui';
import { zurichToday } from '@/src/domain/courses';
import { periodRange, type PeriodKind } from '@/src/domain/periods';
import { fetchMemberHours, fetchTeachingHours, type MemberHoursRow, type TeachingHoursRow } from '@/src/lib/statsApi';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const TOP = 50;
const PERIODS: { key: PeriodKind; label: string }[] = [
  { key: 'month', label: 'admin.periodMonth' },
  { key: 'year', label: 'admin.periodYear' },
  { key: 'custom', label: 'admin.dashPeriodCustom' },
];

/** Heures avec une décimale (point, comme les montants de l'app). */
const hoursText = (h: number) => h.toFixed(1);

function Dashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const [kind, setKind] = useState<PeriodKind>('month');
  const [range, setRange] = useState(() => periodRange('month', zurichToday()));
  const [fromText, setFromText] = useState(range.from);
  const [toText, setToText] = useState(range.to);
  const [periodError, setPeriodError] = useState(false);
  const [teaching, setTeaching] = useState<TeachingHoursRow[]>([]);
  const [members, setMembers] = useState<MemberHoursRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [counts, setCounts] = useState<{ profs: number; proofs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const [th, mh] = await Promise.all([fetchTeachingHours(range.from, range.to), fetchMemberHours(range.from, range.to)]);
      if (id !== seq.current) return;
      setTeaching(th.map((r) => ({ ...r, hours: Number(r.hours) })));
      setMembers(mh.map((r) => ({ ...r, hours: Number(r.hours) })));
      setError(null);
    } catch {
      if (id === seq.current) setError('errors.generic');
    }
  }, [range]);

  const loadCounts = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'prof').eq('prof_status', 'en_attente'),
        supabase.from('pending_student_proofs').select('id', { count: 'exact', head: true }),
      ]);
      if (p.error || s.error || p.count == null || s.count == null) setCounts(null);
      else setCounts({ profs: p.count, proofs: s.count });
    } catch {
      setCounts(null);
    }
  }, []);

  const kindRef = useRef(kind);
  kindRef.current = kind;

  useFocusEffect(
    useCallback(() => {
      if (kindRef.current !== 'custom') {
        const fresh = periodRange(kindRef.current, zurichToday());
        setRange((r) => (r.from === fresh.from && r.to === fresh.to ? r : fresh));
      }
      void load();
      void loadCounts();
    }, [load, loadCounts]),
  );
  useEffect(() => () => void seq.current++, []);

  const choose = (k: PeriodKind) => {
    setKind(k);
    setPeriodError(false);
    if (k !== 'custom') setRange(periodRange(k, zurichToday()));
  };
  const applyCustom = () => {
    try {
      setRange(periodRange('custom', zurichToday(), fromText.trim(), toText.trim()));
      setPeriodError(false);
    } catch {
      setPeriodError(true);
    }
  };

  const total = teaching.reduce((s, r) => s + r.hours, 0);
  const shownMembers = showAll ? members : members.slice(0, TOP);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Text style={styles.title}>{t('admin.dashTitle')}</Text>

      {counts ? (
        <View style={styles.counters}>
          <Pressable accessibilityRole="link" style={styles.counter} onPress={() => router.push('/admin?filter=pending')}>
            <Text style={styles.counterText}>{t('admin.dashPendingProfs', { count: counts.profs })}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" style={styles.counter} onPress={() => router.push('/admin/students')}>
            <Text style={styles.counterText}>{t('admin.dashPendingProofs', { count: counts.proofs })}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.chips}>
        {PERIODS.map((p) => (
          <Chip key={p.key} label={t(p.label)} selected={kind === p.key} onPress={() => choose(p.key)} />
        ))}
      </View>
      {kind === 'custom' ? (
        <View>
          <Field label={t('admin.dashFrom')} value={fromText} onChangeText={setFromText} autoCapitalize="none" />
          <Field label={t('admin.dashTo')} value={toText} onChangeText={setToText} autoCapitalize="none" />
          <Button title={t('admin.dashApply')} onPress={applyCustom} />
          <ErrorText>{periodError ? t('admin.dashPeriodInvalid') : null}</ErrorText>
        </View>
      ) : null}
      <ErrorText>{error ? t(error) : null}</ErrorText>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('admin.dashTeaching')}</Text>
        <Text style={styles.total}>{t('admin.dashTeachingTotal', { hours: hoursText(total) })}</Text>
        {teaching.length === 0 ? <Text style={styles.body}>{t('admin.dashNone')}</Text> : null}
        {teaching.map((r) => (
          <View key={r.prof_id} style={styles.row}>
            <Text style={styles.rowName}>{`${r.first_name} ${r.last_name}`}</Text>
            <Text style={styles.meta}>{`${t('admin.dashHours', { hours: hoursText(r.hours) })} - ${t('admin.dashCourses', { count: r.courses })}`}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('admin.dashPresence')}</Text>
        {members.length === 0 ? <Text style={styles.body}>{t('admin.dashNone')}</Text> : null}
        {shownMembers.map((r) => (
          <View key={r.profile_id} style={styles.row}>
            <Text style={styles.rowName}>{`${r.first_name} ${r.last_name}`}</Text>
            <Text style={styles.meta}>{`${t('admin.dashHours', { hours: hoursText(r.hours) })} - ${t('admin.dashSessions', { count: r.sessions })}`}</Text>
          </View>
        ))}
        {members.length > TOP ? (
          <Pressable accessibilityRole="button" onPress={() => setShowAll((v) => !v)}>
            <Text style={styles.link}>{showAll ? t('admin.dashShowLess') : t('admin.dashSeeAll')}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <Dashboard />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  counters: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, marginBottom: 12 },
  counter: { borderWidth: 1, borderColor: colors.orange, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8 },
  counterText: { color: colors.orange, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  card: { borderWidth: 1, borderColor: colors.grey, borderRadius: 8, padding: 12, marginVertical: 8 },
  cardTitle: { color: colors.orange, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  total: { color: colors.white, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  body: { color: colors.white },
  row: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.grey },
  rowName: { color: colors.white, fontSize: 16 },
  meta: { color: colors.grey, fontSize: 13 },
  link: { color: colors.orange, textDecorationLine: 'underline', marginTop: 8, fontSize: 16 },
});
