import { Workbook } from 'exceljs';

/**
 * F05 — .xlsx তৈরি (exceljs)।
 *
 * ⭐ এখানে একটাই নিয়ম: **যা সংখ্যা, তা সংখ্যা হিসেবেই লেখা হয়**। ঘণ্টা
 * "৭ঘ ৩২মি" লিখে দিলে Excel-এ ওটা টেক্সট, তখন কলাম সিলেক্ট করে যোগফল দেখা
 * বা বড়-থেকে-ছোট sort করা — দুটোর কোনোটাই চলে না। অথচ রিপোর্ট নামিয়ে
 * মানুষ প্রথম কাজ ওটাই করে।
 */

export type CellValue = string | number | null;

/** ঘণ্টা ও শতাংশ — দুই দশমিক, কিন্তু ভেতরে পুরো সংখ্যাটাই থাকে */
export const NUM_FMT_2 = '0.00';

export interface ExcelColumn<T> {
  header: string;
  /** Excel-এর অক্ষর-চওড়া একক; বাংলা হেডার একটু বেশি জায়গা নেয় */
  width: number;
  numFmt?: string;
  value: (row: T) => CellValue;
}

interface ErasedColumn {
  header: string;
  width: number;
  numFmt?: string;
  value: (row: unknown) => CellValue;
}

export interface SheetSpec {
  name: string;
  columns: ErasedColumn[];
  rows: readonly unknown[];
}

/**
 * টাইপ-নিরাপদ কলাম সংজ্ঞাকে এক ওয়ার্কবুকে অন্য শিটের পাশে বসানোর মোড়ক।
 * (একেক শিটের সারির ধরন একেক রকম, তাই জেনেরিকটা এখানেই মুছে ফেলা হয়।)
 */
export function sheetOf<T>(
  name: string,
  columns: ExcelColumn<T>[],
  rows: readonly T[],
): SheetSpec {
  return {
    name,
    columns: columns.map((c) => ({
      header: c.header,
      width: c.width,
      numFmt: c.numFmt,
      value: (row: unknown) => c.value(row as T),
    })),
    rows,
  };
}

/**
 * ⭐ রেঞ্জ, তৈরির সময়, ছাঁটাইয়ের নোট — এসব **আলাদা শিটে**, ডেটার উপরে নয়।
 * টেবিলের মাথায় দু-তিন লাইন শিরোনাম বসালে ফিল্টার, sort আর "কলাম সিলেক্ট
 * করে যোগফল" — সব ভেঙে যায়, কারণ তখন হেডার আর প্রথম সারি এক থাকে না।
 */
export async function buildWorkbook(
  sheets: SheetSpec[],
  info: [string, string][],
): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'oXeio Monitoring';
  wb.created = new Date();

  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name);

    ws.columns = spec.columns.map((c) => ({
      header: c.header,
      width: c.width,
      style: c.numFmt ? { numFmt: c.numFmt } : undefined,
    }));

    for (const row of spec.rows) {
      ws.addRow(spec.columns.map((c) => c.value(row)));
    }

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.height = 20;
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' },
      };
    });

    // হেডার আটকে থাকে — ৫০০০ সারির অ্যাটেনডেন্স শিটে এটা ছাড়া কোন কলাম
    // কীসের তা বোঝা যায় না
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (spec.columns.length > 0) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: spec.columns.length },
      };
    }
  }

  const infoSheet = wb.addWorksheet('Info');
  infoSheet.columns = [
    { header: 'বিষয়', width: 28 },
    { header: 'মান', width: 46 },
  ];
  for (const [key, value] of info) infoSheet.addRow([key, value]);
  infoSheet.getRow(1).font = { bold: true };

  // ⚠️ exceljs-এর টাইপ Buffer বললেও রানটাইমে কিছু সংস্করণ ArrayBuffer দেয়;
  //    Buffer.from() দুটোই সামলায়, আর res.send() তখন নিশ্চিতভাবেই বাইনারি পায়।
  const written = await wb.xlsx.writeBuffer();
  return Buffer.from(written);
}

/**
 * ⚠️ ফাইলের নাম ASCII-তে রাখা হয় — Content-Disposition-এ বাংলা নাম দিতে হলে
 *    RFC 5987 এনকোডিং লাগত, আর পুরোনো ক্লায়েন্টে ওটা ভাঙা নামে সেভ হতো।
 */
export function reportFilename(
  report: string,
  from: string,
  to: string,
): string {
  return `oxeio-${report}-${from}_${to}.xlsx`;
}

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
