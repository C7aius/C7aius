import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip, ErrorText, Field } from '@/src/components/ui';
import { beltOptions } from '@/src/domain/belts';
import type { Sport } from '@/src/domain/types';
import { colors } from '@/src/theme';
import { parseAge } from './draft';
import type { StepProps } from './types';

const SPORTS: Sport[] = ['jjb', 'grappling', 'mma'];

export function StepSports({ values, onChange, errors }: StepProps) {
  const { t } = useTranslation();
  const err = (k: string) => (errors[k] ? t(errors[k]) : undefined);
  const has = (s: Sport) => values.sports.includes(s);
  const toggle = (s: Sport) =>
    onChange({ sports: has(s) ? values.sports.filter((x) => x !== s) : [...values.sports, s] });
  const age = parseAge(values.age);

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {SPORTS.map((s) => (
          <Chip key={s} label={t(`sports.${s}`)} selected={has(s)} onPress={() => toggle(s)} />
        ))}
      </View>
      <ErrorText>{err('sports')}</ErrorText>

      {has('jjb') && age !== undefined ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.white, marginBottom: 6 }}>{t('signup.belt')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {beltOptions(age).map((b) => (
              <Chip key={b} label={t(`belts.${b}`)} selected={values.bjjBelt === b} onPress={() => onChange({ bjjBelt: b })} />
            ))}
          </View>
          <ErrorText>{err('bjjBelt')}</ErrorText>
        </View>
      ) : null}

      {has('grappling') ? (
        <Field label={t('signup.yearsGrappling')} value={values.yearsGrappling} onChangeText={(yearsGrappling) => onChange({ yearsGrappling })} keyboardType="number-pad" error={err('yearsGrappling')} />
      ) : null}
      {has('mma') ? (
        <Field label={t('signup.yearsMma')} value={values.yearsMma} onChangeText={(yearsMma) => onChange({ yearsMma })} keyboardType="number-pad" error={err('yearsMma')} />
      ) : null}
    </>
  );
}
