import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/src/theme';

export default function Courses() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('tabs.courses')}</Text>
      <Text style={styles.body}>{t('tabs.emptyHere')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.anthracite, padding: 24 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  body: { color: colors.white, textAlign: 'center' },
});
