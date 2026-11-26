import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Chip, ErrorText } from '@/src/components/ui';
import { rpcErrorKey } from '@/src/domain/adminErrors';
import {
  fetchMyRanking,
  fetchRanking,
  type MyRanking,
  type RankLimit,
  type RankPeriod,
  type RankingRow,
} from '@/src/lib/statsApi';
import { colors } from '@/src/theme';

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const LIMITS: { value: RankLimit; key: string }[] = [
  { value: 10, key: 'top10' },
  { value: 20, key: 'top20' },
  { value: null, key: 'all' },
];

export default function Ranking() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const profileId = profile?.id;
  const [period, setPeriod] = useState<RankPeriod>('all');
  const [limit, setLimit] = useState<RankLimit>(null);
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [mine, setMine] = useState<MyRanking | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const [list, my] = await Promise.all([fetchRanking(period, limit), fetchMyRanking(period)]);
      if (id !== requestId.current) return; // réponse périmée (filtre changé entre-temps)
      setRows(list);
      setMine(my);
      setErrorKey(null);
    } catch (e) {
      if (id === requestId.current) setErrorKey(rpcErrorKey(e as { code?: string; hint?: string | null }));
    }
  }, [period, limit]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('tabs.ranking')}</Text>
      {mine ? (
        <Text style={styles.position}>
          {mine.rank == null
            ? t('ranking.noAttendance')
            : t('ranking.myPosition', { rank: mine.rank, count: mine.sessions })}
        </Text>
      ) : null}
      <View style={styles.filters}>
        {LIMITS.map((l) => (
          <Chip key={l.key} label={t(`ranking.${l.key}`)} selected={limit === l.value} onPress={() => setLimit(l.value)} />
        ))}
      </View>
      <View style={styles.filters}>
        <Chip label={t('ranking.allTime')} selected={period === 'all'} onPress={() => setPeriod('all')} />
        <Chip label={t('ranking.thisYear')} selected={period === 'year'} onPress={() => setPeriod('year')} />
      </View>
      <ErrorText>{errorKey ? t(errorKey) : undefined}</ErrorText>
      {!errorKey && rows.length === 0 ? <Text style={styles.empty}>{t('ranking.empty')}</Text> : null}
      {rows.map((r) => {
        const isMe = r.profile_id === profileId;
        return (
          <View
            key={r.profile_id}
            testID={`row-${r.profile_id}`}
            accessibilityState={{ selected: isMe }}
            style={[styles.row, isMe && styles.rowMe]}
          >
            <View style={styles.rankBox} testID={`rank-${r.rank}`}>
              <Text style={styles.rank}>{MEDALS[r.rank] ?? r.rank}</Text>
            </View>
            <View style={styles.who}>
              <Text style={styles.name}>
                {r.first_name} {r.last_name}
              </Text>
              {r.bjj_belt ? <Text style={styles.belt}>{t(`belts.${r.bjj_belt}`)}</Text> : null}
            </View>
            <Text style={styles.sessions}>{t('ranking.sessions', { count: r.sessions })}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 16, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  position: { color: colors.white, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
  empty: { color: colors.white, textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  rowMe: { backgroundColor: colors.orange, borderColor: colors.orange },
  rankBox: { width: 40, alignItems: 'center' },
  rank: { color: colors.white, fontSize: 18, fontWeight: '700' },
  who: { flex: 1, marginLeft: 8 },
  name: { color: colors.white, fontSize: 16 },
  belt: { color: colors.grey, fontSize: 12 },
  sessions: { color: colors.white, fontWeight: '700' },
});
