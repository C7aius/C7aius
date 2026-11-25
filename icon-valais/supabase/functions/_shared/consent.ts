// Logique pure (sans I/O) du consentement parental : e-mail, page HTML, validation.
// Testée avec Deno (consent.test.ts).

export type Lang = 'fr' | 'de' | 'en' | 'ru';

export const LANGS: readonly Lang[] = ['fr', 'de', 'en', 'ru'];

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_TEXTS: Record<
  Lang,
  { subject: (n: string) => string; hello: string; body: (n: string) => string; button: string; expiry: string; ignore: string }
> = {
  fr: {
    subject: (n) => `Icon Valais : autorisation parentale pour ${n}`,
    hello: 'Bonjour,',
    body: (n) =>
      `${n} souhaite s'inscrire à l'application du club Icon Valais. Comme ${n} a moins de 16 ans, votre autorisation est nécessaire.`,
    button: 'Donner mon autorisation',
    expiry: 'Ce lien est valable 7 jours et ne peut être utilisé qu\'une seule fois.',
    ignore: 'Si vous n\'êtes pas concerné(e), ignorez simplement ce message.',
  },
  de: {
    subject: (n) => `Icon Valais: Zustimmung der Eltern für ${n}`,
    hello: 'Guten Tag',
    body: (n) =>
      `${n} möchte sich in der App des Clubs Icon Valais registrieren. Da ${n} unter 16 Jahre alt ist, ist Ihre Zustimmung erforderlich.`,
    button: 'Zustimmung erteilen',
    expiry: 'Dieser Link ist 7 Tage gültig und kann nur einmal verwendet werden.',
    ignore: 'Falls Sie nicht betroffen sind, ignorieren Sie diese Nachricht einfach.',
  },
  en: {
    subject: (n) => `Icon Valais: parental consent for ${n}`,
    hello: 'Hello,',
    body: (n) =>
      `${n} would like to sign up to the Icon Valais club app. As ${n} is under 16, your consent is required.`,
    button: 'Give my consent',
    expiry: 'This link is valid for 7 days and can only be used once.',
    ignore: 'If this does not concern you, simply ignore this message.',
  },
  ru: {
    subject: (n) => `Icon Valais: согласие родителей для ${n}`,
    hello: 'Здравствуйте!',
    body: (n) =>
      `${n} хочет зарегистрироваться в приложении клуба Icon Valais. Поскольку ${n} младше 16 лет, требуется ваше согласие.`,
    button: 'Дать согласие',
    expiry: 'Ссылка действительна 7 дней и может быть использована только один раз.',
    ignore: 'Если это вас не касается, просто проигнорируйте это письмо.',
  },
};

export const EMAIL_NAME_MAX = 50;

/** Prénom tel qu'inséré dans l'e-mail : une ligne, au plus EMAIL_NAME_MAX caractères (défense en profondeur). */
export function emailSafeName(raw: string): string {
  const oneLine = raw.replace(/[\r\n\t]+/g, ' ').trim();
  const chars = Array.from(oneLine);
  return chars.length > EMAIL_NAME_MAX ? `${chars.slice(0, EMAIL_NAME_MAX).join('')}…` : oneLine;
}

export function buildConsentEmail(
  lang: Lang,
  rawFirstName: string,
  link: string,
): { subject: string; html: string } {
  const t = EMAIL_TEXTS[lang] ?? EMAIL_TEXTS.fr;
  const childFirstName = emailSafeName(rawFirstName);
  const name = escapeHtml(childFirstName);
  const href = escapeHtml(link);
  const html =
    `<!doctype html><html lang="${lang}"><body style="font-family:sans-serif;max-width:480px;margin:auto">` +
    `<p>${t.hello}</p><p>${t.body(name)}</p>` +
    `<p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${t.button}</a></p>` +
    `<p style="color:#555;font-size:13px">${t.expiry}<br>${t.ignore}</p>` +
    `<p style="color:#555;font-size:13px;word-break:break-all">${href}</p>` +
    `</body></html>`;
  // le sujet est du texte brut (pas du HTML) : prénom non échappé (déjà sur une ligne)
  return { subject: t.subject(childFirstName), html };
}

const PAGE_TEXTS: Record<Lang, { okTitle: string; okBody: string; koTitle: string; koBody: string }> = {
  fr: {
    okTitle: 'Merci !',
    okBody: 'Votre autorisation a été enregistrée. Le compte peut maintenant être utilisé.',
    koTitle: 'Lien invalide',
    koBody: 'Ce lien est invalide, expiré ou déjà utilisé. Demandez un nouvel e-mail depuis l\'application.',
  },
  de: {
    okTitle: 'Danke!',
    okBody: 'Ihre Zustimmung wurde gespeichert. Das Konto kann jetzt verwendet werden.',
    koTitle: 'Ungültiger Link',
    koBody: 'Dieser Link ist ungültig, abgelaufen oder wurde bereits verwendet. Fordern Sie in der App eine neue E-Mail an.',
  },
  en: {
    okTitle: 'Thank you!',
    okBody: 'Your consent has been recorded. The account can now be used.',
    koTitle: 'Invalid link',
    koBody: 'This link is invalid, expired or already used. Request a new email from the app.',
  },
  ru: {
    okTitle: 'Спасибо!',
    okBody: 'Ваше согласие сохранено. Теперь аккаунтом можно пользоваться.',
    koTitle: 'Недействительная ссылка',
    koBody: 'Ссылка недействительна, истекла или уже использована. Запросите новое письмо в приложении.',
  },
};

export function confirmPageHtml(lang: Lang, success: boolean): string {
  const t = PAGE_TEXTS[lang] ?? PAGE_TEXTS.fr;
  const title = success ? t.okTitle : t.koTitle;
  const body = success ? t.okBody : t.koBody;
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Icon Valais</title></head>` +
    `<body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;text-align:center">` +
    `<h1>${title}</h1><p>${body}</p></body></html>`
  );
}

// Choisit la langue d'après l'en-tête Accept-Language (ordre d'apparition) ; défaut fr.
export function pickLang(header: string | null | undefined): Lang {
  for (const part of (header ?? '').split(',')) {
    const code = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if ((LANGS as readonly string[]).includes(code)) return code as Lang;
  }
  return 'fr';
}

export type SendRequest = { ok: true; parentEmail: string | undefined } | { ok: false; error: string };

// Corps de send-parent-consent : { parent_email?: string }
export function validateSendRequest(body: unknown): SendRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'invalid body' };
  }
  const raw = (body as Record<string, unknown>).parent_email;
  if (raw === undefined || raw === null) return { ok: true, parentEmail: undefined };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid parent_email' };
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: 'invalid parent_email' };
  return { ok: true, parentEmail: email };
}

export function normalizeLang(v: unknown): Lang {
  return (LANGS as readonly unknown[]).includes(v) ? (v as Lang) : 'fr';
}

// Lien de confirmation : base explicite (PUBLIC_FUNCTIONS_URL) sinon la fonction
// sœur de l'URL de la requête courante (…/functions/v1/send-parent-consent).
export function buildConfirmLink(publicBase: string | undefined, requestUrl: string, token: string): string {
  const base = publicBase?.trim()
    ? `${publicBase.trim().replace(/\/+$/, '')}/confirm-parent-consent`
    : new URL('confirm-parent-consent', requestUrl).toString();
  return `${base}?token=${encodeURIComponent(token)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

const FORM_TEXTS: Record<Lang, { title: string; body: string; button: string }> = {
  fr: { title: 'Autorisation parentale', body: 'Confirmez-vous autoriser cette inscription au club Icon Valais ?', button: 'Je confirme' },
  de: { title: 'Zustimmung der Eltern', body: 'Bestätigen Sie die Anmeldung beim Club Icon Valais?', button: 'Ich bestätige' },
  en: { title: 'Parental consent', body: 'Do you confirm this sign-up to the Icon Valais club?', button: 'I confirm' },
  ru: { title: 'Согласие родителей', body: 'Подтверждаете ли вы эту регистрацию в клубе Icon Valais?', button: 'Подтверждаю' },
};

// Page affichée par le GET (lecture seule) : le consentement n'est donné que par
// le POST du formulaire, pour que les scanners de liens d'e-mail ne le déclenchent pas.
export function confirmFormHtml(lang: Lang, token: string): string {
  const t = FORM_TEXTS[lang] ?? FORM_TEXTS.fr;
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Icon Valais</title></head>` +
    `<body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;text-align:center">` +
    `<h1>${t.title}</h1><p>${t.body}</p>` +
    `<form method="post" action=""><input type="hidden" name="token" value="${escapeHtml(token)}">` +
    `<button type="submit" style="padding:12px 20px;font-size:16px">${t.button}</button></form>` +
    `</body></html>`
  );
}

// ---------------------------------------------------------------------------
// Décision de send-parent-consent (pure : aucune I/O)
// ---------------------------------------------------------------------------
export const RESEND_COOLDOWN_MS = 60_000;
export const DAILY_CAP = 5;
const DAY_MS = 24 * 3600_000;

export type SendDecisionInput = {
  profile: {
    age: number;
    parentProfileId: string | null;
    parentConsentAt: string | null;
    parentEmail: string | null;
    email: string | null;
  };
  userEmail: string | null | undefined;
  requestedEmail: string | undefined; // déjà normalisé (validateSendRequest)
  previousRequests: Date[]; // created_at des demandes existantes pour ce profil
  now: Date;
};

export type SendDecision =
  | { ok: true; parentEmail: string; saveEmail: boolean }
  | { ok: false; status: 400 | 409 | 429; error: string };

export function decideSend(i: SendDecisionInput): SendDecision {
  const p = i.profile;
  if (p.parentProfileId !== null || p.age >= 16 || p.parentConsentAt !== null) {
    return { ok: false, status: 409, error: 'consent not required' };
  }
  const existing = p.parentEmail ? p.parentEmail.trim().toLowerCase() : null;
  const hasRequest = i.previousRequests.length > 0;

  let parentEmail: string;
  if (hasRequest) {
    // adresse figée dès qu'une demande existe ; renvoi vers la même adresse autorisé
    if (!existing || (i.requestedEmail !== undefined && i.requestedEmail !== existing)) {
      return { ok: false, status: 409, error: 'parent_email_locked' };
    }
    parentEmail = existing;
  } else {
    const chosen = i.requestedEmail ?? existing;
    if (!chosen) return { ok: false, status: 400, error: 'parent_email required' };
    parentEmail = chosen;
  }

  const own = [p.email, i.userEmail].filter(Boolean).map((e) => String(e).trim().toLowerCase());
  if (own.includes(parentEmail)) {
    return { ok: false, status: 400, error: 'parent_email must differ from own email' };
  }

  const nowMs = i.now.getTime();
  const times = i.previousRequests.map((d) => d.getTime());
  if (times.some((t) => nowMs - t < RESEND_COOLDOWN_MS)) {
    return { ok: false, status: 429, error: 'too many requests' };
  }
  if (times.filter((t) => nowMs - t < DAY_MS).length >= DAILY_CAP) {
    return { ok: false, status: 429, error: 'too many requests' };
  }
  return { ok: true, parentEmail, saveEmail: !hasRequest && parentEmail !== existing };
}
