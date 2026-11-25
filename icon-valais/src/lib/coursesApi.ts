import { courseRpcErrorKey } from '@/src/domain/adminErrors';
import type { CourseRow } from '@/src/domain/courses';
import { supabase } from '@/src/lib/supabase';

type RawCourse = Omit<CourseRow, 'prof' | 'booked' | 'myBookings'>;

/**
 * Cours de la semaine [from, to[ : au plus 4 requêtes, quel que soit le nombre de cours
 * (cours + lieu, noms des profs, compteurs, mes inscriptions).
 * `profileIds` limite « mes inscriptions » à soi et ses enfants (un admin/prof peut voir davantage).
 */
export async function fetchWeek(from: Date, to: Date, profileIds?: string[]): Promise<CourseRow[]> {
  const { data, error } = await supabase
    .from('courses')
    .select('*, location:locations(id,name,address,maps_url)')
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return assemble((data ?? []) as unknown as RawCourse[], profileIds);
}

/** Un cours avec lieu, prof, compteur et mes inscriptions ; null s'il n'existe pas (ou n'est pas visible). */
export async function fetchCourse(id: string, profileIds?: string[]): Promise<CourseRow | null> {
  const { data, error } = await supabase
    .from('courses')
    .select('*, location:locations(id,name,address,maps_url)')
    .eq('id', id)
    .limit(1);
  if (error) throw error;
  const rows = await assemble((data ?? []) as unknown as RawCourse[], profileIds);
  return rows[0] ?? null;
}

async function assemble(courses: RawCourse[], profileIds?: string[]): Promise<CourseRow[]> {
  if (courses.length === 0) return [];

  const courseIds = courses.map((c) => c.id);
  const profIds = [...new Set(courses.map((c) => c.prof_id).filter((x): x is string => !!x))];

  let myQuery = supabase.from('bookings').select('course_id,profile_id').in('course_id', courseIds).is('cancelled_at', null);
  if (profileIds) myQuery = myQuery.in('profile_id', profileIds);

  const [profs, counts, mine] = await Promise.all([
    profIds.length
      ? supabase.from('public_profiles').select('id,first_name,last_name').in('id', profIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('course_booking_counts').select('course_id,booked').in('course_id', courseIds),
    myQuery,
  ]);
  if (profs.error) throw profs.error;
  if (counts.error) throw counts.error;
  if (mine.error) throw mine.error;

  const profById = new Map<string, { first_name: string; last_name: string }>();
  for (const p of (profs.data ?? []) as { id: string; first_name: string; last_name: string }[]) {
    profById.set(p.id, { first_name: p.first_name, last_name: p.last_name });
  }
  const countById = new Map<string, number>();
  for (const c of (counts.data ?? []) as { course_id: string; booked: number | null }[]) {
    countById.set(c.course_id, c.booked ?? 0);
  }
  const mineById = new Map<string, string[]>();
  for (const b of (mine.data ?? []) as { course_id: string; profile_id: string }[]) {
    mineById.set(b.course_id, [...(mineById.get(b.course_id) ?? []), b.profile_id]);
  }

  return courses.map((c) => ({
    ...c,
    prof: c.prof_id ? (profById.get(c.prof_id) ?? null) : null,
    booked: countById.get(c.id) ?? 0,
    myBookings: mineById.get(c.id) ?? [],
  }));
}

/** Retourne null en cas de succès, sinon la clé i18n de l'erreur. */
async function call(fn: 'book_course' | 'unbook_course', courseId: string, profileId?: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc(fn, { p_course: courseId, ...(profileId ? { p_profile: profileId } : {}) });
    return error ? courseRpcErrorKey(error) : null;
  } catch {
    return 'errors.network';
  }
}

export const bookCourse = (courseId: string, profileId?: string) => call('book_course', courseId, profileId);
export const unbookCourse = (courseId: string, profileId?: string) => call('unbook_course', courseId, profileId);

async function rpcKey(run: () => PromiseLike<{ error: { code?: string; hint?: string | null } | null }>): Promise<string | null> {
  try {
    const { error } = await run();
    return error ? courseRpcErrorKey(error) : null;
  } catch {
    return 'errors.network';
  }
}

export const takeSlot = (courseId: string) => rpcKey(() => supabase.rpc('take_slot', { p_course: courseId }));
export const leaveSlot = (courseId: string) => rpcKey(() => supabase.rpc('leave_slot', { p_course: courseId }));
export const assignProf = (courseId: string, profId: string | null) =>
  // la RPC accepte null (cours vacant) ; les types générés l'ignorent
  rpcKey(() => supabase.rpc('assign_prof', { p_course: courseId, p_prof: profId as string }));
export const cancelCourse = (courseId: string, scope: 'one' | 'following') =>
  rpcKey(() => supabase.rpc('cancel_course', { p_course: courseId, p_scope: scope }));
export const setAttendance = (courseId: string, profileId: string, present: boolean) =>
  rpcKey(() => supabase.rpc('set_attendance', { p_course: courseId, p_profile: profileId, p_present: present }));

export type LocationRow = {
  id: string;
  name: string;
  address: string;
  maps_url: string;
  is_default: boolean;
  archived: boolean;
};

export type ProfOption = { id: string; first_name: string; last_name: string };

/** Tous les lieux (les archivés aussi ; l'appelant filtre). Le lieu par défaut d'abord. */
export async function fetchLocations(): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('id,name,address,maps_url,is_default,archived')
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as LocationRow[]).slice().sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/** Profs (et admins, affichés comme profs) proposables à un cours. */
export async function fetchProfOptions(): Promise<ProfOption[]> {
  const { data, error } = await supabase
    .from('public_profiles')
    .select('id,first_name,last_name')
    .eq('display_role', 'prof')
    .order('first_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProfOption[];
}

export const createCourse = (p: Record<string, unknown>, repeatUntil: string | null) =>
  rpcKey(() =>
    // la RPC accepte null (pas de répétition) ; les types générés l'ignorent
    supabase.rpc('create_course', { p: p as never, p_repeat_until: repeatUntil as string }),
  );
export const updateCourse = (courseId: string, p: Record<string, unknown>, scope: 'one' | 'following') =>
  rpcKey(() => supabase.rpc('update_course', { p_course: courseId, p: p as never, p_scope: scope }));
export const saveLocation = (p: Record<string, unknown>) =>
  rpcKey(() => supabase.rpc('admin_upsert_location', { p: p as never }));
