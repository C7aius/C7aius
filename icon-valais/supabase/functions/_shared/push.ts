// Logique pure (sans I/O) de l'envoi des notifications push Expo : textes
// traduits, messages, paquets, lecture des tickets. Testée avec Deno (push.test.ts).
import { normalizeLang, type Lang } from './consent.ts';

export type { Lang };

export type OutboxKind = 'course_cancelled' | 'slot_vacant' | 'prof_validated';

export type OutboxRow = {
  id: number;
  profile_id: string;
  kind: OutboxKind;
  course_id: string | null;
  payload: Record<string, unknown>;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { courseId: string | null };
  sound: 'default';
};

// Ticket renvoyé par https://exp.host/--/api/v2/push/send (un par message, même ordre).
export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH = 100;
export const OUTBOX_BATCH = 500;

const TEXTS: Record<Lang, Record<OutboxKind, { title: string; body: string }>> = {
  fr: {
    slot_vacant: {
      title: 'Créneau sans prof',
      body: 'Un cours des prochaines 24 h n\'a pas encore de professeur. Ouvrez l\'application pour le prendre.',
    },
    prof_validated: {
      title: 'Compte professeur validé',
      body: 'Votre compte professeur a été validé. Vous pouvez maintenant donner des cours.',
    },
    course_cancelled: {
      title: 'Cours annulé',
      body: 'Un cours auquel vous êtes inscrit a été annulé.',
    },
  },
  de: {
    slot_vacant: {
      title: 'Kurs ohne Trainer',
      body: 'Ein Kurs in den nächsten 24 Stunden hat noch keinen Trainer. Öffnen Sie die App, um ihn zu übernehmen.',
    },
    prof_validated: {
      title: 'Trainerkonto bestätigt',
      body: 'Ihr Trainerkonto wurde bestätigt. Sie können jetzt Kurse geben.',
    },
    course_cancelled: {
      title: 'Kurs abgesagt',
      body: 'Ein Kurs, für den Sie angemeldet sind, wurde abgesagt.',
    },
  },
  en: {
    slot_vacant: {
      title: 'Class without an instructor',
      body: 'A class in the next 24 hours has no instructor yet. Open the app to take it.',
    },
    prof_validated: {
      title: 'Instructor account approved',
      body: 'Your instructor account has been approved. You can now teach classes.',
    },
    course_cancelled: {
      title: 'Class cancelled',
      body: 'A class you are booked on has been cancelled.',
    },
  },
  ru: {
    slot_vacant: {
      title: 'Занятие без тренера',
      body: 'У занятия в ближайшие 24 часа пока нет тренера. Откройте приложение, чтобы взять его.',
    },
    prof_validated: {
      title: 'Аккаунт тренера подтверждён',
      body: 'Ваш аккаунт тренера подтверждён. Теперь вы можете вести занятия.',
    },
    course_cancelled: {
      title: 'Занятие отменено',
      body: 'Занятие, на которое вы записаны, отменено.',
    },
  },
};

export function pushText(lang: Lang, kind: OutboxKind): { title: string; body: string } {
  return TEXTS[normalizeLang(lang)][kind];
}

// Un message par jeton du destinataire ; destinataire sans jeton → aucun message.
// Langue : profiles.language, à défaut 'fr'.
export function buildPushMessages(
  rows: OutboxRow[],
  tokens: Map<string, string[]>,
  langs: Map<string, Lang>,
): ExpoMessage[] {
  const out: ExpoMessage[] = [];
  for (const r of rows) {
    const { title, body } = pushText(normalizeLang(langs.get(r.profile_id)), r.kind);
    for (const to of tokens.get(r.profile_id) ?? []) {
      out.push({ to, title, body, data: { courseId: r.course_id }, sound: 'default' });
    }
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (!(size >= 1)) throw new RangeError('chunk: size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type TicketSummary = {
  sent: number[]; // lignes à marquer sent_at
  errors: { id: number; error: string }[]; // lignes à marquer error
  deadTokens: string[]; // jetons DeviceNotRegistered à supprimer
};

// rowIds : toutes les lignes traitées ; owners[i] / tos[i] / tickets[i] : ligne,
// jeton et ticket du message i (ticket null = paquet non envoyé, à réessayer).
// Une ligne est envoyée si au moins un ticket est ok ; sinon, si un de ses
// paquets a échoué, elle reste en attente ; sinon elle est en erreur. Une ligne
// sans message (aucun jeton) est en erreur no_push_token.
export function summarizeTickets(
  rowIds: number[],
  owners: number[],
  tos: string[],
  tickets: (ExpoTicket | null)[],
): TicketSummary {
  const state = new Map<number, { ok: boolean; pending: boolean; error: string | null; any: boolean }>();
  for (const id of rowIds) state.set(id, { ok: false, pending: false, error: null, any: false });
  const dead = new Set<string>();
  owners.forEach((id, i) => {
    const s = state.get(id);
    if (!s) return;
    s.any = true;
    const t = tickets[i] ?? null;
    if (t === null) s.pending = true;
    else if (t.status === 'ok') s.ok = true;
    else {
      const code = t.details?.error ?? 'expo_error';
      if (code === 'DeviceNotRegistered') dead.add(tos[i]);
      s.error ??= code;
    }
  });
  const sent: number[] = [];
  const errors: { id: number; error: string }[] = [];
  for (const [id, s] of state) {
    if (!s.any) errors.push({ id, error: 'no_push_token' });
    else if (s.ok) sent.push(id);
    else if (!s.pending) errors.push({ id, error: s.error ?? 'expo_error' });
  }
  return { sent, errors, deadTokens: [...dead] };
}

// Comparaison en temps constant (longueurs égales).
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// Vrai seulement si l'en-tête Authorization est « Bearer <clé service_role> ».
export function isServiceRoleRequest(authorization: string | null, serviceKey: string | undefined): boolean {
  if (!serviceKey) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return !!m && safeEqual(m[1], serviceKey);
}

// ---------------------------------------------------------------------------
// Traitement d'une requête send-push, I/O injectées (testé sans réseau ni base).
// ---------------------------------------------------------------------------
export type SendPushDeps = {
  serviceKey: string | undefined;
  expoAccessToken?: string;
  loadPending(limit: number): Promise<OutboxRow[]>;
  loadTokens(profileIds: string[]): Promise<{ token: string; profile_id: string }[]>;
  loadLangs(profileIds: string[]): Promise<{ id: string; language: string | null }[]>;
  markSent(ids: number[]): Promise<void>;
  markError(ids: number[], error: string): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
  fetch: typeof fetch;
};

export type SendPushResult = { status: number; body: Record<string, unknown> };

export async function handleSendPush(req: Request, deps: SendPushDeps): Promise<SendPushResult> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!isServiceRoleRequest(req.headers.get('Authorization'), deps.serviceKey)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const rows = await deps.loadPending(OUTBOX_BATCH);
  if (rows.length === 0) return { status: 200, body: { processed: 0, sent: 0, failed: 0, pending: 0 } };

  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const tokens = new Map<string, string[]>();
  for (const t of await deps.loadTokens(profileIds)) {
    tokens.set(t.profile_id, [...(tokens.get(t.profile_id) ?? []), t.token]);
  }
  const langs = new Map<string, Lang>();
  for (const p of await deps.loadLangs(profileIds)) langs.set(p.id, normalizeLang(p.language));

  const messages: ExpoMessage[] = [];
  const owners: number[] = [];
  for (const r of rows) {
    for (const m of buildPushMessages([r], tokens, langs)) {
      messages.push(m);
      owners.push(r.id);
    }
  }

  const tickets: (ExpoTicket | null)[] = [];
  for (const part of chunk(messages, EXPO_BATCH)) {
    let got: ExpoTicket[] | null = null;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (deps.expoAccessToken) headers.Authorization = `Bearer ${deps.expoAccessToken}`;
      const res = await deps.fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(part) });
      if (res.ok) {
        const data = (await res.json())?.data;
        if (Array.isArray(data) && data.length === part.length) got = data as ExpoTicket[];
        else console.error('expo push: unexpected response shape');
      } else {
        console.error('expo push: http', res.status);
        await res.body?.cancel();
      }
    } catch (e) {
      console.error('expo push: fetch failed', e instanceof Error ? e.message : 'unknown');
    }
    tickets.push(...(got ?? part.map(() => null)));
  }

  const s = summarizeTickets(rows.map((r) => r.id), owners, messages.map((m) => m.to), tickets);
  if (s.sent.length) await deps.markSent(s.sent);
  const byError = new Map<string, number[]>();
  for (const e of s.errors) byError.set(e.error, [...(byError.get(e.error) ?? []), e.id]);
  for (const [error, ids] of byError) await deps.markError(ids, error);
  if (s.deadTokens.length) await deps.deleteTokens(s.deadTokens);

  return {
    status: 200,
    body: {
      processed: rows.length,
      sent: s.sent.length,
      failed: s.errors.length,
      pending: rows.length - s.sent.length - s.errors.length,
      removedTokens: s.deadTokens.length,
    },
  };
}
