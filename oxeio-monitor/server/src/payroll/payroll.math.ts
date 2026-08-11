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
  /** ওই মাসের টার্গেট — সাধারণত ২০৮ ঘণ্টা, কিন্তু পলিসি থেকেই আসে। */
  targetSec: number;
  /** worked + adjustment — টার্গেটের সাথে এটাই মেলানো হয়। */
  creditedSec: number;
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
  const { monthlySalary, targetSec, creditedSec } = input;

  if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
    throw new RangeError('Salary cannot be negative or undefined');
  }
  if (!Number.isFinite(targetSec) || targetSec <= 0) {
    throw new RangeError('The monthly target cannot be zero or negative');
  }
  if (!Number.isFinite(creditedSec) || creditedSec < 0) {
    throw new RangeError('Credited time cannot be negative');
  }

  const salaryPaisa = Math.round(monthlySalary * PAISA_PER_TAKA);
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
