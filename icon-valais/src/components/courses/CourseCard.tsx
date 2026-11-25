import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Profile } from '@/src/auth/AuthProvider';
import { courseLabelStatus, formatChf, formatCourseTime, type CourseRow } from '@/src/domain/courses';
import type { Lang } from '@/src/i18n';
import { ErrorText } from '@/src/components/ui';
import { colors } from '@/src/theme';
import { BookButton } from './BookButton';
import { LocationDetails } from './LocationDetails';

export function CourseCard({
  course,
  now,
  lang,
  selfId,
  kids,
  onOpen,
  onChanged,
}: {
  course: CourseRow;
  now: Date;
  lang: Lang;
  selfId: string;
  kids: Pick<Profile, 'id' | 'first_name'>[];
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const label = courseLabelStatus(course, now);
  const cancelled = label === 'annule';
  const started = new Date(course.starts_at).getTime() <= now.getTime();
  const bookable = !cancelled && !started;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t(`sports.${course.sport}`)} ${formatCourseTime(course.starts_at, course.ends_at, lang)}`}
        onPress={onOpen}
      >
        <Text style={[styles.time, cancelled && styles.struck]}>{formatCourseTime(course.starts_at, course.ends_at, lang)}</Text>
        <View style={styles.row}>
          <Text style={[styles.sport, cancelled && styles.struck]}>{t(`sports.${course.sport}`)}</Text>
          <Text style={styles.meta}> · {t(`courses.level.${course.level}`)}</Text>
          {course.kind === 'competition' ? <Text style={styles.badge}>{t('courses.competition')}</Text> : null}
        </View>
      </Pressable>
      <LocationDetails name={course.location.name} address={course.location.address} mapsUrl={course.location.maps_url} />
      {label === 'annule' ? (
        <Text style={[styles.status, styles.struck]}>{t('courses.cancelled')}</Text>
      ) : label === 'vacant' ? (
        <Text style={styles.status}>{t('courses.vacant')}</Text>
      ) : label === 'open_mat' ? (
        <Text style={styles.status}>{t('courses.openMat')}</Text>
      ) : course.prof ? (
        <Text style={styles.meta}>
          {t('courses.prof')} : {course.prof.first_name} {course.prof.last_name}
        </Text>
      ) : null}
      <Text style={styles.meta}>{t('courses.places', { booked: course.booked, places: course.places })}</Text>
      <Text style={styles.meta}>{t('courses.priceMember', { price: formatChf(course.price_member) })}</Text>
      <Text style={styles.meta}>{t('courses.priceNonMember', { price: formatChf(course.price_non_member) })}</Text>
      {bookable ? (
        <BookButton
          course={course}
          selfId={selfId}
          kids={kids}
          onError={setErrorKey}
          onDone={onChanged}
        />
      ) : null}
      <ErrorText>{errorKey ? t(errorKey) : undefined}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.grey, borderRadius: 10, padding: 12, marginBottom: 10 },
  time: { color: colors.orange, fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  sport: { color: colors.white, fontWeight: '700' },
  meta: { color: colors.grey, marginTop: 2 },
  badge: { color: colors.white, backgroundColor: colors.orange, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8, overflow: 'hidden', fontSize: 12 },
  status: { color: colors.orange, fontWeight: '600', marginTop: 4 },
  struck: { textDecorationLine: 'line-through' },
});
