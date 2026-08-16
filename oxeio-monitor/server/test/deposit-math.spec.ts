import { describe, expect, it } from 'vitest';

import {
  effectiveDepositStart,
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

/**
 * ⭐⭐ **এই কর্মীর জামানত কোন মাস থেকে** — একটাই সংজ্ঞা।
 *
 * ⚠️⚠️ নিয়মটা আগে **দুই জায়গায় লেখা ছিল**: খাতা ভরার সময় একবার, পর্দায়
 * দেখানোর সময় আরেকবার। দুটো আলাদা হয়ে গেলে পর্দা এক মাস দেখাত আর খাতায়
 * বসত অন্যটা — আর দুটোই "ঠিক" দেখাত বলে পার্থক্যটা কেউ ধরতে পারত না।
 * এই টেস্টগুলো সেই একত্ব পাহারা দেয়।
 */
describe('effectiveDepositStart', () => {
  const policyStart = '2026-01';

  it('কিছু না থাকলে নিয়মের মাস', () => {
    expect(
      effectiveDepositStart({ override: null, joinedMonth: null, policyStart }),
    ).toBe('2026-01');
  });

  it('পরে যোগ দিলে যোগদানের মাস', () => {
    expect(
      effectiveDepositStart({ override: null, joinedMonth: '2026-04', policyStart }),
    ).toBe('2026-04');
  });

  /** ⚠️ নিয়ম চালুর আগে যোগ দিলে নিয়মের মাসই — তার আগে কাটার কথাই ছিল না */
  it('আগে যোগ দিলেও নিয়মের মাস', () => {
    expect(
      effectiveDepositStart({ override: null, joinedMonth: '2025-03', policyStart }),
    ).toBe('2026-01');
  });

  /**
   * ⭐⭐ **মালিকের বেছে দেওয়া মাস যোগদানের তারিখকেও হারায়।** `joined_on`
   * প্রায়ই অনুমান বা ফাঁকা; এই ঘরটা মালিক নিজে বসান — অনুমান বিবৃতিকে
   * হারালে সংশোধন করেও কিছু বদলাত না।
   */
  it('override সবকিছুর উপরে', () => {
    expect(
      effectiveDepositStart({
        override: '2026-03',
        joinedMonth: '2026-07',
        policyStart,
      }),
    ).toBe('2026-03');
  });

  it('override নিয়মের আগেও হতে পারে', () => {
    expect(
      effectiveDepositStart({ override: '2025-11', joinedMonth: null, policyStart }),
    ).toBe('2025-11');
  });
});
