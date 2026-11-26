import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth, type Profile } from '@/src/auth/AuthProvider';
import { CourseCard } from '@/src/components/courses/CourseCard';
import type { PayInfo } from '@/src/components/courses/BookButton';
import { WeekNav } from '@/src/components/courses/WeekNav';
import { Chip, ErrorText } from '@/src/components/ui';
import { formatDayHeading, weekRange, zurichDayKey, type CourseRow } from '@/src/domain/courses';
import type { Lang } from '@/src/i18n';
import type { Sport } from '@/src/domain/types';
import { fetchWeek } from '@/src/lib/coursesApi';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

/** Adhésion et essais gratuits de chaque profil (soi + enfants) ; un échec laisse simplement le profil sans info. */
async function loadPayInfo(ids: string[]): Promise<Record<string, PayInfo>> {
  const out: Record<string, PayInfo> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const [m, tr] = await Promise.all([
          supabase.rpc('my_membership', { p_profile: id }),
          supabase.rpc('my_trial_status', { p_profile: id }),
        ]);
        const mem = Array.isArray(m.data) ? m.data[0] : null;
        const trial = Array.isArray(tr.data) ? tr.data[0] : null;
        if (!mem || !trial) return;
        out[id] = { isMember: !!mem.is_member, used: Number(trial.used), limit: Number(trial.trial_limit) };
      } catch {
        // pas d'info : la carte n'affiche pas le compteur d'essais
      }
    }),
  );
  return out;
}

const SPORTS: Sport[] = ['jjb', 'grappling', 'mma'];
const WEEK_MS = 7 * 24 * 3600 * 1000;

export default function Courses() {
  const { t, i18n } = useTranslation();
  const { profile, isActive } = useAuth();
  const router = useRouter();
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState<CourseRow[]>([]);
  const [kids, setKids] = useState<Pick<Profile, 'id' | 'first_name'>[]>([]);
  const [payInfo, setPayInfo] = useState<Record<string, PayInfo>>({});
  const [loadError, setLoadError] = useState(false);
  const [locFilter, setLocFilter] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState<Sport | null>(null);
  const [now, setNow] = useState(() => new Date());
  const lang = (i18n.language || 'fr') as Lang;

  const { from, to } = useMemo(() => weekRange(anchor), [anchor]);
  const profileId = profile?.id;
  const canCreate = profile?.role === 'admin' || (profile?.role === 'prof' && isActive);

  const requestId = useRef(0);
  const load = useCallback(async () => {
    if (!profileId) return;
    const mine = ++requestId.current;
    try {
      const { data: kidRows } = await supabase.from('profiles').select('id,first_name').eq('parent_profile_id', profileId);
      const kidList = ((kidRows ?? []) as Pick<Profile, 'id' | 'first_name'>[])
        .slice()
        .sort((a, b) => a.first_name.localeCompare(b.first_name));
      const week = await fetchWeek(from, to, [profileId, ...kidList.map((k) => k.id)]);
      if (mine !== requestId.current) return; // réponse périmée (semaine changée entre-temps)
      setKids(kidList);
      void loadPayInfo([profileId, ...kidList.map((k) => k.id)]).then((info) => {
        if (mine === requestId.current) setPayInfo(info);
      });
      setRows(week);
      setNow(new Date());
      setLoadError(false);
    } catch {
      if (mine === requestId.current) setLoadError(true);
    }
  }, [profileId, from, to]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const locations = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.location.id, r.location.name);
    return [...m.entries()];
  }, [rows]);

  const days = useMemo(() => {
    const groups = new Map<string, { heading: string; items: CourseRow[] }>();
    for (const r of rows) {
      if (locFilter && r.location_id !== locFilter) continue;
      if (sportFilter && r.sport !== sportFilter) continue;
      const key = zurichDayKey(r.starts_at);
      const g = groups.get(key) ?? { heading: formatDayHeading(r.starts_at, lang), items: [] };
      g.items.push(r);
      groups.set(key, g);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, locFilter, sportFilter, lang]);

  const shift = (dir: 1 | -1) => setAnchor(new Date(from.getTime() + (dir === 1 ? WEEK_MS : -WEEK_MS) + 12 * 3600 * 1000));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerNav}>
          <WeekNav from={from} to={to} onPrev={() => shift(-1)} onNext={() => shift(1)} />
        </View>
        {canCreate ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('courses.newCourse')} onPress={() => router.push('/courses/new')} style={styles.plus}>
            <Text style={styles.plusText}>+</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.filters}>
        <Chip label={t('courses.allLocations')} selected={locFilter === null} onPress={() => setLocFilter(null)} />
        {locations.map(([id, name]) => (
          <Chip key={id} label={name} selected={locFilter === id} onPress={() => setLocFilter(id)} />
        ))}
      </View>
      <View style={styles.filters}>
        <Chip label={t('courses.allSports')} selected={sportFilter === null} onPress={() => setSportFilter(null)} />
        {SPORTS.map((s) => (
          <Chip key={s} label={t(`sports.${s}`)} selected={sportFilter === s} onPress={() => setSportFilter(s)} />
        ))}
      </View>
      <ErrorText>{loadError ? t('courses.loadError') : undefined}</ErrorText>
      {!loadError && days.length === 0 ? <Text style={styles.empty}>{t('courses.empty')}</Text> : null}
      {days.map(([key, g]) => (
        <View key={key}>
          <Text style={styles.day}>{g.heading}</Text>
          {g.items.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              now={now}
              lang={lang}
              selfId={profileId ?? ''}
              kids={kids}
              payInfo={payInfo}
              onOpen={() => router.push(`/courses/${c.id}`)}
              onChanged={() => void load()}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 16, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerNav: { flex: 1 },
  plus: { backgroundColor: colors.orange, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  plusText: { color: colors.white, fontSize: 26, fontWeight: '700', lineHeight: 30 },
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { color: colors.orange, fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  empty: { color: colors.white, textAlign: 'center', marginTop: 24 },
});
