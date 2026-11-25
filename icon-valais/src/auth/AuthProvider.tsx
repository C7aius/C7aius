import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/src/lib/supabase';
import type { Database } from '@/src/lib/database.types';

export type Profile = Omit<Database['public']['Tables']['profiles']['Row'], 'is_account_active'>;

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  isActive: boolean;
  /** false tant que la session et le profil initiaux ne sont pas résolus */
  ready: boolean;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    }).catch(() => setSessionLoaded(true));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // pas d'appel supabase ici (verrou interne) : seulement de l'état
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const load = useCallback(async (id: string | null) => {
    if (!id) {
      setProfile(null);
      setIsActive(false);
      setProfileLoaded(true);
      return;
    }
    try {
      const [p, active] = await Promise.all([
        supabase.from('profiles').select('*').eq('auth_user_id', id).maybeSingle(),
        supabase.rpc('current_account_active'),
      ]);
      setProfile(p.error ? null : p.data);
      setIsActive(!p.error && !active.error && active.data === true);
    } catch {
      setProfile(null);
      setIsActive(false);
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    setProfileLoaded(false);
    void load(userId);
  }, [sessionLoaded, userId, load]);

  const refresh = useCallback(() => load(userId), [load, userId]);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, profile, isActive, ready: sessionLoaded && profileLoaded, signOut, refresh }),
    [session, profile, isActive, sessionLoaded, profileLoaded, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
