/**
 * **R26 — মাস বন্ধ হলে রিপোর্ট নিজে থেকে পাঠানো**, তার খাঁটি নিয়মগুলো।
 *
 * ⭐ আলাদা ফাইল, কারণ এখানকার ভুলগুলো নীরব: ভুল তারিখের রেঞ্জ মানে ভুল
 * মাসের সংখ্যা পাঠানো, আর সেটা পড়ে কেউ ধরতে পারবে না — ফাইলটা দেখতে
 * নিখুঁতই লাগবে। তাই সিদ্ধান্তটুকু I/O ছাড়া, টেস্টসহ।
 */

/**
 * `'2026-07'` → ওই মাসের প্রথম ও শেষ দিন।
 *
 * ⚠️⚠️ শেষ দিনটা **গোনা হয়**, ৩০/৩১ ধরে নেওয়া হয় না — ফেব্রুয়ারিতে
 * (আর অধিবর্ষে) ধরে নেওয়া সংখ্যা দু-দিন পর্যন্ত ভুল হতো, আর ওই দু-দিনের
 * ঘণ্টা রিপোর্ট থেকে নীরবে বাদ পড়ত।
 *
 * ⭐ `Date.UTC(y, m, 0)` — পরের মাসের "০ তারিখ" মানে চলতি মাসের শেষ দিন।
 */
export function monthRange(yearMonth: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) throw new RangeError(`Not a month: ${yearMonth}`);

  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new RangeError(`Not a month: ${yearMonth}`);

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    from: `${yearMonth}-01`,
    to: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

export interface MonthCaptionInput {
  orgName: string;
  yearMonth: string;
  /** রিপোর্টে কতজন কর্মী আছেন */
  people: number;
  /** সবার মোট গোনা ঘণ্টা */
  totalHours: number;
}

/**
 * টেলিগ্রামে ফাইলের সাথে যে এক-দুই লাইন যায়।
 *
 * ⚠️⚠️ **কোনো কর্মীর নাম এখানে নেই, ইচ্ছাকৃতভাবে।** বার্তা টেলিগ্রামের
 * সার্ভারে জমে থাকে আর ওই চ্যাটে কে আছে সেটা সময়ের সাথে বদলায় — তাই
 * ক্যাপশনে কেবল **যোগফল**। নাম-ধরে-ধরে হিসাবটা সংযুক্ত ফাইলে, আর ফাইলটা
 * খুলতে হলে ইচ্ছে করে নামাতে হয় (`ops.rules.ts`-এর allowlist-এর একই যুক্তি)।
 *
 * ⚠️ কোনো Markdown/HTML নয় — প্রতিষ্ঠানের নামে একটা `_` থাকলেই গোটা কলটা
 *    ৪০০ হয়ে যেত।
 */
export function monthCaption(input: MonthCaptionInput): string {
  const hours = Math.round(input.totalHours);

  return (
    `${input.orgName} — ${input.yearMonth} is closed.\n` +
    `${input.people} staff · ${hours} hours counted.\n` +
    `Full sheet attached. Figures are locked for this month.`
  );
}

/**
 * ⭐ ফাইলের নাম — ASCII, তারিখসহ, যাতে চ্যাটে পাশাপাশি কয়েকটা মাস থাকলেও
 * কোনটা কোনটা এক নজরে বোঝা যায়।
 *
 * ⚠️ `reportFilename()`-এর ফরম্যাটটাই (`oxeio-<report>-<from>_<to>.<ext>`)
 *    ব্যবহার করা হয় — দুই জায়গায় দু-রকম নাম হলে সাপোর্টে "কোন ফাইলটা"
 *    প্রশ্নের উত্তর দেওয়া কঠিন হতো।
 */
export function monthReportName(yearMonth: string, ext: 'xlsx' | 'pdf'): string {
  const { from, to } = monthRange(yearMonth);
  return `oxeio-summary-${from}_${to}.${ext}`;
}
