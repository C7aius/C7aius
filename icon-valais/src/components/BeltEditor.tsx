import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, ErrorText } from '@/src/components/ui';
import { rpcErrorKey } from '@/src/domain/adminErrors';
import { beltOptions } from '@/src/domain/belts';
import type { Belt } from '@/src/domain/types';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

/** Choix de la ceinture (admin ou prof actif) via la RPC set_belt ; les ceintures enfant dépendent de l'âge. */
export function BeltEditor({
  profileId,
  age,
  current,
  onSaved,
}: {
  profileId: string;
  age: number;
  current: Belt | null;
  onSaved: (b: Belt) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Belt | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('set_belt', { p_profile: profileId, p_belt: selected });
      if (e) setError(rpcErrorKey(e));
      else onSaved(selected);
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={{ color: colors.white, marginBottom: 6 }}>{t('profile.belt')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {beltOptions(age).map((b) => (
          <Chip key={b} label={t(`belts.${b}`)} selected={selected === b} onPress={() => setSelected(b)} />
        ))}
      </View>
      <ErrorText>{error ? t(error) : null}</ErrorText>
      <Button title={t('common.save')} onPress={save} disabled={busy || !selected || selected === current} />
    </View>
  );
}
