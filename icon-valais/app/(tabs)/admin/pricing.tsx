import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminGuard } from '@/src/components/admin/AdminGuard';
import { Button, ErrorText, Field } from '@/src/components/ui';
import { rpcErrorKey } from '@/src/domain/adminErrors';
import { PRICING_KEYS, toPricingPayload, validatePricing, type PricingForm, type PricingKey } from '@/src/domain/paymentsView';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const LABEL: Record<PricingKey, string> = {
  price_1m: 'admin.price1m',
  price_3m: 'admin.price3m',
  price_6m: 'admin.price6m',
  price_12m: 'admin.price12m',
  student_discount_pct: 'admin.studentPct',
  child_discount_pct: 'admin.childPct',
  child_max_age: 'admin.childMaxAge',
  default_course_price: 'admin.defaultCoursePrice',
};

function PricingForm_() {
  const { t } = useTranslation();
  const router = useRouter();
  const [form, setForm] = useState<PricingForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PricingKey, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('pricing_settings').select('*').limit(1).maybeSingle();
      if (error || !data) {
        setMessage('errors.generic');
        return;
      }
      const row = data as Record<PricingKey, number>;
      setForm(Object.fromEntries(PRICING_KEYS.map((k) => [k, String(row[k])])) as PricingForm);
    } catch {
      setMessage('errors.network');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submit = async () => {
    if (!form) return;
    const errs = validatePricing(form);
    setErrors(errs);
    setSaved(false);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_update_pricing', { p: toPricingPayload(form) });
      if (error) setMessage(rpcErrorKey(error));
      else setSaved(true);
    } catch {
      setMessage('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Text style={styles.title}>{t('admin.pricingTitle')}</Text>
      {!form && !message ? <Text style={styles.body}>{t('common.loading')}</Text> : null}
      {form
        ? PRICING_KEYS.map((k) => (
            <Field
              key={k}
              label={t(LABEL[k])}
              value={form[k]}
              keyboardType="decimal-pad"
              autoCapitalize="none"
              onChangeText={(v) => {
                setForm({ ...form, [k]: v });
                setSaved(false);
              }}
              error={errors[k] ? t(errors[k] as string) : undefined}
            />
          ))
        : null}
      <ErrorText>{message ? t(message) : null}</ErrorText>
      {saved ? <Text style={styles.body}>{t('admin.pricingSaved')}</Text> : null}
      {form ? <Button title={t('common.save')} disabled={busy} onPress={() => void submit()} /> : null}
    </ScrollView>
  );
}

export default function Pricing() {
  return (
    <AdminGuard>
      <PricingForm_ />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white, marginBottom: 8 },
});
