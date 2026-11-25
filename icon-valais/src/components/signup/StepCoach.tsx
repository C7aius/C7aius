import { useTranslation } from 'react-i18next';

import { Field } from '@/src/components/ui';
import type { StepProps } from './types';

export function StepCoach({ values, onChange, errors }: StepProps) {
  const { t } = useTranslation();
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  return (
    <>
      <Field label={t('signup.coachYears')} value={values.coachYears} onChangeText={(coachYears) => onChange({ coachYears })} keyboardType="number-pad" error={err('coachYears')} />
      <Field label={t('signup.trainingPlaces')} value={values.trainingPlaces} onChangeText={(trainingPlaces) => onChange({ trainingPlaces })} autoCapitalize="sentences" multiline />
      <Field label={t('signup.competitionAwards')} value={values.competitionAwards} onChangeText={(competitionAwards) => onChange({ competitionAwards })} autoCapitalize="sentences" multiline />
      <Field label={t('signup.cv')} value={values.cv} onChangeText={(cv) => onChange({ cv })} autoCapitalize="sentences" multiline />
    </>
  );
}
