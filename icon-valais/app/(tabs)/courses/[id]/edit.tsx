import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { CourseForm } from '@/src/components/courses/CourseForm';
import { Button } from '@/src/components/ui';
import { toUpdateCoursePayload } from '@/src/domain/courseForm';
import { zurichDayKey, zurichTimeKey, type CourseRow } from '@/src/domain/courses';
import { fetchCourse, updateCourse } from '@/src/lib/coursesApi';
import { colors } from '@/src/theme';

export default function EditCourse() {
  const { t } = useTranslation();
  const { profile, isActive } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const selfId = profile?.id;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      try {
        const c = await fetchCourse(id, selfId ? [selfId] : []);
        if (!alive) return;
        setCourse(c);
        setState(c ? 'ok' : 'missing');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, selfId]);

  const back = <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />;
  const isAdmin = profile?.role === 'admin';
  const isProf = profile?.role === 'prof' && isActive;
  // même règle que update_course ; la base reste l'autorité
  const allowed =
    !!course &&
    course.status !== 'annule' &&
    new Date(course.starts_at).getTime() > Date.now() &&
    (isAdmin || (isProf && course.created_by === selfId && !course.is_private));

  let body;
  if (!course) {
    body = (
      <Text style={styles.body}>
        {state === 'loading' ? t('common.loading') : state === 'missing' ? t('courses.notFound') : t('courses.loadError')}
      </Text>
    );
  } else if (!allowed || !profile) {
    body = <Text style={styles.body}>{t('courses.form.forbidden')}</Text>;
  } else {
    body = (
      <CourseForm
        mode="edit"
        role={profile.role}
        inSeries={!!course.series_id}
        initial={{
          sport: course.sport,
          level: course.level,
          kind: course.kind,
          locationId: course.location_id,
          localDate: zurichDayKey(course.starts_at),
          startTime: zurichTimeKey(course.starts_at),
          endTime: zurichTimeKey(course.ends_at),
          places: course.places,
          priceMember: course.price_member,
          priceNonMember: course.price_non_member,
        }}
        onSubmit={async (values, scope) => {
          const key = await updateCourse(course.id, toUpdateCoursePayload(values, course.location_id), scope);
          if (!key) router.back();
          return key;
        }}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {back}
      <Text style={styles.title}>{t('courses.form.editTitle')}</Text>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 16, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white },
});
