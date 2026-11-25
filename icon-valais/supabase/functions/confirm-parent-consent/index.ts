// GET ?token=<uuid> (public, verify_jwt = false) : confirme le consentement parental
// via la RPC confirm_parent_consent et renvoie une page HTML traduite.
import { serviceClient } from '../_shared/http.ts';
import { confirmPageHtml, isUuid, pickLang } from '../_shared/consent.ts';

function page(status: number, lang: ReturnType<typeof pickLang>, ok: boolean): Response {
  return new Response(confirmPageHtml(lang, ok), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

Deno.serve(async (req) => {
  const lang = pickLang(req.headers.get('Accept-Language'));
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }
  const token = new URL(req.url).searchParams.get('token');
  if (!isUuid(token)) return page(400, lang, false);

  const { data, error } = await serviceClient().rpc('confirm_parent_consent', { p_token: token });
  if (error) {
    console.error('confirm_parent_consent failed', error.message);
    return page(500, lang, false);
  }
  return data === true ? page(200, lang, true) : page(400, lang, false);
});
