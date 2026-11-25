import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Profile } from '@/src/auth/AuthProvider';
import { Button, Chip, ErrorText, Field } from '@/src/components/ui';
import { buildProfilePatch, profileErrorKey, valuesFromProfile, type ProfileFormValues } from '@/src/domain/profileUpdate';
import type { Sport } from '@/src/domain/types';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const SPORTS: Sport[] = ['jjb', 'grappling', 'mma'];

/** Édition des champs modifiables d'un profil (le sien ou celui d'un enfant). La ceinture reste en lecture seule. */
export function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<ProfileFormValues>(() => valuesFromProfile(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ key: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<ProfileFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  const has = (s: Sport) => v.sports.includes(s);
  const toggle = (s: Sport) => set({ sports: has(s) ? v.sports.filter((x) => x !== s) : [...v.sports, s] });

  const save = async () => {
    const result = buildProfilePatch(v, profile.role);
    if ('errors' in result) {
      setErrors(result.errors);
      setMessage(null);
      return;
    }
    setErrors({});
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.from('profiles').update(result.patch).eq('id', profile.id);
      if (error) setMessage({ key: profileErrorKey(error), ok: false });
      else {
        setMessage({ key: 'profile.saved', ok: true });
        onSaved();
      }
    } catch {
      setMessage({ key: 'errors.network', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Field label={t('signup.phone')} value={v.phone} onChangeText={(phone) => set({ phone })} keyboardType="phone-pad" />
      <Field label={t('signup.age')} value={v.age} onChangeText={(age) => set({ age })} keyboardType="number-pad" error={err('age')} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {SPORTS.map((s) => (
          <Chip key={s} label={t(`sports.${s}`)} selected={has(s)} onPress={() => toggle(s)} />
        ))}
      </View>
      <ErrorText>{err('sports')}</ErrorText>

      {has('grappling') ? (
        <Field label={t('signup.yearsGrappling')} value={v.yearsGrappling} onChangeText={(yearsGrappling) => set({ yearsGrappling })} keyboardType="number-pad" error={err('yearsGrappling')} />
      ) : null}
      {has('mma') ? (
        <Field label={t('signup.yearsMma')} value={v.yearsMma} onChangeText={(yearsMma) => set({ yearsMma })} keyboardType="number-pad" error={err('yearsMma')} />
      ) : null}

      {profile.role === 'prof' ? (
        <>
          <Field label={t('signup.coachYears')} value={v.coachYears} onChangeText={(coachYears) => set({ coachYears })} keyboardType="number-pad" error={err('coachYears')} />
          <Field label={t('signup.trainingPlaces')} value={v.trainingPlaces} onChangeText={(trainingPlaces) => set({ trainingPlaces })} />
          <Field label={t('signup.competitionAwards')} value={v.competitionAwards} onChangeText={(competitionAwards) => set({ competitionAwards })} multiline />
          <Field label={t('signup.cv')} value={v.cv} onChangeText={(cv) => set({ cv })} multiline />
        </>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <Text style={{ color: colors.white, fontSize: 14 }}>{t('profile.belt')}</Text>
        <Text style={{ color: colors.white, fontWeight: '700', marginTop: 4 }}>
          {profile.bjj_belt ? t(`belts.${profile.bjj_belt}`) : '—'}
        </Text>
        <Text style={{ color: colors.grey, fontSize: 13 }}>{t('profile.beltReadOnly')}</Text>
      </View>

      {message ? (
        message.ok ? <Text style={{ color: colors.white, marginTop: 8 }}>{t(message.key)}</Text> : <ErrorText>{t(message.key)}</ErrorText>
      ) : null}
      <Button title={t('common.save')} onPress={() => void save()} disabled={busy} />
    </View>
  );
}
