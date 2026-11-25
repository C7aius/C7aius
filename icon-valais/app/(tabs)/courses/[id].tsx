import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth, type Profile } from '@/src/auth/AuthProvider';
import { AssignProfPicker } from '@/src/components/courses/AssignProfPicker';
import { BookButton } from '@/src/components/courses/BookButton';
import { LocationDetails } from '@/src/components/courses/LocationDetails';
import { ParticipantsList } from '@/src/components/courses/ParticipantsList';
import { Button, Chip, ErrorText } from '@/src/components/ui';
import { courseLabelStatus, formatChf, formatCourseTime, type CourseRow } from '@/src/domain/courses';
import type { Lang } from '@/src/i18n';
import { cancelCourse, fetchCourse, leaveSlot, takeSlot } from '@/src/lib/coursesApi';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function CourseDetail() {
  const { t, i18n } = useTranslation();
  const { profile, isActive } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lang = (i18n.language || 'fr') as Lang;
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [kids, setKids] = useState<Pick<Profile, 'id' | 'first_name'>[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [now, setNow] = useState(() => new Date());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [scope, setScope] = useState<'one' | 'following'>('one');
  const requestId = useRef(0);
  const selfId = profile?.id ?? '';

  const load = useCallback(async () => {
    if (!selfId || !id) return;
    const mine = ++requestId.current;
    try {
      const { data: kidRows } = await supabase.from('profiles').select('id,first_name').eq('parent_profile_id', selfId);
      const kidList = (kidRows ?? []) as Pick<Profile, 'id' | 'first_name'>[];
      const c = await fetchCourse(id, [selfId, ...kidList.map((k) => k.id)]);
      if (mine !== requestId.current) return;
      setKids(kidList);
      setCourse(c);
      setNow(new Date());
      setState(c ? 'ok' : 'missing');
    } catch {
      if (mine === requestId.current) setState('error');
    }
  }, [selfId, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const back = <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />;

  if (!course) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        {back}
        <Text style={styles.meta}>
          {state === 'loading' ? t('common.loading') : state === 'missing' ? t('courses.notFound') : t('courses.loadError')}
        </Text>
      </ScrollView>
    );
  }

  const isAdmin = profile?.role === 'admin';
  const isProf = profile?.role === 'prof' && isActive;
  const label = courseLabelStatus(course, now);
  const cancelled = label === 'annule';
  const started = new Date(course.starts_at).getTime() <= now.getTime();
  const isMine = course.prof_id === selfId;
  const open = !cancelled && !started;
  const canTake = isProf && open && course.prof_id === null && !course.is_private;
  const canLeave = isProf && open && isMine && !course.is_private;
  const canAssign = isAdmin && open;
  const canCancel = open && (isAdmin || (isProf && course.created_by === selfId && !course.is_private));
  const canRoll = !cancelled && (isAdmin || (isProf && isMine));

  // Action puis rechargement, y compris en cas d'erreur (ex. « déjà pris » : l'état a changé).
  const act = async (run: () => Promise<string | null>) => {
    setBusy(true);
    setErrorKey(null);
    const key = await run();
    setBusy(false);
    if (key) setErrorKey(key);
    setAssigning(false);
    setCancelling(false);
    await load();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {back}
      <Text style={[styles.time, cancelled && styles.struck]}>{formatCourseTime(course.starts_at, course.ends_at, lang)}</Text>
      <View style={styles.row}>
        <Text style={[styles.sport, cancelled && styles.struck]}>{t(`sports.${course.sport}`)}</Text>
        <Text style={styles.meta}> · {t(`courses.level.${course.level}`)}</Text>
        {course.kind === 'competition' ? <Text style={styles.badge}>{t('courses.competition')}</Text> : null}
      </View>
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

      {open ? (
        <BookButton course={course} selfId={selfId} kids={kids} onError={setErrorKey} onDone={() => void load()} />
      ) : null}
      {canTake ? <Button title={t('courses.take')} disabled={busy} onPress={() => void act(() => takeSlot(course.id))} /> : null}
      {canLeave ? (
        <Button title={t('courses.leave')} variant="secondary" disabled={busy} onPress={() => void act(() => leaveSlot(course.id))} />
      ) : null}
      {canAssign ? (
        <View>
          <Button title={t('courses.assignProf')} variant="secondary" onPress={() => setAssigning((a) => !a)} />
          {assigning ? (
            <AssignProfPicker courseId={course.id} currentProfId={course.prof_id} onDone={() => void act(async () => null)} />
          ) : null}
        </View>
      ) : null}
      {canCancel ? (
        <View>
          <Button title={t('courses.cancelCourse')} variant="secondary" onPress={() => setCancelling((c) => !c)} />
          {cancelling ? (
            <View style={styles.confirm}>
              <Text style={styles.meta}>{t('courses.cancelPrompt')}</Text>
              {course.series_id ? (
                <View style={styles.row}>
                  <Chip label={t('courses.scopeOne')} selected={scope === 'one'} onPress={() => setScope('one')} />
                  <Chip label={t('courses.scopeFollowing')} selected={scope === 'following'} onPress={() => setScope('following')} />
                </View>
              ) : null}
              <Button
                title={t('courses.confirmCancel')}
                disabled={busy}
                onPress={() => void act(() => cancelCourse(course.id, course.series_id ? scope : 'one'))}
              />
              <Pressable accessibilityRole="button" onPress={() => setCancelling(false)}>
                <Text style={styles.link}>{t('courses.close')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
      <ErrorText>{errorKey ? t(errorKey) : undefined}</ErrorText>
      {canRoll ? <ParticipantsList courseId={course.id} selfId={selfId} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 16, paddingTop: 60 },
  time: { color: colors.orange, fontWeight: '700', fontSize: 20, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  sport: { color: colors.white, fontWeight: '700', fontSize: 16 },
  meta: { color: colors.grey, marginTop: 2 },
  badge: { color: colors.white, backgroundColor: colors.orange, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8, overflow: 'hidden', fontSize: 12 },
  status: { color: colors.orange, fontWeight: '600', marginTop: 4 },
  struck: { textDecorationLine: 'line-through' },
  confirm: { marginTop: 8 },
  link: { color: colors.orange, textDecorationLine: 'underline', padding: 8, textAlign: 'center' },
});
