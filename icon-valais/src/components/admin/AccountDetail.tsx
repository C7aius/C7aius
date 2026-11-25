import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth, type Profile } from '@/src/auth/AuthProvider';
import { BeltEditor } from '@/src/components/BeltEditor';
import { Button, Chip, ErrorText, Field } from '@/src/components/ui';
import { formatDate, rpcErrorKey } from '@/src/domain/adminErrors';
import { canEditBelt } from '@/src/domain/roles';
import type { Role } from '@/src/domain/types';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';

const ROLES: Role[] = ['eleve', 'prof', 'admin'];
const ROLE_KEY: Record<Role, string> = { eleve: 'admin.roleEleve', prof: 'admin.roleProf', admin: 'admin.roleAdmin' };
const STATUS_KEY = { en_attente: 'admin.statusEnAttente', valide: 'admin.statusValide', refuse: 'admin.statusRefuse' } as const;

const todayIso = () => new Date().toISOString().slice(0, 10);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Fiche d'un compte (admin) : statut prof, rôle, cotisation, e-mail du parent, ceinture. */
export function AccountDetail({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [parentEmail, setParentEmail] = useState('');
  const [parentEmailError, setParentEmailError] = useState<string | null>(null);
  const [parentEmailSaved, setParentEmailSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (e) {
      setError(rpcErrorKey(e));
      return;
    }
    if (data) {
      setProfile(data as Profile);
      setParentEmail((data as Profile).parent_email ?? '');
      setMissing(false);
    } else {
      setProfile(null);
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    setProfile(null);
    setMissing(false);
    setError(null);
    setPendingRole(null);
    setParentEmailError(null);
    setParentEmailSaved(false);
    let live = true;
    void load().catch(() => live && setError('errors.network'));
    return () => {
      live = false;
    };
  }, [load]);

  const run = async (call: () => PromiseLike<{ error: { code?: string; hint?: string | null } | null }>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await call();
      if (e) {
        setError(rpcErrorKey(e));
        return false;
      }
      await load();
      onChanged?.();
      return true;
    } catch {
      setError('errors.network');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const isSelf = !!profile && auth.profile?.id === profile.id;

  const setRole = async (r: Role) => {
    if (!profile) return;
    setPendingRole(null);
    const ok = await run(() => supabase.rpc('admin_set_role', { p_profile: profile.id, p_role: r }));
    // l'admin a changé son propre rôle : recharger ses droits (onglets)
    if (ok && isSelf) await auth.refresh();
  };

  const chooseRole = (r: Role) => {
    if (busy || !profile || profile.role === r) return;
    // changer son propre rôle d'admin retire l'accès à l'administration : confirmation
    if (isSelf && profile.role === 'admin') setPendingRole(r);
    else void setRole(r);
  };

  const saveParentEmail = async () => {
    if (!profile) return;
    const value = parentEmail.trim().toLowerCase();
    setParentEmailSaved(false);
    if (value !== '' && (value.length > 254 || !EMAIL_RE.test(value))) {
      setParentEmailError('errors.invalidEmail');
      return;
    }
    setParentEmailError(null);
    const ok = await run(() => supabase.from('profiles').update({ parent_email: value === '' ? null : value }).eq('id', profile.id));
    if (ok) setParentEmailSaved(true);
  };

  if (!profile && error) return <ErrorText>{t(error)}</ErrorText>;
  if (missing) return <Text style={styles.body}>{t('admin.notFound')}</Text>;
  if (!profile) return <Text style={styles.body}>{t('common.loading')}</Text>;

  const paid = profile.paid_until;
  const membership = !paid
    ? t('admin.unpaid')
    : paid >= todayIso()
      ? t('admin.paidUntil', { date: formatDate(paid) })
      : t('admin.paidExpired', { date: formatDate(paid) });

  return (
    <View>
      <Text style={styles.title}>{`${profile.first_name} ${profile.last_name}`}</Text>
      {profile.email ? <Text style={styles.body}>{profile.email}</Text> : null}
      <ErrorText>{error ? t(error) : null}</ErrorText>

      <Text style={styles.section}>{t('admin.roleLabel')}</Text>
      {profile.auth_user_id === null ? (
        <Text style={styles.body}>{t('admin.childProfile')}</Text>
      ) : (
        <View style={styles.row}>
          {ROLES.map((r) => (
            <Chip key={r} label={t(ROLE_KEY[r])} selected={profile.role === r} onPress={() => chooseRole(r)} />
          ))}
        </View>
      )}
      {pendingRole ? (
        <View>
          <Text style={styles.body}>{t('admin.confirmOwnRole', { role: t(ROLE_KEY[pendingRole]) })}</Text>
          <Button title={t('common.confirm')} disabled={busy} onPress={() => void setRole(pendingRole)} />
          <Button title={t('common.cancel')} variant="secondary" disabled={busy} onPress={() => setPendingRole(null)} />
        </View>
      ) : null}

      {profile.role === 'prof' ? (
        <View>
          <Text style={styles.section}>{t('admin.profStatus')}</Text>
          <Text style={styles.body}>{profile.prof_status ? t(STATUS_KEY[profile.prof_status]) : '-'}</Text>
          {profile.prof_status !== 'valide' ? (
            <Button
              title={t('admin.validate')}
              disabled={busy}
              onPress={() => void run(() => supabase.rpc('admin_set_prof_status', { p_profile: profile.id, p_status: 'valide' }))}
            />
          ) : null}
          {profile.prof_status !== 'refuse' ? (
            <Button
              title={t('admin.reject')}
              variant="secondary"
              disabled={busy}
              onPress={() => void run(() => supabase.rpc('admin_set_prof_status', { p_profile: profile.id, p_status: 'refuse' }))}
            />
          ) : null}
        </View>
      ) : null}

      <Text style={styles.section}>{t('admin.membership')}</Text>
      <Text style={styles.body}>{membership}</Text>
      <Button
        title={t('admin.markPaid')}
        variant="secondary"
        disabled={busy}
        onPress={() => void run(() => supabase.rpc('admin_mark_paid_current_year', { p_profile: profile.id }))}
      />

      {profile.auth_user_id !== null && profile.parent_profile_id === null ? (
        <View>
          <Text style={styles.section}>{t('admin.parentEmail')}</Text>
          <Text style={styles.body}>{profile.parent_email ?? t('admin.parentEmailNone')}</Text>
          <Field
            label={t('admin.parentEmailEdit')}
            value={parentEmail}
            onChangeText={(v) => {
              setParentEmail(v);
              setParentEmailSaved(false);
            }}
            keyboardType="email-address"
            maxLength={254}
            error={parentEmailError ? t(parentEmailError) : undefined}
          />
          {parentEmailSaved ? <Text style={styles.body}>{t('admin.parentEmailSaved')}</Text> : null}
          <Button title={t('admin.parentEmailSave')} variant="secondary" disabled={busy} onPress={() => void saveParentEmail()} />
        </View>
      ) : null}

      {canEditBelt('admin', null) ? (
        <View style={{ marginTop: 20 }}>
          <BeltEditor
            key={profile.id}
            profileId={profile.id}
            age={profile.age}
            current={profile.bjj_belt}
            onSaved={() => {
              void load();
              onChanged?.();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.orange, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  section: { color: colors.orange, fontWeight: '700', marginTop: 20, marginBottom: 6 },
  body: { color: colors.white, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
