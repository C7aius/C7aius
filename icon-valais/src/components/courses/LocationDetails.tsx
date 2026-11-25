import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/src/theme';

export function LocationDetails({ name, address, mapsUrl }: { name: string; address: string; mapsUrl: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const safeUrl = /^https:\/\//i.test(mapsUrl) ? mapsUrl : null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t('courses.location')} ${name}`}
        onPress={() => setOpen((o) => !o)}
      >
        <Text style={styles.name}>
          {name} {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.details}>
          {address ? <Text style={styles.text}>{address}</Text> : null}
          {safeUrl ? (
            <Text
              accessibilityRole="link"
              // @ts-expect-error href est pris en charge par react-native-web
              href={safeUrl}
              // sur le web, le href suffit (évite une double ouverture)
              onPress={Platform.OS === 'web' ? undefined : () => void Linking.openURL(safeUrl)}
              style={styles.link}
            >
              {t('courses.openMaps')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.white, marginTop: 4 },
  details: { marginTop: 4, paddingLeft: 8 },
  text: { color: colors.grey },
  link: { color: colors.orange, textDecorationLine: 'underline', marginTop: 2 },
});
