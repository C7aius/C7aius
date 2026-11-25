import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  buildConfirmLink,
  buildConsentEmail,
  confirmPageHtml,
  confirmFormHtml,
  decideSend,
  isUuid,
  pickLang,
  validateSendRequest,
  type Lang,
} from './consent.ts';

const LANGS: Lang[] = ['fr', 'de', 'en', 'ru'];
const LINK = 'https://x.example/functions/v1/confirm-parent-consent?token=abc';

Deno.test('buildConsentEmail: nom, lien et sujet dans les 4 langues', () => {
  for (const lang of LANGS) {
    const { subject, html } = buildConsentEmail(lang, 'Lea', LINK);
    assert(subject.trim().length > 0, `sujet ${lang}`);
    assertStringIncludes(html, 'Lea');
    assertStringIncludes(html, LINK);
  }
});

Deno.test('buildConsentEmail: sujets distincts par langue', () => {
  const subjects = LANGS.map((l) => buildConsentEmail(l, 'Lea', LINK).subject);
  assertEquals(new Set(subjects).size, 4);
});

Deno.test('buildConsentEmail: échappe le HTML du prénom et du lien', () => {
  const { html } = buildConsentEmail('en', '<script>x</script>', 'https://x/?a=1&b="2"');
  assertFalse(html.includes('<script>'));
  assertStringIncludes(html, '&lt;script&gt;');
  assertStringIncludes(html, 'a=1&amp;b=&quot;2&quot;');
});

Deno.test('confirmPageHtml: succès et lien invalide traduits', () => {
  for (const lang of LANGS) {
    const ok = confirmPageHtml(lang, true);
    const ko = confirmPageHtml(lang, false);
    assertStringIncludes(ok, `<html lang="${lang}"`);
    assert(ok !== ko);
  }
  assertStringIncludes(confirmPageHtml('fr', false), 'invalide');
});

Deno.test('pickLang: Accept-Language, défaut fr', () => {
  assertEquals(pickLang('de-CH,de;q=0.9,en;q=0.8'), 'de');
  assertEquals(pickLang('ru'), 'ru');
  assertEquals(pickLang('es,en;q=0.5'), 'en');
  assertEquals(pickLang('es'), 'fr');
  assertEquals(pickLang(null), 'fr');
});

Deno.test('validateSendRequest: corps vide accepté, e-mail optionnel', () => {
  assertEquals(validateSendRequest({}), { ok: true, parentEmail: undefined });
  assertEquals(validateSendRequest({ parent_email: ' Maman@Test.ch ' }), {
    ok: true,
    parentEmail: 'maman@test.ch',
  });
});

Deno.test('validateSendRequest: refuse e-mail invalide ou corps non objet', () => {
  assertFalse(validateSendRequest({ parent_email: 'pas-un-email' }).ok);
  assertFalse(validateSendRequest({ parent_email: 42 }).ok);
  assertFalse(validateSendRequest(null).ok);
  assertFalse(validateSendRequest('x').ok);
});

Deno.test('buildConfirmLink: base explicite ou fonction sœur de la requête', () => {
  assertEquals(
    buildConfirmLink('https://p.example/functions/v1/', 'http://internal/x', 'tok'),
    'https://p.example/functions/v1/confirm-parent-consent?token=tok',
  );
  assertEquals(
    buildConfirmLink(undefined, 'https://ref.supabase.co/functions/v1/send-parent-consent', 'tok'),
    'https://ref.supabase.co/functions/v1/confirm-parent-consent?token=tok',
  );
});

Deno.test('isUuid', () => {
  assert(isUuid('00000000-0000-4000-8000-000000000001'));
  assertFalse(isUuid('abc'));
  assertFalse(isUuid(null));
});

Deno.test('confirmFormHtml: bouton POST, jeton caché, 4 langues', () => {
  const tok = '00000000-0000-4000-8000-000000000001';
  for (const lang of LANGS) {
    const h = confirmFormHtml(lang, tok);
    assertStringIncludes(h, '<form method="post"');
    assertStringIncludes(h, `name="token" value="${tok}"`);
    assertStringIncludes(h, `<html lang="${lang}"`);
  }
  assertEquals(new Set(LANGS.map((l) => confirmFormHtml(l, 'x'))).size, 4);
});

const NOW = new Date('2026-01-10T12:00:00Z');
const base = {
  profile: { age: 12, parentProfileId: null, parentConsentAt: null, parentEmail: 'mum@t.ch', email: 'kid@t.ch' },
  userEmail: 'kid@t.ch',
  requestedEmail: undefined as string | undefined,
  previousRequests: [] as Date[],
  now: NOW,
};
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 3600_000;

Deno.test('decideSend: première demande, adresse du profil', () => {
  assertEquals(decideSend(base), { ok: true, parentEmail: 'mum@t.ch', saveEmail: false });
});

Deno.test('decideSend: première demande, nouvelle adresse à enregistrer', () => {
  assertEquals(decideSend({ ...base, requestedEmail: 'dad@t.ch' }), { ok: true, parentEmail: 'dad@t.ch', saveEmail: true });
  assertEquals(decideSend({ ...base, profile: { ...base.profile, parentEmail: null }, requestedEmail: 'dad@t.ch' }),
    { ok: true, parentEmail: 'dad@t.ch', saveEmail: true });
});

Deno.test('decideSend: pas d\'adresse → 400', () => {
  const r = decideSend({ ...base, profile: { ...base.profile, parentEmail: null } });
  assertEquals(r, { ok: false, status: 400, error: 'parent_email required' });
});

Deno.test('decideSend: non éligible → 409', () => {
  for (const profile of [
    { ...base.profile, age: 16 },
    { ...base.profile, parentProfileId: 'x' },
    { ...base.profile, parentConsentAt: '2026-01-01' },
  ]) {
    assertEquals(decideSend({ ...base, profile }), { ok: false, status: 409, error: 'consent not required' });
  }
});

Deno.test('decideSend: adresse figée dès qu\'une demande existe', () => {
  const prev = [ago(2 * H)];
  assertEquals(decideSend({ ...base, previousRequests: prev, requestedEmail: 'kid@t.ch' }),
    { ok: false, status: 409, error: 'parent_email_locked' });
  assertEquals(decideSend({ ...base, previousRequests: prev, requestedEmail: 'dad@t.ch' }),
    { ok: false, status: 409, error: 'parent_email_locked' });
  assertEquals(decideSend({ ...base, previousRequests: prev, profile: { ...base.profile, parentEmail: null } }),
    { ok: false, status: 409, error: 'parent_email_locked' });
  assertEquals(decideSend({ ...base, previousRequests: prev, requestedEmail: 'mum@t.ch' }),
    { ok: true, parentEmail: 'mum@t.ch', saveEmail: false });
});

Deno.test('decideSend: refuse sa propre adresse', () => {
  const r = decideSend({ ...base, requestedEmail: 'KID@t.ch'.toLowerCase() });
  assertEquals(r, { ok: false, status: 400, error: 'parent_email must differ from own email' });
  const r2 = decideSend({ ...base, userEmail: 'mum@t.ch' });
  assertEquals(r2.ok, false);
});

Deno.test('decideSend: délai de 60 s entre deux envois', () => {
  assertEquals(decideSend({ ...base, previousRequests: [ago(30_000)] }), { ok: false, status: 429, error: 'too many requests' });
  assertEquals(decideSend({ ...base, previousRequests: [ago(61_000)] }).ok, true);
});

Deno.test('decideSend: plafond de 5 demandes par 24 h', () => {
  const five = [2, 3, 4, 5, 6].map((m) => ago(m * 60_000));
  assertEquals(decideSend({ ...base, previousRequests: five }), { ok: false, status: 429, error: 'too many requests' });
  const four = five.slice(0, 4);
  assertEquals(decideSend({ ...base, previousRequests: four }).ok, true);
  // les demandes de plus de 24 h ne comptent pas
  const old = [25, 26, 27, 28, 29, 30].map((h) => ago(h * H));
  assertEquals(decideSend({ ...base, previousRequests: old }).ok, true);
});
