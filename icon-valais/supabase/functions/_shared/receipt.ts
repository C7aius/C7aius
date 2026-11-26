// Quittance PDF d'un paiement (pdf-lib, police DejaVu Sans intégrée : latin
// et cyrillique) et traitement de la requête receipt (I/O injectées).
// Testé avec Deno (receipt.test.ts).
//
// Contenu : « Icon Valais Conthey », « Quittance n° <receipt_no> », date
// (Europe/Zurich), payeur, bénéficiaire s'il diffère, description, montant
// CHF, moyen de paiement, « Pas de TVA », remboursement le cas échéant.
// La description est celle enregistrée en base (en français).
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import { corsHeaders } from './http.ts';
import { normalizeLang, type Lang, LANGS } from './consent.ts';
import { CLUB_TIME_ZONE } from './push.ts';
import { DEJAVU_SANS_BASE64 } from './receiptFont.ts';

export type { Lang };

export type ReceiptStatus = 'pending' | 'succeeded' | 'failed' | 'refund_pending' | 'refunded';

export type ReceiptData = {
  receiptNo: number | string;
  paidAt: string | null; // ISO
  payerName: string;
  beneficiaryName?: string | null;
  description: string;
  amount: number; // CHF
  currency: string;
  method: string | null;
  status: ReceiptStatus;
  refundedAt?: string | null;
};

type Texts = {
  title: (n: string) => string;
  date: string;
  payer: string;
  beneficiary: string;
  description: string;
  amount: string;
  method: string;
  noVat: string;
  refunded: (d: string) => string;
  refundPending: string;
  methods: Record<string, string>;
};

const TEXTS: Record<Lang, Texts> = {
  fr: {
    title: (n) => `Quittance n° ${n}`,
    date: 'Date',
    payer: 'Payeur',
    beneficiary: 'Bénéficiaire',
    description: 'Description',
    amount: 'Montant',
    method: 'Moyen de paiement',
    noVat: 'Pas de TVA',
    refunded: (d) => `Remboursé le ${d}`,
    refundPending: 'Remboursement en cours',
    methods: { card: 'Carte', twint: 'TWINT' },
  },
  de: {
    title: (n) => `Quittung Nr. ${n}`,
    date: 'Datum',
    payer: 'Zahler',
    beneficiary: 'Begünstigte Person',
    description: 'Beschreibung',
    amount: 'Betrag',
    method: 'Zahlungsmittel',
    noVat: 'Keine MWST',
    refunded: (d) => `Erstattet am ${d}`,
    refundPending: 'Erstattung in Bearbeitung',
    methods: { card: 'Karte', twint: 'TWINT' },
  },
  en: {
    title: (n) => `Receipt No. ${n}`,
    date: 'Date',
    payer: 'Payer',
    beneficiary: 'Beneficiary',
    description: 'Description',
    amount: 'Amount',
    method: 'Payment method',
    noVat: 'No VAT',
    refunded: (d) => `Refunded on ${d}`,
    refundPending: 'Refund in progress',
    methods: { card: 'Card', twint: 'TWINT' },
  },
  ru: {
    title: (n) => `Квитанция № ${n}`,
    date: 'Дата',
    payer: 'Плательщик',
    beneficiary: 'Получатель',
    description: 'Описание',
    amount: 'Сумма',
    method: 'Способ оплаты',
    noVat: 'Без НДС',
    refunded: (d) => `Возвращено ${d}`,
    refundPending: 'Возврат в обработке',
    methods: { card: 'Карта', twint: 'TWINT' },
  },
};

// JJ.MM.AAAA à Zurich.
export function formatZurichDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

let fontBytes: Uint8Array | null = null;
function font(): Uint8Array {
  if (!fontBytes) fontBytes = Uint8Array.from(atob(DEJAVU_SANS_BASE64), (c) => c.charCodeAt(0));
  return fontBytes;
}

export async function buildReceiptPdf(r: ReceiptData, lang: Lang): Promise<Uint8Array> {
  const t = TEXTS[lang] ?? TEXTS.fr;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await doc.embedFont(font(), { subset: true });
  doc.setTitle(t.title(String(r.receiptNo)));
  doc.setProducer('Icon Valais Conthey');
  const page = doc.addPage([595.28, 841.89]); // A4
  const x = 56;
  let y = 780;
  const dark = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);
  const line = (text: string, size = 11, color = dark) => {
    page.drawText(text, { x, y, size, font: f, color, maxWidth: 480 });
    y -= size + 10;
  };
  const field = (label: string, value: string) => {
    page.drawText(label, { x, y, size: 10, font: f, color: grey });
    page.drawText(value, { x: x + 150, y, size: 11, font: f, color: dark, maxWidth: 330 });
    y -= 22;
  };

  line('Icon Valais Conthey', 20);
  y -= 8;
  line(t.title(String(r.receiptNo)), 15);
  y -= 12;
  if (r.paidAt) field(t.date, formatZurichDate(r.paidAt));
  field(t.payer, r.payerName);
  if (r.beneficiaryName && r.beneficiaryName !== r.payerName) field(t.beneficiary, r.beneficiaryName);
  field(t.description, r.description);
  field(t.amount, `${Number(r.amount).toFixed(2)} ${(r.currency || 'chf').toUpperCase()}`);
  if (r.method) field(t.method, t.methods[r.method] ?? r.method);
  y -= 10;
  line(t.noVat, 10, grey);
  if (r.status === 'refunded') line(r.refundedAt ? t.refunded(formatZurichDate(r.refundedAt)) : t.refunded('—'), 12);
  else if (r.status === 'refund_pending') line(t.refundPending, 12);

  return await doc.save();
}

// ---------------------------------------------------------------------------
// Requête GET ?payment=<id>[&lang=fr|de|en|ru]
// ---------------------------------------------------------------------------
export type ReceiptDeps = {
  // paiement lu AVEC le jeton de l'appelant (RLS payments_select : payeur,
  // bénéficiaire, parent du bénéficiaire, admin) ; null si invisible
  loadVisibleReceipt(paymentId: string, jwt: string): Promise<ReceiptData | null>;
  viewerLanguage(jwt: string): Promise<string | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function handleReceipt(req: Request, deps: ReceiptDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (req.method !== 'GET') return jsonRes(405, { error: 'method not allowed' });
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!m) return jsonRes(401, { error: 'unauthorized' });
  const url = new URL(req.url);
  const id = url.searchParams.get('payment') ?? '';
  if (!UUID.test(id)) return jsonRes(400, { error: 'invalid_payment' });

  const r = await deps.loadVisibleReceipt(id, m[1]);
  if (!r) return jsonRes(404, { error: 'not_found' });
  if (r.status !== 'succeeded' && r.status !== 'refund_pending' && r.status !== 'refunded') {
    return jsonRes(409, { error: 'not_paid' });
  }
  const q = url.searchParams.get('lang');
  const lang = q && (LANGS as readonly string[]).includes(q) ? (q as Lang) : normalizeLang(await deps.viewerLanguage(m[1]));
  const pdf = await buildReceiptPdf(r, lang);
  return new Response(pdf.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: {
      ...HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="quittance-${r.receiptNo}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
