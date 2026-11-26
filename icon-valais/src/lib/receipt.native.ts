import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { fetchReceipt } from '@/src/lib/receiptFetch';

/** Natif : écrit le PDF dans le cache puis ouvre la feuille de partage. (Web : receipt.ts.) */
export async function openReceipt(paymentId: string, receiptNo: number): Promise<void> {
  const bytes = await fetchReceipt(paymentId);
  const file = new File(Paths.cache, `quittance-${receiptNo}.pdf`);
  file.create({ overwrite: true });
  file.write(new Uint8Array(bytes));
  await shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
