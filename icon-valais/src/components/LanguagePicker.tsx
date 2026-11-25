import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { Chip, ErrorText } from '@/src/components/ui';
import i18n, { LANGS, type Lang } from '@/src/i18n';
import { supabase } from '@/src/lib/supabase';

const NAMES: Record<Lang, string> = { fr: 'Français', de: 'Deutsch', en: 'English', ru: 'Русский' };

/** Change la langue de l'interface et l'enregistre dans profiles.language. */
export function LanguagePicker() {
  const { t } = useTranslation();
  const { profile, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const choose = async (lang: Lang) => {
    setError(null);
    await i18n.changeLanguage(lang);
    if (!profile) return;
    try {
      const { error: e } = await supabase.from('profiles').update({ language: lang }).eq('id', profile.id);
      if (e) setError('errors.generic');
      else await refresh();
    } catch {
      setError('errors.network');
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
