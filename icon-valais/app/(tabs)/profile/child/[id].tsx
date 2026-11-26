import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Profile } from '@/src/auth/AuthProvider';
import { ProfileForm } from '@/src/components/profile/ProfileForm';
import { Button } from '@/src/components/ui';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

export default function ChildProfile() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [child, setChild] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!live) return;
      if (data) setChild(data as Profile);
      else setMissing(true);
    })();
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{child ? `${child.first_name} ${child.last_name}` : t('profile.childTitle')}</Text>
      {missing ? <Text style={styles.body}>{t('profile.notFound')}</Text> : null}
      {child ? <ProfileForm profile={child} onSaved={() => undefined} /> : null}
      {child ? (
        <>
          <Button
            title={t('subscription.link')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/profile/membership', params: { profileId: child.id } })}
          />
          <Button
            title={t('studentProof.link')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/profile/student-proof', params: { profileId: child.id } })}
          />
        </>
      ) : null}
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 60 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  body: { color: colors.white, marginBottom: 12 },
});
