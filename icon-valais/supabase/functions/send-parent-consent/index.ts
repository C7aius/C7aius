// POST (utilisateur connecté) : crée un jeton de consentement parental et envoie
// l'e-mail via Resend. Secrets requis : RESEND_API_KEY, CONSENT_FROM_EMAIL.
// Optionnel : PUBLIC_FUNCTIONS_URL (base publique des fonctions pour le lien).
import { authenticate, corsHeaders, json, serviceClient } from '../_shared/http.ts';
import { buildConfirmLink, buildConsentEmail, normalizeLang, validateSendRequest } from '../_shared/consent.ts';

const RESEND_COOLDOWN_MS = 60_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('CONSENT_FROM_EMAIL');
  if (!resendKey) return json(500, { error: 'server misconfigured: RESEND_API_KEY is not set' });
  if (!from) return json(500, { error: 'server misconfigured: CONSENT_FROM_EMAIL is not set' });

  const user = await authenticate(req);
  if (!user) return json(401, { error: 'unauthorized' });

  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'invalid json' });
    }
  }
  const v = validateSendRequest(body);
  if (!v.ok) return json(400, { error: v.error });

  const db = serviceClient();
  // Uniquement le profil de l'appelant (jamais un identifiant fourni par le client).
  const { data: profile, error: pErr } = await db
    .from('profiles')
    .select('id, first_name, email, age, parent_profile_id, parent_email, parent_consent_at, language')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (pErr) return json(500, { error: 'profile lookup failed' });
  if (!profile) return json(404, { error: 'profile not found' });

  if (profile.parent_profile_id !== null || profile.age >= 16 || profile.parent_consent_at !== null) {
    return json(409, { error: 'consent not required' });
  }

  const { data: previous, error: cErr } = await db
    .from('parent_consents')
    .select('created_at')
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (cErr) return json(500, { error: 'consent lookup failed' });
  const hasRequest = (previous?.length ?? 0) > 0;

  // L'adresse parent est figée dès qu'une demande existe : un mineur ne peut pas
  // rediriger l'e-mail vers lui-même. Renvoi vers la même adresse autorisé.
  const existing: string | null = profile.parent_email ? String(profile.parent_email).trim().toLowerCase() : null;
  let parentEmail: string;
  if (hasRequest) {
    if (!existing) return json(409, { error: 'parent_email_locked' });
    if (v.parentEmail !== undefined && v.parentEmail !== existing) {
      return json(409, { error: 'parent_email_locked' });
    }
    parentEmail = existing;
    const last = new Date(previous![0].created_at).getTime();
    if (Date.now() - last < RESEND_COOLDOWN_MS) return json(429, { error: 'too many requests' });
  } else {
    const chosen = v.parentEmail ?? existing;
    if (!chosen) return json(400, { error: 'parent_email required' });
    parentEmail = chosen;
  }

  const own = [profile.email, user.email].filter(Boolean).map((e) => String(e).trim().toLowerCase());
  if (own.includes(parentEmail)) return json(400, { error: 'parent_email must differ from own email' });

  if (!hasRequest && parentEmail !== existing) {
    const { error } = await db.from('profiles').update({ parent_email: parentEmail }).eq('id', profile.id);
    if (error) return json(500, { error: 'could not save parent_email' });
  }

  const { data: row, error: iErr } = await db
    .from('parent_consents')
    .insert({ profile_id: profile.id, parent_email: parentEmail })
    .select('token')
    .single();
  if (iErr || !row) return json(500, { error: 'could not create consent request' });

  const link = buildConfirmLink(Deno.env.get('PUBLIC_FUNCTIONS_URL'), req.url, row.token);
  const mail = buildConsentEmail(normalizeLang(profile.language), profile.first_name, link);

  let sent = false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [parentEmail], subject: mail.subject, html: mail.html }),
    });
    sent = res.ok;
    if (!res.ok) console.error('resend error', res.status, await res.text());
  } catch (e) {
    console.error('resend fetch failed', e);
  }
  if (!sent) {
    // pas d'e-mail parti : on retire le jeton pour ne pas figer l'adresse inutilement
    await db.from('parent_consents').delete().eq('token', row.token);
    return json(502, { error: 'email delivery failed' });
  }
  return json(200, { ok: true });
});
