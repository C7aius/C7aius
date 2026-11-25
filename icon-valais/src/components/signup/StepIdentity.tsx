import { useTranslation } from 'react-i18next';

import { Field } from '@/src/components/ui';
import type { StepProps } from './types';

export function StepIdentity({ values, onChange, errors }: StepProps) {
  const { t } = useTranslation();
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  return (
    <>
      <Field label={t('signup.firstName')} value={values.firstName} onChangeText={(firstName) => onChange({ firstName })} autoCapitalize="words" error={err('firstName')} />
      <Field label={t('signup.lastName')} value={values.lastName} onChangeText={(lastName) => onChange({ lastName })} autoCapitalize="words" error={err('lastName')} />
      <Field label={t('auth.email')} value={values.email} onChangeText={(email) => onChange({ email })} keyboardType="email-address" autoComplete="email" error={err('email')} />
      <Field label={t('auth.password')} value={values.password} onChangeText={(password) => onChange({ password })} secureTextEntry autoComplete="new-password" error={err('password')} />
      <Field label={t('signup.confirmPassword')} value={values.confirmPassword} onChangeText={(confirmPassword) => onChange({ confirmPassword })} secureTextEntry autoComplete="new-password" error={err('confirmPassword')} />
      <Field label={t('signup.phone')} value={values.phone} onChangeText={(phone) => onChange({ phone })} keyboardType="phone-pad" autoComplete="tel" error={err('phone')} />
      <Field label={t('signup.age')} value={values.age} onChangeText={(age) => onChange({ age })} keyboardType="number-pad" error={err('age')} />
    </>
  );
}
