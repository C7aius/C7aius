import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui';
import { colors } from '@/src/theme';

/**
 * Retour web de Stripe Checkout : /payment-result?status=success|cancel&payment=<id>.
 * Le paiement n'est jamais « confirmé » ici : seul le webhook le fait, l'écran l'indique.
 */
export default function PaymentResult() {
  const { t } = useTranslation();
  const router = useRouter();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const kind = status === 'success' ? 'Success' : status === 'cancel' ? 'Cancel' : null;

  return (
    <View style={styles.screen}>
      {kind ? (
        <>
          <Text style={styles.title}>{t(`payments.resultTitle${kind}`)}</Text>
          <Text style={styles.text}>{t(`payments.result${kind}`)}</Text>
        </>
      ) : (
        <Text style={styles.text}>{t('payments.resultInvalid')}</Text>
      )}
      <Button title={t('payments.backHome')} onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite, justifyContent: 'center', padding: 24 },
  title: { color: colors.orange, fontSize: 22, fontWeight: '700', marginBottom: 12 },
  text: { color: colors.white, marginBottom: 20 },
});
