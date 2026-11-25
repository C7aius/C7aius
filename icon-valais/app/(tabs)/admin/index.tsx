import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth, type Profile } from '@/src/auth/AuthProvider';
import { AccountDetail } from '@/src/components/admin/AccountDetail';
import { Chip, ErrorText, Field } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

type Filter = 'all' | 'eleve' | 'prof' | 'admin' | 'pending';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'admin.filterAll' },
  { key: 'pending', label: 'admin.filterPending' },
  { key: 'eleve', label: 'admin.filterEleve' },
  { key: 'prof', label: 'admin.filterProf' },
  { key: 'admin', label: 'admin.filterAdmin' },
];
const ROLE_KEY = { eleve: 'admin.roleEleve', prof: 'admin.roleProf', admin: 'admin.roleAdmin' } as const;
const WIDE = 900;

export default function Admin() {
  const { t } = useTranslation();
  const { profile, ready } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [rows, setRows] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const isAdmin = profile?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.from('profiles').select('*').order('last_name');
      if (e) setError('errors.generic');
      else {
        setRows((data ?? []) as Profile[]);
        setError(null);
      }
    } catch {
      setError('errors.network');
    }
  }, []);

  // recharge à chaque retour sur l'écran (ex. après une action dans la fiche)
  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'pending' && !(r.role === 'prof' && r.prof_status === 'en_attente')) return false;
      if ((filter === 'eleve' || filter === 'prof' || filter === 'admin') && r.role !== filter) return false;
      if (!q) return true;
      return `${r.first_name} ${r.last_name} ${r.email ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>{ready ? t('admin.forbidden') : t('common.loading')}</Text>
      </View>
    );
  }

  const open = (id: string) => {
    if (wide) setSelected(id);
    else router.push({ pathname: '/admin/user/[id]', params: { id } });
  };

  const list = (
    <View>
      <Text style={styles.title}>{t('admin.title')}</Text>
      <Pressable accessibilityRole="link" onPress={() => router.push('/admin/locations')}>
        <Text style={styles.link}>{t('admin.locations')}</Text>
      </Pressable>
      <Field label={t('common.search')} value={query} onChangeText={setQuery} />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={t(f.label)} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
      <ErrorText>{error ? t(error) : null}</ErrorText>
      {shown.length === 0 && !error ? <Text style={styles.body}>{t('admin.noResults')}</Text> : null}
      {shown.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() => open(r.id)}
          style={[styles.item, selected === r.id && wide && styles.itemSelected]}
        >
          <Text style={styles.itemName}>{`${r.first_name} ${r.last_name}`}</Text>
          <Text style={styles.itemMeta}>
            {t(ROLE_KEY[r.role])}
            {r.role === 'prof' && r.prof_status === 'en_attente' ? ` - ${t('admin.pending')}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  if (!wide) return <ScrollView style={styles.screen} contentContainerStyle={styles.container}>{list}</ScrollView>;

  return (
    <View style={[styles.screen, styles.wideRow]}>
      <ScrollView style={styles.wideCol} contentContainerStyle={styles.container}>{list}</ScrollView>
      <ScrollView style={styles.wideDetail} contentContainerStyle={styles.container}>
        {selected ? (
          <AccountDetail key={selected} id={selected} onChanged={() => void load()} />
        ) : (
          <Text style={styles.body}>{t('admin.selectAccount')}</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.anthracite, padding: 24 },
  container: { padding: 24, paddingTop: 60 },
  wideRow: { flexDirection: 'row' },
  wideCol: { width: 380, borderRightWidth: 1, borderRightColor: colors.grey },
  wideDetail: { flex: 1 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 12 },
  link: { color: colors.orange, textDecorationLine: 'underline', marginBottom: 12, fontSize: 16 },
  body: { color: colors.white, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  item: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.grey },
  itemSelected: { backgroundColor: '#3A3A3A' },
  itemName: { color: colors.white, fontSize: 16 },
  itemMeta: { color: colors.grey, fontSize: 13 },
});
