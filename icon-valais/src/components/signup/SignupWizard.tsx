import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/auth/AuthProvider';
import { setConsentSendResult } from '@/src/auth/consentNotice';
import { consentSendErrorKey } from '@/src/domain/functionErrors';
import { Button, ErrorText } from '@/src/components/ui';
import { needsParentConsent, registrationSchema } from '@/src/domain/registration';
import type { Lang } from '@/src/i18n';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';
import {
  emptyDraft,
  signUpErrorKey,
  stepErrors,
  stepsFor,
  toCandidate,
  toSignUpMetadata,
  validBelt,
  type Draft,
  type StepId,
} from './draft';
import { StepCoach } from './StepCoach';
import { StepIdentity } from './StepIdentity';
import { StepParent } from './StepParent';
import { StepRole } from './StepRole';
import { StepSports } from './StepSports';

const TITLES: Record<StepId, string> = {
  role: 'signup.stepRole',
  identity: 'signup.stepIdentity',
  sports: 'signup.stepSports',
  coach: 'signup.stepCoach',
  parent: 'signup.stepParent',
};

const COMPONENTS = {
  role: StepRole,
  identity: StepIdentity,
  sports: StepSports,
  coach: StepCoach,
  parent: StepParent,
};

export function SignupWizard() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [index, setIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = stepsFor(draft);
  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;
  const Current = COMPONENTS[step];

  const onChange = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if ('age' in patch) next.bjjBelt = validBelt(next.bjjBelt, next.age);
      return next;
    });
    setErrors({});
    setFormError(null);
  };

  const submit = async () => {
    const parsed = registrationSchema.safeParse(toCandidate(draft));
    if (!parsed.success) {
      setFormError('errors.generic');
      return;
    }
    const input = parsed.data;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: toSignUpMetadata(input, i18n.language as Lang) },
      });
      if (error) {
        setFormError(signUpErrorKey(error.message));
        return;
      }
      if (!data.session) {
        // confirmation par e-mail requise : ce n'est pas un échec
        setNotice('signup.checkEmail');
        return;
      }
      if (needsParentConsent(input.age, false)) {
        // Échec non bloquant : l'écran « en attente » l'indique et propose de renvoyer l'e-mail.
        try {
          const { error: sendError } = await supabase.functions.invoke('send-parent-consent', {
            body: { parent_email: input.parentEmail },
          });
          setConsentSendResult(sendError ? await consentSendErrorKey(sendError) : null);
        } catch {
          setConsentSendResult('errors.network');
        }
      }
      await refresh();
    } catch {
      setFormError('errors.network');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const errs = stepErrors(draft, step);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (isLast) void submit();
    else setIndex(index + 1);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.progress}>
        {t('signup.stepOf', { current: Math.min(index, steps.length - 1) + 1, total: steps.length })}
      </Text>
      <Text style={styles.title}>{t(TITLES[step])}</Text>
      <Current values={draft} onChange={onChange} errors={errors} />
      {notice ? <Text style={styles.notice}>{t(notice)}</Text> : null}
      {formError ? <ErrorText>{t(formError)}</ErrorText> : null}
      <View style={styles.actions}>
        <Button title={isLast ? t('signup.submit') : t('common.next')} onPress={next} disabled={busy} />
        {index > 0 ? (
          <Button title={t('common.back')} variant="secondary" onPress={() => setIndex(index - 1)} disabled={busy} />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 48 },
  progress: { color: colors.grey, marginBottom: 4 },
  title: { color: colors.orange, fontSize: 24, fontWeight: '700', marginBottom: 20 },
  notice: { color: colors.white, marginVertical: 8 },
  actions: { marginTop: 12 },
});
