import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth, type Profile } from '@/src/auth/AuthProvider';
import { Button, Chip, ErrorText, Field } from '@/src/components/ui';
import { beltOptions } from '@/src/domain/belts';
import type { Belt, Sport } from '@/src/domain/types';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const SPORTS: Sport[] = ['jjb', 'grappling', 'mma'];

type Form = { firstName: string; lastName: string; age: string; sports: Sport[]; belt: Belt | ''; yg: string; ym: string };
const empty: Form = { firstName: '', lastName: '', age: '', sports: [], belt: '', yg: '', ym: '' };

const toInt = (raw: string): number | undefined => {
  const n = raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export default function Children() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const router = useRouter();
  const [children, setChildren] = useState<Profile[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase.from('profiles').select('*').eq('parent_profile_id', profile.id);
    setChildren(((data ?? []) as Profile[]).slice().sort((a, b) => a.first_name.localeCompare(b.first_name)));
  }, [profile]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  const has = (s: Sport) => form.sports.includes(s);
  const age = toInt(form.age);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'errors.required';
    if (!form.lastName.trim()) e.lastName = 'errors.required';
    if (age === undefined || age > 100) e.age = 'errors.ageRange';
    if (form.sports.length === 0) e.sports = 'errors.sportRequired';
    const yg = has('grappling') ? toInt(form.yg) : undefined;
    const ym = has('mma') ? toInt(form.ym) : undefined;
    if (has('grappling') && yg === undefined) e.yg = 'errors.yearsRequired';
    if (has('mma') && ym === undefined) e.ym = 'errors.yearsRequired';
    if (form.belt && age !== undefined && !(beltOptions(age) as string[]).includes(form.belt)) e.belt = 'errors.beltInvalid';
    setErrors(e);
    setMessage(null);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const { error } = await supabase.rpc('create_child_profile', {
        p: {
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          age,
          sports: form.sports,
          bjj_belt: has('jjb') && form.belt ? form.belt : null,
          years_grappling: yg ?? null,
          years_mma: ym ?? null,
        },
      });
      if (error) setMessage('errors.generic');
      else {
        setForm(empty);
        await load();
      }
    } catch {
      setMessage('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('profile.children')}</Text>
      {children.length === 0 ? <Text style={styles.body}>{t('profile.noChildren')}</Text> : null}
      {children.map((c) => (
        <Pressable key={c.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/profile/child/[id]', params: { id: c.id } })} style={styles.child}>
          <Text style={styles.body}>{c.first_name} {c.last_name} ({c.age})</Text>
        </Pressable>
      ))}

      <Text style={[styles.title, { marginTop: 24 }]}>{t('profile.addChild')}</Text>
      <Field label={t('signup.firstName')} value={form.firstName} onChangeText={(firstName) => set({ firstName })} error={err('firstName')} />
      <Field label={t('signup.lastName')} value={form.lastName} onChangeText={(lastName) => set({ lastName })} error={err('lastName')} />
      <Field label={t('signup.age')} value={form.age} onChangeText={(a) => set({ age: a })} keyboardType="number-pad" error={err('age')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {SPORTS.map((s) => (
          <Chip key={s} label={t(`sports.${s}`)} selected={has(s)} onPress={() => set({ sports: has(s) ? form.sports.filter((x) => x !== s) : [...form.sports, s] })} />
        ))}
      </View>
      <ErrorText>{err('sports')}</ErrorText>
      {has('jjb') && age !== undefined ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.body}>{t('profile.childBelt')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {beltOptions(age).map((b) => (
              <Chip key={b} label={t(`belts.${b}`)} selected={form.belt === b} onPress={() => set({ belt: b })} />
            ))}
          </View>
          <ErrorText>{err('belt')}</ErrorText>
        </View>
      ) : null}
      {has('grappling') ? <Field label={t('signup.yearsGrappling')} value={form.yg} onChangeText={(yg) => set({ yg })} keyboardType="number-pad" error={err('yg')} /> : null}
      {has('mma') ? <Field label={t('signup.yearsMma')} value={form.ym} onChangeText={(ym) => set({ ym })} keyboardType="number-pad" error={err('ym')} /> : null}
      <ErrorText>{message ? t(message) : undefined}</ErrorText>
      <Button title={t('profile.childAdd')} onPress={() => void submit()} disabled={busy} />
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 22, fontWeight: '700', marginBottom: 12 },
  body: { color: colors.white, marginBottom: 6 },
  child: { borderWidth: 1, borderColor: colors.grey, borderRadius: 8, padding: 12, marginBottom: 8 },
});
