import { describe, expect, it } from 'vitest';

import {
  computePayroll,
  paisaToTaka,
  salaryForMonth,
  supersededThrough,
} from '../src/payroll/payroll.math';

/** ২০৮ ঘণ্টা, সেকেন্ডে */
const TARGET = 208 * 3600;

describe('payroll — ঘাটতিকে টাকায় রূপান্তর', () => {
  it('টার্গেট পূরণ হলে কিছুই কাটা যায় না', () => {
    const line = computePayroll({
      monthlySalary: 13000,
      targetSec: TARGET,
      creditedSec: TARGET,
      // ⚠️ পুরো মাস — G37-এর proration এখানে কিছু বদলায় না
      workdays: 26,
      monthWorkdays: 26,
    });

    expect(line.shortfallSec).toBe(0);
    expect(line.deductionPaisa).toBe(0);
    expect(paisaToTaka(line.payablePaisa)).toBe('13000.00');
  });

  it('টার্গেটের বেশি কাজ করলেও কাটা যায় না, আর OT-র টাকা হিসাব হয় না', () => {
    const line = computePayroll({
      monthlySalary: 13000,
      targetSec: TARGET,
      creditedSec: TARGET + 10 * 3600,
      // ⚠️ পুরো মাস — G37-এর proration এখানে কিছু বদলায় না
      workdays: 26,
      monthWorkdays: 26,
    });

    expect(line.deductionPaisa).toBe(0);
    expect(line.overtimeSec).toBe(10 * 3600);
    expect(paisaToTaka(line.payablePaisa)).toBe('13000.00');
  });

  it('ঠিক ভাগ যায় এমন বেতনে হিসাব মিলিয়ে দেখা', () => {
    // ১৩০০০ ÷ ২০৮ = ৬২.৫০ টাকা/ঘণ্টা। ২০ ঘণ্টা ঘাটতি = ১২৫০ টাকা।
    const line = computePayroll({
      monthlySalary: 13000,
      targetSec: TARGET,
      creditedSec: TARGET - 20 * 3600,
      // ⚠️ পুরো মাস — G37-এর proration এখানে কিছু বদলায় না
      workdays: 26,
      monthWorkdays: 26,
    });

    expect(paisaToTaka(line.hourlyRatePaisa)).toBe('62.50');
    expect(paisaToTaka(line.deductionPaisa)).toBe('1250.00');
    expect(paisaToTaka(line.payablePaisa)).toBe('11750.00');
  });

  /**
   * ⭐ এই টেস্টটাই সবচেয়ে দরকারি। ১০০০০ ÷ ২০৮ = ৪৮.০৭৬৯… — ভাগ যায় না।
   * হারটা আগে পয়সায় round করে (৪৮০৮) তারপর ঘণ্টা দিয়ে গুণ করলে
   * ২০ ঘণ্টায় ৯৬১.৬০ আসত, অথচ সঠিক ৯৬১.৫৪। মাসে ছয় পয়সা সামান্য শোনায়,
   * কিন্তু ভুলটা সবসময় একই দিকে ঝোঁকে — কর্মীর বিপক্ষে।
   */
  it('ভাগ না যাওয়া বেতনে হার আগে round করা হয় না', () => {
    const line = computePayroll({
      monthlySalary: 10000,
      targetSec: TARGET,
      creditedSec: TARGET - 20 * 3600,
      // ⚠️ পুরো মাস — G37-এর proration এখানে কিছু বদলায় না
      workdays: 26,
      monthWorkdays: 26,
    });

    expect(paisaToTaka(line.deductionPaisa)).toBe('961.54');

    const naive = Math.round((Math.round(1000000 / 208) * 20) / 1);
    expect(paisaToTaka(naive)).toBe('961.60'); // যা হতো
  });

  it('পুরো মাস অনুপস্থিত থাকলে প্রদেয় শূন্য, ঋণাত্মক নয়', () => {
    const line = computePayroll({
      monthlySalary: 15000,
      targetSec: TARGET,
      creditedSec: 0,
      // ⚠️ পুরো মাস — G37-এর proration এখানে কিছু বদলায় না
      workdays: 26,
      monthWorkdays: 26,
    });

    expect(paisaToTaka(line.deductionPaisa)).toBe('15000.00');
    expect(line.payablePaisa).toBe(0);
  });

  /**
   * ⚠️⚠️ **কর্মদিবস থাকা সত্ত্বেও টার্গেট শূন্য = পলিসি ভুল বসানো।**
   * মেনে নিলে ঘাটতি অসম্ভব হতো, কর্তনও শূন্য — অর্থাৎ কেউ এক ঘণ্টা কাজ
   * না করেই পুরো বেতন পেত। G37-এর পরেও এই শর্তটা রাখা হয়েছে।
   */
  it('কর্মদিবস আছে অথচ টার্গেট শূন্য — নাকচ', () => {
    expect(() =>
      computePayroll({
        monthlySalary: 13000,
        targetSec: 0,
        creditedSec: 0,
        workdays: 26,
        monthWorkdays: 26,
      }),
    ).toThrow(RangeError);
  });

  it('ঋণাত্মক বেতন নাকচ হয়', () => {
    expect(() =>
      computePayroll({
        monthlySalary: -1,
        targetSec: TARGET,
        creditedSec: 0,
        workdays: 26,
        monthWorkdays: 26,
      }),
    ).toThrow(RangeError);
  });

  // ── G37 · ADR-025 — মাঝপথে যোগ দিলে ──────────────────────────────────

  describe('G37 — proration', () => {
    /** ১৫ তারিখে যোগ: d = ১৪, D = ২৬, টার্গেট ১৪ × ৮ = ১১২ঘ */
    const HALF = {
      monthlySalary: 20000,
      targetSec: 112 * 3600,
      workdays: 14,
      monthWorkdays: 26,
    };

    it('বেতনও prorate হয় — d ÷ D', () => {
      const line = computePayroll({ ...HALF, creditedSec: 112 * 3600 });

      // ২০০০০ × ১৪ ÷ ২৬ = ১০,৭৬৯.২৩
      expect(line.payablePaisa).toBe(Math.round((2000000 * 14) / 26));
      expect(line.deductionPaisa).toBe(0);
    });

    /**
     * ⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।** বেতন ও টার্গেট দুটোই prorate
     * করলে ঘণ্টাপ্রতি হার d-নিরপেক্ষ হয়ে যায় — S ÷ (D × ৮)। শুধু টার্গেট
     * prorate করলে এই হার দ্বিগুণ হতো, আর কোনো একক সংখ্যা দেখে সেটা ধরা
     * পড়ত না।
     */
    it('ঘণ্টাপ্রতি হার পুরো-মাসের কর্মীর সমান', () => {
      const partial = computePayroll({ ...HALF, creditedSec: 0 });
      const full = computePayroll({
        monthlySalary: 20000,
        targetSec: 208 * 3600,
        creditedSec: 0,
        workdays: 26,
        monthWorkdays: 26,
      });

      expect(partial.hourlyRatePaisa).toBe(full.hourlyRatePaisa);
    });

    it('অর্ধেক মাসে অর্ধেক কাজ করলে prorated বেতনের অর্ধেক কাটে', () => {
      const line = computePayroll({ ...HALF, creditedSec: 56 * 3600 });

      const prorated = Math.round((2000000 * 14) / 26);
      expect(line.deductionPaisa).toBe(Math.round(prorated / 2));
    });

    /** ⚠️ ওই মাসে ছিলই না — টার্গেট ০, বেতনও ০, আর কোনো ছোড়াছুড়ি নয় */
    it('মাসে একদিনও না থাকলে সবই শূন্য', () => {
      const line = computePayroll({
        monthlySalary: 20000,
        targetSec: 0,
        creditedSec: 0,
        workdays: 0,
        monthWorkdays: 26,
      });

      expect(line.payablePaisa).toBe(0);
      expect(line.deductionPaisa).toBe(0);
      expect(line.shortfallSec).toBe(0);
    });

    /**
     * ⭐ **O9 — পুরো মাসটাই ছুটি (D = ০)।** কারো কর্মদিবস নেই, ঘাটতিও
     * অসম্ভব — মালিকের সিদ্ধান্ত: পুরো বেতন।
     */
    it('পুরো মাস ছুটি হলে পুরো বেতন', () => {
      const line = computePayroll({
        monthlySalary: 20000,
        targetSec: 0,
        creditedSec: 0,
        workdays: 0,
        monthWorkdays: 0,
      });

      expect(line.payablePaisa).toBe(2000000);
    });

    /** ⚠️ টার্গেটের বেশি কাজ করলেও prorated বেতনই সর্বোচ্চ (ADR-023) */
    it('টার্গেটের বেশি কাজেও বাড়তি টাকা নয়', () => {
      const line = computePayroll({ ...HALF, creditedSec: 200 * 3600 });

      expect(line.payablePaisa).toBe(Math.round((2000000 * 14) / 26));
      expect(line.overtimeSec).toBe(88 * 3600);
    });
  });

  it('পয়সা থেকে টাকায় রূপান্তর দশমিক ঠিক রাখে', () => {
    expect(paisaToTaka(0)).toBe('0.00');
    expect(paisaToTaka(5)).toBe('0.05');
    expect(paisaToTaka(100)).toBe('1.00');
    expect(paisaToTaka(123456)).toBe('1234.56');
  });

  it('অফিসের বারো জনের কারো হিসাবেই ঋণাত্মক প্রদেয় আসে না', () => {
    const salaries = [13000, 10000, 15000, 14000, 13000, 10000, 14000, 10000, 10000, 10000, 10000, 10000];

    for (const salary of salaries) {
      for (const workedHours of [0, 50, 100, 207, 208, 250]) {
        const line = computePayroll({
          monthlySalary: salary,
          targetSec: TARGET,
          creditedSec: workedHours * 3600,
          // ⚠️ পুরো মাস — G37-এর proration এখানে কিছু বদলায় না
          workdays: 26,
          monthWorkdays: 26,
        });

        expect(line.payablePaisa).toBeGreaterThanOrEqual(0);
        expect(line.payablePaisa).toBeLessThanOrEqual(salary * 100);
        expect(line.deductionPaisa + line.payablePaisa).toBe(salary * 100);
      }
    }
  });
});

/**
 * ⭐⭐ **অতীতের বেতন যাতে না নড়ে** *(২৩ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ আগে পে-রোল `employees.monthly_salary` **লাইভ** পড়ত, তাই কারো বেতন
 * বাড়ালে **বন্ধ মাসের পে-রোলও বদলে যেত**। এই ব্লকটাই সেই রোগের পাহারাদার।
 */
describe('salaryForMonth — ওই মাসে কত বেতন ছিল', () => {
  const slices = [
    { throughMonth: '2026-06', monthlySalary: '12000.00' },
    { throughMonth: '2026-08', monthlySalary: '13000.00' },
  ];

  it('পুরোনো মাস পুরোনো বেতনই পায়', () => {
    expect(salaryForMonth('2026-05', '15000.00', slices)).toBe('12000.00');
    expect(salaryForMonth('2026-06', '15000.00', slices)).toBe('12000.00');
  });

  /** ⭐ জুলাই ২০২৬-০৬-এর আওতার বাইরে, তাই পরের টুকরোটা */
  it('মাঝের মাস পরের টুকরো পায়', () => {
    expect(salaryForMonth('2026-07', '15000.00', slices)).toBe('13000.00');
    expect(salaryForMonth('2026-08', '15000.00', slices)).toBe('13000.00');
  });

  it('সব টুকরোর পরের মাস এখনকার বেতন পায়', () => {
    expect(salaryForMonth('2026-09', '15000.00', slices)).toBe('15000.00');
  });

  /** ⚠️ খালি টেবিল = "বেতন কোনোদিন বদলায়নি" — সব মাসেই এখনকার মান */
  it('কোনো ইতিহাস না থাকলে এখনকার বেতন', () => {
    expect(salaryForMonth('2026-01', '15000.00', [])).toBe('15000.00');
  });

  /** ⚠️ null = বেতন বসানোই নেই — শূন্য নয় */
  it('বেতন বসানো না থাকলে null-ই থাকে', () => {
    expect(salaryForMonth('2026-01', null, [])).toBeNull();
  });

  /** ⚠️ ক্রম এলোমেলো হলেও সবচেয়ে ছোট মানানসই টুকরোই জেতে */
  it('সারির ক্রমে ফল বদলায় না', () => {
    const shuffled = [...slices].reverse();
    expect(salaryForMonth('2026-07', '15000.00', shuffled)).toBe('13000.00');
  });
});

describe('supersededThrough — পুরোনো বেতন কোন মাস পর্যন্ত', () => {
  it('সাধারণত আগের মাস পর্যন্ত', () => {
    expect(supersededThrough('2026-08', false)).toBe('2026-07');
  });

  it('জানুয়ারিতে আগের বছরের ডিসেম্বর', () => {
    expect(supersededThrough('2026-01', false)).toBe('2025-12');
  });

  /**
   * ⚠️⚠️ চলতি মাস বন্ধ থাকলে ওই মাসের বেতন **দেওয়া হয়ে গেছে**, তাই নতুন
   * সংখ্যাটা ওখানে বসানো যাবে না — পুরোনোটা চলতি মাস পর্যন্তই চলেছিল।
   * এটা না রাখলে বন্ধ মাসের পে-রোল আবার নড়ত।
   */
  it('চলতি মাস বন্ধ থাকলে ওই মাস পর্যন্তই', () => {
    expect(supersededThrough('2026-08', true)).toBe('2026-08');
    expect(supersededThrough('2026-01', true)).toBe('2026-01');
  });
});
