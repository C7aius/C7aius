import { supabase } from '@/src/lib/supabase';

/** Erreur de téléchargement de quittance ; `key` = clé i18n. */
export class ReceiptError extends Error {
  constructor(public key: string) {
    super(key);
  }
}

/** Télécharge le PDF de la quittance (Edge Function `receipt`, JWT de l'utilisateur). */
export async function fetchReceipt(paymentId: string): Promise<ArrayBuffer> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ReceiptError('errors.notAllowed');
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/receipt?payment=${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    });
  } catch {
    throw new ReceiptError('errors.network');
  }
  if (!res.ok) throw new ReceiptError(res.status === 409 || res.status === 404 ? 'payments.receiptUnavailable' : 'payments.receiptError');
  return res.arrayBuffer();
}
