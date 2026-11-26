// Logique pure (sans I/O) de l'envoi des notifications push Expo : textes
// traduits, messages, paquets, lecture des tickets. Testée avec Deno (push.test.ts).
import { normalizeLang, type Lang } from './consent.ts';

export type { Lang };

export type OutboxKind = 'course_cancelled' | 'slot_vacant' | 'prof_validated' | 'membership_expiring';

export type OutboxRow = {
  id: number;
  profile_id: string;
  kind: OutboxKind;
  course_id: string | null;
  payload: Record<string, unknown>;
  // renvoyés par claim_outbox (facultatifs)
  attempts?: number;
  language?: string | null;
  sport?: string | null;
  starts_at?: string | null;
  child_first_name?: string | null;
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
export const CLUB_TIME_ZONE = 'Europe/Zurich';

// until : dernier jour d'une adhésion (YYYY-MM-DD, membership_expiring).
export type PushContext = {
  sport?: string | null;
  startsAt?: string | null;
  childName?: string | null;
  until?: string | null;
};

const LOCALES: Record<Lang, string> = { fr: 'fr-CH', de: 'de-CH', en: 'en-GB', ru: 'ru-RU' };

// Mêmes libellés que src/i18n/locales/*.json (sports).
const SPORTS: Record<Lang, Record<string, string>> = {
  fr: { jjb: 'Jiu-jitsu brésilien', grappling: 'Grappling', mma: 'MMA' },
  de: { jjb: 'Brasilianisches Jiu-Jitsu', grappling: 'Grappling', mma: 'MMA' },
  en: { jjb: 'Brazilian jiu-jitsu', grappling: 'Grappling', mma: 'MMA' },
  ru: { jjb: 'Бразильское джиу-джитсу', grappling: 'Грэпплинг', mma: 'ММА' },
};

// « Jiu-jitsu brésilien, jeudi 3 décembre à 14:30 » (heure de Zurich), ou null.
function courseLabel(lang: Lang, ctx: PushContext): string | null {
  const parts: string[] = [];
  if (ctx.sport) parts.push(SPORTS[lang][ctx.sport] ?? ctx.sport);
  if (ctx.startsAt) {
    const d = new Date(ctx.startsAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        new Intl.DateTimeFormat(LOCALES[lang], {
          timeZone: CLUB_TIME_ZONE,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }).format(d),
      );
    }
  }
  return parts.length ? parts.join(', ') : null;
}

// « jeudi 3 décembre » (date seule, sans fuseau : midi UTC reste le même jour à Zurich), ou null.
function dateLabel(lang: Lang, day: string | null | undefined): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    timeZone: CLUB_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

// course : libellé du cours ; child : prénom de l'enfant ; until : date de fin (membership_expiring)
type Body = (course: string | null, child: string | null, until: string | null) => string;

const TEXTS: Record<Lang, Record<OutboxKind, { title: string; body: Body }>> = {
  fr: {
    slot_vacant: {
      title: 'Cours sans professeur',
      body: (c) =>
        c
          ? `${c} : ce cours n'a pas encore de professeur. Ouvrez l'application pour le prendre.`
          : 'Un cours des prochaines 24 h n\'a pas encore de professeur. Ouvrez l\'application pour le prendre.',
    },
    prof_validated: {
      title: 'Compte professeur validé',
      body: () => 'Votre compte professeur a été validé. Vous pouvez maintenant donner des cours.',
    },
    course_cancelled: {
      title: 'Cours annulé',
      body: (c, k) =>
        k
          ? c ? `Le cours de ${k} (${c}) est annulé.` : `Un cours de ${k} a été annulé.`
          : c ? `Votre cours (${c}) est annulé.` : 'Un cours auquel vous êtes inscrit a été annulé.',
    },
    membership_expiring: {
      title: 'Abonnement bientôt terminé',
      body: (_c, k, u) =>
        (k
          ? u ? `L'abonnement de ${k} se termine le ${u}.` : `L'abonnement de ${k} se termine dans 7 jours.`
          : u ? `Votre abonnement se termine le ${u}.` : 'Votre abonnement se termine dans 7 jours.') +
        ' Renouvelez-le dans l\'application.',
    },
  },
  de: {
    slot_vacant: {
      title: 'Kurs ohne Trainer',
      body: (c) =>
        c
          ? `${c}: Dieser Kurs hat noch keinen Trainer. Öffnen Sie die App, um ihn zu übernehmen.`
          : 'Ein Kurs in den nächsten 24 Stunden hat noch keinen Trainer. Öffnen Sie die App, um ihn zu übernehmen.',
    },
    prof_validated: {
      title: 'Trainerkonto bestätigt',
      body: () => 'Ihr Trainerkonto wurde bestätigt. Sie können jetzt Kurse geben.',
    },
    course_cancelled: {
      title: 'Kurs abgesagt',
      body: (c, k) =>
        k
          ? c ? `Der Kurs von ${k} (${c}) wurde abgesagt.` : `Ein Kurs von ${k} wurde abgesagt.`
          : c ? `Ihr Kurs (${c}) wurde abgesagt.` : 'Ein Kurs, für den Sie angemeldet sind, wurde abgesagt.',
    },
    membership_expiring: {
      title: 'Abo endet bald',
      body: (_c, k, u) =>
        (k
          ? u ? `Das Abo von ${k} endet am ${u}.` : `Das Abo von ${k} endet in 7 Tagen.`
          : u ? `Ihr Abo endet am ${u}.` : 'Ihr Abo endet in 7 Tagen.') +
        ' Verlängern Sie es in der App.',
    },
  },
  en: {
    slot_vacant: {
      title: 'Class without an instructor',
      body: (c) =>
        c
          ? `${c}: this class has no instructor yet. Open the app to take it.`
          : 'A class in the next 24 hours has no instructor yet. Open the app to take it.',
    },
    prof_validated: {
      title: 'Instructor account approved',
      body: () => 'Your instructor account has been approved. You can now teach classes.',
    },
    course_cancelled: {
      title: 'Class cancelled',
      body: (c, k) =>
        k
          ? c ? `${k}'s class (${c}) has been cancelled.` : `One of ${k}'s classes has been cancelled.`
          : c ? `Your class (${c}) has been cancelled.` : 'A class you are booked on has been cancelled.',
    },
    membership_expiring: {
      title: 'Membership ending soon',
      body: (_c, k, u) =>
        (k
          ? u ? `${k}'s membership ends on ${u}.` : `${k}'s membership ends in 7 days.`
          : u ? `Your membership ends on ${u}.` : 'Your membership ends in 7 days.') +
        ' Renew it in the app.',
    },
  },
  ru: {
    slot_vacant: {
      title: 'Занятие без тренера',
      body: (c) =>
        c
          ? `${c}: у этого занятия пока нет тренера. Откройте приложение, чтобы взять его.`
          : 'У занятия в ближайшие 24 часа пока нет тренера. Откройте приложение, чтобы взять его.',
    },
    prof_validated: {
      title: 'Аккаунт тренера подтверждён',
      body: () => 'Ваш аккаунт тренера подтверждён. Теперь вы можете вести занятия.',
    },
    course_cancelled: {
      title: 'Занятие отменено',
      body: (c, k) =>
        k
          ? c ? `Занятие (${k}, ${c}) отменено.` : `Занятие (${k}) отменено.`
          : c ? `Ваше занятие (${c}) отменено.` : 'Занятие, на которое вы записаны, отменено.',
    },
    membership_expiring: {
      title: 'Абонемент скоро закончится',
      body: (_c, k, u) =>
        (k
          ? u ? `Абонемент (${k}) заканчивается ${u}.` : `Абонемент (${k}) заканчивается через 7 дней.`
          : u ? `Ваш абонемент заканчивается ${u}.` : 'Ваш абонемент заканчивается через 7 дней.') +
        ' Продлите его в приложении.',
    },
  },
};

export function pushText(lang: Lang, kind: OutboxKind, ctx: PushContext = {}): { title: string; body: string } {
  const l = normalizeLang(lang);
  const t = TEXTS[l][kind];
  const child = ctx.childName?.trim().slice(0, 50) || null;
  return { title: t.title, body: t.body(courseLabel(l, ctx), child, dateLabel(l, ctx.until)) };
}

// Un message par jeton du destinataire ; destinataire sans jeton → aucun message.
// Langue : profiles.language, à défaut 'fr'. Texte : sport, date et heure locales
// du cours, prénom de l'enfant (notification reçue par le parent).
export function buildPushMessages(
  rows: OutboxRow[],
  tokens: Map<string, string[]>,
  langs: Map<string, Lang>,
): ExpoMessage[] {
  const out: ExpoMessage[] = [];
  for (const r of rows) {
    const { title, body } = pushText(normalizeLang(langs.get(r.profile_id)), r.kind, {
      sport: r.sport,
      startsAt: r.starts_at,
      childName: r.child_first_name,
      until: typeof r.payload?.ends_on === 'string' ? r.payload.ends_on : null,
    });
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
  pending: number[]; // lignes à réessayer (réservation libérée)
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
  const pending: number[] = [];
  for (const [id, s] of state) {
    if (!s.any) errors.push({ id, error: 'no_push_token' });
    else if (s.ok) sent.push(id);
    else if (s.pending) pending.push(id);
    else errors.push({ id, error: s.error ?? 'expo_error' });
  }
  return { sent, errors, deadTokens: [...dead], pending };
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
  // claim_outbox : réserve et renvoie jusqu'à `limit` lignes (avec langue, sport, début, prénom de l'enfant)
  claim(limit: number): Promise<OutboxRow[]>;
  loadTokens(profileIds: string[]): Promise<{ token: string; profile_id: string }[]>;
  markSent(ids: number[]): Promise<void>;
  markError(ids: number[], error: string): Promise<void>;
  releaseClaims(ids: number[]): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
  fetch: typeof fetch;
};

export type SendPushResult = { status: number; body: Record<string, unknown> };

// Envoie un paquet ; ticket null = à réessayer plus tard (réseau, 5xx, 429,
// réponse illisible). Un paquet refusé en 4xx est renvoyé message par message,
// pour qu'un seul message invalide ne fasse pas échouer les autres.
async function sendBatch(part: ExpoMessage[], deps: SendPushDeps): Promise<(ExpoTicket | null)[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (deps.expoAccessToken) headers.Authorization = `Bearer ${deps.expoAccessToken}`;
  let res: Response;
  try {
    res = await deps.fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(part) });
  } catch (e) {
    console.error('expo push: fetch failed', e instanceof Error ? e.message : 'unknown');
    return part.map(() => null);
  }
  if (res.ok) {
    try {
      const data = (await res.json())?.data;
      if (Array.isArray(data) && data.length === part.length) return data as ExpoTicket[];
    } catch {
      // réponse illisible
    }
    console.error('expo push: unexpected response shape');
    return part.map(() => null);
  }
  console.error('expo push: http', res.status);
  await res.body?.cancel();
  // 401/403 : jeton d'accès Expo absent, invalide ou révoqué (configuration du
  // projet, pas le message) → comme 429/5xx, les lignes restent en attente.
  if (res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) {
    if (part.length === 1) return [{ status: 'error', details: { error: `http_${res.status}` } }];
    const out: (ExpoTicket | null)[] = [];
    for (const m of part) out.push(...(await sendBatch([m], deps)));
    return out;
  }
  return part.map(() => null);
}

export async function handleSendPush(req: Request, deps: SendPushDeps): Promise<SendPushResult> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  if (!isServiceRoleRequest(req.headers.get('Authorization'), deps.serviceKey)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const rows = await deps.claim(OUTBOX_BATCH);
  if (rows.length === 0) return { status: 200, body: { processed: 0, sent: 0, failed: 0, pending: 0 } };

  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const tokens = new Map<string, string[]>();
  for (const t of await deps.loadTokens(profileIds)) {
    tokens.set(t.profile_id, [...(tokens.get(t.profile_id) ?? []), t.token]);
  }
  const langs = new Map<string, Lang>();
  for (const r of rows) langs.set(r.profile_id, normalizeLang(r.language));

  const messages: ExpoMessage[] = [];
  const owners: number[] = [];
  for (const r of rows) {
    for (const m of buildPushMessages([r], tokens, langs)) {
      messages.push(m);
      owners.push(r.id);
    }
  }

  const tickets: (ExpoTicket | null)[] = [];
  for (const part of chunk(messages, EXPO_BATCH)) tickets.push(...(await sendBatch(part, deps)));

  const s = summarizeTickets(rows.map((r) => r.id), owners, messages.map((m) => m.to), tickets);
  if (s.sent.length) await deps.markSent(s.sent);
  const byError = new Map<string, number[]>();
  for (const e of s.errors) byError.set(e.error, [...(byError.get(e.error) ?? []), e.id]);
  for (const [error, ids] of byError) await deps.markError(ids, error);
  if (s.pending.length) await deps.releaseClaims(s.pending);
  if (s.deadTokens.length) await deps.deleteTokens(s.deadTokens);

  return {
    status: 200,
    body: {
      processed: rows.length,
      sent: s.sent.length,
      failed: s.errors.length,
      pending: s.pending.length,
      removedTokens: s.deadTokens.length,
    },
  };
}
