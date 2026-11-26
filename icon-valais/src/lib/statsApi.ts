import type { Database } from '@/src/lib/database.types';
import { supabase } from '@/src/lib/supabase';

export type RankPeriod = 'all' | 'year';
export type RankLimit = 10 | 20 | null;
export type RankingRow = Database['public']['Functions']['attendance_ranking']['Returns'][number];
export type MyRanking = { rank: number | null; sessions: number };

/** Classement de régularité ; `limit` garde les ex aequo (peut renvoyer un peu plus de N lignes). */
export async function fetchRanking(period: RankPeriod, limit: RankLimit): Promise<RankingRow[]> {
  const { data, error } = await supabase.rpc('attendance_ranking', { p_period: period, p_limit: limit ?? undefined });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyRanking(period: RankPeriod): Promise<MyRanking> {
  const { data, error } = await supabase.rpc('my_ranking', { p_period: period });
  if (error) throw error;
  return data?.[0] ?? { rank: null, sessions: 0 };
}
