import PDFDocument from 'pdfkit';

import {
  dhakaStamp,
  MAX_PDF_ROWS,
  truncateToWidth,
  truncationNote,
} from './reports.pdf.text';

/**
 * F06 — PDF তৈরির ইঞ্জিন (pdfkit)। কোন রিপোর্ট দেখতে কেমন হবে সেটা
 * [reports.pages.ts](./reports.pages.ts)-এ, ঠিক যেভাবে Excel-এ
 * `reports.excel.ts` (ইঞ্জিন) আর `reports.sheets.ts` (লেআউট) আলাদা।
 *
 * ⭐ **PDF-এর ভাষা ইংরেজি** — কারণ ও তার একমাত্র বিকল্প
 * [reports.pdf.text.ts](./reports.pdf.text.ts)-এর মাথায় লেখা আছে। এক
 * বাক্যে: pdfkit-এর বিল্ট-ইন ফন্টে বাংলা **নীরবে ফাঁকা** ছাপে, আর
 * রেপোতে কোনো বাংলা ফন্ট নেই।
 *
 * ⚠️ এখানে কোনো ডাটাবেস বা HTTP নেই — শুধু ইনপুট → Buffer। ফলে PDF-এর
 * চেহারা বদলাতে গিয়ে কোয়েরির কোডে হাত পড়ে না।
 */

/** A4 ল্যান্ডস্কেপ — ৯–১২টা কলাম পোর্ট্রেটে আঁটে না, আঁটাতে গেলে ফন্ট এত
 *  ছোট হতো যে ছাপা কাগজে সংখ্যা পড়া যেত না */
const PAGE = { size: 'A4' as const, layout: 'landscape' as const, margin: 36 };

/** ল্যান্ডস্কেপ A4-এর ভেতরের প্রস্থ (৮৪২pt − দুই পাশে ৩৬pt) */
export const CONTENT_WIDTH = 770;

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const TITLE_SIZE = 16;
const META_SIZE = 8.5;
const HEAD_SIZE = 7.5;
const BODY_SIZE = 7.5;
const NOTE_SIZE = 7.5;

const ROW_HEIGHT = 12.5;
const HEAD_HEIGHT = 15;
/** ঘরের ভেতরে দু-পাশে ফাঁক — নইলে সংখ্যা কলামের দাগ ছুঁয়ে থাকত */
const CELL_PAD = 3;

export interface PdfColumn<T> {
  header: string;
  /** পয়েন্টে — সবগুলোর যোগফল `CONTENT_WIDTH` হওয়া উচিত */
  width: number;
  /** সংখ্যার কলাম ডানে — নইলে দশমিক বিন্দু এক লাইনে দাঁড়ায় না */
  align?: 'left' | 'right';
  value: (row: T) => string;
}

interface ErasedColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
  value: (row: unknown) => string;
}

export interface PdfTable {
  columns: ErasedColumn[];
  rows: readonly unknown[];
}

/** টাইপ-নিরাপদ কলাম সংজ্ঞা → ইঞ্জিনের জেনেরিকহীন রূপ (sheetOf-এর মতোই) */
export function tableOf<T>(
  columns: PdfColumn<T>[],
  rows: readonly T[],
): PdfTable {
  return {
    columns: columns.map((c) => ({
      header: c.header,
      width: c.width,
      align: c.align,
      value: (row: unknown) => c.value(row as T),
    })),
    rows,
  };
}

export interface LetterheadSpec {
  /** প্রতিষ্ঠানের নাম — `ORG_NAME` থেকে */
  orgName: string;
  /** রিপোর্টের নাম, ইংরেজিতে */
  reportTitle: string;
  rangeFrom: string;
  rangeTo: string;
  /** ISO — ঢাকার সময়ে ছাপা হয় */
  generatedAt: string;
}

export interface PdfSpec {
  letterhead: LetterheadSpec;
  table: PdfTable;
  /** টেবিলের নিচে সংক্ষিপ্ত মোট (লেবেল, মান) */
  totals?: [string, string][];
  /** ছাপার আগে/পরে যা জানানো দরকার — সতর্কতা, নীতি, ছাঁটাই */
  notes?: string[];
}

/**
 * PDF বানিয়ে Buffer ফেরত দেয়।
 *
 * ⚠️ pdfkit stream-এ লেখে, তাই `end` ইভেন্ট না ধরে Buffer পাওয়া যায় না।
 * `doc.end()` ডাকার **আগে** লিসেনার বসাতে হয় — নইলে ছোট ডকুমেন্টে
 * প্রথম chunk-টা হারিয়ে যেতে পারত আর ফাইল ভাঙা বেরোত।
 */
export async function buildPdf(spec: PdfSpec): Promise<Buffer> {
  const doc = new PDFDocument({
    ...PAGE,
    bufferPages: true,
    info: {
      Title: `${spec.letterhead.reportTitle} ${spec.letterhead.rangeFrom} - ${spec.letterhead.rangeTo}`,
      Author: spec.letterhead.orgName,
      Creator: 'oXeio Monitoring',
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  render(doc, spec);
  doc.end();

  return done;
}

function render(doc: PDFKit.PDFDocument, spec: PdfSpec): void {
  const { columns, rows } = spec.table;
  const shown = rows.slice(0, MAX_PDF_ROWS);
  const cut = truncationNote(rows.length, shown.length);

  letterhead(doc, spec.letterhead, rows.length);

  let y = doc.y + 6;
  y = tableHeader(doc, columns, y);

  const bottom = doc.page.height - doc.page.margins.bottom - 18;

  for (const row of shown) {
    if (y + ROW_HEIGHT > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      y = tableHeader(doc, columns, y);
    }
    y = tableRow(doc, columns, row, y);
  }

  // ⭐ শূন্য সারিও একটা ফল — খালি পাতা দেখে কেউ যেন "রিপোর্ট ভেঙেছে"
  //    না ভাবেন
  if (shown.length === 0) {
    doc
      .font(FONT)
      .fontSize(BODY_SIZE)
      .fillColor('#666666')
      .text(
        'No rows for this range.',
        doc.page.margins.left + CELL_PAD,
        y + 4,
        { width: CONTENT_WIDTH },
      );
    y += ROW_HEIGHT + 4;
  }

  footer(doc, spec, y, cut);
  pageNumbers(doc, spec.letterhead);
}

function letterhead(
  doc: PDFKit.PDFDocument,
  head: LetterheadSpec,
  totalRows: number,
): void {
  const left = doc.page.margins.left;

  doc
    .font(FONT_BOLD)
    .fontSize(TITLE_SIZE)
    .fillColor('#111111')
    .text(head.orgName, left, doc.page.margins.top, { width: CONTENT_WIDTH });

  doc
    .font(FONT_BOLD)
    .fontSize(META_SIZE + 2)
    .text(head.reportTitle, { width: CONTENT_WIDTH });

  doc
    .font(FONT)
    .fontSize(META_SIZE)
    .fillColor('#444444')
    .text(
      `Period: ${head.rangeFrom} to ${head.rangeTo}   |   ` +
        `Generated: ${dhakaStamp(new Date(head.generatedAt))}   |   ` +
        `Rows: ${totalRows}`,
      { width: CONTENT_WIDTH },
    );

  // শিরোনাম আর টেবিলের মাঝে একটা দাগ — ছাপা কাগজে এটাই "লেটারহেড শেষ"
  const lineY = doc.y + 4;
  doc
    .moveTo(left, lineY)
    .lineTo(left + CONTENT_WIDTH, lineY)
    .lineWidth(0.8)
    .strokeColor('#111111')
    .stroke();

  doc.y = lineY;
}

function tableHeader(
  doc: PDFKit.PDFDocument,
  columns: ErasedColumn[],
  y: number,
): number {
  const left = doc.page.margins.left;

  doc.rect(left, y, CONTENT_WIDTH, HEAD_HEIGHT).fillColor('#EFEFEF').fill();

  doc.font(FONT_BOLD).fontSize(HEAD_SIZE).fillColor('#111111');
  cells(doc, columns, y + 4, (c) => c.header);

  doc
    .moveTo(left, y + HEAD_HEIGHT)
    .lineTo(left + CONTENT_WIDTH, y + HEAD_HEIGHT)
    .lineWidth(0.5)
    .strokeColor('#999999')
    .stroke();

  return y + HEAD_HEIGHT + 2;
}

function tableRow(
  doc: PDFKit.PDFDocument,
  columns: ErasedColumn[],
  row: unknown,
  y: number,
): number {
  doc.font(FONT).fontSize(BODY_SIZE).fillColor('#222222');
  cells(doc, columns, y, (c) => c.value(row));
  return y + ROW_HEIGHT;
}

/**
 * এক সারির সব ঘর বসানো।
 *
 * ⚠️ প্রতিটা ঘরে `width` **আর** `lineBreak: false` — দুটোই দরকার।
 * `lineBreak` না থাকলে লম্বা নাম নিজে থেকে পরের লাইনে নেমে যেত আর
 * সারিগুলো একে অন্যের উপর ছাপা হতো; `width` না থাকলে লেখা পাশের
 * কলামের উপরে গড়িয়ে যেত। তার আগে `truncateToWidth` দিয়ে কেটেও নেওয়া
 * হয়, যাতে কাটা জায়গায় `...` দেখা যায় — pdfkit নিজে চুপচাপ কাটে।
 */
function cells(
  doc: PDFKit.PDFDocument,
  columns: ErasedColumn[],
  y: number,
  textOf: (c: ErasedColumn) => string,
): void {
  let x = doc.page.margins.left;

  for (const column of columns) {
    const inner = column.width - CELL_PAD * 2;
    const text = truncateToWidth(textOf(column), inner, (s) =>
      doc.widthOfString(s),
    );

    doc.text(text, x + CELL_PAD, y, {
      width: inner,
      align: column.align ?? 'left',
      lineBreak: false,
    });

    x += column.width;
  }
}

function footer(
  doc: PDFKit.PDFDocument,
  spec: PdfSpec,
  startY: number,
  cut: string | null,
): void {
  const notes = [...(spec.notes ?? [])];
  if (cut) notes.unshift(cut);

  if ((spec.totals?.length ?? 0) === 0 && notes.length === 0) return;

  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  let y = startY + 8;

  // ⚠️ পাদটীকা যেন পাতার নিচে গিয়ে কাটা না পড়ে — জায়গা না থাকলে নতুন পাতা
  if (y + (spec.totals?.length ?? 0) * 11 + notes.length * 20 > bottom) {
    doc.addPage();
    y = doc.page.margins.top;
  }

  if (spec.totals && spec.totals.length > 0) {
    doc.font(FONT_BOLD).fontSize(NOTE_SIZE).fillColor('#111111');
    for (const [label, value] of spec.totals) {
      doc.text(`${label}: ${value}`, left, y, {
        width: CONTENT_WIDTH,
        lineBreak: false,
      });
      y += 11;
    }
    y += 4;
  }

  doc.font(FONT).fontSize(NOTE_SIZE).fillColor('#555555');
  for (const note of notes) {
    doc.text(note, left, y, { width: CONTENT_WIDTH });
    y = doc.y + 3;
  }
}

/**
 * প্রতি পাতার নিচে "Page n of m"।
 *
 * ⭐ `bufferPages: true` ছাড়া এটা অসম্ভব — মোট কত পাতা হবে সেটা শেষ সারি
 * ছাপার আগে জানা যায় না, অথচ সংখ্যাটা লিখতে হয় **প্রথম** পাতাতেও।
 * ছাপা রিপোর্টে পাতার সংখ্যা না থাকলে এক পাতা হারিয়ে গেলে কেউ টেরই পেত না।
 */
function pageNumbers(doc: PDFKit.PDFDocument, head: LetterheadSpec): void {
  const range = doc.bufferedPageRange();

  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);

    const y = doc.page.height - doc.page.margins.bottom - 10;
    doc
      .font(FONT)
      .fontSize(7)
      .fillColor('#777777')
      // ⚠️ বিভাজক ASCII `|` — `·` WinAnsi-তে আছে বটে, কিন্তু পাদটীকাটা
      //    `toPdfText()` দিয়ে যায় না, তাই এখানে ASCII-র বাইরে কিছু না
      //    রাখাই একমাত্র নিশ্চিত পথ
      .text(
        `${head.orgName} | ${head.reportTitle} | ${head.rangeFrom} to ${head.rangeTo}`,
        doc.page.margins.left,
        y,
        { width: CONTENT_WIDTH / 2, lineBreak: false },
      )
      .text(
        `Page ${i + 1} of ${range.count}`,
        doc.page.margins.left + CONTENT_WIDTH / 2,
        y,
        { width: CONTENT_WIDTH / 2, align: 'right', lineBreak: false },
      );
  }
}
