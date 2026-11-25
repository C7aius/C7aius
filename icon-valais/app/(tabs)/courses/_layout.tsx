import { Stack } from 'expo-router';

import { colors } from '@/src/theme';

export default function CoursesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.anthracite },
      }}
    />
  );
}
