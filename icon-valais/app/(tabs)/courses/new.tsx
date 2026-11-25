import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { CourseForm } from '@/src/components/courses/CourseForm';
import { Button } from '@/src/components/ui';
import { toCreateCoursePayload } from '@/src/domain/courseForm';
import { createCourse } from '@/src/lib/coursesApi';
import { colors } from '@/src/theme';

export default function NewCourse() {
  const { t } = useTranslation();
  const { profile, isActive } = useAuth();
  const router = useRouter();
  const allowed = profile?.role === 'admin' || (profile?.role === 'prof' && isActive);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Text style={styles.title}>{t('courses.form.newTitle')}</Text>
      {allowed && profile ? (
        <CourseForm
          mode="create"
          role={profile.role}
          onSubmit={async (values) => {
            const { p, p_repeat_until } = toCreateCoursePayload(values);
            const key = await createCourse(p, p_repeat_until);
            if (!key) router.replace('/');
            return key;
          }}
        />
      ) : (
        <Text style={styles.body}>{t('errors.notAllowed')}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 16, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white },
});
