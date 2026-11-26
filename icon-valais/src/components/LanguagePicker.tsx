import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Chip, ErrorText } from '@/src/components/ui';
import i18n, { LANGS, type Lang } from '@/src/i18n';
import { supabase } from '@/src/lib/supabase';

const NAMES: Record<Lang, string> = { fr: 'Français', de: 'Deutsch', en: 'English', ru: 'Русский' };

/**
 * Enregistre la langue dans profiles.language, puis change la langue de
 * l'interface — seulement si l'enregistrement a réussi (sinon l'interface
 * reviendrait à l'ancienne langue au prochain chargement du profil).
 */
export function LanguagePicker() {
  const { t } = useTranslation();
  const { profile, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (lang: Lang) => {
    if (busy) return;
    setError(null);
    if (!profile) {
      await i18n.changeLanguage(lang);
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.from('profiles').update({ language: lang }).eq('id', profile.id);
      if (e) {
        setError('errors.generic');
        return;
      }
      await i18n.changeLanguage(lang);
      await refresh();
    } catch {
      setError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {LANGS.map((l) => (
          <Chip key={l} label={NAMES[l]} selected={i18n.language === l} onPress={() => void choose(l)} />
        ))}
      </View>
      <ErrorText>{error ? t(error) : undefined}</ErrorText>
    </View>
  );
}
