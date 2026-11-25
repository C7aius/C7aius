import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Button, ErrorText, Field } from '@/src/components/ui';
import { validateLocation } from '@/src/domain/courseForm';
import { fetchLocations, saveLocation, type LocationRow } from '@/src/lib/coursesApi';
import { colors } from '@/src/theme';

type Draft = { id?: string; name: string; address: string; mapsUrl: string; isDefault: boolean; archived: boolean };
const EMPTY: Draft = { name: '', address: '', mapsUrl: '', isDefault: false, archived: false };

const toPayload = (d: Draft) => ({
  ...(d.id ? { id: d.id } : {}),
  name: d.name.trim(),
  address: d.address.trim(),
  maps_url: d.mapsUrl.trim(),
  is_default: d.isDefault,
  archived: d.archived,
});

export default function Locations() {
  const { t } = useTranslation();
  const { profile, ready } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchLocations());
    } catch {
      setMessage('errors.network');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>{ready ? t('admin.forbidden') : t('common.loading')}</Text>
      </View>
    );
  }

  const run = async (d: Draft) => {
    setBusy(true);
    setMessage(null);
    const key = await saveLocation(toPayload(d));
    setBusy(false);
    if (key) {
      setMessage(key);
      return false;
    }
    await load();
    return true;
  };

  const submit = async () => {
    if (!draft) return;
    const errs = validateLocation({ name: draft.name, address: draft.address, mapsUrl: draft.mapsUrl });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (await run(draft)) setDraft(null);
  };

  const toDraft = (l: LocationRow): Draft => ({
    id: l.id, name: l.name, address: l.address, mapsUrl: l.maps_url, isDefault: l.is_default, archived: l.archived,
  });
  const edit = (d: Draft | null) => {
    setDraft(d);
    setErrors({});
    setMessage(null);
  };
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Text style={styles.title}>{t('admin.locations')}</Text>
      {rows.length === 0 && !message ? <Text style={styles.body}>{t('admin.locationNone')}</Text> : null}
      {rows.map((l) => (
        <View key={l.id} style={[styles.item, l.archived && styles.archived]}>
          <Pressable accessibilityRole="button" onPress={() => edit(toDraft(l))}>
            <Text style={styles.name}>{l.name}</Text>
            {l.address ? <Text style={styles.meta}>{l.address}</Text> : null}
            {l.is_default ? <Text style={styles.badge}>{t('admin.locationDefaultBadge')}</Text> : null}
            {l.archived ? <Text style={styles.meta}>{t('admin.locationArchivedBadge')}</Text> : null}
          </Pressable>
          {!l.is_default ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void run({ ...toDraft(l), archived: !l.archived })}
            >
              <Text style={styles.link}>{l.archived ? t('admin.locationRestore') : t('admin.locationArchive')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <ErrorText>{message ? t(message) : undefined}</ErrorText>

      {draft ? (
        <View style={styles.form}>
          <Field label={t('admin.locationName')} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} error={err('name')} />
          <Field label={t('admin.locationAddress')} value={draft.address} onChangeText={(address) => setDraft({ ...draft, address })} autoCapitalize="sentences" error={err('address')} />
          <Field label={t('admin.locationMaps')} value={draft.mapsUrl} onChangeText={(mapsUrl) => setDraft({ ...draft, mapsUrl })} keyboardType="url" error={err('mapsUrl')} />
          <View style={styles.switchRow}>
            <Text style={styles.body}>{t('admin.locationDefault')}</Text>
            <Switch
              accessibilityLabel={t('admin.locationDefault')}
              value={draft.isDefault}
              disabled={draft.archived}
              onValueChange={(isDefault) => setDraft({ ...draft, isDefault })}
            />
          </View>
          <Button title={t('common.save')} disabled={busy} onPress={() => void submit()} />
          <Button title={t('common.cancel')} variant="secondary" onPress={() => edit(null)} />
        </View>
      ) : (
        <Button title={t('admin.locationAdd')} onPress={() => edit({ ...EMPTY })} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.anthracite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.anthracite, padding: 24 },
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginVertical: 12 },
  body: { color: colors.white, marginBottom: 8 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.grey, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  archived: { opacity: 0.6 },
  name: { color: colors.white, fontSize: 16 },
  meta: { color: colors.grey, fontSize: 13 },
  badge: { color: colors.orange, fontSize: 12, fontWeight: '600' },
  link: { color: colors.orange, textDecorationLine: 'underline', padding: 8 },
  form: { marginTop: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
});
