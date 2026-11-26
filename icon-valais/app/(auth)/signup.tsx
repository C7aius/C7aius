import { View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { SignupWizard } from '@/src/components/signup/SignupWizard';
import { colors } from '@/src/theme';

export default function Signup() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: colors.anthracite }}>
      <SignupWizard />
      <Link href="/login" style={{ color: colors.orange, textAlign: 'center', padding: 16 }}>
        {t('auth.haveAccount')} {t('auth.login')}
      </Link>
    </View>
  );
}
