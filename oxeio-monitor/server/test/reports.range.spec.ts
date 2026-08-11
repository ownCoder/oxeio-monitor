import { describe, expect, it } from 'vitest';

import {
  MAX_RANGE_DAYS,
  bucketOf,
  countWorkdays,
  dailyTargetSec,
  daysInclusive,
  eachDate,
  isWorkday,
  isoDayOf,
  monthsIn,
  parseReportRange,
  parseWorkDate,
  secondsToHours,
  sharePct,
  toIsoDate,
  weekStartIsoDay,
  type WorkdayRule,
} from '../src/reports/reports.range';

/** ঢাকার ১১ আগস্ট ২০২৬, দুপুর — "আজ" হিসেবে ব্যবহার */
const NOW = new Date('2026-08-11T06:00:00.000Z');

/** শুক্রবার ছুটি, কোনো সরকারি ছুটি নেই */
const FRIDAY_OFF: WorkdayRule = { weeklyOffDay: 5, holidays: new Set() };

const day = (iso: string): Date => parseWorkDate(iso);

describe('তারিখ পার্স', () => {
  it('YYYY-MM-DD থেকে UTC-midnight বানায় — Prisma @db.Date-এর সাথে মেলে', () => {
    const d = parseWorkDate('2026-08-11');
    expect(d.toISOString()).toBe('2026-08-11T00:00:00.000Z');
    expect(toIsoDate(d)).toBe('2026-08-11');
  });

  /**
   * ⭐ সবচেয়ে দরকারি টেস্ট। `Date.UTC(2026, 1, 30)` কোনো এরর দেয় না —
   * চুপচাপ ২ মার্চ বানিয়ে দেয়। তখন "ফেব্রুয়ারির রিপোর্ট" মার্চের ডেটা
   * নিয়ে আসত, আর কেউ ধরতেই পারত না।
   */
  it('ক্যালেন্ডারে নেই এমন তারিখ পরের মাসে গড়িয়ে না গিয়ে নাকচ হয়', () => {
    expect(() => parseWorkDate('2026-02-30')).toThrow(RangeError);
    expect(() => parseWorkDate('2026-13-01')).toThrow(RangeError);
    expect(() => parseWorkDate('2026-00-10')).toThrow(RangeError);
  });

  it('লিপ ইয়ারের ২৯ ফেব্রুয়ারি চলে, সাধারণ বছরে চলে না', () => {
    expect(toIsoDate(parseWorkDate('2028-02-29'))).toBe('2028-02-29');
    expect(() => parseWorkDate('2026-02-29')).toThrow(RangeError);
  });

  it('আলগা ফরম্যাট নেওয়া হয় না', () => {
    expect(() => parseWorkDate('2026-8-1')).toThrow(RangeError);
    expect(() => parseWorkDate('11/08/2026')).toThrow(RangeError);
    expect(() => parseWorkDate('')).toThrow(RangeError);
  });
});

describe('রেঞ্জ যাচাই (F08)', () => {
  it('স্বাভাবিক রেঞ্জ অক্ষত থাকে', () => {
    const r = parseReportRange('2026-08-01', '2026-08-10', { now: NOW });
    expect(toIsoDate(r.from)).toBe('2026-08-01');
    expect(toIsoDate(r.to)).toBe('2026-08-10');
    expect(r.days).toBe(10);
    expect(r.clampedToToday).toBe(false);
  });

  it('এক দিনের রেঞ্জও চলে (F01 — এক দিনের অ্যাটেনডেন্স)', () => {
    const r = parseReportRange('2026-08-11', '2026-08-11', { now: NOW });
    expect(r.days).toBe(1);
  });

  it('উল্টো রেঞ্জ নাকচ হয়', () => {
    expect(() =>
      parseReportRange('2026-08-10', '2026-08-01', { now: NOW }),
    ).toThrow(RangeError);
  });

  /**
   * ⭐ সীমা না থাকলে `from=2000-01-01` চাইলে সার্ভার ১৫ জন × ৯৫০০ দিন সারি
   * বানাতে বসত — মেমরি শেষ, আর পুরো ড্যাশবোর্ড বসে যেত।
   */
  it('৩৭০ দিনের বেশি চাইলে নাকচ হয়', () => {
    expect(MAX_RANGE_DAYS).toBe(370);

    const ok = parseReportRange('2025-08-11', '2026-08-11', { now: NOW });
    expect(ok.days).toBe(366);

    expect(() =>
      parseReportRange('2000-01-01', '2026-08-11', { now: NOW }),
    ).toThrow(/370/);
  });

  /**
   * ⭐ এই দুটো একসাথে না ধরলে সীমাটা কার্যত ফাঁকা হয়ে যেত: ছাঁটাই আগে করলে
   * `2000-01-01 → 2999-12-31` ছেঁটে "আজ পর্যন্ত" হয়ে সীমার নিচে নেমে আসত
   * না ঠিকই, কিন্তু `2026-08-01 → 2999-12-31` ঠিকই পাস করে যেত — অর্থাৎ
   * ব্যবহারকারী এক প্রশ্ন করে অন্য প্রশ্নের উত্তর পেতেন।
   */
  it('সীমা মাপা হয় চাওয়া রেঞ্জে, ছাঁটাইয়ের আগে', () => {
    expect(() =>
      parseReportRange('2026-08-01', '2999-12-31', { now: NOW }),
    ).toThrow(RangeError);
  });

  it('ভবিষ্যতের শেষ তারিখ আজ পর্যন্ত ছেঁটে যায়, আর সেটা জানিয়ে দেওয়া হয়', () => {
    const r = parseReportRange('2026-08-01', '2026-08-31', { now: NOW });

    expect(toIsoDate(r.to)).toBe('2026-08-11');
    expect(toIsoDate(r.requestedTo)).toBe('2026-08-31');
    expect(r.clampedToToday).toBe(true);
    expect(r.days).toBe(11);
  });

  it('পুরো রেঞ্জ ভবিষ্যতে হলে নাকচ — শূন্য রিপোর্ট নয়', () => {
    expect(() =>
      parseReportRange('2026-09-01', '2026-09-30', { now: NOW }),
    ).toThrow(RangeError);
  });

  /**
   * ঢাকা UTC+৬। UTC-তে ১০ আগস্ট রাত ৯টা মানে ঢাকায় ১১ আগস্ট ভোর ৩টা —
   * অর্থাৎ "আজ" ১১ তারিখ। নিজে অফসেট হিসাব লিখলে এখানেই এক দিন হারাত।
   */
  it('"আজ" ঢাকার তারিখ ধরে, সার্ভারের UTC তারিখ ধরে নয়', () => {
    const r = parseReportRange('2026-08-01', '2026-08-31', {
      now: new Date('2026-08-10T21:00:00.000Z'),
    });
    expect(toIsoDate(r.to)).toBe('2026-08-11');
  });
});

describe('কর্মদিবস ও টার্গেট (§ ২.১-খ)', () => {
  it('ISO দিন ঠিক আসে — শুক্রবার ৫', () => {
    expect(isoDayOf(day('2026-08-10'))).toBe(1); // সোম
    expect(isoDayOf(day('2026-08-14'))).toBe(5); // শুক্র
    expect(isoDayOf(day('2026-08-16'))).toBe(7); // রবি
  });

  it('সাপ্তাহিক ছুটির দিন কর্মদিবস নয়', () => {
    expect(isWorkday(day('2026-08-13'), FRIDAY_OFF)).toBe(true);
    expect(isWorkday(day('2026-08-14'), FRIDAY_OFF)).toBe(false);
  });

  it('ছুটির ক্যালেন্ডারের দিনও কর্মদিবস নয়', () => {
    const rule: WorkdayRule = {
      weeklyOffDay: 5,
      holidays: new Set([day('2026-08-13').getTime()]),
    };
    expect(isWorkday(day('2026-08-13'), rule)).toBe(false);
  });

  it('weeklyOffDay = null হলে প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস', () => {
    const rule: WorkdayRule = { weeklyOffDay: null, holidays: new Set() };
    expect(countWorkdays(day('2026-08-01'), day('2026-08-31'), rule)).toBe(31);
  });

  it('আগস্ট ২০২৬-এ শুক্রবার বাদে ২৭ কর্মদিবস', () => {
    // ৩১ দিনের মাস, শুক্রবার ৭/১৪/২১/২৮ — চারটি
    expect(
      countWorkdays(day('2026-08-01'), day('2026-08-31'), FRIDAY_OFF),
    ).toBe(27);
  });

  it('মোট টার্গেট ভাগ করে আবার যোগ করলে ২০৮ ঘণ্টাই ফিরে আসে', () => {
    const monthly = 208 * 3600;
    const workdays = countWorkdays(
      day('2026-08-01'),
      day('2026-08-31'),
      FRIDAY_OFF,
    );

    const perDay = dailyTargetSec(monthly, workdays);
    expect(secondsToHours(perDay * workdays)).toBe(208);
  });

  /**
   * ⭐ প্রতিদিনের টার্গেট round করলে এই যোগফলটাই মেলে না। ২২ কর্মদিবসের
   * মাসে ৭৪৮৮০০ ÷ ২২ = ৩৪০৩৬.৩৬…; round করে ২২ বার যোগ করলে ২০৭.৯৯ বা
   * ২০৮.০১ দাঁড়াত — কেউ ঠিক টার্গেট ছুঁয়েও কাগজে ঘাটতি দেখতেন।
   */
  it('ভাগ না যাওয়া কর্মদিবসেও যোগফল টার্গেট ছাড়িয়ে যায় না', () => {
    const monthly = 208 * 3600;

    for (const workdays of [20, 21, 22, 23, 24, 25, 26, 27, 30]) {
      const perDay = dailyTargetSec(monthly, workdays);
      expect(secondsToHours(perDay * workdays)).toBe(208);

      const naive = Math.round(perDay) * workdays;
      expect(Math.abs(naive - monthly)).toBeLessThanOrEqual(workdays);
    }
  });

  it('কর্মদিবস শূন্য হলে টার্গেট ০, Infinity নয়', () => {
    expect(dailyTargetSec(208 * 3600, 0)).toBe(0);
  });

  it('ঋণাত্মক মাসিক টার্গেট নাকচ হয়', () => {
    expect(() => dailyTargetSec(-1, 26)).toThrow(RangeError);
  });
});

describe('মাস ও বালতি', () => {
  it('রেঞ্জের প্রতিটি মাসের পুরো সীমা ফেরে — অর্ধেক মাসেরও', () => {
    const months = monthsIn(day('2026-08-10'), day('2026-09-05'));

    expect(months.map((m) => m.key)).toEqual(['2026-08', '2026-09']);
    // ⭐ ১০ আগস্ট থেকে চাইলেও হর হবে **পুরো** আগস্টের কর্মদিবস
    expect(toIsoDate(months[0].first)).toBe('2026-08-01');
    expect(toIsoDate(months[0].last)).toBe('2026-08-31');
    expect(toIsoDate(months[1].last)).toBe('2026-09-30');
  });

  it('লিপ ইয়ারের ফেব্রুয়ারি ২৯ দিনে শেষ হয়', () => {
    const [feb] = monthsIn(day('2028-02-05'), day('2028-02-06'));
    expect(toIsoDate(feb.last)).toBe('2028-02-29');
  });

  /**
   * ⭐ সপ্তাহ সোমবারে শুরু ধরলে বাংলাদেশের প্রতিটি কর্মসপ্তাহ (শনি–বৃহস্পতি)
   * দুই বালতিতে ভাগ হয়ে যেত, আর সাপ্তাহিক সারাংশে কেউ কখনো পুরো সপ্তাহ
   * দেখত না।
   */
  it('সপ্তাহ শুরু হয় সাপ্তাহিক ছুটির পরের দিনে', () => {
    expect(weekStartIsoDay(5)).toBe(6); // শুক্র ছুটি → শনিবার শুরু
    expect(weekStartIsoDay(7)).toBe(1); // রবি ছুটি → সোমবার শুরু
    expect(weekStartIsoDay(null)).toBe(1);
  });

  it('সপ্তাহের বালতি শনিবার শুরু হয়ে শুক্রবারে শেষ', () => {
    const b = bucketOf(day('2026-08-11'), 'week', weekStartIsoDay(5));

    expect(b.key).toBe('2026-08-08'); // শনিবার
    expect(toIsoDate(b.start)).toBe('2026-08-08');
    expect(toIsoDate(b.end)).toBe('2026-08-14'); // শুক্রবার
    expect(isoDayOf(b.end)).toBe(5);
  });

  it('একই সপ্তাহের সব দিন একই চাবিতে পড়ে, পরের দিনটি নতুন চাবিতে', () => {
    const start = weekStartIsoDay(5);
    for (const iso of ['2026-08-08', '2026-08-11', '2026-08-14']) {
      expect(bucketOf(day(iso), 'week', start).key).toBe('2026-08-08');
    }
    expect(bucketOf(day('2026-08-15'), 'week', start).key).toBe('2026-08-15');
  });

  it('মাসের বালতি YYYY-MM — monthly_summary-র চাবির সাথে এক ফরম্যাট', () => {
    const b = bucketOf(day('2026-08-11'), 'month', 6);
    expect(b.key).toBe('2026-08');
    expect(toIsoDate(b.start)).toBe('2026-08-01');
    expect(toIsoDate(b.end)).toBe('2026-08-31');
  });

  it('সপ্তাহের বালতি মাস পেরিয়ে গেলেও অটুট থাকে', () => {
    const b = bucketOf(day('2026-09-01'), 'week', weekStartIsoDay(5));
    expect(b.key).toBe('2026-08-29');
    expect(toIsoDate(b.end)).toBe('2026-09-04');
  });
});

describe('দিন গোনা ও উপস্থাপনা', () => {
  it('দুই প্রান্তসহ দিন গোনা হয়', () => {
    expect(daysInclusive(day('2026-08-01'), day('2026-08-01'))).toBe(1);
    expect(daysInclusive(day('2026-08-01'), day('2026-08-31'))).toBe(31);
  });

  it('eachDate কোনো দিন বাদ দেয় না, ক্রমও ঠিক রাখে', () => {
    const dates = eachDate(day('2026-08-01'), day('2026-08-31'));
    expect(dates).toHaveLength(31);
    expect(toIsoDate(dates[0])).toBe('2026-08-01');
    expect(toIsoDate(dates[30])).toBe('2026-08-31');
  });

  /**
   * ⭐ ঘণ্টা **সংখ্যা** হিসেবেই ফেরে — "৭ঘ ৩২মি" নয়। Excel-এ টেক্সট হলে
   * কলামের যোগফল বা sort কিছুই কাজ করত না।
   */
  it('সেকেন্ড → ঘণ্টা: সংখ্যা, দুই দশমিক', () => {
    expect(secondsToHours(3600)).toBe(1);
    expect(secondsToHours(27120)).toBe(7.53); // ৭ঘ ৩২মি
    expect(secondsToHours(0)).toBe(0);
    expect(typeof secondsToHours(27120)).toBe('number');
  });

  it('শতাংশে হর শূন্য হলে NaN নয়, ০', () => {
    expect(sharePct(0, 0)).toBe(0);
    expect(sharePct(1, 4)).toBe(25);
    expect(sharePct(1, 3)).toBe(33.33);
  });
});
