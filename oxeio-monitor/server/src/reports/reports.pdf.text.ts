import { dhakaPathParts } from '../agent/util/dhaka-time';

/**
 * F06 — PDF-এ কোন লেখা আদৌ **ছাপা যাবে** তার খাঁটি হিসাব। pdfkit এখানে
 * ইমপোর্ট করা হয়নি, তাই পুরোটা DB ও লাইব্রেরি ছাড়াই পরীক্ষা করা যায়।
 *
 * ⭐ **এই ফাইলটাই F06-এর সবচেয়ে বড় সিদ্ধান্তের জায়গা: PDF ইংরেজিতে।**
 *
 * pdfkit-এর সাথে যে ১৪টা ফন্ট আসে (Helvetica, Times, Courier …) সেগুলো
 * **WinAnsi**-তে এনকোড করা — অর্থাৎ ল্যাটিন-১-এর বাইরে কোনো অক্ষরের গ্লিফই
 * ওদের নেই। বাংলা লিখলে কোনো এরর ওঠে না, শুধু জায়গাটা **ফাঁকা** থাকে বা
 * বাক্স বসে। অর্থাৎ ভুলটা নীরব: সার্ভার ২০০ দেয়, ফাইল নামে, খুললে নামের
 * কলাম খালি।
 *
 * বাংলা ছাপাতে হলে একটা TTF embed করতে হতো। সেটা করা হয়নি, কারণ:
 *
 * ১· রিপোর্টে **বাংলা ফন্টের কোনো ফাইল নেই** — একটা লাইসেন্স-করা বাইনারি
 *    ফন্ট রেপোতে ঢোকানো মানে লাইসেন্স, আকার আর build-এ কপি করার নিয়ম,
 *    তিনটেই আলাদা সিদ্ধান্ত। কেউ সেটা নেয়নি।
 * ২· বাংলা শুধু গ্লিফ নয়, **shaping**-ও লাগে (যুক্তাক্ষর, ই-কার আগে বসা,
 *    রেফ)। fontkit-এ ইন্ডিক shaper আছে বটে, কিন্তু সেটা আসল ফন্ট দিয়ে
 *    চোখে না দেখে ভরসা করা যায় না। ভাঙা যুক্তাক্ষরের PDF ইংরেজি PDF-এর
 *    চেয়ে খারাপ — ওটা দেখতে ঠিক লাগে, পড়তে ভুল।
 * ৩· PDF-এর আসল মালমসলা সংখ্যা (ঘণ্টা, তারিখ, এমপ কোড) — সেগুলো এমনিতেই
 *    ASCII। বাংলাটা কেবল লেবেলে।
 *
 * ⚠️ তবু একটা ফাঁক থেকে যায়: **কর্মীর নাম ডাটাবেসে বাংলা**। সেটা চুপচাপ
 * ফাঁকা ছাপা হলে পাঠক ভাবতেন ডেটাই নেই। তাই [personLabel()](#) নামটা
 * ছাপা যায় কি না দেখে, না গেলে **এমপ কোড** বসায় এবং `lossy` বলে জানায় —
 * আর সেই পতাকা দেখে PDF-এর পাদটীকায় কারণটা লেখা হয়।
 *
 * বাংলা নাম দরকার হলে Excel (F05) আছে — সেখানে UTF-8, কোনো সমস্যাই নেই।
 */

/** ছাপা না-গেলে যা বসে — কোনো কিছুই না বসিয়ে ফাঁকা রাখা সবচেয়ে খারাপ */
export const UNPRINTABLE = '?';

/** টেবিলের খালি ঘর — `null`/`undefined`/খালি স্ট্রিং সবই এটাই হয় */
export const EMPTY_CELL = '-';

/**
 * ইউনিকোড যতিচিহ্ন → ASCII।
 *
 * ⚠️ এগুলো WinAnsi-তে **আছে**, তবু বদলে দেওয়া হয় — কারণ একই ড্যাশ কোথাও
 * `–` কোথাও `-` হলে কলামের প্রস্থ মাপা আর তুলনা করা দুটোই অনির্দেশ্য হতো।
 * ছাপা লেখা যত কম রকমের বাইট, তত কম চমক।
 */
const PUNCTUATION: ReadonlyMap<string, string> = new Map([
  [' ', ' '], // NBSP
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['–', '-'], // en dash
  ['—', '-'], // em dash
  ['…', '...'],
  ['•', '*'],
]);

/**
 * WinAnsi-তে ছাপা যায় এমন অক্ষর: ASCII printable + Latin-1 supplement।
 *
 * ⚠️ WinAnsi-র ০x৮০–০x৯F ব্লকে আরও কিছু অক্ষর আছে (€, †, ‰ …), কিন্তু
 * সেগুলো ইচ্ছাকৃতভাবে বাদ — রিপোর্টে ওদের দরকার নেই, আর তালিকাটা যত ছোট
 * তত কম "এই একটা অক্ষরে ভাঙল কেন" রহস্য।
 */
const PRINTABLE = /^[\x20-\x7E¡-ÿ]*$/;

export interface PdfText {
  text: string;
  /** কিছু অক্ষর ছাপা যায়নি — পাদটীকায় কারণ লেখা দরকার */
  lossy: boolean;
}

/**
 * যেকোনো লেখাকে ছাপার উপযোগী করা।
 *
 * ⚠️ ছাপা না-যাওয়া অক্ষর **মুছে ফেলা হয় না**, `?` বসে। মুছে দিলে
 * "মামুন" হয়ে যেত খালি স্ট্রিং, আর সেটা "নাম নেই"-এর সমান দেখাত।
 * একটা `?` অন্তত বলে যে এখানে কিছু ছিল।
 */
export function toPdfText(value: string | null | undefined): PdfText {
  if (value === null || value === undefined || value.length === 0) {
    return { text: EMPTY_CELL, lossy: false };
  }

  let normalized = '';
  for (const ch of value) {
    normalized += PUNCTUATION.get(ch) ?? ch;
  }

  if (PRINTABLE.test(normalized)) {
    return { text: normalized, lossy: false };
  }

  let out = '';
  for (const ch of normalized) {
    out += PRINTABLE.test(ch) ? ch : UNPRINTABLE;
  }

  return { text: out, lossy: true };
}

/**
 * ⭐ কর্মীর নামের ঘরে কী বসবে।
 *
 * নাম ছাপা গেলে নামই। না গেলে **এমপ কোড** — `???? ?????` নয়। কারণ
 * প্রশ্নচিহ্নের সারি দেখে কেউ কর্মীকে চিনতে পারতেন না, অথচ কোডটা তার
 * পাশের কলামেই আছে আর সবাই সেটা চেনে। দুই ঘরে একই কোড দেখলে অন্তত
 * বোঝা যায় "নামটা এই ফন্টে আসেনি", আর পাদটীকা সেটাই বলে।
 *
 * ⚠️ কোডও ছাপা না গেলে (হওয়ার কথা নয় — কোড ASCII) `?` বসে, খালি নয়।
 */
export function personLabel(fullName: string, empCode: string): PdfText {
  const name = toPdfText(fullName);
  if (!name.lossy) return name;

  const code = toPdfText(empCode);
  return { text: code.text, lossy: true };
}

/**
 * ঘণ্টা → ছাপার লেখা।
 *
 * ⚠️ Excel-এ ঘণ্টা **সংখ্যা** হিসেবে যায় (reports.excel.ts-এর মূল নিয়ম),
 * কিন্তু PDF-এ যোগ করার বা sort করার কোনো উপায় নেই — ওটা ছবি। তাই এখানে
 * উল্টো সিদ্ধান্ত: সবসময় দুই দশমিকের **সমান-প্রস্থ লেখা**, যাতে কলামে
 * দশমিক বিন্দুগুলো এক লাইনে দাঁড়ায়।
 */
export function hoursText(hours: number): string {
  if (!Number.isFinite(hours)) return EMPTY_CELL;
  return hours.toFixed(2);
}

/**
 * লেখা কেটে ছোট করা, শেষে `...`।
 *
 * `measure` বাইরে থেকে আসে (pdfkit-এর `widthOfString`) যাতে ফাংশনটা খাঁটি
 * থাকে — নইলে এই যুক্তিটুকু পরীক্ষা করতে গোটা PDF ইঞ্জিন লাগত।
 *
 * ⚠️ না কাটলে pdfkit লেখাটা পরের কলামের **উপরে** ছেপে দিত (সে ঘরের সীমা
 * জানে না), আর দুটো সংখ্যা মিশে গিয়ে তৃতীয় একটা ভুল সংখ্যা পড়া যেত।
 */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (maxWidth <= 0) return '';
  if (measure(text) <= maxWidth) return text;

  const ellipsis = '...';
  // ⚠️ `...`-ই যদি না আঁটে তবে যতটুকু আঁটে ততটুকু কাঁচা লেখা — খালি ঘরের
  //    চেয়ে একটা আধখানা শব্দও ভালো
  if (measure(ellipsis) > maxWidth) {
    let raw = '';
    for (const ch of text) {
      if (measure(raw + ch) > maxWidth) break;
      raw += ch;
    }
    return raw;
  }

  let out = '';
  for (const ch of text) {
    if (measure(out + ch + ellipsis) > maxWidth) break;
    out += ch;
  }

  return out + ellipsis;
}

/**
 * `generated_at` (ISO/UTC) → লেটারহেডে ছাপার মতো ঢাকার সময়।
 *
 * ⚠️ `toLocaleString()` ব্যবহার করা হয়নি — ওটা সার্ভারের টাইমজোন ও ICU
 * ডেটার উপর নির্ভর করে, আর Docker-এর slim ইমেজে ICU প্রায়ই ছাঁটা থাকে।
 * তখন একই কোড এক মেশিনে ঢাকার সময় আর আরেক মেশিনে UTC ছাপত, অথচ দুটোতেই
 * পাশে লেখা থাকত "(Asia/Dhaka)"।
 */
export function dhakaStamp(instant: Date): string {
  const { year, month, day, hhmmss } = dhakaPathParts(instant);
  return `${year}-${month}-${day} ${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)} (Asia/Dhaka)`;
}

/**
 * PDF-এ ছাপা হবে না এমন সারিগুলোর কথা।
 *
 * ⭐ সীমাটা আছেই কারণ ৩৭০ দিন × ১৫ জন = ৫৫০০ সারি — ওটা ১৫০ পাতার PDF,
 * তৈরি হতে কয়েক সেকেন্ড ইভেন্ট লুপ আটকে থাকত, আর কেউ পড়তও না। কিন্তু
 * চুপচাপ কেটে দেওয়া হয় না: বাদ পড়া সারির সংখ্যা ফাইলেই লেখা থাকে, আর
 * পুরোটা পেতে হলে Excel-এর কথা বলা থাকে।
 */
export const MAX_PDF_ROWS = 2000;

export function truncationNote(total: number, shown: number): string | null {
  if (total <= shown) return null;
  return `Only the first ${shown} of ${total} rows are shown. Download the Excel (xlsx) export for the complete data.`;
}
