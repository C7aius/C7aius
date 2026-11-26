import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatChf } from '@/src/domain/courses';
import { colors } from '@/src/theme';

export type Months = 1 | 3 | 6 | 12;
export const PLAN_MONTHS: readonly Months[] = [1, 3, 6, 12];

/** Ligne de `membership_price` : tout est calculé par le serveur. */
export type Plan = {
  months: Months;
  base: number;
  discount_pct: number;
  reason: 'none' | 'student' | 'child';
  amount: number;
};

/** Les 4 formules avec leur prix et la réduction appliquée. */
export function PlanPicker({
  plans,
  selected,
  onSelect,
  disabled,
}: {
  plans: Plan[];
  selected: Months | null;
  onSelect: (months: Months) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View>
      {plans.map((p) => {
        const on = p.months === selected;
        const discount =
          p.reason === 'child'
            ? t('subscription.discountChild', { pct: p.discount_pct })
            : p.reason === 'student'
              ? t('subscription.discountStudent', { pct: p.discount_pct })
              : null;
        return (
          <Pressable
            key={p.months}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onSelect(p.months)}
            style={[styles.plan, on && styles.planOn]}
          >
            <Text style={styles.months}>{t('subscription.months', { count: p.months })}</Text>
            <View style={styles.right}>
              {discount ? <Text style={styles.discount}>{discount}</Text> : null}
              {discount ? <Text style={styles.base}>{formatChf(p.base)}</Text> : null}
              <Text style={styles.amount}>{formatChf(p.amount)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  plan: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.grey,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  planOn: { borderColor: colors.orange, borderWidth: 2 },
  months: { color: colors.white, fontSize: 16, fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  amount: { color: colors.orange, fontSize: 18, fontWeight: '700' },
  base: { color: colors.grey, textDecorationLine: 'line-through' },
  discount: { color: colors.white, fontSize: 12 },
});
