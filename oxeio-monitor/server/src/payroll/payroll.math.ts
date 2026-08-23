/**
 * ঘণ্টার ঘাটতিকে টাকায় রূপান্তর — খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * আলাদা ফাইলে রাখার কারণ: এটাই একমাত্র জায়গা যেখানে সিস্টেম **কারো বেতন
 * নিয়ে সিদ্ধান্ত** দেয়। ডাটাবেস বা HTTP-র সাথে মিশে থাকলে এটা নিরিবিলি
 * পরীক্ষা করা যেত না, অথচ ভুল হলে ফল সরাসরি মানুষের পকেটে পড়ে।
 */

/** টাকার হিসাব কখনো binary float-এ নয় — সব হিসাব পয়সায় (integer)। */
export const PAISA_PER_TAKA = 100;

export interface PayrollInput {
  /** মাসিক বেতন, টাকায়। */
  monthlySalary: number;
  /**
   * ওই কর্মীর ওই মাসের টার্গেট — **তার কর্মদিবস × দৈনিক টার্গেট**
   * (`prorate()` থেকে)। ⚠️ আর ফ্ল্যাট ২০৮ নয়।
   */
  targetSec: number;
  /** worked + adjustment — টার্গেটের সাথে এটাই মেলানো হয়। */
  creditedSec: number;

  /**
   * **G37 · ADR-025** — তার কর্মদিবস (d) ও মাসের কর্মদিবস (D)।
   *
   * ⚠️⚠️ **ঐচ্ছিক করা হয়নি, ইচ্ছাকৃতভাবে।** ডিফল্ট বসালে নতুন কোনো কলার
   * চুপচাপ proration ছাড়াই বেতন হিসাব করত — অর্থাৎ ১৫ তারিখে যোগ দেওয়া
   * কর্মী পুরো মাসের বেতন পেত, আর ভুলটা ধরা পড়ত মাস শেষে। `required`
   * দিলে কম্পাইলারই পাহারা দেয়।
   */
  workdays: number;
  monthWorkdays: number;
}

export interface PayrollLine {
  /** ঘণ্টাপ্রতি হার, পয়সায়। */
  hourlyRatePaisa: number;
  shortfallSec: number;
  overtimeSec: number;
  /** ঘাটতির জন্য কত টাকা কম, পয়সায়। ঘাটতি না থাকলে ০। */
  deductionPaisa: number;
  /** বেতন − কর্তন, পয়সায়। */
  payablePaisa: number;
  /**
   * ⚠️ অতিরিক্ত ঘণ্টার **টাকা হিসাব করা হয় না** — শুধু ঘণ্টাটা জানানো হয়।
   * OT-র হার কত হবে (১×, ১.৫×, নাকি কিছুই না) সেটা ব্যবসায়িক সিদ্ধান্ত,
   * আর সেটা কেউ নেয়নি। নিজে থেকে একটা হার ধরে নিলে সেটা নীরবে নীতি
   * হয়ে যেত।
   */
  overtimeNote: 'Not calculated — no rate has been decided';
}

/**
 * ⚠️ শূন্য বা ঋণাত্মক টার্গেটে ভাগ করা যায় না। এমনটা হওয়ার কথা নয়
 * (work policy-তে ২০৮ বসানো), কিন্তু হলে চুপচাপ Infinity বেরিয়ে গিয়ে
 * কারো বেতন থেকে অসীম টাকা কাটার হিসাব দাঁড়াত।
 */
export function computePayroll(input: PayrollInput): PayrollLine {
  const { monthlySalary, targetSec, creditedSec, workdays, monthWorkdays } = input;

  if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
    throw new RangeError('Salary cannot be negative or undefined');
  }
  if (!Number.isFinite(creditedSec) || creditedSec < 0) {
    throw new RangeError('Credited time cannot be negative');
  }
  if (!Number.isFinite(workdays) || workdays < 0) {
    throw new RangeError('Workdays cannot be negative or undefined');
  }
  if (!Number.isFinite(monthWorkdays) || monthWorkdays < 0) {
    throw new RangeError('The month workdays cannot be negative or undefined');
  }

  const basePaisa = Math.round(monthlySalary * PAISA_PER_TAKA);

  /**
   * ⭐⭐ **প্রযোজ্য বেতন = মাসিক × d ÷ D** — G37-এর মূল লাইন।
   *
   * ⚠️ ভাগ ও গুণ **একসাথে**, আগে ভগ্নাংশ বের করে নয়। `salaryFraction()`
   * আলাদা করে দেওয়া আছে বটে, কিন্তু টাকার হিসাবে সেটা ব্যবহার করা হয় না —
   * দুবার round করলে কারো বেতনে কয়েক পয়সার হেরফের হতো।
   *
   * ⭐ D = ০ (পুরো মাস ছুটি) → পুরো বেতন (O9)। ঘাটতি তখন অসম্ভব, কারণ
   * টার্গেটও ০।
   */
  const salaryPaisa =
    monthWorkdays <= 0
      ? basePaisa
      : Math.round((basePaisa * Math.min(workdays, monthWorkdays)) / monthWorkdays);

  /**
   * ⚠️⚠️ **টার্গেট ০ — বৈধ, কিন্তু শুধু একটা কারণেই।**
   *
   * কারো কোনো কর্মদিবসই না থাকলে (মাসের পরে যোগ দিয়েছে, বা পুরো মাস ছুটি)
   * টার্গেট ০ হওয়াই ঠিক, আর তখন ঘাটতিও অসম্ভব।
   *
   * ⚠️ কিন্তু কর্মদিবস **থাকা সত্ত্বেও** টার্গেট ০ মানে পলিসিটাই ভুল
   * বসানো — আর সেটা চুপচাপ মেনে নিলে ফল ভয়ংকর: ঘাটতি অসম্ভব, তাই কর্তনও
   * শূন্য, অর্থাৎ **কেউ এক ঘণ্টা কাজ না করেই পুরো বেতন পেত**। তাই ওই
   * অবস্থায় আগের মতোই ছোড়া হয়।
   */
  if (!Number.isFinite(targetSec) || targetSec <= 0) {
    if (workdays > 0) {
      throw new RangeError('The monthly target cannot be zero or negative');
    }

    return {
      hourlyRatePaisa: 0,
      shortfallSec: 0,
      overtimeSec: Math.max(0, creditedSec),
      deductionPaisa: 0,
      // ⚠️ কর্মদিবস ০ মানে d/D-ও ০, তাই এটা ০ — শুধু D = ০ হলে পুরো বেতন
      payablePaisa: salaryPaisa,
      overtimeNote: 'Not calculated — no rate has been decided',
    };
  }

  const targetHours = targetSec / 3600;

  // ⚠️ হার আলাদা করে round করা হয় **না** কর্তনের হিসাবে — নিচে সরাসরি
  //    salaryPaisa × ঘাটতি ÷ টার্গেট করা হয়। ১৩০০০ ÷ ২০৮ = ৬২.৫ টাকা,
  //    কিন্তু ১০০০০ ÷ ২০৮ = ৪৮.০৭৬৯…। হারটা আগে round করলে ওই ভগ্নাংশ
  //    প্রতি ঘণ্টায় গুণ হয়ে মাসের শেষে কয়েক টাকার ভুল দাঁড়াত।
  const hourlyRatePaisa = Math.round(salaryPaisa / targetHours);

  const deficitSec = Math.max(0, targetSec - creditedSec);
  const surplusSec = Math.max(0, creditedSec - targetSec);

  const deductionPaisa =
    deficitSec === 0 ? 0 : Math.round((salaryPaisa * deficitSec) / targetSec);

  return {
    hourlyRatePaisa,
    shortfallSec: deficitSec,
    overtimeSec: surplusSec,
    deductionPaisa,
    // কর্তন কখনো বেতনের বেশি হতে পারে না — কেউ পুরো মাস অনুপস্থিত থাকলে
    // deficit = target, তখন কর্তন = পুরো বেতন, প্রদেয় = ০। ঋণাত্মক নয়।
    payablePaisa: Math.max(0, salaryPaisa - deductionPaisa),
    overtimeNote: 'Not calculated — no rate has been decided',
  };
}

/** পয়সা → দেখানোর মতো টাকা (দুই দশমিক)। */
export function paisaToTaka(paisa: number): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  return `${sign}${Math.floor(abs / PAISA_PER_TAKA)}.${String(abs % PAISA_PER_TAKA).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// ⭐⭐ কোন মাসে কত বেতন ছিল — অতীত যাতে না নড়ে (২৩ আগস্ট ২০২৬)
// ════════════════════════════════════════════════════════════════════════════

/**
 * এক টুকরো **পুরোনো** বেতন — "এই মাস পর্যন্ত এটাই ছিল"।
 *
 * ⚠️ সংখ্যাটা `string`, `number` নয় — Prisma-র `Decimal` স্ট্রিং হয়ে আসে,
 *    আর মাঝপথে `Number` করলে টাকার মান নীরবে গোল হতে পারত।
 */
export interface SalarySlice {
  /** 'YYYY-MM' — এই মাস পর্যন্ত (অন্তর্ভুক্ত) */
  throughMonth: string;
  monthlySalary: string;
}

/**
 * ⭐⭐ **ওই মাসে যে বেতন সত্যিই চলছিল।**
 *
 * ⚠️⚠️ কেন দরকার: পে-রোল আগে `employees.monthly_salary` **লাইভ** পড়ত,
 * তাই কারো বেতন বাড়ালে **বন্ধ মাসের পে-রোলও বদলে যেত** — আর যে কাগজে
 * বেতন দেওয়া হয়েছিল তার সাথে আর মিলত না।
 *
 * নিয়মটা একটাই: **সবচেয়ে ছোট `throughMonth` যেটা ওই মাসের সমান বা বড়**।
 *
 * ```
 * চাওয়া হলো ২০২৬-০৭
 * সারি: [২০২৬-০৬ → ১২০০০]  [২০২৬-০৮ → ১৩০০০]
 *                            ↑ এটাই — জুলাই এর আওতায় পড়ে
 * ```
 *
 * ⚠️ কোনো সারি না মিললে **এখনকার বেতনই** ফেরত যায়। খালি টেবিল মানে
 * "বেতন কোনোদিন বদলায়নি", আর তখন এখনকার মানই সব মাসের জন্য সত্যি।
 *
 * ⚠️ `null` ফেরত মানে **বেতন বসানোই নেই** — শূন্য নয়, আর পর্দাতেও দুটো
 * আলাদা করে দেখানো হয় (`payroll.service.ts`-এর `monthlySalary`)।
 */
export function salaryForMonth(
  yearMonth: string,
  currentSalary: string | null,
  slices: readonly SalarySlice[],
): string | null {
  let best: SalarySlice | null = null;

  for (const slice of slices) {
    if (slice.throughMonth < yearMonth) continue;
    if (best === null || slice.throughMonth < best.throughMonth) best = slice;
  }

  return best === null ? currentSalary : best.monthlySalary;
}

/**
 * বেতন বদলালে **পুরোনো মানটা কোন মাস পর্যন্ত চলেছিল**।
 *
 * ⭐ সাধারণ নিয়ম: নতুন বেতন **চলতি মাস থেকে**, তাই পুরোনোটা চলেছিল
 * **আগের মাস পর্যন্ত**।
 *
 * ⚠️⚠️ ব্যতিক্রম — **চলতি মাস আগেই বন্ধ হয়ে থাকলে**। তখন ওই মাসের বেতন
 * দেওয়া হয়ে গেছে, তাই নতুন সংখ্যাটা ওখানে বসানো যাবে না; পুরোনোটা
 * **চলতি মাস পর্যন্তই** চলেছিল ধরা হয়, আর নতুনটা পরের মাস থেকে।
 * এটা না রাখলে বন্ধ মাসের পে-রোল আবার নড়ত — ঠিক যে রোগ সারাতে এই
 * টেবিলটা বানানো।
 */
export function supersededThrough(
  yearMonth: string,
  currentMonthClosed: boolean,
): string {
  if (currentMonthClosed) return yearMonth;

  const [y, m] = yearMonth.split('-').map((s) => Number.parseInt(s, 10));
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;

  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}
