import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, ErrorText, Field } from '@/src/components/ui';
import { maxRepeatUntil, validateCourseForm, type CourseFormValues } from '@/src/domain/courseForm';
import { zurichToday } from '@/src/domain/courses';
import { formatDate } from '@/src/domain/adminErrors';
import type { Role, Sport } from '@/src/domain/types';
import { fetchLocations, fetchProfOptions, type LocationRow, type ProfOption } from '@/src/lib/coursesApi';
import { colors } from '@/src/theme';

const SPORTS: Sport[] = ['jjb', 'grappling', 'mma'];

export type CourseFormInitial = Partial<
  Pick<CourseFormValues, 'sport' | 'level' | 'kind' | 'locationId' | 'localDate' | 'startTime' | 'endTime'>
> & { places?: number; priceMember?: number; priceNonMember?: number };

type Props = {
  mode: 'create' | 'edit';
  role: Role;
  initial?: CourseFormInitial;
  /** édition d'une occurrence de série : choix « ce cours » / « ce cours et les suivants » */
  inSeries?: boolean;
  /** retourne null en cas de succès, sinon la clé i18n de l'erreur */
  onSubmit: (values: CourseFormValues, scope: 'one' | 'following') => Promise<string | null>;
};

/** Formulaire de cours (création et modification). Chargement des lieux et, pour l'admin, des profs inclus. */
export function CourseForm({ mode, role, initial, inSeries, onSubmit }: Props) {
  const { t } = useTranslation();
  const isAdmin = role === 'admin';
  const creating = mode === 'create';
  const [sport, setSport] = useState<Sport>(initial?.sport ?? 'jjb');
  const [level, setLevel] = useState<'adulte' | 'enfant'>(initial?.level ?? 'adulte');
  const [kind, setKind] = useState<'normal' | 'competition'>(initial?.kind ?? 'normal');
  const [locationId, setLocationId] = useState(initial?.locationId ?? '');
  const [localDate, setLocalDate] = useState(initial?.localDate ?? zurichToday());
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [places, setPlaces] = useState(String(initial?.places ?? 20));
  const [priceMember, setPriceMember] = useState(String(initial?.priceMember ?? 0));
  const [priceNonMember, setPriceNonMember] = useState(String(initial?.priceNonMember ?? 0));
  const [isPrivate, setIsPrivate] = useState(false);
  const [profId, setProfId] = useState<string | undefined>(undefined);
  const [recurring, setRecurring] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [scope, setScope] = useState<'one' | 'following'>('one');

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [profs, setProfs] = useState<ProfOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [locs, ps] = await Promise.all([
          fetchLocations(),
          isAdmin && creating ? fetchProfOptions() : Promise.resolve([] as ProfOption[]),
        ]);
        if (!alive) return;
        setLocations(locs);
        setProfs(ps);
        // lieu par défaut préselectionné à la création
        setLocationId((cur) => cur || locs.find((l) => l.is_default && !l.archived)?.id || '');
      } catch {
        if (alive) setLoadError('errors.network');
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, creating]);

  const today = zurichToday();
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
  const fixedUntil = !isAdmin && recurring ? maxRepeatUntil('prof', localDate, today) : undefined;
  const profYearLimited = !!fixedUntil && /^\d{4}-\d{2}-\d{2}$/.test(localDate.trim()) && fixedUntil < localDate.trim();
  const adminMax = isAdmin && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? maxRepeatUntil('admin', localDate, today) : undefined;
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  const shownLocations = locations.filter((l) => !l.archived || l.id === initial?.locationId);

  const submit = async () => {
    const candidate: CourseFormValues = {
      sport,
      level,
      kind,
      isPrivate: isAdmin && isPrivate,
      locationId,
      localDate: localDate.trim(),
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      profId: isAdmin && creating ? profId : undefined,
      places: num(places),
      priceMember: num(priceMember),
      priceNonMember: num(priceNonMember),
      recurring: creating && recurring,
      repeatUntil: creating && recurring ? (isAdmin ? repeatUntil.trim() || undefined : fixedUntil) : undefined,
    };
    const result = validateCourseForm(candidate, role, today);
    if ('errors' in result) {
      setErrors(result.errors);
      setServerError(null);
      return;
    }
    setErrors({});
    setServerError(null);
    setBusy(true);
    const key = await onSubmit(result.values, inSeries ? scope : 'one');
    setBusy(false);
    if (key) setServerError(key);
  };

  return (
    <View>
      <Text style={styles.label}>{t('courses.form.sport')}</Text>
      <View style={styles.row}>
        {SPORTS.map((s) => (
          <Chip key={s} label={t(`sports.${s}`)} selected={sport === s} onPress={() => setSport(s)} />
        ))}
      </View>
      <Text style={styles.label}>{t('courses.form.level')}</Text>
      <View style={styles.row}>
        <Chip label={t('courses.level.adulte')} selected={level === 'adulte'} onPress={() => setLevel('adulte')} />
        <Chip label={t('courses.level.enfant')} selected={level === 'enfant'} onPress={() => setLevel('enfant')} />
      </View>
      <Text style={styles.label}>{t('courses.form.kind')}</Text>
      <View style={styles.row}>
        <Chip label={t('courses.form.kindNormal')} selected={kind === 'normal'} onPress={() => setKind('normal')} />
        <Chip label={t('courses.competition')} selected={kind === 'competition'} onPress={() => setKind('competition')} />
      </View>
      <Text style={styles.label}>{t('courses.location')}</Text>
      <View style={styles.row}>
        {shownLocations.map((l) => (
          <Chip key={l.id} label={l.name} selected={locationId === l.id} onPress={() => setLocationId(l.id)} />
        ))}
      </View>
      {!loadError && locations.length > 0 && shownLocations.length === 0 ? (
        <Text style={styles.hint}>{t('courses.form.noLocation')}</Text>
      ) : null}
      <ErrorText>{loadError ? t(loadError) : err('locationId')}</ErrorText>

      {creating ? (
        <Field label={t('courses.form.date')} value={localDate} onChangeText={setLocalDate} placeholder="2026-09-15" error={err('localDate')} />
      ) : null}
      <Field label={t('courses.form.startTime')} value={startTime} onChangeText={setStartTime} placeholder="18:30" error={err('startTime')} />
      <Field label={t('courses.form.endTime')} value={endTime} onChangeText={setEndTime} placeholder="20:00" error={err('endTime')} />
      <Field label={t('courses.form.places')} value={places} onChangeText={setPlaces} keyboardType="number-pad" error={err('places')} />
      <Field label={t('courses.form.priceMember')} value={priceMember} onChangeText={setPriceMember} keyboardType="decimal-pad" error={err('priceMember')} />
      <Field label={t('courses.form.priceNonMember')} value={priceNonMember} onChangeText={setPriceNonMember} keyboardType="decimal-pad" error={err('priceNonMember')} />

      {isAdmin && creating ? (
        <>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('courses.form.private')}</Text>
            <Switch accessibilityLabel={t('courses.form.private')} value={isPrivate} onValueChange={setIsPrivate} />
          </View>
          <Text style={styles.label}>{t('courses.form.prof')}</Text>
          <View style={styles.row}>
            <Chip label={t('courses.noProf')} selected={profId === undefined} onPress={() => setProfId(undefined)} />
            {profs.map((p) => (
              <Chip key={p.id} label={`${p.first_name} ${p.last_name}`} selected={profId === p.id} onPress={() => setProfId(p.id)} />
            ))}
          </View>
        </>
      ) : null}

      {creating ? (
        <>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('courses.form.recurring')}</Text>
            <Switch accessibilityLabel={t('courses.form.recurring')} value={recurring} onValueChange={setRecurring} />
          </View>
          {recurring && !isAdmin ? (
            profYearLimited ? (
              <ErrorText>{t('courses.form.err.profYearOnly')}</ErrorText>
            ) : (
              <>
                <Text style={styles.hint}>{t('courses.form.repeatUntilFixed', { date: formatDate(fixedUntil ?? '') })}</Text>
                <ErrorText>{err('repeatUntil')}</ErrorText>
              </>
            )
          ) : null}
          {recurring && isAdmin ? (
            <>
              <Field
                label={t('courses.form.repeatUntil')}
                value={repeatUntil}
                onChangeText={setRepeatUntil}
                placeholder={adminMax}
                error={err('repeatUntil')}
              />
              {adminMax ? <Text style={styles.hint}>{t('courses.form.repeatMax', { date: formatDate(adminMax) })}</Text> : null}
            </>
          ) : null}
        </>
      ) : null}

      {inSeries ? (
        <>
          <Text style={styles.label}>{t('courses.form.scope')}</Text>
          <View style={styles.row}>
            <Chip label={t('courses.scopeOne')} selected={scope === 'one'} onPress={() => setScope('one')} />
            <Chip label={t('courses.scopeFollowing')} selected={scope === 'following'} onPress={() => setScope('following')} />
          </View>
        </>
      ) : null}

      <ErrorText>{serverError ? t(serverError) : undefined}</ErrorText>
      <Button title={creating ? t('courses.form.create') : t('common.save')} disabled={busy} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.white, marginBottom: 6, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  hint: { color: colors.grey, marginBottom: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  switchLabel: { color: colors.white, fontSize: 16 },
});
