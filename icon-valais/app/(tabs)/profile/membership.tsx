import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { PLAN_MONTHS, PlanPicker, type Months, type Plan } from '@/src/components/payments/PlanPicker';
import { Button, Chip, ErrorText } from '@/src/components/ui';
import { formatDate } from '@/src/domain/adminErrors';
import { formatChf } from '@/src/domain/courses';
import { payMembershipDetail } from '@/src/lib/payments';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

type Status = {
  is_member: boolean;
  until: string | null;
  auto_renew: boolean;
  cancel_at_period_end: boolean;
};
type Method = 'card' | 'twint';

const first = <T,>(data: unknown): T | null => (Array.isArray(data) ? ((data[0] as T) ?? null) : null);

/** Abonnement du profil `profileId` (soi par défaut ; un parent l'ouvre depuis la fiche de l'enfant). */
export default function Membership() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const profileId = params.profileId || profile?.id;

  const [status, setStatus] = useState<Status | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [months, setMonths] = useState<Months | null>(null);
  const [method, setMethod] = useState<Method>('card');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) return;
    try {
      const [mem, ...prices] = await Promise.all([
        supabase.rpc('my_membership', { p_profile: profileId }),
        ...PLAN_MONTHS.map((m) => supabase.rpc('membership_price', { p_profile: profileId, p_months: m })),
      ]);
      const s = first<Status>(mem.data);
      setStatus(s);
      const rows = prices.map((r, i) => {
        const row = first<Omit<Plan, 'months'>>(r.data);
        return row ? ({ ...row, months: PLAN_MONTHS[i] } as Plan) : null;
      });
      if (rows.every((r): r is Plan => r !== null)) setPlans(rows);
      else setErrorKey('subscription.loadError');
      if (s?.is_member && s.auto_renew) {
        const { data } = await supabase
          .from('memberships')
          .select('id')
          .eq('profile_id', profileId)
          .eq('status', 'active')
          .eq('auto_renew', true)
          .limit(1);
        setMembershipId((data as { id: string }[] | null)?.[0]?.id ?? null);
      } else {
        setMembershipId(null);
      }
    } catch {
      setErrorKey('subscription.loadError');
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = plans.find((p) => p.months === months);

  const pay = async () => {
    if (!profileId || !months) return;
    setBusy(true);
    setErrorKey(null);
    setMessage(null);
    const { outcome, errorKey: key } = await payMembershipDetail(profileId, months, method);
    if (outcome === 'redirected') return; // la page quitte l'app
    setBusy(false);
    if (outcome === 'error') setErrorKey(key ?? 'payments.error');
    else if (outcome === 'paid') {
      setMessage('subscription.paid');
      void load();
    } else if (outcome === 'pending') {
      setMessage('subscription.pending');
      void load();
    }
  };

  const cancel = async () => {
    if (!membershipId) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const { error } = await supabase.functions.invoke('cancel-subscription', { body: { membershipId } });
      if (error) setErrorKey('payments.error');
      else {
        setMessage('subscription.cancelled');
        setConfirming(false);
        void load();
      }
    } catch {
      setErrorKey('errors.network');
    } finally {
      setBusy(false);
    }
  };

  const target = profileId && profileId !== profile?.id ? { profileId } : {};

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('subscription.title')}</Text>

      {status ? (
        <>
          <Text style={styles.status}>
            {status.is_member && status.until
              ? t('subscription.memberUntil', { date: formatDate(status.until) })
              : t('subscription.notMember')}
          </Text>
          {status.is_member ? (
            <Text style={styles.row}>{t(status.auto_renew ? 'subscription.autoRenewOn' : 'subscription.autoRenewOff')}</Text>
          ) : null}
          {status.cancel_at_period_end ? <Text style={styles.row}>{t('subscription.cancelScheduled')}</Text> : null}
        </>
      ) : null}

      {status?.is_member && status.auto_renew && !status.cancel_at_period_end && membershipId ? (
        confirming ? (
          <>
            <Text style={styles.row}>{t('subscription.cancelConfirm')}</Text>
            <Button title={t('subscription.cancelYes')} disabled={busy} onPress={() => void cancel()} />
            <Button title={t('subscription.cancelNo')} variant="secondary" disabled={busy} onPress={() => setConfirming(false)} />
          </>
        ) : (
          <Button title={t('subscription.cancel')} variant="secondary" onPress={() => setConfirming(true)} />
        )
      ) : null}

      <Text style={styles.section}>{t('subscription.plans')}</Text>
      <PlanPicker plans={plans} selected={months} onSelect={setMonths} disabled={busy} />

      <Text style={styles.section}>{t('subscription.method')}</Text>
      <Chip label={t('subscription.card')} selected={method === 'card'} onPress={() => setMethod('card')} />
      <Chip label={t('subscription.twint')} selected={method === 'twint'} onPress={() => setMethod('twint')} />

      <Button
        title={busy ? t('subscription.busy') : selected ? t('subscription.subscribe', { amount: formatChf(selected.amount) }) : t('subscription.select')}
        disabled={busy || !selected}
        onPress={() => void pay()}
      />
      {message ? <Text style={styles.ok}>{t(message)}</Text> : null}
      <ErrorText>{errorKey ? t(errorKey) : undefined}</ErrorText>

      <Button
        title={t('subscription.studentLink')}
        variant="secondary"
        onPress={() => router.push({ pathname: '/profile/student-proof', params: target })}
      />
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  status: { color: colors.white, fontSize: 18, fontWeight: '600', marginBottom: 6 },
  row: { color: colors.white, marginBottom: 8 },
  section: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  ok: { color: colors.white, marginTop: 8 },
});
