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

export function buildConsentEmail(
  lang: Lang,
  childFirstName: string,
  link: string,
): { subject: string; html: string } {
  const t = EMAIL_TEXTS[lang] ?? EMAIL_TEXTS.fr;
  const name = escapeHtml(childFirstName);
  const href = escapeHtml(link);
  const html =
    `<!doctype html><html lang="${lang}"><body style="font-family:sans-serif;max-width:480px;margin:auto">` +
    `<p>${t.hello}</p><p>${t.body(name)}</p>` +
    `<p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${t.button}</a></p>` +
    `<p style="color:#555;font-size:13px">${t.expiry}<br>${t.ignore}</p>` +
    `<p style="color:#555;font-size:13px;word-break:break-all">${href}</p>` +
    `</body></html>`;
  // le sujet est du texte brut (pas du HTML) : prénom non échappé
  return { subject: t.subject(childFirstName.replace(/[\r\n]+/g, ' ')), html };
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
