import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { PaymentItem } from '@/src/components/payments/PaymentItem';
import { Button, ErrorText } from '@/src/components/ui';
import type { PaymentRow } from '@/src/domain/paymentsView';
import { openReceipt } from '@/src/lib/receipt';
import { ReceiptError } from '@/src/lib/receiptFetch';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

/** Mes paiements (les miens et ceux faits pour mes enfants), avec quittance PDF. */
export default function Payments() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile } = useAuth();
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = profile?.id;

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const { data, error: e } = await supabase
        .from('payments')
        .select('*')
        .or(`payer_profile_id.eq.${me},beneficiary_profile_id.eq.${me}`)
        .order('created_at', { ascending: false })
        .limit(200);
      if (e) setError('errors.generic');
      else {
        setRows((data ?? []) as PaymentRow[]);
        setError(null);
      }
    } catch {
      setError('errors.network');
    }
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
      <Text style={styles.title}>{t('payments.mineTitle')}</Text>
      <ErrorText>{error ? t(error) : null}</ErrorText>
      {rows && rows.length === 0 && !error ? <Text style={styles.body}>{t('payments.mineNone')}</Text> : null}
      {(rows ?? []).map((p) => (
        <PaymentItem key={p.id} payment={p} busy={busy} onReceipt={(x) => void receipt(x)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white, marginBottom: 8 },
});
