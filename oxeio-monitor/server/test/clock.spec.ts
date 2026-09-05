import { describe, expect, it } from 'vitest';

import { dhakaNoon, dhakaTodayIso } from './setup/clock';
import { workDateOf } from '../src/agent/util/dhaka-time';

/**
 * ⭐⭐ **G140 — যে হেল্পারের উপর এখন প্রতিটা ফিক্সচার দাঁড়িয়ে, তার নিজের
 * পাহারা।**
 *
 * ⚠️ `dhakaNoon()` ভুল হলে কোনো এরর উঠত না — শুধু ফিক্সচারগুলো আবার
 * সীমানার কাছে সরে যেত, আর টেস্ট বছরে কয়েকবার নীরবে ভাঙত। ঠিক সেই
 * ব্যর্থতাটাই তিনবার ঘটেছে (G62 · adjustments · agent-recovery), আর
 * প্রতিবার ধরা পড়েছে **কাকতালীয়ভাবে** — CI ওই ঘণ্টায় চলায়।
 *
 * ⭐ এই টেস্টগুলো কাকতাল সরিয়ে দেয়: দাবিটা সময়ের উপর নির্ভর করে না,
 * তাই দিনের যেকোনো মুহূর্তে চালালেই একই উত্তর।
 */
describe('dhakaNoon — ফিক্সচারের নিরাপদ মুহূর্ত', () => {
  it('ঢাকার দুপুর ১২টা, অর্থাৎ ০৬:০০ UTC', () => {
    expect(dhakaNoon().toISOString().slice(11)).toBe('06:00:00.000Z');
  });

  it('আজকের ঢাকা-দিনেই পড়ে — সার্ভারের "আজ"-এর সাথে এক', () => {
    expect(workDateOf(dhakaNoon()).getTime()).toBe(
      workDateOf(new Date()).getTime(),
    );
  });

  /**
   * ⭐⭐ **এটাই ফাইলের সবচেয়ে জরুরি দাবি।** পুরো নিয়মটার একমাত্র যুক্তি
   * হলো মুহূর্তটা দুই সীমানা থেকেই দূরে — কেউ `+ 6 * 3_600_000` কে
   * `+ 1 * 3_600_000` করে দিলে বাকি সব টেস্ট **সবুজই থাকত**, শুধু
   * বোমাটা ফিরে আসত।
   */
  it('ঢাকার দুই মধ্যরাত থেকেই ১১ ঘণ্টার বেশি দূরে', () => {
    const noon = dhakaNoon();
    /**
     * ⚠️⚠️ `workDateOf()` ঢাকার দিনটাকে **UTC-মধ্যরাত হিসেবে লেবেল** করে
     * ফেরায় (`2026-09-05T00:00:00Z` = ৫ সেপ্টেম্বরের ঢাকা-দিন)। আসল
     * ঢাকা-মধ্যরাতের **মুহূর্ত** তার ছ-ঘণ্টা আগে — লেবেল আর মুহূর্ত এক
     * ধরে নিয়ে এই টেস্টটা প্রথমবার ভেঙেছিল, আর সেটাই লিখে রাখার মতো:
     * `todayWindow()`-ও ঠিক এই কারণে `- 6 * 3_600_000` করে।
     */
    const midnight = workDateOf(noon).getTime() - 6 * 3_600_000;
    const sinceMidnight = noon.getTime() - midnight;
    const untilNextMidnight = midnight + 86_400_000 - noon.getTime();

    expect(sinceMidnight).toBeGreaterThan(11 * 3_600_000);
    expect(untilNextMidnight).toBeGreaterThan(11 * 3_600_000);
  });

  it('dayOffset ঠিক ২৪ ঘণ্টা করে সরায়, দুপুরেই থাকে', () => {
    for (const d of [-3, -1, 1, 3]) {
      expect(dhakaNoon(d).getTime() - dhakaNoon().getTime()).toBe(
        d * 86_400_000,
      );
      expect(dhakaNoon(d).toISOString().slice(11)).toBe('06:00:00.000Z');
    }
  });

  it('dhakaTodayIso() ঠিক ওই দিনটাই বলে', () => {
    expect(dhakaTodayIso()).toBe(dhakaNoon().toISOString().slice(0, 10));
  });

  /**
   * ⚠️ ঢাকা UTC+৬ — তাই UTC-ভিত্তিক পুরোনো সূত্রটা ঢাকার ০০:০০–০৬:০০-এ
   * **আগের দিন** বলত। জানালাটা দিনে ছ-ঘণ্টা চওড়া ছিল, আর সেটাই G62।
   */
  it('UTC-র তারিখ নয়, ঢাকার তারিখ', () => {
    const utcDate = new Date().toISOString().slice(0, 10);
    const dhakaDate = dhakaTodayIso();
    const hourUtc = new Date().getUTCHours();
    if (hourUtc >= 18) expect(dhakaDate).not.toBe(utcDate);
    else expect(dhakaDate).toBe(utcDate);
  });
});
