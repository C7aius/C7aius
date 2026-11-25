import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import i18n, { LANGS, type Lang } from '@/src/i18n';
import { clearConsentSendResult } from './consentNotice';
import { registerForPush } from '@/src/lib/push';
import { launchedFromRecoveryLink, supabase } from '@/src/lib/supabase';
import type { Database } from '@/src/lib/database.types';

export type Profile = Omit<Database['public']['Tables']['profiles']['Row'], 'is_account_active'>;

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  isActive: boolean;
  /** false tant que la session et le profil initiaux ne sont pas résolus */
  ready: boolean;
  /** session ouverte par un lien « mot de passe oublié » : l'écran /reset-password doit être affiché */
  recovering: boolean;
  /** natif : session de récupération posée depuis le lien profond */
  startRecovery(): void;
  /** fin de la récupération (mot de passe changé, ou abandon) */
  endRecovery(): void;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type Loaded = { userId: string | null; profile: Profile | null; isActive: boolean };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [recovering, setRecovering] = useState<boolean>(launchedFromRecoveryLink === true);
  const userId = session?.user.id ?? null;
  const currentId = useRef<string | null>(null);
  currentId.current = userId;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    }).catch(() => setSessionLoaded(true));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // pas d'appel supabase ici (verrou interne) : seulement de l'état
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      else if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const load = useCallback(async (id: string | null) => {
    let result: Loaded = { userId: id, profile: null, isActive: false };
    if (id) {
      try {
        const [p, active] = await Promise.all([
          supabase.from('profiles').select('*').eq('auth_user_id', id).maybeSingle(),
          supabase.rpc('current_account_active'),
        ]);
        result = {
          userId: id,
          profile: p.error ? null : p.data,
          isActive: !p.error && !active.error && active.data === true,
        };
      } catch {
        // profil indisponible : reste inactif
      }
    }
    // résultat périmé (autre utilisateur entre-temps) : ignoré
    if (currentId.current === id) setLoaded(result);
  }, []);

  useEffect(() => {
    if (sessionLoaded) void load(userId);
  }, [sessionLoaded, userId, load]);

  const refresh = useCallback(() => load(userId), [load, userId]);
  const startRecovery = useCallback(() => setRecovering(true), []);
  const endRecovery = useCallback(() => setRecovering(false), []);
  const signOut = useCallback(async () => {
    clearConsentSendResult();
    await supabase.auth.signOut();
  }, []);

  // `ready` : le profil chargé correspond à l'utilisateur de la session courante
  const fresh = sessionLoaded && loaded !== null && loaded.userId === userId;

  // Langue enregistrée dans le profil : appliquée à chaque nouveau profil chargé
  // (connexion, rechargement de la page) ou quand elle change en base.
  const savedLang = fresh ? loaded.profile?.language : undefined;
  useEffect(() => {
    if (savedLang && (LANGS as readonly string[]).includes(savedLang) && i18n.language !== savedLang) {
      void i18n.changeLanguage(savedLang as Lang);
    }
  }, [savedLang, userId]);

  // Jeton de notifications : une fois par utilisateur et par session d'app, dès qu'un profil frais est
  // chargé, actif ou non (register_push_token l'accepte) : un prof en attente doit recevoir prof_validated.
  const pushUser = useRef<string | null>(null);
  const hasProfile = fresh && loaded.profile !== null;
  useEffect(() => {
    if (!hasProfile || !userId || pushUser.current === userId) return;
    pushUser.current = userId;
    registerForPush().catch(() => console.warn('push registration failed'));
  }, [hasProfile, userId]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile: fresh ? loaded.profile : null,
      isActive: fresh ? loaded.isActive : false,
      ready: fresh,
      recovering,
      startRecovery,
      endRecovery,
      signOut,
      refresh,
    }),
    [session, fresh, loaded, recovering, startRecovery, endRecovery, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
