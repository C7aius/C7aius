import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatWeekLabel } from '@/src/domain/courses';
import { colors } from '@/src/theme';

export function WeekNav({ from, to, onPrev, onNext }: { from: Date; to: Date; onPrev: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('courses.prevWeek')} onPress={onPrev} style={styles.arrow}>
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>
      <Text style={styles.label}>{formatWeekLabel(from, to)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('courses.nextWeek')} onPress={onNext} style={styles.arrow}>
        <Text style={styles.arrowText}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  arrow: { paddingHorizontal: 16, paddingVertical: 6 },
  arrowText: { color: colors.orange, fontSize: 28, fontWeight: '700' },
  label: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
