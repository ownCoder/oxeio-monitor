import { describe, expect, it } from 'vitest';

import {
  AGENT_DOWN_AFTER_SEC,
  decideLiveStatus,
  formatWorkDate,
  HOURS_PER_DAY,
  monthStartOf,
  OFFLINE_AFTER_SEC,
  parseWorkDate,
  previousWorkDate,
  spreadIntoHourBuckets,
} from '../src/dashboard/dashboard.math';

/** ঢাকার ১০ আগস্ট ২০২৬ — কর্মদিবস মানেই UTC-midnight Date */
const WORK_DATE = new Date(Date.UTC(2026, 7, 10));

/** ঢাকার ওই দিনের `HH:MM` → UTC instant (ঢাকা = UTC+6, DST নেই) */
function dhaka(hh: number, mm = 0, ss = 0): Date {
  return new Date(Date.UTC(2026, 7, 10, hh - 6, mm, ss));
}

const NOW = new Date('2026-08-10T09:00:00.000Z');
const secondsAgo = (sec: number): Date => new Date(NOW.getTime() - sec * 1000);

describe('decideLiveStatus — কার্ডের রঙ', () => {
  const base = { hasDevice: true, lastState: 'active' as const, now: NOW };

  it('তাজা heartbeat হলে শেষ সেগমেন্টের state-ই দেখায়', () => {
    expect(decideLiveStatus({ ...base, lastSeenAt: secondsAgo(5) })).toBe(
      'active',
    );
    expect(
      decideLiveStatus({
        ...base,
        lastSeenAt: secondsAgo(5),
        lastState: 'idle',
      }),
    ).toBe('idle');
  });

  it('locked আলাদা রঙ পায় না — idle-এ মেশে', () => {
    expect(
      decideLiveStatus({
        ...base,
        lastSeenAt: secondsAgo(5),
        lastState: 'locked',
      }),
    ).toBe('idle');
  });

  it('৯০ সেকেন্ড পেরোলে offline, ১০ মিনিট পেরোলে agent_down', () => {
    expect(decideLiveStatus({ ...base, lastSeenAt: secondsAgo(120) })).toBe(
      'offline',
    );
    expect(decideLiveStatus({ ...base, lastSeenAt: secondsAgo(700) })).toBe(
      'agent_down',
    );
  });

  /**
   * ⭐ সবচেয়ে দরকারি টেস্ট। শর্ত দুটোর ক্রম উল্টে গেলে (আগে ৯০ সে., পরে
   * ৬০০ সে.) তিন ঘণ্টা ধরে মরে থাকা এজেন্টও নিরীহ ⚪ offline দেখাত —
   * 🔴 কোনোদিন উঠত না, অথচ ওটাই ধরার জন্য ফিচারটা।
   */
  it('অনেকক্ষণ চুপ থাকা এজেন্ট offline নয়, agent_down', () => {
    expect(
      decideLiveStatus({ ...base, lastSeenAt: secondsAgo(3 * 3600) }),
    ).toBe('agent_down');
  });

  it('সীমানার ঠিক উপরে — "বেশি হলে" মানে কঠোরভাবে বেশি', () => {
    expect(
      decideLiveStatus({ ...base, lastSeenAt: secondsAgo(OFFLINE_AFTER_SEC) }),
    ).toBe('active');
    expect(
      decideLiveStatus({
        ...base,
        lastSeenAt: secondsAgo(OFFLINE_AFTER_SEC + 1),
      }),
    ).toBe('offline');
    expect(
      decideLiveStatus({
        ...base,
        lastSeenAt: secondsAgo(AGENT_DOWN_AFTER_SEC),
      }),
    ).toBe('offline');
    expect(
      decideLiveStatus({
        ...base,
        lastSeenAt: secondsAgo(AGENT_DOWN_AFTER_SEC + 1),
      }),
    ).toBe('agent_down');
  });

  it('ডিভাইসই না থাকলে offline — লাল অ্যালার্ম নয়', () => {
    expect(
      decideLiveStatus({
        hasDevice: false,
        lastSeenAt: null,
        lastState: null,
        now: NOW,
      }),
    ).toBe('offline');
  });

  it('ডিভাইস আছে কিন্তু কখনো সাড়া দেয়নি — agent_down', () => {
    expect(
      decideLiveStatus({
        hasDevice: true,
        lastSeenAt: null,
        lastState: null,
        now: NOW,
      }),
    ).toBe('agent_down');
  });

  it('এজেন্ট জীবিত কিন্তু সেগমেন্ট আসেনি — না-জানাকে active ধরা হয় না', () => {
    expect(
      decideLiveStatus({
        ...base,
        lastSeenAt: secondsAgo(10),
        lastState: null,
      }),
    ).toBe('idle');
  });

  it('ডিভাইসের ঘড়ি এগিয়ে থাকলেও (ভবিষ্যতের lastSeenAt) তাজাই ধরা হয়', () => {
    expect(
      decideLiveStatus({ ...base, lastSeenAt: secondsAgo(-30) }),
    ).toBe('active');
  });
});

describe('spreadIntoHourBuckets — ঘণ্টার বালতি (E05)', () => {
  it('এক ঘণ্টার ভেতরের সেগমেন্ট পুরোটাই সেই ঘণ্টায়', () => {
    const buckets = spreadIntoHourBuckets(
      [{ startedAt: dhaka(10, 10), endedAt: dhaka(10, 40), durationSec: 1800 }],
      WORK_DATE,
    );

    expect(buckets).toHaveLength(HOURS_PER_DAY);
    expect(buckets[10]).toBe(1800);
    expect(sum(buckets)).toBe(1800);
  });

  /**
   * ⭐ এই ফিচারের মূল ফাঁদ। ১০:৪৫–১২:১৫ = ৯০ মিনিট। পুরোটা শুরুর ঘণ্টায়
   * ফেলে দিলে চার্ট বলত "১০টায় ৯০ মিনিট কাজ" — এক ঘণ্টার ঘরে দেড়
   * ঘণ্টা, আর ১১টার ঘরে শূন্য। ভুলটা চোখে পড়ত না, কারণ মোট ঠিকই থাকত।
   */
  it('তিন ঘণ্টা জুড়ে ছড়ানো সেগমেন্ট অনুপাতে ভাগ হয়', () => {
    const buckets = spreadIntoHourBuckets(
      [{ startedAt: dhaka(10, 45), endedAt: dhaka(12, 15), durationSec: 5400 }],
      WORK_DATE,
    );

    expect(buckets[10]).toBe(15 * 60);
    expect(buckets[11]).toBe(60 * 60);
    expect(buckets[12]).toBe(15 * 60);
    expect(sum(buckets)).toBe(5400);
  });

  it('ঠিক ঘণ্টার সীমানায় শেষ হলে পরের বালতিতে কিছু পড়ে না', () => {
    const buckets = spreadIntoHourBuckets(
      [{ startedAt: dhaka(9, 0), endedAt: dhaka(10, 0), durationSec: 3600 }],
      WORK_DATE,
    );

    expect(buckets[9]).toBe(3600);
    expect(buckets[10]).toBe(0);
  });

  /**
   * ⚠️ প্রতি ঘণ্টায় আলাদা Math.round করলে ২৪টা রাউন্ডিং জমে বালতির যোগফল
   * durationSec ছাড়িয়ে যেত বা কম পড়ত। চার্টের মোট আর টাইমলাইনের মোট
   * তখন আলাদা দেখাত — আর কোনটা সত্যি তা প্রমাণ করার উপায় থাকত না।
   */
  it('ভাগ না যাওয়া সময়েও বালতির যোগফল হুবহু durationSec', () => {
    const buckets = spreadIntoHourBuckets(
      [
        {
          startedAt: dhaka(8, 17, 13),
          endedAt: dhaka(13, 42, 47),
          durationSec: 19_534,
        },
      ],
      WORK_DATE,
    );

    expect(sum(buckets)).toBe(19_534);
    expect(buckets.every((b) => Number.isInteger(b))).toBe(true);
  });

  /**
   * ⭐ durationSec আসে monotonic ঘড়ি থেকে, ঘণ্টার সীমানা দেয়ালঘড়ি থেকে —
   * দুটো মিলবে না ধরে নেওয়াই নিরাপদ (ঘুম/সাসপেন্ডে ব্যবধান বাড়ে)।
   * ভাগ হয় durationSec, অনুপাত আসে দেয়ালঘড়ি থেকে।
   */
  it('durationSec দেয়ালঘড়ির ব্যবধানের সমান না হলেও মোট durationSec-ই থাকে', () => {
    const buckets = spreadIntoHourBuckets(
      [{ startedAt: dhaka(10, 0), endedAt: dhaka(12, 0), durationSec: 3600 }],
      WORK_DATE,
    );

    expect(sum(buckets)).toBe(3600);
    expect(buckets[10]).toBe(1800);
    expect(buckets[11]).toBe(1800);
  });

  it('একাধিক সেগমেন্ট একই বালতিতে যোগ হয়', () => {
    const buckets = spreadIntoHourBuckets(
      [
        { startedAt: dhaka(14, 0), endedAt: dhaka(14, 20), durationSec: 1200 },
        { startedAt: dhaka(14, 30), endedAt: dhaka(14, 45), durationSec: 900 },
      ],
      WORK_DATE,
    );

    expect(buckets[14]).toBe(2100);
    expect(sum(buckets)).toBe(2100);
  });

  it('দিনের প্রথম ও শেষ ঘণ্টা ঠিক জায়গায় পড়ে', () => {
    const buckets = spreadIntoHourBuckets(
      [
        { startedAt: dhaka(0, 0), endedAt: dhaka(0, 30), durationSec: 1800 },
        { startedAt: dhaka(23, 30), endedAt: dhaka(24, 0), durationSec: 1800 },
      ],
      WORK_DATE,
    );

    expect(buckets[0]).toBe(1800);
    expect(buckets[23]).toBe(1800);
  });

  it('দেয়ালঘড়ি উল্টো গেলে পুরোটা শুরুর ঘণ্টায় পড়ে, সময় হারায় না', () => {
    const buckets = spreadIntoHourBuckets(
      [{ startedAt: dhaka(15, 10), endedAt: dhaka(15, 5), durationSec: 300 }],
      WORK_DATE,
    );

    expect(buckets[15]).toBe(300);
    expect(sum(buckets)).toBe(300);
  });

  it('অন্য দিনের সেগমেন্ট ভুল করে এলে কোনো বালতিতে ঢোকে না', () => {
    const buckets = spreadIntoHourBuckets(
      [
        {
          startedAt: new Date(Date.UTC(2026, 7, 8, 4)),
          endedAt: new Date(Date.UTC(2026, 7, 8, 5)),
          durationSec: 3600,
        },
      ],
      WORK_DATE,
    );

    expect(sum(buckets)).toBe(0);
  });

  it('durationSec শূন্য হলে বালতি অস্পৃশ্য থাকে', () => {
    const buckets = spreadIntoHourBuckets(
      [{ startedAt: dhaka(11, 0), endedAt: dhaka(11, 0), durationSec: 0 }],
      WORK_DATE,
    );

    expect(sum(buckets)).toBe(0);
  });
});

describe('তারিখ — parse ও format', () => {
  it('বৈধ তারিখ UTC-midnight Date হয়', () => {
    expect(parseWorkDate('2026-08-10')?.toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    );
  });

  /**
   * ⚠️ `new Date('2026-02-31')` চুপচাপ ৩ মার্চ বানায়। যাচাই না করলে
   * ব্যবহারকারী এক তারিখ চেয়ে আরেক তারিখের ডেটা পেত, কোনো এরর ছাড়াই।
   */
  it('অস্তিত্বহীন তারিখ পরের মাসে গড়িয়ে না গিয়ে null হয়', () => {
    expect(parseWorkDate('2026-02-31')).toBeNull();
    expect(parseWorkDate('2026-13-01')).toBeNull();
    expect(parseWorkDate('2026-00-10')).toBeNull();
  });

  it('অধিবর্ষ ঠিকভাবে চেনে', () => {
    expect(parseWorkDate('2028-02-29')?.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(parseWorkDate('2026-02-29')).toBeNull();
  });

  it('ফরম্যাট না মিললে null', () => {
    expect(parseWorkDate('10-08-2026')).toBeNull();
    expect(parseWorkDate('2026-8-10')).toBeNull();
    expect(parseWorkDate('2026-08-10T00:00:00Z')).toBeNull();
    expect(parseWorkDate('')).toBeNull();
  });

  it('format করলে টাইমজোন ছাড়াই তারিখটাই ফেরে', () => {
    expect(formatWorkDate(WORK_DATE)).toBe('2026-08-10');
    expect(formatWorkDate(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01');
  });

  it('মাসের শুরু ও আগের দিন', () => {
    expect(formatWorkDate(monthStartOf(WORK_DATE))).toBe('2026-08-01');
    expect(formatWorkDate(previousWorkDate(WORK_DATE))).toBe('2026-08-09');
    // মাসের সীমানা পেরিয়ে
    const augFirst = new Date(Date.UTC(2026, 7, 1));
    expect(formatWorkDate(previousWorkDate(augFirst))).toBe('2026-07-31');
  });
});

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
