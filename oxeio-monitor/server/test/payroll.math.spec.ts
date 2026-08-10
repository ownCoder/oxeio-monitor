import { describe, expect, it } from 'vitest';

import { computePayroll, paisaToTaka } from '../src/payroll/payroll.math';

/** ২০৮ ঘণ্টা, সেকেন্ডে */
const TARGET = 208 * 3600;

describe('payroll — ঘাটতিকে টাকায় রূপান্তর', () => {
  it('টার্গেট পূরণ হলে কিছুই কাটা যায় না', () => {
    const line = computePayroll({
      monthlySalary: 13000,
      targetSec: TARGET,
      creditedSec: TARGET,
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
    });

    expect(paisaToTaka(line.deductionPaisa)).toBe('15000.00');
    expect(line.payablePaisa).toBe(0);
  });

  it('টার্গেট শূন্য হলে অসীম কর্তনের বদলে থেমে যায়', () => {
    // work policy-তে ২০৮ বসানো, তাই এটা হওয়ার কথা নয় — কিন্তু হলে
    // চুপচাপ Infinity বেরিয়ে গিয়ে অসম্ভব একটা বিল দাঁড়াত
    expect(() =>
      computePayroll({ monthlySalary: 13000, targetSec: 0, creditedSec: 0 }),
    ).toThrow(RangeError);
  });

  it('ঋণাত্মক বেতন নাকচ হয়', () => {
    expect(() =>
      computePayroll({ monthlySalary: -1, targetSec: TARGET, creditedSec: 0 }),
    ).toThrow(RangeError);
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
        });

        expect(line.payablePaisa).toBeGreaterThanOrEqual(0);
        expect(line.payablePaisa).toBeLessThanOrEqual(salary * 100);
        expect(line.deductionPaisa + line.payablePaisa).toBe(salary * 100);
      }
    }
  });
});
