// GET ?payment=<id>[&lang=fr|de|en|ru] (utilisateur connecté) : quittance PDF
// (application/pdf). Le paiement est lu avec le jeton de l'appelant : la RLS
// payments_select n'en laisse voir qu'au payeur, au bénéficiaire, au parent du
// bénéficiaire et à l'admin (sinon 404). Les noms sont ensuite lus avec le
// client service. Langue : ?lang, sinon celle du profil. Logique dans
// _shared/receipt.ts.
import { createClient } from '@supabase/supabase-js';
import { serviceClient } from '../_shared/http.ts';
import { handleReceipt, type ReceiptData } from '../_shared/receipt.ts';

function userClient(jwt: string) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const fullName = (p: { first_name?: string | null; last_name?: string | null } | undefined) =>
  p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '';

Deno.serve(async (req) => {
  const db = serviceClient();
  try {
    return await handleReceipt(req, {
      async loadVisibleReceipt(id, jwt) {
        // RLS : invisible → null
        const { data: p, error } = await userClient(jwt)
          .from('payments')
          .select('id, receipt_no, payer_profile_id, beneficiary_profile_id, amount, currency, method, status, description, paid_at, refunded_at')
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(`payment lookup: ${error.message}`);
        if (!p) return null;
        const ids = [p.payer_profile_id, p.beneficiary_profile_id].filter((x): x is string => !!x);
        const { data: people, error: nErr } = await db.from('profiles').select('id, first_name, last_name').in('id', ids);
        if (nErr) throw new Error(`names lookup: ${nErr.message}`);
        const byId = new Map((people ?? []).map((x) => [x.id, x]));
        return {
          receiptNo: p.receipt_no,
          paidAt: p.paid_at,
          payerName: fullName(byId.get(p.payer_profile_id)),
          beneficiaryName: p.beneficiary_profile_id === p.payer_profile_id ? null : fullName(byId.get(p.beneficiary_profile_id)),
          description: p.description,
          amount: Number(p.amount),
          currency: p.currency,
          method: p.method,
          status: p.status,
          refundedAt: p.refunded_at,
        } as ReceiptData;
      },
      async viewerLanguage(jwt) {
        const { data: u } = await db.auth.getUser(jwt);
        if (!u?.user) return null;
        const { data } = await db.from('profiles').select('language').eq('auth_user_id', u.user.id).maybeSingle();
        return data?.language ?? null;
      },
    });
  } catch (e) {
    console.error('receipt failed', e instanceof Error ? e.message : 'unknown');
    return new Response(JSON.stringify({ error: 'receipt failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
