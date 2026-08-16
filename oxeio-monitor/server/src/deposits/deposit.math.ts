/**
 * R21 — জামানতের খাঁটি হিসাব। কোনো I/O নেই।
 *
 * `payroll.math.ts`-এর মতোই আলাদা ফাইলে, একই কারণে: এখানকার ভুল সরাসরি
 * মানুষের পকেটে পড়ে, আর ডাটাবেসের সাথে মিশে থাকলে নিরিবিলি পরীক্ষা করা
 * যেত না।
 */

/** '2026-08' — বছর-মাস, ঢাকার ক্যালেন্ডারে। */
export type YearMonth = string;

export const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH.test(value);
}

/**
 * `2026-08` → `2026-09`।
 *
 * ⚠️ `new Date()` দিয়ে করা হয় **না** — মাসের যোগ-বিয়োগে JS-এর Date
 * সময়-অঞ্চল টেনে আনে, আর ৩১ তারিখে "পরের মাস" কখনো দুই মাস এগিয়ে যায়।
 * এখানে ব্যাপারটা নিছক দুটো সংখ্যা।
 */
export function nextMonth(ym: YearMonth): YearMonth {
  const [y, m] = ym.split('-').map(Number);
  return m === 12
    ? `${y + 1}-01`
    : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** শুরু থেকে শেষ পর্যন্ত প্রতিটা মাস, **দুই প্রান্তসহ**। */
export function monthsBetween(from: YearMonth, to: YearMonth): YearMonth[] {
  if (!isYearMonth(from) || !isYearMonth(to)) {
    throw new RangeError('Months must be in YYYY-MM format');
  }

  const out: YearMonth[] = [];
  let cursor = from;

  // ⚠️ স্ট্রিং তুলনাই যথেষ্ট — 'YYYY-MM' লেক্সিকোগ্রাফিক ক্রমে সময়ের
  //    ক্রমের সমান, কারণ দুটো ঘরই শূন্য-প্যাড করা।
  while (cursor <= to) {
    out.push(cursor);
    cursor = nextMonth(cursor);

    // ⚠️⚠️ ছাদ। `to` ভুল করে ২৩০০ সাল হলে লুপটা কয়েক হাজার বার ঘুরে
    //    মেমরি খেত — আর সেটা ধরা পড়ত সার্ভার পড়ে যাওয়ায়, ভুল ইনপুটে নয়।
    if (out.length > 600) {
      throw new RangeError('The month range is too long (over 50 years)');
    }
  }

  return out;
}

/**
 * দুটো তারিখের মধ্যে কত দিন — শেষেরটা **গোনা হয়**।
 *
 * ⚠️ ৩১ জুলাই জানিয়ে ৩০ আগস্ট শেষ দিন = ৩০ দিন, ২৯ নয়। মানুষ "৩০ দিনের
 * নোটিশ" বলতে এটাই বোঝে, আর এক দিনের হেরফেরে কারো ৫,০০০ টাকা আটকে যেত।
 */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export interface NoticeCheck {
  /** কত দিনের নোটিশ পাওয়া গেছে — দুটো তারিখের একটাও না থাকলে `null` */
  daysGiven: number | null;
  /** নিয়ম কত দিনের */
  daysRule: number;
  /**
   * নিয়ম অনুযায়ী ফেরত পাওয়ার কথা কি না।
   *
   * ⚠️ এটাই **শেষ কথা নয়** — সিদ্ধান্তটা মালিকের (ADR-028)। এই মানটা শুধু
   * পর্দায় "নিয়ম কী বলে" দেখানোর জন্য, আর ডিফল্ট বোতামটা কোনটা হবে তা
   * ঠিক করতে।
   */
  meetsRule: boolean;
}

/**
 * ⚠️ তারিখ না জানা থাকলে `meetsRule` **false** — "জানি না"-কে "হ্যাঁ" ধরে
 * নেওয়া মানে নীরবে নিয়মটা মাফ করে দেওয়া। মালিক তবু ফেরত দিতে পারবেন,
 * কিন্তু সেটা তখন তাঁর সজ্ঞান সিদ্ধান্ত।
 */
export function checkNotice(
  noticeGivenOn: Date | null,
  lastWorkingDay: Date | null,
  daysRule: number,
): NoticeCheck {
  if (!noticeGivenOn || !lastWorkingDay) {
    return { daysGiven: null, daysRule, meetsRule: false };
  }

  const daysGiven = daysBetween(noticeGivenOn, lastWorkingDay);
  return { daysGiven, daysRule, meetsRule: daysGiven >= daysRule };
}

/**
 * ⭐⭐ **এই কর্মীর জামানত কোন মাস থেকে কাটা শুরু** — একটাই সংজ্ঞা।
 *
 * ⚠️⚠️ প্রথমে এটা **দুই জায়গায় লেখা ছিল** — `ensureLedger()` খাতা ভরার
 * সময় একবার, আর `balances()` পর্দায় দেখানোর সময় আরেকবার। দুটো আলাদা হয়ে
 * গেলে পর্দা এক মাস দেখাত আর খাতায় বসত অন্যটা, আর পার্থক্যটা কেউ ধরতে
 * পারত না — কারণ দুটোই "ঠিক" দেখাত, শুধু একে অন্যের সাথে মিলত না।
 *
 * ⚠️ ক্রমটাই নিয়ম:
 *   ১· মালিকের বেছে দেওয়া মাস থাকলে **সেটাই চূড়ান্ত** — `joined_on`-এর
 *      উপরেও। ওটা অনুমান, আর এটা বিবৃতি।
 *   ২· নইলে যোগদানের মাস আর নিয়মের মাসের মধ্যে যেটা **পরে**।
 */
export function effectiveDepositStart(input: {
  /** মালিকের বেছে দেওয়া, না দিলে `null` */
  override: string | null;
  /** `joined_on`-এর মাস, না জানলে `null` */
  joinedMonth: string | null;
  /** নিয়মের সাধারণ শুরুর মাস */
  policyStart: string;
}): string {
  if (input.override) return input.override;

  const joined = input.joinedMonth ?? input.policyStart;
  return joined > input.policyStart ? joined : input.policyStart;
}
