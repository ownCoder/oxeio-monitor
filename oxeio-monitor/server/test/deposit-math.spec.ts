import { describe, expect, it } from 'vitest';

import {
  checkNotice,
  daysBetween,
  isYearMonth,
  monthsBetween,
  nextMonth,
} from '../src/deposits/deposit.math';

/**
 * R21 — জামানতের খাঁটি হিসাব। ডাটাবেস লাগে না, তাই এগুলোই প্রথম পাহারা।
 */

describe('মাসের হিসাব', () => {
  it('পরের মাস — আর বছর পেরোলেও ঠিক', () => {
    expect(nextMonth('2026-08')).toBe('2026-09');
    expect(nextMonth('2026-11')).toBe('2026-12');
    // ⚠️ ডিসেম্বর → পরের বছরের জানুয়ারি, '2026-13' নয়
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('দুই প্রান্তসহ প্রতিটা মাস', () => {
    expect(monthsBetween('2026-08', '2026-08')).toEqual(['2026-08']);
    expect(monthsBetween('2026-08', '2026-11')).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('বছর পেরিয়ে গেলেও ক্রম ঠিক থাকে', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('শুরু শেষের পরে হলে খালি তালিকা — ছোড়া হয় না', () => {
    // ⚠️ কর্মী নিয়ম শুরুর মাসের পরে যোগ দিলে এমনটা হতেই পারে
    expect(monthsBetween('2026-09', '2026-08')).toEqual([]);
  });

  it('ভুল ফরম্যাট চুপচাপ মেনে নেওয়া হয় না', () => {
    expect(() => monthsBetween('2026-8', '2026-09')).toThrow(RangeError);
    expect(() => monthsBetween('2026-13', '2027-01')).toThrow(RangeError);
    expect(isYearMonth('2026-00')).toBe(false);
    expect(isYearMonth('2026-12')).toBe(true);
  });

  it('⚠️ অস্বাভাবিক লম্বা সীমা থামিয়ে দেওয়া হয়', () => {
    // ৫০ বছরের বেশি — ভুল ইনপুট, লুপ ঘুরতে দেওয়া হয় না
    expect(() => monthsBetween('2026-01', '2126-01')).toThrow(RangeError);
  });
});

describe('নোটিশের হিসাব', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('শেষ দিনটাও গোনা হয়', () => {
    // ⚠️ ৩১ জুলাই জানিয়ে ৩০ আগস্ট শেষ দিন = ৩০ দিন। মানুষ "৩০ দিনের
    //    নোটিশ" বলতে এটাই বোঝে, আর এক দিনের হেরফেরে টাকাটা আটকে যেত।
    expect(daysBetween(d('2026-07-31'), d('2026-08-30'))).toBe(30);
  });

  it('ঠিক ৩০ দিন হলে নিয়ম মেলে', () => {
    const check = checkNotice(d('2026-07-31'), d('2026-08-30'), 30);
    expect(check.daysGiven).toBe(30);
    expect(check.meetsRule).toBe(true);
  });

  it('২৯ দিন হলে মেলে না', () => {
    const check = checkNotice(d('2026-08-01'), d('2026-08-30'), 30);
    expect(check.daysGiven).toBe(29);
    expect(check.meetsRule).toBe(false);
  });

  it('⭐ তারিখ জানা না থাকলে "না" — "জানি না"-কে "হ্যাঁ" ধরা হয় না', () => {
    expect(checkNotice(null, d('2026-08-30'), 30)).toEqual({
      daysGiven: null,
      daysRule: 30,
      meetsRule: false,
    });
    expect(checkNotice(d('2026-07-01'), null, 30).meetsRule).toBe(false);
  });

  it('নিয়ম ০ দিনের হলে যেকোনো নোটিশই যথেষ্ট', () => {
    // ⚠️ অদ্ভুত শোনায়, কিন্তু বৈধ — নিয়ম শিথিল করতে চাইলে কোড বদলাতে হবে না
    expect(checkNotice(d('2026-08-29'), d('2026-08-30'), 0).meetsRule).toBe(true);
  });

  it('⚠️ শেষ দিন নোটিশের আগে হলে ঋণাত্মক — আর সেটা নিয়ম মেলায় না', () => {
    const check = checkNotice(d('2026-09-10'), d('2026-08-30'), 30);
    expect(check.daysGiven).toBe(-11);
    expect(check.meetsRule).toBe(false);
  });
});
