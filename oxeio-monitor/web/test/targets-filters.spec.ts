import { describe, expect, it } from 'vitest';

import {
  dropdownValueOf,
  FILTERS,
  stageOf,
  STATUS_OPTIONS,
} from '../src/pages/targets/filters';

/**
 * **Design Pool-এর ছাঁকনি** — কোন কন্ট্রোল কী বাছে।
 *
 * ⚠️⚠️ এই নিয়মগুলো পাতার ভেতরে ছিল, তাই যাচাই করার একমাত্র উপায় ছিল
 * ব্রাউজারে চোখে দেখা। `no_file` যোগ করার সময় আলাদা করা হলো (৯ সেপ্টেম্বর
 * ২০২৬), কারণ ভুলটা নীরব: বাছাইয়ের সাথে সাথে ঘরটা "All targets"-এ ফিরে
 * গেলে তালিকাটা পর্দায় থাকে, কিন্তু কেউ আর বলতে পারে না ওটা কীসের তালিকা।
 */
describe('stageOf — ধাপ না অবস্থা', () => {
  it('⭐ ছয়টা ধাপই চেনা যায়', () => {
    for (const key of [
      'to_check',
      'to_fix',
      'to_upload',
      'to_live',
      'to_review',
      'no_file',
    ] as const) {
      expect(stageOf(key)).toBe(key);
    }
  });

  it('⭐ অবস্থাগুলো ধাপ নয়', () => {
    expect(stageOf('all')).toBeUndefined();
    expect(stageOf('pool')).toBeUndefined();
    expect(stageOf('done')).toBeUndefined();
  });
});

describe('dropdownValueOf — ড্রপডাউনে কী দেখা যাবে', () => {
  const TODAY = '2026-09-09';

  /**
   * ⭐⭐⭐ **এই দাবিটাই নতুন ছাঁকনিটার প্রাণ।**
   *
   * ⚠️⚠️ বাকি সব ধাপ `'all'` দেখায়, কারণ ওগুলো **চিপে** বাছা হয়। কিন্তু
   * `no_file` ড্রপডাউনেরই ভেতরে — একই নিয়ম খাটালে বেছে নেওয়ার সাথে সাথে
   * ঘরটা "All targets"-এ ফিরে যেত, অথচ তালিকাটা বদলে থাকত।
   */
  it('⭐⭐⭐ `no_file` নিজেকেই দেখায়, `all` নয়', () => {
    expect(dropdownValueOf('no_file', '', '', TODAY)).toBe('no_file');
  });

  it('⭐⭐ কিউ-চিপের ধাপগুলো ড্রপডাউনে `all` দেখায়', () => {
    expect(dropdownValueOf('to_check', '', '', TODAY)).toBe('all');
    expect(dropdownValueOf('to_upload', '', '', TODAY)).toBe('all');
    expect(dropdownValueOf('to_review', '', '', TODAY)).toBe('all');
  });

  /**
   * ⚠️ `done_today` আসল কোনো অবস্থা নয় — মনে রাখা হয় না, **মিলিয়ে
   * দেখা হয়**। তাই হাতে তারিখ বদলালে ঘরটা সাথে সাথে `done`-এ নামে।
   */
  it('⭐⭐ আজকের দুটো তারিখসহ `done` হলে `done_today`', () => {
    expect(dropdownValueOf('done', TODAY, TODAY, TODAY)).toBe('done_today');
  });

  it('⭐⭐ তারিখ সরে গেলেই আর `done_today` নয়', () => {
    expect(dropdownValueOf('done', '2026-09-01', TODAY, TODAY)).toBe('done');
    expect(dropdownValueOf('done', TODAY, '2026-09-30', TODAY)).toBe('done');
    expect(dropdownValueOf('done', '', '', TODAY)).toBe('done');
  });

  it('⭐ বাকি অবস্থাগুলো নিজেরাই', () => {
    expect(dropdownValueOf('all', '', '', TODAY)).toBe('all');
    expect(dropdownValueOf('pool', '', '', TODAY)).toBe('pool');
    expect(dropdownValueOf('assigned', '', '', TODAY)).toBe('assigned');
  });
});

describe('কোথায় বসে — মালিকের "নীরব তালিকা" শর্তটা', () => {
  /**
   * ⭐⭐⭐ **`no_file` চিপে নেই, আর সেটাই পুরো সিদ্ধান্ত**
   * *(মালিকের শর্ত, ৯ সেপ্টেম্বর ২০২৬: "নীরব তালিকা, অ্যালার্ট নয়")*।
   *
   * ⚠️⚠️ চিপে বসালে ওর গায়ে **সংখ্যা** বসত, আর সংখ্যা বসলে ওটা একটা
   * কিউ হয়ে যেত — রোজ খালি করার জিনিস, অর্থাৎ কার্যত একটা অ্যালার্ট।
   * অথচ চিহ্ন না থাকার সবচেয়ে সাধারণ কারণ নির্দোষ (সেভ না করা ফাইল)।
   */
  it('⭐⭐⭐ ড্রপডাউনে আছে, কিউ-চিপের সারিতে নেই', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toContain('no_file');
    expect(FILTERS.map((f) => f.key)).not.toContain('no_file');
  });

  it('⭐ চিপের সারিতে কেবল গবেষকের রোজকার কিউগুলো', () => {
    expect(FILTERS.map((f) => f.key)).toEqual([
      'to_check',
      'to_fix',
      'to_upload',
      'to_live',
    ]);
  });
});
