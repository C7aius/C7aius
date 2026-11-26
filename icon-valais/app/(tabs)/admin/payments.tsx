import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminGuard } from '@/src/components/admin/AdminGuard';
import { PaymentItem } from '@/src/components/payments/PaymentItem';
import { Button, Chip, ErrorText } from '@/src/components/ui';
import { failedRefunds, formatAmount, paymentTotals, periodStart, type Period, type PaymentRow } from '@/src/domain/paymentsView';
import { openReceipt } from '@/src/lib/receipt';
import { ReceiptError } from '@/src/lib/receiptFetch';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'admin.periodMonth' },
  { key: '30d', label: 'admin.period30' },
  { key: 'year', label: 'admin.periodYear' },
  { key: 'all', label: 'admin.periodAll' },
];

function AdminPaymentsList() {
  const { t } = useTranslation();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('month');
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  // remboursements échoués : toutes périodes confondues (à traiter à la main)
  const [failed, setFailed] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      let q = supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(1000);
      const from = periodStart(period);
      if (from) q = q.gte('created_at', from);
      const [{ data, error: e }, rf] = await Promise.all([
        q,
        supabase.from('payments').select('*').eq('status', 'refund_failed').order('created_at', { ascending: false }).limit(200),
      ]);
      if (e || rf.error) setError('errors.generic');
      else {
        setRows((data ?? []) as PaymentRow[]);
        setFailed(failedRefunds((rf.data ?? []) as PaymentRow[]));
        setError(null);
      }
    } catch {
      setError('errors.network');
    }
  }, [period]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const totals = useMemo(() => paymentTotals(rows ?? []), [rows]);

  const receipt = async (p: PaymentRow) => {
    setBusy(true);
    setError(null);
    try {
      await openReceipt(p.id, p.receipt_no);
    } catch (e) {
      setError(e instanceof ReceiptError ? e.key : 'payments.receiptError');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Text style={styles.title}>{t('admin.paymentsTitle')}</Text>
      <View style={styles.chips}>
        {PERIODS.map((p) => (
          <Chip key={p.key} label={t(p.label)} selected={period === p.key} onPress={() => setPeriod(p.key)} />
        ))}
      </View>
      <View style={styles.totals}>
        <Text style={styles.body}>{t('admin.totalCollected')}</Text>
        <Text style={styles.total} testID="total-collected">{formatAmount(totals.collected)}</Text>
        <Text style={styles.body}>{t('admin.totalRefunded')}</Text>
        <Text style={styles.total} testID="total-refunded">{formatAmount(totals.refunded)}</Text>
      </View>
      <ErrorText>{error ? t(error) : null}</ErrorText>
      {failed.length > 0 ? (
        <View style={styles.failed} testID="refunds-failed">
          <Text style={styles.failedTitle}>{t('admin.refundsFailedTitle', { count: failed.length })}</Text>
          <Text style={styles.body}>{t('admin.refundsFailedHint')}</Text>
          {failed.map((p) => (
            <PaymentItem key={p.id} payment={p} />
          ))}
        </View>
      ) : null}
      {rows && rows.length === 0 && !error ? <Text style={styles.body}>{t('admin.paymentsNone')}</Text> : null}
      {(rows ?? []).map((p) => (
        <PaymentItem key={p.id} payment={p} busy={busy} onReceipt={(x) => void receipt(x)} />
      ))}
    </ScrollView>
  );
}

export default function AdminPayments() {
  return (
    <AdminGuard>
      <AdminPaymentsList />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  totals: { marginVertical: 8 },
  failed: { marginVertical: 8, padding: 12, borderWidth: 1, borderColor: colors.orange, borderRadius: 8 },
  failedTitle: { color: colors.orange, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  total: { color: colors.orange, fontSize: 20, fontWeight: '700', marginBottom: 6 },
});
