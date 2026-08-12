import { describe, expect, it } from 'vitest';

import { prorate, salaryFraction, type ProrationInput } from '../src/summary/proration';

/**
 * **G37 · ADR-025** — মাঝপথে যোগ দিলে টার্গেট ও বেতন।
 *
 * ⭐ এই ফাইলের সবচেয়ে জরুরি টেস্টটা কোনো একটা সংখ্যার নয়, একটা
 * **সমতার**: ১৫ তারিখে যোগ দেওয়া আর পুরো মাস থাকা — দুজনের ঘণ্টাপ্রতি
 * হার হুবহু এক হতে হবে। ওটা ভাঙলে বাকি সব সংখ্যা ঠিক থেকেও নিয়মটা অন্যায্য
 * হয়ে যেত, আর কেউ টের পেত না।
 */
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** সেপ্টেম্বর ২০২৬ — শুক্রবার ৪, ১১, ১৮, ২৫; ছুটি ছাড়া ২৬ কর্মদিবস */
const SEPT: ProrationInput = {
  monthStart: d(2026, 9, 1),
  monthEnd: d(2026, 9, 30),
  joinedOn: null,
  leftOn: null,
  weeklyOffDay: 5, // শুক্রবার (O11)
  holidays: new Set<number>(),
  monthlyTargetSec: 208 * 3600,
  policyWorkdays: 26,
};

const HOURS = 3600;

describe('prorate — কর্মদিবস গোনা', () => {
  it('পুরো মাস থাকলে d = D', () => {
    const r = prorate(SEPT);

    expect(r.monthWorkdays).toBe(26);
    expect(r.employeeWorkdays).toBe(26);
    expect(r.partial).toBe(false);
  });

  /** ⭐ মালিকের নিজের উদাহরণ: "১৫ তারিখ join করলে ১৫ দিনের salary" */
  it('১৫ সেপ্টেম্বর যোগ দিলে তার কর্মদিবস ১৪', () => {
    const r = prorate({ ...SEPT, joinedOn: d(2026, 9, 15) });

    expect(r.employeeWorkdays).toBe(14);
    expect(r.partial).toBe(true);
  });

  it('মাসের মাঝে চলে গেলেও একই ভাবে গোনা হয়', () => {
    const r = prorate({ ...SEPT, leftOn: d(2026, 9, 14) });

    // ১–১৪ সেপ্টেম্বর, শুক্রবার ৪ ও ১১ বাদে = ১২
    expect(r.employeeWorkdays).toBe(12);
  });

  /**
   * ⚠️ যোগদান মাসের **আগে** হলে সেটা মাস শুরুর তারিখেই আটকে যায় — নইলে
   * `countWorkdays` আগের মাসগুলোও গুনে ফেলত, আর টার্গেট আকাশে উঠত।
   */
  it('আগের মাসে যোগ দেওয়া মানে পুরো মাস', () => {
    const r = prorate({ ...SEPT, joinedOn: d(2020, 1, 1) });
    expect(r.employeeWorkdays).toBe(26);
  });

  it('মাসের পরে যোগ দিলে ওই মাসে তার কিছুই নেই', () => {
    const r = prorate({ ...SEPT, joinedOn: d(2026, 10, 1) });

    expect(r.employeeWorkdays).toBe(0);
    expect(r.targetSec).toBe(0);
  });

  it('মাসের আগেই চলে গেলে একই', () => {
    const r = prorate({ ...SEPT, leftOn: d(2026, 8, 31) });
    expect(r.employeeWorkdays).toBe(0);
  });

  /** ⚠️ যোগ দিয়ে সেই মাসেই চলে যাওয়া — দুই প্রান্তই একসাথে খাটে */
  it('একই মাসে যোগ দিয়ে চলে গেলে মাঝের অংশটুকুই', () => {
    const r = prorate({
      ...SEPT,
      joinedOn: d(2026, 9, 7),
      leftOn: d(2026, 9, 10),
    });

    // ৭, ৮, ৯, ১০ — কোনো শুক্রবার নেই
    expect(r.employeeWorkdays).toBe(4);
  });

  it('ছুটির দিন কর্মদিবস থেকে বাদ যায়', () => {
    const r = prorate({
      ...SEPT,
      holidays: new Set([d(2026, 9, 1).getTime(), d(2026, 9, 2).getTime()]),
    });

    expect(r.monthWorkdays).toBe(24);
    expect(r.employeeWorkdays).toBe(24);
  });
});

describe('prorate — টার্গেট', () => {
  it('পুরো মাসে টার্গেট = কর্মদিবস × ৮ ঘণ্টা, ২০৮ নয়', () => {
    // ⚠️ সেপ্টেম্বরে ২৬ কর্মদিবস, তাই এখানে ঠিক ২০৮ই আসে — কিন্তু
    //    আগস্টে ২৭ দিন, অর্থাৎ ২১৬ঘ। ফ্ল্যাট ২০৮ আর নেই।
    expect(prorate(SEPT).targetSec).toBe(208 * HOURS);
  });

  it('আগস্টে ২৭ কর্মদিবস — টার্গেট ২১৬ ঘণ্টা', () => {
    const r = prorate({
      ...SEPT,
      monthStart: d(2026, 8, 1),
      monthEnd: d(2026, 8, 31),
    });

    expect(r.monthWorkdays).toBe(27);
    expect(r.targetSec).toBe(216 * HOURS);
  });

  it('১৫ তারিখে যোগ দিলে টার্গেট ১৪ × ৮ = ১১২ ঘণ্টা', () => {
    expect(prorate({ ...SEPT, joinedOn: d(2026, 9, 15) }).targetSec).toBe(112 * HOURS);
  });

  /**
   * ⚠️⚠️ "৮ ঘণ্টা" হার্ডকোড **নয়** — পলিসির দুটো কলাম ভাগ করে বেরোয়।
   * চুক্তি বদলে ২৬০ঘ ÷ ২৬ হলে দৈনিক ১০ ঘণ্টা, আর কোনো migration লাগে না।
   */
  it('দৈনিক টার্গেট পলিসি থেকেই আসে, হার্ডকোড নয়', () => {
    const r = prorate({ ...SEPT, monthlyTargetSec: 260 * HOURS, policyWorkdays: 26 });

    expect(r.dailyTargetSec).toBe(10 * HOURS);
    expect(r.targetSec).toBe(260 * HOURS);
  });

  it('পলিসির কর্মদিবস শূন্য বা ঋণাত্মক হলে ছোড়ে', () => {
    expect(() => prorate({ ...SEPT, policyWorkdays: 0 })).toThrow(RangeError);
    expect(() => prorate({ ...SEPT, monthlyTargetSec: -1 })).toThrow(RangeError);
  });
});

describe('salaryFraction — বেতনের ভগ্নাংশ', () => {
  it('পুরো মাস থাকলে পুরো বেতন', () => {
    expect(salaryFraction(26, 26)).toBe(1);
  });

  it('অর্ধেক কর্মদিবসে অর্ধেক', () => {
    expect(salaryFraction(13, 26)).toBe(0.5);
  });

  it('ওই মাসে না থাকলে শূন্য', () => {
    expect(salaryFraction(0, 26)).toBe(0);
  });

  /**
   * ⭐⭐ **O9 — পুরো মাসটাই ছুটি (D = ০)।** ঈদ আর সরকারি ছুটি একসাথে
   * পড়লে সম্ভব। তখন কারো কোনো কর্মদিবসই নেই, অর্থাৎ ঘাটতিও অসম্ভব —
   * মালিকের সিদ্ধান্ত: **পুরো বেতন**। ০/০-কে ০ ধরলে সবাই বিনা দোষে ওই
   * মাসে শূন্য বেতন পেত।
   */
  it('পুরো মাস ছুটি হলে পুরো বেতন, শূন্য নয়', () => {
    expect(salaryFraction(0, 0)).toBe(1);
  });

  /** ⚠️ ১-এর বেশি কখনো নয় — ডেটা এলোমেলো হলেও কেউ বাড়তি বেতন পাবে না */
  it('কখনো ১-এর বেশি নয়', () => {
    expect(salaryFraction(30, 26)).toBe(1);
  });
});

/**
 * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।**
 *
 * ADR-025-এর পুরো যুক্তিটাই এই সমতার উপর দাঁড়ানো: বেতন ও টার্গেট **দুটোই**
 * prorate করলে ঘণ্টাপ্রতি হার = (S·d/D) ÷ (d×৮) = **S ÷ (D×৮)** — d
 * কেটে যায়। অর্থাৎ কে কবে যোগ দিল তাতে হার বদলায় না।
 *
 * ⚠️ শুধু টার্গেট prorate করলে ১৫ তারিখে যোগ দেওয়া কর্মীর হার **দ্বিগুণ**
 * হয়ে যেত, আর সেটা কোনো একক সংখ্যা দেখে ধরা পড়ত না।
 */
describe('⭐ ঘণ্টাপ্রতি হার সবার এক — যেদিনই যোগ দিক', () => {
  const salary = 20000;

  const rateOf = (joinedOn: Date | null): number => {
    const r = prorate({ ...SEPT, joinedOn });
    const paid = salary * salaryFraction(r.employeeWorkdays, r.monthWorkdays);
    return paid / (r.targetSec / HOURS);
  };

  it('পুরো মাস, ১৫ তারিখ, ২৪ তারিখ — তিনজনেরই একই হার', () => {
    const full = rateOf(null);

    expect(rateOf(d(2026, 9, 15))).toBeCloseTo(full, 10);
    expect(rateOf(d(2026, 9, 24))).toBeCloseTo(full, 10);
  });

  it('হারটা S ÷ (D × দৈনিক ঘণ্টা)', () => {
    // ২০০০০ ÷ (২৬ × ৮) = ৯৬.১৫…
    expect(rateOf(null)).toBeCloseTo(20000 / (26 * 8), 10);
  });
});
