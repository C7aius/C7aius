import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  buildConfirmLink,
  buildConsentEmail,
  confirmPageHtml,
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
