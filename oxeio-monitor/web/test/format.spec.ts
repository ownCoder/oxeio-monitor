import { describe, expect, it } from 'vitest';

import {
  formatAgo,
  formatBytes,
  formatCount,
  formatDate,
  formatDateShort,
  formatDuration,
  formatHoursAsDuration,
  formatMonth,
  formatPct,
  formatSignedDuration,
  formatTaka,
  formatTime,
  isValidWorkDate,
  monthEndOf,
  parseWorkDate,
  pctOf,
  shiftMonth,
  shiftWorkDate,
  thisMonthRange,
  todayInDhaka,
  weekdayOf,
  workDateOf,
} from '../src/lib/format';

/**
 * ⭐ **ওয়েবের প্রথম টেস্ট ফাইল।**
 *
 * ⚠️ এখানে যা পরীক্ষা করা হচ্ছে তার একটাও "দেখতে সুন্দর" প্রশ্ন নয় —
 * প্রতিটাই এমন ভুল যেখানে পর্দায় **ভুল সংখ্যা** বসে যায়, আর কেউ ধরতে
 * পারে না কারণ দেখতে ঠিকই লাগে। ঢাকার তারিখ একদিন সরে গেলে রাতে কাজ করা
 * কর্মী নিজের ঘণ্টা খুঁজে পায় না; সংশোধনের চিহ্ন হারালে যোগ আর বিয়োগ
 * একই দেখায়।
 */

// ── ঢাকার তারিখ ────────────────────────────────────────────────────────────

describe('todayInDhaka — ব্রাউজারের টাইমজোন ধরে নেওয়া হয় না', () => {
  /**
   * ⭐⭐ এই ফাইলের সবচেয়ে জরুরি টেস্ট। ঢাকায় রাত ১২টা–ভোর ৬টার মধ্যে UTC
   * এখনো **আগের দিন**। `toISOString().slice(0,10)` লিখলে ওই সময়ে কাজ করা
   * কর্মী নিজের আজকের ঘণ্টা খুঁজেই পেত না — অথচ রাতে কাজ করা এই
   * সিস্টেমে স্বাভাবিক (§ ২.১-ক)।
   */
  it('ঢাকার রাত ২টা = নতুন দিন, যদিও UTC-তে আগের দিন', () => {
    const utc = new Date('2026-08-11T20:00:00Z'); // ঢাকায় ১২ আগস্ট রাত ২টা
    expect(utc.toISOString().slice(0, 10)).toBe('2026-08-11');
    expect(todayInDhaka(utc)).toBe('2026-08-12');
  });

  it('ঢাকার রাত ১১:৫৯ এখনো সেদিনই', () =>
    expect(todayInDhaka(new Date('2026-08-12T17:59:00Z'))).toBe('2026-08-12'));

  it('workDateOf ISO স্ট্রিং আর Date দুটোই নেয়', () => {
    expect(workDateOf('2026-08-11T20:30:00Z')).toBe('2026-08-12');
    expect(workDateOf(new Date('2026-08-11T20:30:00Z'))).toBe('2026-08-12');
  });
});

describe('parseWorkDate — অসম্ভব তারিখ চুপচাপ পাল্টে যায় না', () => {
  /**
   * ⚠️ `new Date('2026-02-31')` চুপচাপ ৩ মার্চ বানিয়ে দেয়। ফিরে এসে না
   * মেলালে ব্যবহারকারী ভুল দিনের ডেটা দেখে বুঝতেও পারত না।
   */
  it('৩১ ফেব্রুয়ারি null', () => expect(parseWorkDate('2026-02-31')).toBeNull());
  it('১৩ নম্বর মাস null', () => expect(parseWorkDate('2026-13-01')).toBeNull());
  it('ফরম্যাট না মিললে null', () => expect(parseWorkDate('11/08/2026')).toBeNull());
  it('ঠিক তারিখ চলে', () => expect(isValidWorkDate('2026-02-28')).toBe(true));
  it('লিপ ইয়ারের ২৯ ফেব্রুয়ারি চলে', () =>
    expect(isValidWorkDate('2028-02-29')).toBe(true));
  it('অ-লিপ বছরের ২৯ ফেব্রুয়ারি নয়', () =>
    expect(isValidWorkDate('2026-02-29')).toBe(false));
});

describe('তারিখ সরানো', () => {
  it('মাসের সীমা পেরোয়', () =>
    expect(shiftWorkDate('2026-08-01', -1)).toBe('2026-07-31'));

  it('ভুল তারিখ দিলে যা দেওয়া হয়েছিল তাই ফেরে', () =>
    expect(shiftWorkDate('গতকাল', -1)).toBe('গতকাল'));

  it('মাসের শেষ দিন — লিপ ইয়ার নিজে থেকেই মেলে', () => {
    expect(monthEndOf('2026-02')).toBe('2026-02-28');
    expect(monthEndOf('2028-02-10')).toBe('2028-02-29');
  });

  it('বছরের সীমা পেরিয়ে মাস সরে', () =>
    expect(shiftMonth('2026-01', -1)).toBe('2025-12'));

  it('চলতি মাসের রেঞ্জ ঢাকার আজ ধরে', () => {
    const range = thisMonthRange(new Date('2026-08-11T20:00:00Z'));
    expect(range).toEqual({ from: '2026-08-01', to: '2026-08-12' });
  });
});

describe('তারিখ দেখানো', () => {
  it('পুরো তারিখ', () => expect(formatDate('2026-08-10')).toBe('10 August 2026'));
  it('সরু কলামে', () => expect(formatDateShort('2026-10-05')).toBe('5 Oct'));
  it('বার', () => expect(weekdayOf('2026-08-10')).toBe('Mon'));
  it('মাস', () => expect(formatMonth('2026-08')).toBe('August 2026'));

  /** ⚠️ ভুল ইনপুট পেলে ফাঁকা নয়, যা এসেছিল তাই — নইলে ঘরটা নীরবে খালি হতো */
  it('ভুল তারিখে যা এসেছিল তাই', () =>
    expect(formatDate('not-a-date')).toBe('not-a-date'));

  it('ভুল মাসে যা এসেছিল তাই', () =>
    expect(formatMonth('2026-99')).toBe('2026-99'));

  /** ⚠️ সময় ঢাকার ঘড়িতে — ব্যবহারকারীর টাইমজোনে নয় */
  it('সময় ঢাকার ঘড়িতে', () =>
    expect(formatTime('2026-08-11T08:32:00Z')).toBe('14:32'));

  it('সময় না থাকলে ড্যাশ', () => expect(formatTime(null)).toBe('—'));
  it('ভাঙা ISO-তে ড্যাশ', () => expect(formatTime('আজ দুপুর')).toBe('—'));
});

describe('formatAgo — একবচন/বহুবচন', () => {
  const now = new Date('2026-08-12T10:00:00Z');
  const ago = (sec: number) =>
    formatAgo(new Date(now.getTime() - sec * 1000).toISOString(), now);

  it('একদম সদ্য', () => expect(ago(10)).toBe('Just now'));
  /** ⚠️ "1 minutes ago" যন্ত্রের মতো শোনায়, আর সংখ্যার উপর ভরসা কমায় */
  it('এক মিনিট — একবচন', () => expect(ago(60)).toBe('1 minute ago'));
  it('দুই মিনিট — বহুবচন', () => expect(ago(120)).toBe('2 minutes ago'));
  it('এক ঘণ্টা', () => expect(ago(3600)).toBe('1 hour ago'));
  it('দুই দিন', () => expect(ago(2 * 86400)).toBe('2 days ago'));

  /** ⚠️ ঘড়ি এদিক-ওদিক হলে ঋণাত্মক সংখ্যা দেখালে মনে হতো সিস্টেম ভেঙে গেছে */
  it('ভবিষ্যতের সময়েও ঋণাত্মক নয়', () =>
    expect(formatAgo(new Date(now.getTime() + 60_000).toISOString(), now)).toBe(
      'Just now',
    ));

  it('কখনো না এলে Never', () => expect(formatAgo(null)).toBe('Never'));
});

// ── সময়কাল ─────────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('ঘণ্টা ও মিনিট', () => expect(formatDuration(7 * 3600 + 32 * 60)).toBe('7h 32m'));
  it('এক ঘণ্টার কম — শুধু মিনিট', () => expect(formatDuration(32 * 60)).toBe('32m'));

  /** ⚠️ খালি ঘর দেখলে বোঝা যায় না ডেটা নেই না কি সত্যিই শূন্য */
  it('শূন্য মানে 0m, ফাঁকা নয়', () => expect(formatDuration(0)).toBe('0m'));
  it('তথ্য না থাকলে ড্যাশ', () => expect(formatDuration(null)).toBe('—'));
  it('NaN-এ ড্যাশ', () => expect(formatDuration(Number.NaN)).toBe('—'));

  /**
   * ⭐ round করার পর মিনিট ৬০ হয়ে যেতে পারে। ঘণ্টায় না তুললে পর্দায়
   * `0h 60m` বসে থাকত — ভুল না হলেও কেউ ওই সংখ্যাটাকে বিশ্বাস করত না।
   */
  it('৩৫৯৮ সেকেন্ড → 1h 0m, "0h 60m" নয়', () =>
    expect(formatDuration(3598)).toBe('1h 0m'));

  it('ঋণাত্মক সময় ০-তে আটকায়', () => expect(formatDuration(-500)).toBe('0m'));
});

describe('formatSignedDuration — চিহ্নটাই আসল তথ্য', () => {
  it('ধনাত্মকেও চিহ্ন থাকে', () =>
    expect(formatSignedDuration(2 * 3600)).toBe('+2:00'));

  /** ⚠️ ইউনিকোড মাইনাস (U+2212), হাইফেন নয় */
  it('ঋণাত্মকে ইউনিকোড মাইনাস', () => {
    const text = formatSignedDuration(-30 * 60);
    expect(text).toBe('−0:30');
    expect(text.charCodeAt(0)).toBe(0x2212);
  });

  it('এক ঘণ্টার কম হলেও ঘণ্টাটা থাকে', () =>
    expect(formatSignedDuration(30 * 60)).toBe('+0:30'));

  it('শূন্যকে ধনাত্মক ধরা হয়', () => expect(formatSignedDuration(0)).toBe('+0:00'));

  /** ⚠️ `formatDuration()`-এর ফাঁদটা এখানেও — সরানোর পর প্রথম টেস্টেই ধরা পড়ল */
  it('৩৫৯৮ সেকেন্ড → +1:00, "+0:60" নয়', () =>
    expect(formatSignedDuration(3598)).toBe('+1:00'));

  it('ঋণাত্মক দিকেও একই', () =>
    expect(formatSignedDuration(-3598)).toBe('−1:00'));
});

describe('formatHoursAsDuration — API-র দুই ফরম্যাট এক পর্দায়', () => {
  it('সংখ্যা', () => expect(formatHoursAsDuration(7.53)).toBe('7h 32m'));
  /** ⚠️ payroll ঘণ্টা **স্ট্রিং** হিসেবে পাঠায় (Decimal) */
  it('স্ট্রিং', () => expect(formatHoursAsDuration('7.53')).toBe('7h 32m'));
  it('null-এ ড্যাশ', () => expect(formatHoursAsDuration(null)).toBe('—'));
  it('আজেবাজে স্ট্রিং-এ ড্যাশ', () => expect(formatHoursAsDuration('অনেক')).toBe('—'));
});

// ── শতাংশ, বাইট, টাকা ───────────────────────────────────────────────────────

describe('formatPct — null মানে তথ্য নেই, শূন্য নয়', () => {
  /**
   * ⭐ `0%` লিখলে "কিছুই productive করেনি" বলা হতো, অথচ সত্যিটা "বলার
   * মতো কিছুই নেই" — ছুটির দিনে দুটোর পার্থক্য পুরো রিপোর্ট বদলে দেয়।
   */
  it('null-এ ড্যাশ', () => expect(formatPct(null)).toBe('—'));
  it('শূন্যে 0%', () => expect(formatPct(0)).toBe('0%'));
  it('দশমিক ঘর', () => expect(formatPct(72.456, 1)).toBe('72.5%'));

  it('হর শূন্য হলে ০, NaN নয়', () => expect(pctOf(5, 0)).toBe(0));
  it('স্বাভাবিক শতাংশ', () => expect(pctOf(1, 4)).toBe(25));
});

describe('formatBytes', () => {
  it('১ KiB-র কম', () => expect(formatBytes(900)).toBe('900 B'));
  it('KB', () => expect(formatBytes(2048)).toBe('2.0 KB'));
  it('বড় হলে দশমিক ছাড়া', () => expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB'));
  it('null-এ ড্যাশ', () => expect(formatBytes(null)).toBe('—'));
});

describe('formatTaka — সংখ্যায় রূপান্তর করা হয় না', () => {
  /**
   * ⚠️ সার্ভার টাকা **স্ট্রিং** হিসেবে পাঠায় (Decimal)। `Number()` করে
   * হিসাব করলে ১৩০০০.১০ পর্দায় ১৩০০০.০৯৯৯… হয়ে যেত।
   */
  it('হাজারের কমা', () => expect(formatTaka('13000.50')).toBe('৳ 13,000.50'));
  it('দশমিকের ঘরগুলো হুবহু থাকে', () =>
    expect(formatTaka('13000.10')).toBe('৳ 13,000.10'));
  it('দশমিক না থাকলে যোগ করা হয় না', () =>
    expect(formatTaka('900')).toBe('৳ 900'));
  it('ঋণাত্মক', () => expect(formatTaka('-1500')).toBe('৳ -1,500'));
  it('লাখের অঙ্ক', () => expect(formatTaka('1234567')).toBe('৳ 1,234,567'));
  it('null-এ ড্যাশ', () => expect(formatTaka(null)).toBe('—'));
});

describe('formatCount', () => {
  it('হাজারের কমা', () => expect(formatCount(12345)).toBe('12,345'));
  it('null-এ ড্যাশ', () => expect(formatCount(null)).toBe('—'));
});
