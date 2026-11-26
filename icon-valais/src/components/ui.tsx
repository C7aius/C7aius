import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors } from '@/src/theme';

type FieldProps = Omit<TextInputProps, 'style'> & { label: string; error?: string };

export function Field({ label, error, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.grey}
        autoCapitalize="none"
        {...input}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, variant === 'secondary' && styles.buttonSecondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { color: colors.white, marginBottom: 6, fontSize: 14 },
  input: {
    backgroundColor: colors.white,
    color: colors.anthracite,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.white,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, marginTop: 4, fontSize: 13 },
  button: { backgroundColor: colors.orange, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.grey },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  buttonTextSecondary: { color: colors.white, fontWeight: '500' },
  disabled: { opacity: 0.5 },
  chip: {
    borderWidth: 1,
    borderColor: colors.grey,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: { backgroundColor: colors.orange, borderColor: colors.orange },
  chipText: { color: colors.white },
  chipTextSelected: { fontWeight: '700' },
});
