import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, ErrorText } from '@/src/components/ui';
import { formatChf } from '@/src/domain/courses';
import { payBookingDetail, type PayOutcome } from '@/src/lib/payments';
import { colors } from '@/src/theme';

/**
 * Confirmation avant paiement d'une réservation : montant (calculé par le serveur), mention de
 * remboursement, lien « Devenir adhérent ». « Payer » ouvre la feuille Stripe (natif) ou
 * redirige vers Stripe Checkout (web).
 */
export function PaySheet({
  bookingId,
  amount,
  onClose,
  onBecomeMember,
}: {
  bookingId: string;
  amount: number;
  /** Feuille fermée : payé, en attente de confirmation du webhook, ou abandonné. */
  onClose: (outcome: 'paid' | 'pending' | 'cancelled') => void;
  onBecomeMember: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const pay = async () => {
    setBusy(true);
    setErrorKey(null);
    const { outcome, errorKey: key } = await payBookingDetail(bookingId);
    if (outcome === 'redirected') return; // la page quitte l'app
    setBusy(false);
    if (outcome === 'error') setErrorKey(key ?? 'payments.error');
    else onClose(outcome satisfies Exclude<PayOutcome, 'error' | 'redirected'>);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {
        if (!busy) onClose('cancelled');
      }}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('payments.confirmTitle')}</Text>
          <Text style={styles.amount}>{formatChf(amount)}</Text>
          <Text style={styles.notice}>{t('payments.refundNotice')}</Text>
          <Text style={styles.notice}>{t('payments.holdNotice')}</Text>
          <Pressable accessibilityRole="link" onPress={onBecomeMember} disabled={busy}>
            <Text style={styles.link}>{t('payments.becomeMember')}</Text>
          </Pressable>
          <ErrorText>{errorKey ? t(errorKey) : undefined}</ErrorText>
          <Button title={busy ? t('payments.busy') : t('payments.pay')} disabled={busy} onPress={() => void pay()} />
          <Button title={t('payments.cancel')} variant="secondary" disabled={busy} onPress={() => onClose('cancelled')} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: colors.anthracite, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.grey },
  title: { color: colors.white, fontSize: 18, fontWeight: '700' },
  amount: { color: colors.orange, fontSize: 28, fontWeight: '700', marginVertical: 8 },
  notice: { color: colors.white, marginBottom: 6 },
  link: { color: colors.orange, textDecorationLine: 'underline', marginVertical: 8 },
});
