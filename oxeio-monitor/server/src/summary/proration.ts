import { countLeaveWorkdays, countWorkdays } from './summary.math';

/**
 * **G37 · ADR-025** — মাঝপথে যোগ দিলে বা চলে গেলে টার্গেট ও বেতন কতটা।
 *
 * ⭐ **কেন আলাদা ফাইল:** এটাই একমাত্র জায়গা যেখানে ঠিক হয় কারো ওই মাসে
 * *কতটা* প্রাপ্য। ভুল হলে ফল সরাসরি মানুষের পকেটে পড়ে, আর ভুলটা ধরা পড়ে
 * মাস শেষে — তাই DB বা HTTP-র কিছুই এখানে ঢুকতে দেওয়া হয়নি।
 *
 * নিয়মটা (ADR-025):
 *
 * ```
 * D = ওই মাসের কর্মদিবস      (সাপ্তাহিক ছুটি ও holidays বাদে)
 * d = তার নিজের কর্মদিবস      (joined_on … left_on-এর ভেতরে যতগুলো পড়ে)
 *
 * দৈনিক টার্গেট = monthly_target ÷ policy_workdays   (২০৮ ÷ ২৬ = ৮ ঘণ্টা)
 * টার্গেট       = d × দৈনিক টার্গেট
 * প্রযোজ্য বেতন  = মাসিক বেতন × d ÷ D
 * ```
 *
 * ⚠️⚠️ **বেতন আর টার্গেট — দুটোই একসাথে prorate করতে হয়।** শুধু টার্গেট
 * করলে ঘণ্টার হার দ্বিগুণ হয়ে যেত: ১৩ কর্মদিবস × ৮ = ১০৪ঘ, বেতন ২০,০০০ →
 * ১৯২ টাকা/ঘণ্টা (হওয়ার কথা ৯৬)। দুটোই করলে হার = (S·d/D) ÷ (d×৮) =
 * **S ÷ (D×৮)** — অর্থাৎ ১৫ তারিখে যোগ দেওয়া আর পুরো মাস থাকা, দুজনের
 * ঘণ্টাপ্রতি হার হুবহু এক। এই সমতাটাই পুরো নিয়মের ভিত্তি।
 */
export interface ProrationInput {
  /** মাসের প্রথম ও শেষ দিন (`monthBounds()` থেকে) */
  monthStart: Date;
  monthEnd: Date;

  /** কর্মীর যোগদান — `null` = মাস শুরুর আগে থেকেই আছে */
  joinedOn: Date | null;
  /** কর্মীর শেষ দিন — `null` = এখনো আছে */
  leftOn: Date | null;

  /** ISO দিন (শুক্র = ৫), `null` = প্রতিটি দিনই কর্মদিবস */
  weeklyOffDay: number | null;
  /** ওই মাসের ছুটির দিনগুলো, `getTime()` মিলিয়ে */
  holidays: ReadonlySet<number>;

  /**
   * ⭐⭐ R2 — **ওই কর্মীর ছুটির দিনগুলো** (`getTime()`), সংস্থার ছুটি নয়।
   *
   * ⚠️⚠️ `holidays`-এর সাথে **মেশানো হয়নি**, আর সেটাই এখানকার মূল সিদ্ধান্ত।
   *    `holidays` দিয়ে **D** গোনা হয়, আর D হলো পে-রোলের `d ÷ D`-এর হর —
   *    সবার জন্য এক। একজনের ছুটি ওখানে ঢুকলে **তার ছুটির কারণে গোটা দলের
   *    হর বদলে যেত**।
   *
   * ⭐ ছুটি কমায় কেবল **ঘণ্টার টার্গেট**, লব **d নয়** — অর্থাৎ **সবেতন**।
   *    d কমালে ছুটি নেওয়া মানেই নীরবে বেতন কাটা হতো।
   */
  leaveDates?: ReadonlySet<number>;

  /** পলিসির মাসিক টার্গেট, সেকেন্ডে (২০৮ ঘণ্টা) */
  monthlyTargetSec: number;
  /**
   * পলিসির `expected_workdays` কলাম (২৬)।
   *
   * ⚠️⚠️ **"৮ ঘণ্টা" কোথাও হার্ডকোড করা হয়নি** — এই দুটো কলাম ভাগ করেই
   * বেরোয়। এখন ঠিক ৮ আসে; ভবিষ্যতে চুক্তি বদলে ২৪০ঘ ÷ ২৬ হলে নিয়মটাও
   * সাথে বদলাবে, কোনো migration ছাড়াই।
   */
  policyWorkdays: number;
}

export interface Proration {
  /** D — ওই মাসের মোট কর্মদিবস */
  monthWorkdays: number;
  /** d — তার নিজের কর্মদিবস */
  employeeWorkdays: number;
  /** এক কর্মদিবসের টার্গেট, সেকেন্ডে (round করা হয়নি — নিচের নোট) */
  dailyTargetSec: number;
  /**
   * ⭐ R2 — d-এর মধ্যে যতগুলো দিন সে ছুটিতে ছিল।
   * ⚠️ কেবল **কর্মদিবসে পড়া** ছুটি — শুক্রবারে বা সরকারি ছুটিতে কেউ
   *    "ছুটি" লিখলেও সেদিন এমনিতেই টার্গেট ছিল না।
   */
  leaveWorkdays: number;
  /** (d − ছুটি) × দৈনিক টার্গেট — `monthly_summary.target_sec`-এ যাবে */
  targetSec: number;
  /** ⭐ পুরো মাস আছে কি না। `false` হলে ওয়েবে "prorated" লেখা দেখানো হয় */
  partial: boolean;
}

/**
 * ⚠️ `Date` তুলনা `getTime()` দিয়ে — Prisma-র `@db.Date` সবসময় UTC-মধ্যরাত
 * দেয়, আর `monthBounds()`-ও তাই।
 */
function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function earlierOf(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * ⭐ মূল হিসাব।
 *
 * ⚠️ `dailyTargetSec` **round করা হয় না**। ২৬ দিনে ৭৪৮৮০০ ÷ ২৬ = ২৮৮০০
 * পুরোপুরি মেলে, কিন্তু অন্য পলিসিতে ভগ্নাংশ আসতে পারে। প্রতিদিন round
 * করে গুণ করলে মাসের শেষে টার্গেট আসল সংখ্যায় গিয়ে ঠেকত না — অর্থাৎ কেউ
 * ঠিক টার্গেট ছুঁয়েও কাগজে ঘাটতি দেখত। round শুধু একদম শেষে।
 */
export function prorate(input: ProrationInput): Proration {
  const {
    monthStart,
    monthEnd,
    joinedOn,
    leftOn,
    weeklyOffDay,
    holidays,
    monthlyTargetSec,
    policyWorkdays,
    leaveDates,
  } = input;

  if (!Number.isFinite(monthlyTargetSec) || monthlyTargetSec < 0) {
    throw new RangeError('The monthly target cannot be negative or undefined');
  }
  if (!Number.isFinite(policyWorkdays) || policyWorkdays <= 0) {
    throw new RangeError('The policy workdays cannot be zero or negative');
  }

  const monthWorkdays = countWorkdays(monthStart, monthEnd, weeklyOffDay, holidays);

  // কর্মকালের সাথে মাসের ছেদ
  const from = joinedOn === null ? monthStart : laterOf(joinedOn, monthStart);
  const to = leftOn === null ? monthEnd : earlierOf(leftOn, monthEnd);

  /**
   * ⚠️ ছেদটা **খালিও** হতে পারে — মাসের পরে যোগ দিয়েছে, বা আগেই চলে গেছে।
   * তখন `countWorkdays` উল্টো রেঞ্জ পেত (`from > to`) আর লুপটা এমনিতেই
   * শূন্য ফেরাত; তবু এখানে স্পষ্ট করে আটকানো হয়েছে, কারণ "শূন্য কারণ
   * লুপ চলেনি" আর "শূন্য কারণ সে ওই মাসে ছিল না" — পড়ে বোঝার মতো
   * দুটো আলাদা কথা।
   */
  const employeeWorkdays =
    from.getTime() > to.getTime()
      ? 0
      : countWorkdays(from, to, weeklyOffDay, holidays);

  const dailyTargetSec = monthlyTargetSec / policyWorkdays;

  /**
   * ⭐ R2 — কর্মকালের ভেতরে, **কর্মদিবসে পড়া** ছুটির দিন কটা।
   *
   * ⚠️ `isWorkday` দিয়ে ছেঁকে নেওয়া হয়, নইলে শুক্রবারে লেখা একটা ছুটি
   *    টার্গেট থেকে আট ঘণ্টা কেটে নিত — অথচ ওই দিনে কোনো টার্গেটই ছিল না।
   *    ব্যর্থতাটা হতো নীরব: সংখ্যা কমত, কারণ কেউ খুঁজে পেত না।
   */
  const leaveWorkdays = countLeaveWorkdays(
    leaveDates,
    from,
    to,
    weeklyOffDay,
    holidays,
  );

  const billableWorkdays = Math.max(0, employeeWorkdays - leaveWorkdays);

  return {
    monthWorkdays,
    employeeWorkdays,
    leaveWorkdays,
    dailyTargetSec,
    targetSec: Math.round(billableWorkdays * dailyTargetSec),
    partial: employeeWorkdays < monthWorkdays,
  };
}

/**
 * বেতনের ভগ্নাংশ — **পয়সায় গুণ করার জন্য**, আলাদা করে নয়।
 *
 * ⚠️⚠️ এখানে ভগ্নাংশটা `number` হিসেবে ফেরে বলে **এটা দিয়ে সরাসরি টাকা
 * হিসাব করা যাবে না** — `computePayroll()` d ও D নিয়ে নিজেই একবারে গুণ ও
 * round করে। দুই জায়গায় দুবার round করলে কারো বেতনে কয়েক পয়সার হেরফের
 * হতো, আর সেটা মাস শেষে মেলাতে গিয়ে ধরা পড়ত।
 *
 * ⭐ **D = ০ হলে ১** — পুরো মাসটাই ছুটি (ঈদ + সরকারি ছুটি একসাথে পড়লে
 * সম্ভব)। তখন কারো কোনো কর্মদিবসই নেই, অর্থাৎ ঘাটতিও অসম্ভব — মালিকের
 * সিদ্ধান্ত (O9): **পুরো বেতন**। ০/০-কে ০ ধরলে সবাই ওই মাসে বিনা দোষে
 * শূন্য বেতন পেত।
 */
export function salaryFraction(employeeWorkdays: number, monthWorkdays: number): number {
  if (monthWorkdays <= 0) return 1;
  if (employeeWorkdays <= 0) return 0;
  return Math.min(1, employeeWorkdays / monthWorkdays);
}
