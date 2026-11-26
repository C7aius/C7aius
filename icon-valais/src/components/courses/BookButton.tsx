import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Profile } from '@/src/auth/AuthProvider';
import { PaySheet } from '@/src/components/payments/PaySheet';
import { Button, Chip } from '@/src/components/ui';
import { zurichTimeKey } from '@/src/domain/courses';
import { colors } from '@/src/theme';
import type { CourseRow } from '@/src/domain/courses';
import { bookCourse, unbookCourse } from '@/src/lib/coursesApi';

export type PayInfo = { isMember: boolean; used: number; limit: number };

/** Réserver / Se désinscrire ; un parent choisit « moi / enfant X ». */
export function BookButton({
  course,
  selfId,
  kids,
  payInfo,
  onDone,
  onError,
}: {
  course: CourseRow;
  selfId: string;
  kids: Pick<Profile, 'id' | 'first_name'>[];
  /** Adhésion et essais par profil (soi, enfants) ; absent tant que non chargé. */
  payInfo?: Record<string, PayInfo>;
  onDone: () => void;
  onError: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pay, setPay] = useState<{ bookingId: string; amount: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState(selfId);
  const [busy, setBusy] = useState(false);
  const booked = course.myBookings.includes(target);

  const press = async () => {
    setBusy(true);
    onError(null);
    // pas de p_profile pour soi-même
    const arg = target === selfId ? undefined : target;
    setNotice(null);
    if (booked) {
      const key = await unbookCourse(course.id, arg);
      setBusy(false);
      if (key) onError(key);
      else onDone();
      return;
    }
    const res = await bookCourse(course.id, arg);
    setBusy(false);
    if (res.error) return onError(res.error);
    // réservation payante : place retenue 15 min, confirmation puis paiement (montant du serveur)
    if (res.needsPayment && res.bookingId) setPay({ bookingId: res.bookingId, amount: res.amount });
    onDone();
  };

  const closePay = (outcome: 'paid' | 'pending' | 'cancelled') => {
    setPay(null);
    setNotice(outcome === 'paid' ? 'payments.confirmed' : outcome === 'pending' ? 'payments.pendingConfirmation' : null);
    onDone();
  };

  const pending = booked ? course.myPending?.[target] : undefined;
  // reprise du paiement : même confirmation (montant, mention de remboursement) qu'à la réservation
  const payPending = () => {
    if (!pending) return;
    onError(null);
    setNotice(null);
    setPay({ bookingId: pending.bookingId, amount: pending.amount });
  };

  const info = payInfo?.[target];
  const showTrial = !!info && !info.isMember && info.used < info.limit;

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
      {showTrial ? <Text style={styles.trial}>{t('payments.trial', { used: info.used, limit: info.limit })}</Text> : null}
      {notice ? <Text style={styles.trial}>{t(notice)}</Text> : null}
      {pending ? (
        <Text style={styles.trial}>{t('payments.pendingUntil', { time: zurichTimeKey(pending.until) })}</Text>
      ) : null}
      {pending ? <Button title={t('payments.pay')} disabled={busy} onPress={payPending} /> : null}
      <Button
        title={booked ? t('courses.unbook') : t('courses.book')}
        variant={booked ? 'secondary' : 'primary'}
        disabled={busy}
        onPress={() => void press()}
      />
      {pay ? (
        <PaySheet
          bookingId={pay.bookingId}
          amount={pay.amount}
          onClose={closePay}
          onBecomeMember={() => {
            setPay(null);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            router.push('/profile/membership' as any);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trial: { color: colors.orange, marginTop: 6 },
  choice: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
});
