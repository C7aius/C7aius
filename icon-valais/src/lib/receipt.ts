import { fetchReceipt } from '@/src/lib/receiptFetch';

/** Web : télécharge le PDF dans le navigateur. (Natif : receipt.native.ts.) */
export async function openReceipt(paymentId: string, receiptNo: number): Promise<void> {
  const bytes = await fetchReceipt(paymentId);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `quittance-${receiptNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
