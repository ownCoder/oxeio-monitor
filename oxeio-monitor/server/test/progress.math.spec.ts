import { describe, expect, it } from 'vitest';

import { expectedSecOf, paceSecOf } from '../src/agent/progress.math';

/**
 * B05b — tray-র "এগিয়ে / পিছিয়ে"।
 *
 * ⭐ এই সংখ্যাটা স্টাফ **রোজ** দেখে, তাই ভুল হলে সেটা নীরবে ভুল হতো না —
 * নীরবে অবিশ্বাস তৈরি করত। তাই সীমার কেসগুলোই এখানে বেশি।
 */
const BASE = {
  creditedSec: 0,
  monthlyTargetHours: 208,
  expectedWorkdays: 26,
  workdaysElapsed: 0,
};

describe('expectedSecOf — আজ পর্যন্ত কত হওয়ার কথা', () => {
  it('মাসের শুরুতে (কোনো কর্মদিবস পেরোয়নি) প্রত্যাশা শূন্য', () => {
    expect(expectedSecOf(BASE)).toBe(0);
  });

  it('অর্ধেক কর্মদিবসে টার্গেটের ঠিক অর্ধেক', () => {
    expect(expectedSecOf({ ...BASE, workdaysElapsed: 13 })).toBe(
      (208 * 3600) / 2,
    );
  });

  /**
   * ⭐ সবচেয়ে জরুরি কেস: মাসের **শেষ** কর্মদিবসে প্রত্যাশা ঠিক টার্গেটে
   * গিয়ে ঠেকে, তার বেশিও নয় কমও নয়। না মিললে যে কর্মী পুরো মাস নিখুঁত
   * কাজ করেছেন তিনিও শেষ দিনে "পিছিয়ে" দেখতেন।
   */
  it('মাসের শেষ কর্মদিবসে প্রত্যাশা = পুরো টার্গেট', () => {
    expect(expectedSecOf({ ...BASE, workdaysElapsed: 26 })).toBe(208 * 3600);
  });

  it('ছুটি বেশি হলে (কর্মদিবস কম) দৈনিক প্রত্যাশা বাড়ে, মোট টার্গেট বদলায় না', () => {
    const eid = { ...BASE, expectedWorkdays: 20, workdaysElapsed: 20 };
    expect(expectedSecOf(eid)).toBe(208 * 3600);
    // ২০ দিনে ২০৮ ঘণ্টা মানে প্রতিদিন ১০.৪ ঘণ্টা
    expect(expectedSecOf({ ...eid, workdaysElapsed: 1 })).toBe(
      Math.round((208 * 3600) / 20),
    );
  });

  /**
   * ⚠️ পুরো মাস ছুটি ঘোষণা করলে `expectedWorkdays === 0`। ভাগ না আটকালে
   * `NaN` তারে যেত, আর এজেন্টের STJ `NaN` চেনে না — তখন heartbeat-এর
   * **পুরো** উত্তরটাই (revoke কমান্ড সহ) পড়া যেত না।
   */
  it('কর্মদিবস শূন্য হলে NaN নয়, ০', () => {
    const out = expectedSecOf({ ...BASE, expectedWorkdays: 0 });
    expect(Number.isNaN(out)).toBe(false);
    expect(out).toBe(0);
  });

  it('টার্গেট ০ বা ঋণাত্মক হলে ছোড়ে না, ০ দেয়', () => {
    expect(expectedSecOf({ ...BASE, monthlyTargetHours: 0 })).toBe(0);
    expect(expectedSecOf({ ...BASE, monthlyTargetHours: -8 })).toBe(0);
  });

  it('পেরোনো দিন কর্মদিবসের চেয়ে বেশি হলেও প্রত্যাশা টার্গেট ছাড়ায় না', () => {
    expect(expectedSecOf({ ...BASE, workdaysElapsed: 99 })).toBe(208 * 3600);
  });

  it('সবসময় পূর্ণসংখ্যা — সেকেন্ডের ভগ্নাংশ তারে যায় না', () => {
    const out = expectedSecOf({
      ...BASE,
      monthlyTargetHours: 208,
      expectedWorkdays: 23,
      workdaysElapsed: 7,
    });
    expect(Number.isInteger(out)).toBe(true);
  });
});

describe('paceSecOf — এগিয়ে না পিছিয়ে', () => {
  it('ঠিক প্রত্যাশা অনুযায়ী কাজ হলে গতি ঠিক ০', () => {
    const input = { ...BASE, workdaysElapsed: 13 };
    expect(paceSecOf({ ...input, creditedSec: expectedSecOf(input) })).toBe(0);
  });

  it('বেশি কাজ = ধনাত্মক (এগিয়ে)', () => {
    const input = { ...BASE, workdaysElapsed: 10, creditedSec: 90 * 3600 };
    expect(paceSecOf(input)).toBeGreaterThan(0);
  });

  it('কম কাজ = ঋণাত্মক (পিছিয়ে)', () => {
    const input = { ...BASE, workdaysElapsed: 10, creditedSec: 10 * 3600 };
    expect(paceSecOf(input)).toBeLessThan(0);
  });

  /**
   * ⭐ § ২.১-ঙ (G35) — owner-এর সংশোধন গতিতে গোনা **হতেই হবে**। নইলে
   * সার্ভারের দোষে ঘণ্টা হারানো স্টাফকে ঘণ্টা ফেরত দেওয়ার পরেও tray সারা
   * মাস "পিছিয়ে" বলত, অথচ ড্যাশবোর্ড বলত এগিয়ে।
   */
  it('সংশোধনের ঘণ্টা যোগ হলে গতি এগোয়', () => {
    const input = { ...BASE, workdaysElapsed: 10 };
    const without = paceSecOf({ ...input, creditedSec: 60 * 3600 });
    const withAdj = paceSecOf({ ...input, creditedSec: 60 * 3600 + 7200 });
    expect(withAdj - without).toBe(7200);
  });

  /**
   * ⚠️ বড় কর্তন `credited`-কে ঋণাত্মক করে ফেললে tray দেখাত
   * "−৩১২ ঘণ্টা পিছিয়ে" — কারো কাছেই যার কোনো অর্থ নেই।
   */
  it('credited ঋণাত্মক হলে ০ ধরা হয়, গতি অতল হয় না', () => {
    const input = { ...BASE, workdaysElapsed: 10, creditedSec: -500 * 3600 };
    expect(paceSecOf(input)).toBe(-expectedSecOf(input));
  });

  it('মাসের শুরুতে কিছু না করলেও গতি ০ — প্রথম দিনেই "পিছিয়ে" নয়', () => {
    expect(paceSecOf({ ...BASE, workdaysElapsed: 0, creditedSec: 0 })).toBe(0);
  });

  it('পুরো মাস ছুটি হলে যেকোনো কাজই এগিয়ে, কখনো NaN নয়', () => {
    const out = paceSecOf({
      ...BASE,
      expectedWorkdays: 0,
      workdaysElapsed: 0,
      creditedSec: 3600,
    });
    expect(out).toBe(3600);
  });
});
