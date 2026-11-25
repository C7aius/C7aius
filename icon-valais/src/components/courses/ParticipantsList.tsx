import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BeltEditor } from '@/src/components/BeltEditor';
import { Button, Chip, ErrorText, Field } from '@/src/components/ui';
import { rpcErrorKey } from '@/src/domain/adminErrors';
import type { Belt } from '@/src/domain/types';
import { setAttendance } from '@/src/lib/coursesApi';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

type Participant = {
  profile_id: string;
  first_name: string;
  last_name: string;
  age: number;
  bjj_belt: Belt;
  present: boolean;
};
type Candidate = { id: string; first_name: string; last_name: string };

/** Appel : présence, ceinture (jamais la sienne) et ajout d'un présent hors inscription. */
export function ParticipantsList({ courseId, selfId }: { courseId: string; selfId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [beltFor, setBeltFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Candidate[]>([]);

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.rpc('course_participants', { p_course: courseId });
      if (e) setError(rpcErrorKey(e));
      else setRows((data ?? []) as Participant[]);
    } catch {
      setError('errors.network');
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const q = query.trim().replace(/[%,()*]/g, '');
    if (!adding || q.length < 2) {
      setFound([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase
          .from('public_profiles')
          .select('id,first_name,last_name')
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .limit(8);
        if (alive) setFound((data ?? []) as Candidate[]);
      } catch {
        if (alive) setFound([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [query, adding]);

  const mark = async (profileId: string, present: boolean) => {
    setError(null);
    const key = await setAttendance(courseId, profileId, present);
    if (key) setError(key);
    await load();
  };

  const add = async (c: Candidate) => {
    await mark(c.id, true);
    setAdding(false);
    setQuery('');
  };

  const listed = new Set(rows.map((r) => r.profile_id));

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('courses.participants')}</Text>
      {rows.length === 0 ? <Text style={styles.meta}>{t('courses.noParticipants')}</Text> : null}
      {rows.map((r) => {
        const name = `${r.first_name} ${r.last_name}`;
        return (
          <View key={r.profile_id} style={styles.row}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: r.present }}
              accessibilityLabel={t('courses.presentLabel', { name })}
              onPress={() => void mark(r.profile_id, !r.present)}
              style={[styles.box2, r.present && styles.box2On]}
            >
              <Text style={styles.tick}>{r.present ? '✓' : ''}</Text>
            </Pressable>
            <View style={styles.who}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.meta}>
                {t('courses.ageYears', { age: r.age })} · {t(`belts.${r.bjj_belt}`)}
              </Text>
            </View>
            {r.profile_id !== selfId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('courses.beltLabel', { name })}
                onPress={() => setBeltFor(beltFor === r.profile_id ? null : r.profile_id)}
              >
                <Text style={styles.link}>{t('courses.belt')}</Text>
              </Pressable>
            ) : null}
            {beltFor === r.profile_id ? (
              <View style={styles.editor}>
                <BeltEditor
                  profileId={r.profile_id}
                  age={r.age}
                  current={r.bjj_belt}
                  onSaved={() => {
                    setBeltFor(null);
                    void load();
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      <ErrorText>{error ? t(error) : undefined}</ErrorText>
      {adding ? (
        <View>
          <Field label={t('courses.searchMember')} value={query} onChangeText={setQuery} />
          <View style={styles.chips}>
            {found
              .filter((c) => !listed.has(c.id))
              .map((c) => (
                <Chip key={c.id} label={`${c.first_name} ${c.last_name}`} selected={false} onPress={() => void add(c)} />
              ))}
          </View>
        </View>
      ) : (
        <Button title={t('courses.addPresent')} variant="secondary" onPress={() => setAdding(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16 },
  title: { color: colors.orange, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 6 },
  box2: { width: 28, height: 28, borderWidth: 1, borderColor: colors.grey, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  box2On: { backgroundColor: colors.orange, borderColor: colors.orange },
  tick: { color: colors.white, fontWeight: '700' },
  who: { flex: 1, marginLeft: 10 },
  name: { color: colors.white, fontWeight: '600' },
  meta: { color: colors.grey },
  link: { color: colors.orange, textDecorationLine: 'underline', padding: 6 },
  editor: { width: '100%', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
