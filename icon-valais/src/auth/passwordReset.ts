import { Platform } from 'react-native';

/** Schéma d'URL de l'application (doit rester égal à expo.scheme dans app.json). */
export const APP_SCHEME = 'iconvalais';
export const RESET_PATH = '/reset-password';

/**
 * URL de retour du lien de réinitialisation (redirectTo) :
 *  - web : origine de l'application + /reset-password
 *  - natif : iconvalais://reset-password
 * Les deux doivent figurer dans auth.additional_redirect_urls (supabase/config.jsonc,
 * et dans le tableau de bord Supabase en production).
 */
export function resetRedirectUrl(os: string = Platform.OS, origin?: string): string {
  if (os === 'web') {
    const o = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    return `${o}${RESET_PATH}`;
  }
  return `${APP_SCHEME}:/${RESET_PATH}`;
}

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; code: string }
  | { kind: 'none' };

/**
 * Natif : extrait la session du lien profond iconvalais://reset-password#access_token=…&refresh_token=…&type=recovery
 * (sur le web, supabase-js le fait lui-même via detectSessionInUrl).
 */
export function parseRecoveryUrl(url: string | null | undefined): RecoveryLink {
  if (!url) return { kind: 'none' };
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const raw = hashIndex >= 0 ? url.slice(hashIndex + 1) : queryIndex >= 0 ? url.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(raw);
  const error = params.get('error_code') ?? params.get('error');
  if (error) return { kind: 'error', code: error };
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken && params.get('type') === 'recovery') {
    return { kind: 'tokens', accessToken, refreshToken };
  }
  return { kind: 'none' };
}
