import { describe, expect, it } from 'vitest';

import {
  spreadIntoHourBuckets,
  spreadTeamIntoHourBuckets,
} from '../src/dashboard/dashboard.math';

/**
 * **E01 — দলের দিনের ছন্দ** (`GET /live/pulse`)।
 *
 * ⭐ খাঁটি ফাংশন, তাই DB ছাড়াই পুরোটা মাপা যায়। আর মাপার মতো জিনিস
 * দুটোই: **সেকেন্ড হারায় না**, আর **কতজন** সংখ্যাটা সত্যি বলে।
 */

/**
 * কর্মদিবসটা Prisma-র `@db.Date` ধাঁচে — UTC-midnight `Date`।
 *
 * ⚠️⚠️ কিন্তু ঢাকার **স্থানীয়** মধ্যরাত ওটার ছয় ঘণ্টা **আগে**
 * (`dayStartUtcMs = workDate − ৬ঘ`)। প্রথমে এই বিয়োগটা ভুলে গিয়ে
 * helper লিখেছিলাম, আর ছটা টেস্ট সাথে সাথে ফেল করেছিল — সব কাজ ঠিক
 * ছয় ঘরে সরে গিয়েছিল।
 *
 * ⭐ এটাই এই টেস্ট ফাইলটার প্রথম আসল কাজ: **টাইমজোনের ভুল ধরা**।
 */
const DHAKA_OFFSET_MS = 6 * 3_600_000;
const DAY = new Date('2026-08-13T00:00:00.000Z');
const DAY_START_MS = DAY.getTime() - DHAKA_OFFSET_MS;

/** ঢাকার `hour`-এ শুরু, `mins` মিনিট ধরে */
function seg(employeeId: number, hour: number, mins: number, atMin = 0) {
  const startMs = DAY_START_MS + hour * 3_600_000 + atMin * 60_000;
  return {
    employeeId,
    startedAt: new Date(startMs),
    endedAt: new Date(startMs + mins * 60_000),
    durationSec: mins * 60,
  };
}

describe('spreadTeamIntoHourBuckets · সেকেন্ডের হিসাব', () => {
  it('সবসময় ২৪টা বালতি, খালি ঘণ্টাও শূন্য নিয়ে থাকে', () => {
    const hours = spreadTeamIntoHourBuckets([], DAY);

    expect(hours).toHaveLength(24);
    expect(hours.map((h) => h.hour)).toEqual([...Array(24).keys()]);
    expect(hours.every((h) => h.activeSec === 0 && h.people === 0)).toBe(true);
  });

  it('দুজনের একই ঘণ্টার কাজ যোগ হয়', () => {
    const hours = spreadTeamIntoHourBuckets(
      [seg(1, 10, 60), seg(2, 10, 30)],
      DAY,
    );

    expect(hours[10].activeSec).toBe(90 * 60);
  });

  /**
   * ⚠️⚠️ এই টেস্টটাই আসল পাহারাদার। সব সেগমেন্ট এক গাদা করে ছড়ালে মোট
   * ঠিকই আসত, তাই মোট দিয়ে বাগটা ধরা যেত না — ধরা পড়ে **কতজন** দিয়ে।
   */
  it('ঘণ্টার সীমানা পেরোনো কাজ অনুপাতে ভাগ হয়, আর মোট অটুট থাকে', () => {
    // ১০:৪৫ থেকে ৯০ মিনিট → ১০টায় ১৫মি, ১১টায় ৬০মি, ১২টায় ১৫মি
    const hours = spreadTeamIntoHourBuckets([seg(1, 10, 90, 45)], DAY);

    expect(hours[10].activeSec).toBe(15 * 60);
    expect(hours[11].activeSec).toBe(60 * 60);
    expect(hours[12].activeSec).toBe(15 * 60);

    const total = hours.reduce((a, h) => a + h.activeSec, 0);
    expect(total).toBe(90 * 60);
  });

  /**
   * ⭐ একজনের `/hourly` চার্ট আর দলের ছন্দ **একই ফাংশন** থেকে আসে, তাই
   * দুটো কখনো আলাদা গল্প বলতে পারে না। নিয়মটা নকল হলে একদিন একটা বদলাত
   * আর অন্যটা নয় — এই টেস্ট সেটাই আটকায়।
   */
  it('একজনের হিসাব `spreadIntoHourBuckets`-এর সাথে হুবহু মেলে', () => {
    const rows = [seg(7, 9, 50, 20), seg(7, 14, 130, 10), seg(7, 22, 45, 40)];

    const team = spreadTeamIntoHourBuckets(rows, DAY);
    const solo = spreadIntoHourBuckets(rows, DAY);

    expect(team.map((h) => h.activeSec)).toEqual(solo);
  });
});

describe('spreadTeamIntoHourBuckets · কতজন', () => {
  /**
   * ⭐⭐ এই দুটো টেস্ট একসাথে না থাকলে `people` অর্থহীন হতো — একটা মাপে
   * "একই লোক দুবার গোনা হয় না", অন্যটা "আলাদা লোক আলাদা করে গোনা হয়"।
   */
  it('একই কর্মীর দুটো সেগমেন্ট এক ঘণ্টায় থাকলে তিনি একজনই', () => {
    const hours = spreadTeamIntoHourBuckets(
      [seg(1, 10, 20), seg(1, 10, 20, 30)],
      DAY,
    );

    expect(hours[10].people).toBe(1);
    expect(hours[10].activeSec).toBe(40 * 60);
  });

  it('আলাদা কর্মী আলাদা করে গোনা হন', () => {
    const hours = spreadTeamIntoHourBuckets(
      [seg(1, 10, 20), seg(2, 10, 20), seg(3, 10, 20)],
      DAY,
    );

    expect(hours[10].people).toBe(3);
  });

  /**
   * ⚠️ সীমা ছাড়া `> 0` — এক সেকেন্ডও যদি ওই ঘণ্টায় পড়ে, মানুষটা "ছিলেন"।
   * সীমা বসালে সেটা হতো একটা নীরব মত, আর কেউ জানত না কেন ভোরের একজন উধাও।
   */
  it('ঘণ্টার কানায় পড়া সামান্য সময়ও মানুষটাকে গোনে', () => {
    // ০৯:৫৯:৩০ → ১০:০০:৩০, অর্থাৎ দুই ঘণ্টার ঘরে ৩০ সেকেন্ড করে।
    // ⚠️ সেকেন্ডের নিখুঁত সীমানা দরকার, তাই `seg()` নয় — ওর ধাপ মিনিট।
    const start = DAY_START_MS + 9 * 3_600_000 + 59 * 60_000 + 30_000;
    const hours = spreadTeamIntoHourBuckets(
      [
        {
          employeeId: 4,
          startedAt: new Date(start),
          endedAt: new Date(start + 60_000),
          durationSec: 60,
        },
      ],
      DAY,
    );

    expect(hours[9].activeSec).toBe(30);
    expect(hours[10].activeSec).toBe(30);
    expect(hours[9].people).toBe(1);
    expect(hours[10].people).toBe(1);
  });

  it('যে ঘণ্টায় কেউ ছিলেন না, সেখানে শূন্য — আর সেটা বৈধ উত্তর', () => {
    const hours = spreadTeamIntoHourBuckets([seg(1, 10, 30)], DAY);

    expect(hours[3].people).toBe(0);
    expect(hours[3].activeSec).toBe(0);
  });

  /**
   * ⭐ `peakPeople` (সার্ভিসে গোনা) এই সংখ্যাটার উপরেই দাঁড়ায় — চার্টের
   * y-অক্ষের সীমা। তাই সর্বোচ্চটা সত্যিই সর্বোচ্চ কি না, সেটা মেপে রাখা।
   */
  it('সর্বোচ্চ একসাথে কতজন — সেটাই চার্টের অক্ষের সীমা', () => {
    const hours = spreadTeamIntoHourBuckets(
      [seg(1, 9, 60), seg(1, 14, 60), seg(2, 14, 60), seg(3, 14, 60)],
      DAY,
    );

    expect(Math.max(...hours.map((h) => h.people))).toBe(3);
    expect(hours[9].people).toBe(1);
    expect(hours[14].people).toBe(3);
  });
});
