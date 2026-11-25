// Page publique (verify_jwt = false) de confirmation du consentement parental.
//  GET  ?token=<uuid> : vérifie le jeton en lecture seule (check_parent_consent,
//       rien n'est consommé) et affiche un bouton « confirmer ». Les scanners de
//       liens d'e-mail qui préchargent le lien ne peuvent donc pas donner le consentement.
//  POST (formulaire, champ token) : confirm_parent_consent, puis page de résultat.
import { serviceClient } from '../_shared/http.ts';
import { confirmFormHtml, confirmPageHtml, isUuid, type Lang, pickLang } from '../_shared/consent.ts';

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

const invalid = (lang: Lang, status = 400) => html(status, confirmPageHtml(lang, false));

Deno.serve(async (req) => {
  const lang = pickLang(req.headers.get('Accept-Language'));
  const db = serviceClient();

  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token');
    if (!isUuid(token)) return invalid(lang);
    const { data, error } = await db.rpc('check_parent_consent', { p_token: token });
    if (error) {
      console.error('check_parent_consent failed', error.message);
      return invalid(lang, 500);
    }
    return data === true ? html(200, confirmFormHtml(lang, token)) : invalid(lang);
  }

  if (req.method === 'POST') {
    let token: string | null = null;
    try {
      const v = (await req.formData()).get('token');
      token = typeof v === 'string' ? v : null;
    } catch {
      return invalid(lang);
    }
    if (!isUuid(token)) return invalid(lang);
    const { data, error } = await db.rpc('confirm_parent_consent', { p_token: token });
    if (error) {
      console.error('confirm_parent_consent failed', error.message);
      return invalid(lang, 500);
    }
    return data === true ? html(200, confirmPageHtml(lang, true)) : invalid(lang);
  }

  return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
});
