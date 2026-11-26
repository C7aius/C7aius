import type { PayInfo } from '@/src/components/courses/BookButton';
import { supabase } from '@/src/lib/supabase';

/** Adhésion et essais gratuits de chaque profil (soi + enfants) ; un échec laisse simplement le profil sans info. */
export async function loadPayInfo(ids: string[]): Promise<Record<string, PayInfo>> {
  const out: Record<string, PayInfo> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const [m, tr] = await Promise.all([
          supabase.rpc('my_membership', { p_profile: id }),
          supabase.rpc('my_trial_status', { p_profile: id }),
        ]);
        const mem = Array.isArray(m.data) ? m.data[0] : null;
        const trial = Array.isArray(tr.data) ? tr.data[0] : null;
        if (!mem || !trial) return;
        out[id] = { isMember: !!mem.is_member, used: Number(trial.used), limit: Number(trial.trial_limit) };
      } catch {
        // pas d'info : pas de compteur d'essais
      }
    }),
  );
  return out;
}
