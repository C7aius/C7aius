import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Field } from '@/src/components/ui';
import { colors } from '@/src/theme';
import type { StepProps } from './types';

export function StepParent({ values, onChange, errors }: StepProps) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={{ color: colors.white, marginBottom: 12 }}>{t('signup.parentHint')}</Text>
      <Field label={t('signup.parentEmail')} value={values.parentEmail} onChangeText={(parentEmail) => onChange({ parentEmail })} keyboardType="email-address" error={errors.parentEmail ? t(errors.parentEmail) : undefined} />
    </>
  );
}
