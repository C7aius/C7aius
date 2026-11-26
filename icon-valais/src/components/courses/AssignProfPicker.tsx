import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip, ErrorText } from '@/src/components/ui';
import { assignProf } from '@/src/lib/coursesApi';
import { supabase } from '@/src/lib/supabase';

type Prof = { id: string; first_name: string; last_name: string };

/** Choix du prof d'un cours (admin) : profs valides (l'admin s'affiche comme prof) ou « aucun ». */
export function AssignProfPicker({
  courseId,
  currentProfId,
  onDone,
}: {
  courseId: string;
  currentProfId: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [profs, setProfs] = useState<Prof[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data, error: e } = await supabase
          .from('public_profiles')
          .select('id,first_name,last_name')
          .eq('display_role', 'prof')
          .order('first_name', { ascending: true });
        if (!alive) return;
        if (e) setError('errors.generic');
        else setProfs((data ?? []) as Prof[]);
      } catch {
        if (alive) setError('errors.network');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pick = async (profId: string | null) => {
    setBusy(true);
    setError(null);
    const key = await assignProf(courseId, profId);
    setBusy(false);
    if (key) setError(key);
    else onDone();
  };

  return (
    <View>
      <View style={styles.row}>
        <Chip label={t('courses.noProf')} selected={currentProfId === null} onPress={() => !busy && void pick(null)} />
        {profs.map((p) => (
          <Chip
            key={p.id}
            label={`${p.first_name} ${p.last_name}`}
            selected={currentProfId === p.id}
            onPress={() => !busy && void pick(p.id)}
          />
        ))}
      </View>
      <ErrorText>{error ? t(error) : undefined}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 } });
