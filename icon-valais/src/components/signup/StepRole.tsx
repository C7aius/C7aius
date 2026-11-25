import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip } from '@/src/components/ui';
import type { StepProps } from './types';

export function StepRole({ values, onChange }: StepProps) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      <Chip label={t('signup.roleStudent')} selected={values.role === 'eleve'} onPress={() => onChange({ role: 'eleve' })} />
      <Chip label={t('signup.roleCoach')} selected={values.role === 'prof'} onPress={() => onChange({ role: 'prof' })} />
    </View>
  );
}
