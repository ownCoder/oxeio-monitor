/**
 * ফাইল নামানোর সাধারণ অংশ — নাম ও MIME।
 *
 * `reports.excel.ts` থেকে সরিয়ে আনা হয়েছে কারণ F06-এর পর ফরম্যাট দুটো
 * (xlsx ও pdf), আর "PDF-এর নাম বানাতে excel ফাইলটা import করতে হচ্ছে"
 * পড়তে অদ্ভুত লাগত — তার চেয়েও বড় কথা, তখন কেউ Excel-এর কোড বদলাতে
 * গিয়ে অজান্তে PDF-এর নামও বদলে ফেলতে পারত।
 */

export type DownloadFormat = 'xlsx' | 'pdf';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const PDF_MIME = 'application/pdf';

export const MIME_OF: Record<DownloadFormat, string> = {
  xlsx: XLSX_MIME,
  pdf: PDF_MIME,
};

/**
 * ⚠️ ফাইলের নাম ASCII-তে রাখা হয় — Content-Disposition-এ বাংলা নাম দিতে হলে
 *    RFC 5987 এনকোডিং লাগত, আর পুরোনো ক্লায়েন্টে ওটা ভাঙা নামে সেভ হতো।
 *
 * ⚠️ এক্সটেনশনটা প্যারামিটার, ভেতরে হার্ডকোড নয়। আগে `.xlsx` হার্ডকোড ছিল;
 *    PDF যোগ করার সময় সেটা না বদলালে ব্রাউজার একটা PDF-কে `.xlsx` নামে সেভ
 *    করত আর Excel সেটা খুলতে গিয়ে "ফাইল নষ্ট" বলত — অথচ ফাইলটা ঠিকই ছিল।
 */
export function reportFilename(
  report: string,
  from: string,
  to: string,
  format: DownloadFormat,
): string {
  return `oxeio-${report}-${from}_${to}.${format}`;
}
