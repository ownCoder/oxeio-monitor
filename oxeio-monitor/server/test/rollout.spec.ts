import { describe, expect, it } from 'vitest';

import { isNewer, isOfferedTo, rolloutBucket } from '../src/agent/rollout';

/**
 * H04 — ধাপে ধাপে রোলআউট।
 *
 * ⭐ এই নিয়মগুলোর ভুল ধরা পড়ে **অফিসের ১৫টা PC-তে**, আর ততক্ষণে দেরি
 * হয়ে গেছে: [G58](../../docs/08-Gap-Analysis.md) দেখিয়েছে খারাপ MSI একবার
 * বিলি হলে নতুন MSI দিয়ে ঠিক করা যায় না, হাতে যেতে হয়।
 */

// অফিসের ১৫টা মেশিনের মতো করে
const FLEET = Array.from({ length: 15 }, (_, i) => `machine-guid-${i}`);

const offered = (stage: 'canary' | 'partial' | 'all' | 'halted', v: string) =>
  FLEET.filter((g) => isOfferedTo(stage, g, v));

describe('rollout — ধাপগুলো', () => {
  it('halted-এ কেউ পায় না', () => {
    expect(offered('halted', '1.2.0')).toHaveLength(0);
  });

  it('all-এ সবাই পায়', () => {
    expect(offered('all', '1.2.0')).toHaveLength(FLEET.length);
  });

  /**
   * ⚠️ ১৫ ডিভাইসে "১০%" মানে ১.৫ — গোল করলে ০ বা ২। canary-র মানেই
   * গুটিকয়েক, তাই সংখ্যাটা এমন রাখা হয়েছে যাতে বাস্তবে ১–২টা পড়ে।
   */
  it('canary-তে খুব কম মেশিন — শূন্যও নয়, সবাইও নয়', () => {
    // একাধিক ভার্সনে দেখা, কারণ বালতি ভার্সনের উপরেও নির্ভর করে
    const counts = ['1.2.0', '1.3.0', '2.0.0', '2.1.0'].map(
      (v) => offered('canary', v).length,
    );

    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('partial canary-র চেয়ে বেশি, all-এর চেয়ে কম', () => {
    const v = '1.2.0';
    expect(offered('partial', v).length).toBeGreaterThanOrEqual(
      offered('canary', v).length,
    );
    expect(offered('partial', v).length).toBeLessThan(FLEET.length);
  });

  /** canary যারা পেয়েছে, partial-এও তারা পাবে — নইলে আপডেট **ফিরে যেত** */
  it('ধাপ বাড়লে কেউ আপডেট হারায় না', () => {
    const v = '1.2.0';
    for (const g of offered('canary', v)) {
      expect(isOfferedTo('partial', g, v), g).toBe(true);
      expect(isOfferedTo('all', g, v), g).toBe(true);
    }
  });
});

describe('rollout — বালতি', () => {
  it('একই মেশিন ও ভার্সনে সবসময় একই উত্তর', () => {
    // ⚠️ এলোমেলো হলে প্রতি heartbeat-এ ভিন্ন উত্তর আসত — canary
    //    বলে কিছুই থাকত না
    const a = rolloutBucket('guid-x', '1.2.0');
    const b = rolloutBucket('guid-x', '1.2.0');

    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  /**
   * ⭐ ভার্সন বালতিতে না মেশালে **একই হতভাগা মেশিন চিরকাল** প্রতিটা
   * আপডেটের গিনিপিগ হতো, আর একজন স্টাফের PC-ই বারবার ভাঙত।
   */
  it('ভার্সন বদলালে গিনিপিগও বদলায়', () => {
    const first = offered('canary', '1.2.0').join();
    const later = ['1.3.0', '1.4.0', '2.0.0'].map((v) =>
      offered('canary', v).join(),
    );

    expect(later.some((set) => set !== first)).toBe(true);
  });
});

describe('rollout — ভার্সনের তুলনা', () => {
  it.each([
    ['1.10.0', '1.9.0', true],
    ['1.9.0', '1.10.0', false],
    ['2.0.0', '1.99.99', true],
    ['1.2.3', '1.2.3', false],
    ['1.2', '1.2.0', false],
    ['1.2.1', '1.2', true],
  ])('%s > %s → %s', (a, b, expected) => {
    expect(isNewer(a, b)).toBe(expected);
  });

  /** ⚠️ স্ট্রিং তুলনায় '1.10.0' < '1.9.0' — ক্লাসিক ফাঁদ */
  it('স্ট্রিং তুলনার ফাঁদে পড়ে না', () => {
    expect('1.10.0' > '1.9.0').toBe(false);
    expect(isNewer('1.10.0', '1.9.0')).toBe(true);
  });
});
