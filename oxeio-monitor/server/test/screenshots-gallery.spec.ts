import { describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import {
  formatWorkDate,
  GALLERY_PAGE_SIZE,
  pageSlice,
  parseWorkDate,
} from '../src/screenshots/gallery.math';

/**
 * E06 — গ্যালারির খাঁটি হিসাব।
 *
 * তারিখ আর পেজিনেশন — দুটোই এমন জায়গা যেখানে ভুল হলে কোনো এক্সেপশন ওঠে
 * না, শুধু ভুল ছবি (বা কম ছবি) দেখা যায়।
 */

describe('গ্যালারির তারিখ পার্স', () => {
  it('YYYY-MM-DD থেকে UTC-midnight — Prisma-র @db.Date যা চায়', () => {
    const d = parseWorkDate('2026-08-10');
    expect(d?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  /**
   * ⭐ ingest যেভাবে `work_date` বসায় (workDateOf), গ্যালারি ঠিক সেই মানই
   * খোঁজে — নইলে সারি আছে অথচ গ্যালারি খালি, আর কেউ বুঝত না কেন।
   */
  it('ingest-এর workDateOf যা বসায়, তার সাথে হুবহু মেলে', () => {
    // ১০ আগস্ট সকাল ৯টা ঢাকা = ০৩:০০ UTC
    const captured = new Date('2026-08-10T03:00:00.000Z');
    expect(parseWorkDate('2026-08-10')?.getTime()).toBe(
      workDateOf(captured).getTime(),
    );
  });

  it('ঢাকার রাত ১১টায় তোলা ছবিও ওই দিনেরই — UTC-তে পরদিন হলেও', () => {
    // ১০ আগস্ট রাত ১১টা ঢাকা = ১০ আগস্ট ১৭:০০ UTC (একই দিন)
    // ১১ আগস্ট রাত ১২:৩০ ঢাকা = ১০ আগস্ট ১৮:৩০ UTC — কিন্তু ক্যাপচার
    // উইন্ডো ০৭:০০–২৩:০০, তাই এটা বাস্তবে হয় না। তবু সীমানাটা মিলিয়ে রাখা।
    const late = new Date('2026-08-10T16:59:00.000Z'); // ২২:৫৯ ঢাকা
    expect(formatWorkDate(workDateOf(late))).toBe('2026-08-10');
  });

  /**
   * ⭐ এটাই সবচেয়ে দরকারি টেস্ট। regex `2026-02-30` কে পাশ করিয়ে দেয়,
   * আর `Date.UTC(2026, 1, 30)` নীরবে ২ মার্চ বানিয়ে দেয় — ব্যবহারকারী
   * ফেব্রুয়ারির ছবি চেয়ে মার্চের ছবি পেত, কোনো এরর ছাড়াই।
   */
  it.each([
    ['2026-02-30', 'ফেব্রুয়ারিতে ৩০ তারিখ নেই'],
    ['2026-13-01', '১৩তম মাস নেই'],
    ['2026-00-10', '০ নম্বর মাস নেই'],
    ['2026-08-00', '০ তারিখ নেই'],
    ['2026-08-32', '৩২ তারিখ নেই'],
    ['2025-02-29', '২০২৫ লিপ ইয়ার নয়'],
  ])('%s বাতিল — %s', (iso) => {
    expect(parseWorkDate(iso)).toBeNull();
  });

  it('লিপ ইয়ারের ২৯ ফেব্রুয়ারি বৈধ', () => {
    expect(parseWorkDate('2028-02-29')?.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it.each(['2026-8-10', '10-08-2026', '2026/08/10', '', 'আজ'])(
    'গড়ন ভুল হলে null: %s',
    (iso) => {
      expect(parseWorkDate(iso)).toBeNull();
    },
  );
});

describe('গ্যালারির পেজিনেশন', () => {
  it('প্রথম পাতা শূন্য থেকে শুরু হয়', () => {
    const s = pageSlice(1, 200);
    expect(s.skip).toBe(0);
    expect(s.take).toBe(GALLERY_PAGE_SIZE);
  });

  /**
   * ⚠️ পাতা ১ থেকে গোনা, skip ০ থেকে। এক ঘরের ভুল হলে প্রথম পাতার
   * ছবিগুলো কোনো পাতাতেই আসত না।
   */
  it('দ্বিতীয় পাতা ঠিক এক পাতা পরে শুরু', () => {
    expect(pageSlice(2, 200).skip).toBe(GALLERY_PAGE_SIZE);
    expect(pageSlice(3, 200).skip).toBe(2 * GALLERY_PAGE_SIZE);
  });

  it('মোট পাতা — ভাগ না গেলে উপরে ওঠে', () => {
    expect(pageSlice(1, GALLERY_PAGE_SIZE).totalPages).toBe(1);
    expect(pageSlice(1, GALLERY_PAGE_SIZE + 1).totalPages).toBe(2);
  });

  /** ⚠️ "পাতা ১ / ০" দেখানো যাবে না — ছবি না থাকলেও পাতা একটা */
  it('একটাও ছবি না থাকলে totalPages ১', () => {
    expect(pageSlice(1, 0).totalPages).toBe(1);
  });

  it('শেষ পাতার পরে চাইলে skip বড় হয় — খালি লিস্ট, এরর নয়', () => {
    const s = pageSlice(10, 5);
    expect(s.skip).toBe(9 * GALLERY_PAGE_SIZE);
    expect(s.totalPages).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'অদ্ভুত পাতা নম্বর (%s) হলে ১-এ নামিয়ে আনা হয়',
    (page) => {
      const s = pageSlice(page, 200);
      expect(s.page).toBe(1);
      expect(s.skip).toBe(0);
    },
  );
});
