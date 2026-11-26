import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui';
import { formatAmount, formatDay, isReceiptable, STATUS_KEY, type PaymentRow } from '@/src/domain/paymentsView';
import { colors } from '@/src/theme';

/** Ligne de paiement : date, description, montant, statut ; « Quittance » si `onReceipt` est fourni. */
export function PaymentItem({ payment, onReceipt, busy }: { payment: PaymentRow; onReceipt?: (p: PaymentRow) => void; busy?: boolean }) {
  const { t } = useTranslation();
  const p = payment;
  return (
    <View style={styles.item}>
      <Text style={styles.meta}>{formatDay(p.paid_at ?? p.created_at)}</Text>
      <Text style={styles.desc}>{p.description}</Text>
      <Text style={styles.amount}>{formatAmount(Number(p.amount))}</Text>
      <Text style={p.status === 'refunded' ? styles.refunded : styles.meta}>{t(STATUS_KEY[p.status])}</Text>
      {onReceipt && isReceiptable(p) ? (
        <Button title={t('payments.receipt')} variant="secondary" disabled={busy} onPress={() => onReceipt(p)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.grey },
  desc: { color: colors.white, fontSize: 16 },
  amount: { color: colors.white, fontWeight: '600' },
  meta: { color: colors.grey, fontSize: 13 },
  refunded: { color: colors.orange, fontSize: 13, fontWeight: '600' },
});
