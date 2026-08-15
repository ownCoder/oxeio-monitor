import { describe, expect, it } from 'vitest';

import { expectedSecOf as trayExpectedSec } from '../src/agent/progress.math';
import { prorate } from '../src/summary/proration';
import {
  countLeaveWorkdays,
  elapsedWorkdays,
  proratedExpectedSec,
  rollupMonth,
} from '../src/summary/summary.math';

const HOUR = 3600;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * ⭐⭐ **R2 — ছুটি: চারটে পর্দা, একটাই সংখ্যা।**
 *
 * ছুটি ঠিক চার জায়গায় ঢোকে, আর তার তিনটেই একটা ভগ্নাংশের অংশ:
 *
 * ```
 *   targetSec  = (d − ছুটি) × দৈনিক          ← prorate()
 *   expected   = targetSec × (কেটে যাওয়া − ছুটি)  ← elapsedWorkdays()  [লব]
 *                            ─────────────────
 *                              (d − ছুটি)          ← proratedExpectedSec() [হর]
 * ```
 *
 * ⚠️⚠️ **এক দিকে বাদ দিয়ে অন্য দিকে না দেওয়াটাই এখানকার একমাত্র বাগ যা
 * নীরবে ভুল সংখ্যা দেয়** — ব্যতিক্রম ছোড়ে না, টেস্ট লাল হয় না, শুধু
 * ছুটি নেওয়া মানুষটা মাসভর "পিছিয়ে" দেখায়। তাই এই ফাইলের টেস্টগুলো
 * সংখ্যা মেলায় না, **অপরিবর্তনীয় সম্পর্ক** মেলায়।
 */

/** সেপ্টেম্বর ২০২৬ — শুক্রবার সাপ্তাহিক ছুটি, ২৬ কর্মদিবস */
const SEPT = {
  monthStart: day('2026-09-01'),
  monthEnd: day('2026-09-30'),
  joinedOn: null,
  leftOn: null,
  weeklyOffDay: 5,
  holidays: new Set<number>(),
  monthlyTargetSec: 208 * HOUR,
  policyWorkdays: 26,
};

describe('countLeaveWorkdays — কেবল কর্মদিবসই গোনে', () => {
  const from = day('2026-09-01');
  const to = day('2026-09-30');

  it('কর্মদিবসের ছুটি গোনা হয়', () => {
    const leave = new Set([day('2026-09-01').getTime(), day('2026-09-02').getTime()]);
    expect(countLeaveWorkdays(leave, from, to, 5, new Set())).toBe(2);
  });

  it('শুক্রবার (৪ সেপ্টেম্বর) গোনা হয় না', () => {
    const leave = new Set([day('2026-09-04').getTime()]);
    expect(countLeaveWorkdays(leave, from, to, 5, new Set())).toBe(0);
  });

  it('সরকারি ছুটির দিন গোনা হয় না', () => {
    const leave = new Set([day('2026-09-07').getTime()]);
    const holidays = new Set([day('2026-09-07').getTime()]);
    expect(countLeaveWorkdays(leave, from, to, 5, holidays)).toBe(0);
  });

  it('জানালার বাইরের তারিখ গোনা হয় না', () => {
    const leave = new Set([day('2026-08-31').getTime(), day('2026-10-01').getTime()]);
    expect(countLeaveWorkdays(leave, from, to, 5, new Set())).toBe(0);
  });

  it('খালি বা অনুপস্থিত সেটে শূন্য', () => {
    expect(countLeaveWorkdays(undefined, from, to, 5, new Set())).toBe(0);
    expect(countLeaveWorkdays(new Set(), from, to, 5, new Set())).toBe(0);
  });
});

describe('rollupMonth — ছুটি', () => {
  /**
   * ⚠️⚠️ **এটা একটা সত্যিকারের ক্র্যাশ ছিল**, কোনো কাল্পনিক ধার নয়।
   *
   * পুরোনো গার্ডটা ছিল `targetSec === 0 && expectedWorkdays > 0` → throw।
   * গোটা মাস ছুটিতে থাকা কর্মীর ক্ষেত্রে **দুটোই সত্যি**: টার্গেট ০
   * (ছুটি টার্গেট কমায়) আর d অটুট (ছুটি সবেতন)। আর `refreshMonth()`
   * সবার সারি একটাই লুপে লেখে — অর্থাৎ একজনের ছুটি **গোটা দলের** মাসিক
   * সারি লেখা বন্ধ করে দিত।
   */
  it('⭐⭐ গোটা মাস ছুটি থাকলেও ছোড়ে না', () => {
    expect(() =>
      rollupMonth({
        workedSec: 0,
        adjustmentSec: 0,
        targetSec: 0,
        expectedWorkdays: 26,
        monthWorkdays: 26,
        leaveWorkdays: 26,
        workdaysElapsed: 0,
        daysWithWork: 0,
      }),
    ).not.toThrow();
  });

  /** ⭐ যা ধরার জন্য গার্ডটা ছিল, সেটা এখনো ধরা পড়ে */
  it('ছুটি বাদ দেওয়ার পরও কর্মদিবস থাকলে টার্গেট ০ হতে পারে না', () => {
    expect(() =>
      rollupMonth({
        workedSec: 0,
        adjustmentSec: 0,
        targetSec: 0,
        expectedWorkdays: 26,
        monthWorkdays: 26,
        leaveWorkdays: 5,
        workdaysElapsed: 0,
        daysWithWork: 0,
      }),
    ).toThrow(RangeError);
  });

  it('গোটা মাস ছুটিতে থাকলে প্রত্যাশা ০ — অর্থাৎ কোনো ঘাটতিও নেই', () => {
    const m = rollupMonth({
      workedSec: 0,
      adjustmentSec: 0,
      targetSec: 0,
      expectedWorkdays: 26,
      monthWorkdays: 26,
      leaveWorkdays: 26,
      workdaysElapsed: 0,
      daysWithWork: 0,
    });

    expect(m.expectedSec).toBe(0);
    expect(m.paceSec).toBe(0);
    expect(m.shortfallSec).toBe(0);
    // ⭐ তবু d ও D অটুট — বেতন পুরো
    expect(m.expectedWorkdays).toBe(26);
    expect(m.monthWorkdays).toBe(26);
    expect(m.leaveWorkdays).toBe(26);
  });
});

/**
 * ⭐⭐ **এই describe-টাই এই ফাইলের কারণ।**
 *
 * ছুটি লব ও হর দুটোতেই বাদ যায়, তাই **একটা বিল-যোগ্য দিনের হার অপরিবর্তিত
 * থাকে**। অর্থাৎ ছুটি নেওয়ার পর প্রত্যাশা কমে ঠিক ততটুকুই, যতটুকু দিন
 * তিনি কাজ করেননি — এক সেকেন্ডও বেশি বা কম নয়।
 */
describe('প্রত্যাশা — ছুটি লব ও হর দুটোতেই', () => {
  const DAILY = 8 * HOUR;

  it('⭐⭐ ছুটির আগে-পরে "প্রতি কেটে যাওয়া দিনে প্রত্যাশা" এক থাকে', () => {
    // ছুটি নেই: ২৬ দিনের টার্গেট, ১০ দিন কেটেছে
    const plain = proratedExpectedSec({
      targetSec: 26 * DAILY,
      expectedWorkdays: 26,
      workdaysElapsed: 10,
    });

    // ৪ দিন ছুটি, যার ২ দিন ইতিমধ্যে কেটে গেছে
    const withLeave = proratedExpectedSec({
      targetSec: 22 * DAILY,
      expectedWorkdays: 26,
      leaveWorkdays: 4,
      workdaysElapsed: 8,
    });

    expect(plain).toBe(10 * DAILY);
    expect(withLeave).toBe(8 * DAILY);
    // ⭐ দুটোই ঠিক ৮ ঘণ্টা প্রতি কাজের দিন — হার বদলায়নি
    expect(withLeave / 8).toBe(plain / 10);
  });

  /**
   * ⚠️⚠️ যদি কেউ ভবিষ্যতে হর থেকে ছুটি বাদ দিতে ভুলে যায় (অথবা লব থেকে),
   *    এই টেস্টটাই একমাত্র জিনিস যা ধরবে — কারণ সংখ্যাটা তখনো "যুক্তিসঙ্গত"
   *    দেখাবে, শুধু ভুল হবে।
   */
  it('⚠️ কেবল লবে বাদ দিলে হার কমে যেত — সেটা যেন না হয়', () => {
    const correct = proratedExpectedSec({
      targetSec: 22 * DAILY,
      expectedWorkdays: 26,
      leaveWorkdays: 4,
      workdaysElapsed: 8,
    });
    const buggy = proratedExpectedSec({
      targetSec: 22 * DAILY,
      expectedWorkdays: 26, // হর থেকে ছুটি বাদ দিতে ভুলে গেলে
      workdaysElapsed: 8,
    });

    expect(correct).toBe(8 * DAILY);
    expect(buggy).toBeLessThan(correct);
  });

  it('মাসের সব দিন ছুটি হলে হর ০ — প্রত্যাশাও ০, ভাগ নয়', () => {
    const p = proratedExpectedSec({
      targetSec: 0,
      expectedWorkdays: 26,
      leaveWorkdays: 26,
      workdaysElapsed: 0,
    });
    expect(p).toBe(0);
    expect(Number.isFinite(p)).toBe(true);
  });

  /**
   * ⭐⭐ **tray আর মাসিক সারি একই সংখ্যা বলে** — G88-এর মূল নিয়ম।
   *
   * ⚠️ tray আলাদা ফাংশন ডাকে (`progress.math.ts`), কারণ ওটা ছোড়ে না।
   *    ছুটি সেখানে আলাদা করে না পৌঁছালে কর্মী তাঁর নিজের পর্দায় "পিছিয়ে"
   *    দেখতেন আর মালিক Live Board-এ "ঠিক আছে" — আর tray-ই সেই পর্দা যেটা
   *    তিনি সারাদিন দেখেন।
   */
  it('⭐⭐ tray-র প্রত্যাশা মাসিক সারির সাথে হুবহু মেলে', () => {
    const shared = {
      expectedWorkdays: 26,
      leaveWorkdays: 4,
      workdaysElapsed: 8,
    };

    const monthly = proratedExpectedSec({ targetSec: 22 * DAILY, ...shared });
    const tray = trayExpectedSec({
      creditedSec: 0,
      monthlyTargetHours: (22 * DAILY) / HOUR,
      ...shared,
    });

    expect(tray).toBe(monthly);
  });
});

describe('elapsedWorkdays — ছুটি', () => {
  const BASE = {
    periodStart: day('2026-09-01'),
    periodEnd: day('2026-09-30'),
    today: day('2026-09-15'),
    joinedOn: null,
    leftOn: null,
    trackingStartedOn: null,
    weeklyOffDay: 5,
    holidays: new Set<number>(),
  };

  it('জানালার ভেতরের ছুটি বাদ যায়', () => {
    const plain = elapsedWorkdays(BASE);
    const leave = new Set([day('2026-09-01').getTime(), day('2026-09-02').getTime()]);
    expect(elapsedWorkdays(BASE, leave)).toBe(plain - 2);
  });

  /** ⚠️ আজকের দিনটা জানালার বাইরে (আজ শেষ হয়নি) — আজকের ছুটিও তাই বাইরে */
  it('আজকের ছুটি বাদ যায় না, কারণ আজকের দিনটাই এখনো গোনা হয়নি', () => {
    const plain = elapsedWorkdays(BASE);
    const leave = new Set([day('2026-09-15').getTime()]);
    expect(elapsedWorkdays(BASE, leave)).toBe(plain);
  });

  it('ঋণাত্মক হয় না', () => {
    const all = new Set<number>();
    for (let n = 1; n <= 30; n++) all.add(day(`2026-09-${String(n).padStart(2, '0')}`).getTime());
    expect(elapsedWorkdays(BASE, all)).toBe(0);
  });
});

/**
 * ⭐ শেষ পাহারাটা গোটা শৃঙ্খলের: `prorate()` → `elapsedWorkdays()` →
 * `proratedExpectedSec()`, ঠিক যে ক্রমে `summary.service.ts` ডাকে।
 */
describe('পুরো শৃঙ্খল — ছুটির পরেও ঘাটতি জন্মায় না', () => {
  it('⭐⭐ ছুটি কাটিয়ে ফিরে আসা কেউ "পিছিয়ে" দেখায় না', () => {
    // ১ থেকে ৩ সেপ্টেম্বর ছুটি (তিনটেই কর্মদিবস)
    const leaveDates = new Set([
      day('2026-09-01').getTime(),
      day('2026-09-02').getTime(),
      day('2026-09-03').getTime(),
    ]);

    const p = prorate({ ...SEPT, leaveDates });

    const elapsed = elapsedWorkdays(
      {
        periodStart: SEPT.monthStart,
        periodEnd: SEPT.monthEnd,
        today: day('2026-09-15'),
        joinedOn: null,
        leftOn: null,
        trackingStartedOn: null,
        weeklyOffDay: 5,
        holidays: SEPT.holidays,
      },
      leaveDates,
    );

    const expected = proratedExpectedSec({
      targetSec: p.targetSec,
      expectedWorkdays: p.employeeWorkdays,
      leaveWorkdays: p.leaveWorkdays,
      workdaysElapsed: elapsed,
    });

    // ⭐ ছুটির পরে ফিরে ঠিক ওই কাজের দিনগুলোই কাজ করলে pace ঠিক ০
    const credited = elapsed * 8 * HOUR;
    expect(credited - expected).toBe(0);
  });
});
