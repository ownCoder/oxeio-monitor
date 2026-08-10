import { describe, expect, it } from 'vitest';

import { parseCalendarDate } from '../src/admin/calendar-date';

describe('parseCalendarDate — ক্যালেন্ডার তারিখ, instant নয়', () => {
  /**
   * ⭐ `@db.Date` কলাম UTC-মধ্যরাত চায়। এক ঘণ্টাও এদিক-ওদিক হলে
   * Postgres তারিখটা এক দিন সরিয়ে বসাতে পারত।
   */
  it('UTC-মধ্যরাত ফেরত দেয়', () => {
    const d = parseCalendarDate('2026-08-10');

    expect(d?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  /**
   * ⚠️ আসল ফাঁদ: `new Date('2026-08-10T00:00:00')` (শেষে `Z` ছাড়া) সার্ভারের
   * স্থানীয় সময় ধরে পড়া হয়। সার্ভার ঢাকায় থাকলে সেটা UTC-তে আগের দিনের
   * ১৮:০০ — মানে ছুটির ক্যালেন্ডার নীরবে এক দিন পিছিয়ে যেত।
   */
  it('স্থানীয় টাইমজোনে পিছলে যায় না', () => {
    const d = parseCalendarDate('2026-01-01');

    expect(d?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(d?.getUTCHours()).toBe(0);
  });

  /**
   * ⚠️ JS নীরবে `2026-02-31` কে ৩ মার্চ বানিয়ে দেয়। ফিরে মিলিয়ে না দেখলে
   * ছুটির ক্যালেন্ডারে এমন তারিখ বসত যা কেউ লেখেনি।
   */
  it('অস্তিত্বহীন তারিখ নাকচ, চুপচাপ সরিয়ে নেয় না', () => {
    expect(parseCalendarDate('2026-02-31')).toBeNull();
    expect(parseCalendarDate('2025-02-29')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
  });

  it('অধিবর্ষের ২৯ ফেব্রুয়ারি বৈধ', () => {
    expect(parseCalendarDate('2028-02-29')?.toISOString().slice(0, 10)).toBe(
      '2028-02-29',
    );
  });

  it('ফরম্যাট ঠিক না হলে null', () => {
    for (const bad of ['2026-8-10', '10-08-2026', '2026/08/10', '', 'today']) {
      expect(parseCalendarDate(bad)).toBeNull();
    }
  });

  /** ⚠️ সময় জুড়ে দেওয়া মানেই এটা আর ক্যালেন্ডার তারিখ নয় — নাকচ */
  it('সময়সহ স্ট্রিং নাকচ', () => {
    expect(parseCalendarDate('2026-08-10T06:00:00Z')).toBeNull();
  });
});
