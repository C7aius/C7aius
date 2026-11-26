import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { buildReceiptPdf, formatZurichDate, handleReceipt, type ReceiptData, type ReceiptDeps } from './receipt.ts';
import { LANGS } from './consent.ts';

const PAY = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Extraction du texte d'un PDF pdf-lib : flux décompressés (FlateDecode),
// CMap ToUnicode (bfchar / bfrange) des polices intégrées, chaînes <hex> Tj.
// ---------------------------------------------------------------------------
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream('deflate');
    const out = new Response(new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  } catch {
    return null;
  }
}

async function streams(pdf: Uint8Array): Promise<string[]> {
  const latin = new TextDecoder('latin1').decode(pdf);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    let stop = end;
    while (stop > start && (pdf[stop - 1] === 0x0a || pdf[stop - 1] === 0x0d)) stop--;
    const raw = pdf.slice(start, stop);
    const inflated = await inflate(raw);
    out.push(new TextDecoder('latin1').decode(inflated ?? raw));
    re.lastIndex = end + 'endstream'.length;
  }
  return out;
}

async function pdfTexts(pdf: Uint8Array): Promise<string[]> {
  const ss = await streams(pdf);
  const cmaps: Map<number, string>[] = [];
  for (const s of ss) {
    if (!s.includes('begincmap')) continue;
    const map = new Map<number, string>();
    for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, src, dst] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(parseInt(src, 16), String.fromCodePoint(...(dst.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))));
      }
    }
    for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const [, a, b, dst] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        for (let c = parseInt(a, 16), u = parseInt(dst, 16); c <= parseInt(b, 16); c++, u++) map.set(c, String.fromCodePoint(u));
      }
    }
    cmaps.push(map);
  }
  const texts: string[] = [];
  for (const s of ss) {
    for (const [, hex] of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      for (const map of cmaps) {
        texts.push((hex.match(/.{4}/g) ?? []).map((h) => map.get(parseInt(h, 16)) ?? '?').join(''));
      }
    }
  }
  return texts;
}

const DATA: ReceiptData = {
  receiptNo: 42,
  paidAt: '2026-12-31T23:30:00Z', // 1er janvier 2027 à Zurich
  payerName: 'Anne Müller',
  beneficiaryName: 'Léo Müller',
  description: 'Cours JJB du 03.12.2026 18:30',
  amount: 20,
  currency: 'chf',
  method: 'twint',
  status: 'succeeded',
  refundedAt: null,
};

Deno.test('formatZurichDate: date du jour à Zurich (JJ.MM.AAAA)', () => {
  assertEquals(formatZurichDate('2026-12-31T23:30:00Z'), '01.01.2027');
  assertEquals(formatZurichDate('2026-06-15T10:00:00Z'), '15.06.2026');
});

Deno.test('buildReceiptPdf: %PDF, « Icon Valais Conthey », numéro, « 20.00 CHF », dans les 4 langues', async () => {
  const titles = { fr: 'Quittance n° 42', de: 'Quittung Nr. 42', en: 'Receipt No. 42', ru: 'Квитанция № 42' };
  const noVat = { fr: 'Pas de TVA', de: 'Keine MWST', en: 'No VAT', ru: 'Без НДС' };
  for (const lang of LANGS) {
    const pdf = await buildReceiptPdf(DATA, lang);
    assertEquals(new TextDecoder().decode(pdf.slice(0, 4)), '%PDF', lang);
    const all = (await pdfTexts(pdf)).join('\n');
    assertStringIncludes(all, 'Icon Valais Conthey', lang);
    assertStringIncludes(all, titles[lang], lang);
    assertStringIncludes(all, '20.00 CHF', lang);
    assertStringIncludes(all, noVat[lang], lang);
    assertStringIncludes(all, '01.01.2027', lang);
    assertStringIncludes(all, 'Anne Müller', lang);
    assertStringIncludes(all, 'Léo Müller', lang);
    assertStringIncludes(all, 'TWINT', lang);
  }
});

Deno.test('buildReceiptPdf: bénéficiaire omis s\'il est le payeur ; remboursé mentionné', async () => {
  const same = (await pdfTexts(await buildReceiptPdf({ ...DATA, beneficiaryName: 'Anne Müller' }, 'fr'))).join('\n');
  assertEquals(same.includes('Bénéficiaire'), false);
  const refunded = (await pdfTexts(await buildReceiptPdf({ ...DATA, status: 'refunded', refundedAt: '2027-01-05T09:00:00Z' }, 'fr'))).join('\n');
  assertStringIncludes(refunded, 'Remboursé le 05.01.2027');
  const pending = (await pdfTexts(await buildReceiptPdf({ ...DATA, status: 'refund_pending' }, 'de'))).join('\n');
  assertStringIncludes(pending, 'Erstattung in Bearbeitung');
});

// ---------------------------------------------------------------------------
// receipt (requête)
// ---------------------------------------------------------------------------
function deps(over: Partial<ReceiptDeps> = {}): ReceiptDeps {
  return {
    loadVisibleReceipt: () => Promise.resolve(DATA),
    viewerLanguage: () => Promise.resolve('de'),
    ...over,
  };
}

const get = (q: string, auth = true) =>
  new Request(`http://localhost/receipt${q}`, { headers: auth ? { Authorization: 'Bearer jwt' } : {} });

Deno.test('receipt: PDF pour un paiement visible (payeur / bénéficiaire / parent / admin, RLS)', async () => {
  const seen: string[] = [];
  const res = await handleReceipt(get(`?payment=${PAY}`), deps({
    loadVisibleReceipt: (id, jwt) => {
      seen.push(`${id} ${jwt}`);
      return Promise.resolve(DATA);
    },
  }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'application/pdf');
  assertStringIncludes(res.headers.get('Content-Disposition') ?? '', 'quittance-42.pdf');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  assertEquals(seen, [`${PAY} jwt`]);
  const pdf = new Uint8Array(await res.arrayBuffer());
  // langue du profil par défaut
  assertStringIncludes((await pdfTexts(pdf)).join('\n'), 'Quittung Nr. 42');
  // ?lang= prioritaire
  const en = await handleReceipt(get(`?payment=${PAY}&lang=en`), deps());
  assertStringIncludes((await pdfTexts(new Uint8Array(await en.arrayBuffer()))).join('\n'), 'Receipt No. 42');
});

Deno.test('receipt: sans jeton 401 ; id invalide 400 ; invisible 404 ; non payé 409 ; méthode 405', async () => {
  assertEquals((await handleReceipt(get(`?payment=${PAY}`, false), deps())).status, 401);
  assertEquals((await handleReceipt(get('?payment=nope'), deps())).status, 400);
  assertEquals((await handleReceipt(get(`?payment=${PAY}`), deps({ loadVisibleReceipt: () => Promise.resolve(null) }))).status, 404);
  const pending = await handleReceipt(get(`?payment=${PAY}`), deps({ loadVisibleReceipt: () => Promise.resolve({ ...DATA, status: 'pending' }) }));
  assertEquals(pending.status, 409);
  const post = new Request(`http://localhost/receipt?payment=${PAY}`, { method: 'POST', headers: { Authorization: 'Bearer jwt' } });
  assertEquals((await handleReceipt(post, deps())).status, 405);
  assert(true);
});
