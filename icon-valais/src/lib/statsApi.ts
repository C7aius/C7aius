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

export type TeachingHoursRow = Database['public']['Functions']['admin_teaching_hours']['Returns'][number];
export type MemberHoursRow = Database['public']['Functions']['admin_member_hours']['Returns'][number];
export type MemberSegmentRow = Database['public']['Functions']['admin_member_segments']['Returns'][number];
export type Segment = MemberSegmentRow['segment'];

/** Heures d'enseignement par prof (admin), bornes `YYYY-MM-DD` incluses (Zurich). */
export async function fetchTeachingHours(from: string, to: string): Promise<TeachingHoursRow[]> {
  const { data, error } = await supabase.rpc('admin_teaching_hours', { p_from: from, p_to: to });
  if (error) throw error;
  return data ?? [];
}

/** Heures de présence par membre (admin), triées par heures décroissantes. */
export async function fetchMemberHours(from: string, to: string): Promise<MemberHoursRow[]> {
  const { data, error } = await supabase.rpc('admin_member_hours', { p_from: from, p_to: to });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMemberSegments(): Promise<MemberSegmentRow[]> {
  const { data, error } = await supabase.rpc('admin_member_segments');
  if (error) throw error;
  return data ?? [];
}
