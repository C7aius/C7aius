import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase configuration: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example).',
  );
}

/**
 * Web : la page a-t-elle été ouverte depuis le lien « mot de passe oublié » ?
 * Lu AVANT createClient, qui consomme puis efface le fragment #access_token=…&type=recovery.
 */
export const launchedFromRecoveryLink =
  Platform.OS === 'web' && typeof window !== 'undefined' && /(^|[#&?])type=recovery(&|$)/.test(window.location?.hash ?? '');

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
