import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Profile } from '@/src/auth/AuthProvider';
import { Button, Chip } from '@/src/components/ui';
import type { CourseRow } from '@/src/domain/courses';
import { bookCourse, unbookCourse } from '@/src/lib/coursesApi';

/** Réserver / Se désinscrire ; un parent choisit « moi / enfant X ». */
export function BookButton({
  course,
  selfId,
  kids,
  onDone,
  onError,
}: {
  course: CourseRow;
  selfId: string;
  kids: Pick<Profile, 'id' | 'first_name'>[];
  onDone: () => void;
  onError: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(selfId);
  const [busy, setBusy] = useState(false);
  const booked = course.myBookings.includes(target);

  const press = async () => {
    setBusy(true);
    onError(null);
    // pas de p_profile pour soi-même
    const arg = target === selfId ? undefined : target;
    // le paiement d'une réservation payante (needsPayment) arrive avec la tâche 6
    const key = booked ? await unbookCourse(course.id, arg) : (await bookCourse(course.id, arg)).error;
    setBusy(false);
    if (key) onError(key);
    else onDone();
  };

  return (
    <View>
      {kids.length > 0 ? (
        <View style={styles.choice}>
          <Chip label={t('courses.me')} selected={target === selfId} onPress={() => setTarget(selfId)} />
          {kids.map((k) => (
            <Chip key={k.id} label={k.first_name} selected={target === k.id} onPress={() => setTarget(k.id)} />
          ))}
        </View>
      ) : null}
      <Button
        title={booked ? t('courses.unbook') : t('courses.book')}
        variant={booked ? 'secondary' : 'primary'}
        disabled={busy}
        onPress={() => void press()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
});
