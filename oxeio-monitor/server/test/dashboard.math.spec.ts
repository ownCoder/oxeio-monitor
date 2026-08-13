import { describe, expect, it } from 'vitest';

import {
  agentPresence,
  AGENT_DOWN_AFTER_SEC,
  decideLiveStatus,
  formatWorkDate,
  HOURS_PER_DAY,
  latestHeartbeat,
  monthStartOf,
  OFFLINE_AFTER_SEC,
  parseWorkDate,
  previousWorkDate,
  spreadIntoHourBuckets,
  type DeviceReport,
  type LiveStatus,
} from '../src/dashboard/dashboard.math';

/** ঢাকার ১০ আগস্ট ২০২৬ — কর্মদিবস মানেই UTC-midnight Date */
const WORK_DATE = new Date(Date.UTC(2026, 7, 10));

/** ঢাকার ওই দিনের `HH:MM` → UTC instant (ঢাকা = UTC+6, DST নেই) */
function dhaka(hh: number, mm = 0, ss = 0): Date {
  return new Date(Date.UTC(2026, 7, 10, hh - 6, mm, ss));
}

const NOW = new Date('2026-08-10T09:00:00.000Z');
const secondsAgo = (sec: number): Date => new Date(NOW.getTime() - sec * 1000);

/** heartbeat-এ সদ্য `active` বলা একটা সুস্থ ডিভাইস; over দিয়ে যা খুশি বদলাও */
function device(over: Partial<DeviceReport> = {}): DeviceReport {
  return {
    // ⚠️ ডিফল্ট `active` — বেশিরভাগ টেস্টের প্রশ্ন heartbeat নিয়ে, ডিভাইস
    //    বন্ধ কি না তা নিয়ে নয়। বাতিল ডিভাইসের টেস্টগুলো নিজেরাই বলে দেয়।
    status: 'active',
    lastSeenAt: secondsAgo(5),
    lastState: 'active',
    lastStateAt: secondsAgo(5),
    ...over,
  };
}

function statusOf(
  devices: readonly DeviceReport[],
  fallbackState: DeviceReport['lastState'] = null,
): LiveStatus {
  return decideLiveStatus({ devices, fallbackState, now: NOW });
}

describe('decideLiveStatus — কার্ডের রঙ', () => {
  it('তাজা heartbeat হলে এজেন্টের বলা state-ই দেখায়', () => {
    expect(statusOf([device()])).toBe('active');
    expect(statusOf([device({ lastState: 'idle' })])).toBe('idle');
  });

  it('locked আলাদা রঙ পায় না — idle-এ মেশে', () => {
    expect(statusOf([device({ lastState: 'locked' })])).toBe('idle');
  });

  it('৯০ সেকেন্ড পেরোলে offline, ১০ মিনিট পেরোলে agent_down', () => {
    expect(statusOf([device({ lastSeenAt: secondsAgo(120) })])).toBe('offline');
    expect(statusOf([device({ lastSeenAt: secondsAgo(700) })])).toBe(
      'agent_down',
    );
  });

  /**
   * ⭐ সবচেয়ে দরকারি টেস্ট। শর্ত দুটোর ক্রম উল্টে গেলে (আগে ৯০ সে., পরে
   * ৬০০ সে.) তিন ঘণ্টা ধরে মরে থাকা এজেন্টও নিরীহ ⚪ offline দেখাত —
   * 🔴 কোনোদিন উঠত না, অথচ ওটাই ধরার জন্য ফিচারটা।
   */
  it('অনেকক্ষণ চুপ থাকা এজেন্ট offline নয়, agent_down', () => {
    expect(statusOf([device({ lastSeenAt: secondsAgo(3 * 3600) })])).toBe(
      'agent_down',
    );
  });

  it('সীমানার ঠিক উপরে — "বেশি হলে" মানে কঠোরভাবে বেশি', () => {
    expect(
      statusOf([device({ lastSeenAt: secondsAgo(OFFLINE_AFTER_SEC) })]),
    ).toBe('active');
    expect(
      statusOf([device({ lastSeenAt: secondsAgo(OFFLINE_AFTER_SEC + 1) })]),
    ).toBe('offline');
    expect(
      statusOf([device({ lastSeenAt: secondsAgo(AGENT_DOWN_AFTER_SEC) })]),
    ).toBe('offline');
    expect(
      statusOf([device({ lastSeenAt: secondsAgo(AGENT_DOWN_AFTER_SEC + 1) })]),
    ).toBe('agent_down');
  });

  it('ডিভাইসই না থাকলে offline — লাল অ্যালার্ম নয়', () => {
    expect(statusOf([])).toBe('offline');
  });

  it('ডিভাইস আছে কিন্তু কখনো সাড়া দেয়নি — agent_down', () => {
    expect(
      statusOf([
        device({ lastSeenAt: null, lastState: null, lastStateAt: null }),
      ]),
    ).toBe('agent_down');
  });

  it('এজেন্ট জীবিত কিন্তু কেউ কিছু বলেনি — না-জানাকে active ধরা হয় না', () => {
    expect(statusOf([device({ lastState: null, lastStateAt: null })])).toBe(
      'idle',
    );
  });

  it('ডিভাইসের ঘড়ি এগিয়ে থাকলেও (ভবিষ্যতের সময়) তাজাই ধরা হয়', () => {
    expect(
      statusOf([
        device({ lastSeenAt: secondsAgo(-30), lastStateAt: secondsAgo(-30) }),
      ]),
    ).toBe('active');
  });
});

describe('decideLiveStatus — এজেন্টের কথা বনাম সেগমেন্টের অনুমান', () => {
  /**
   * ⭐ পুরো ফিচারটার কারণ। সেগমেন্ট **ব্যাচে** আসে, তাই শেষ সারিটা কয়েক
   * মিনিট পুরোনো হতে পারে: কর্মী উঠে চলে গেছে, এজেন্ট ৫ সেকেন্ড আগে
   * `idle` বলেছে, অথচ সেগমেন্টে এখনো `active` লেখা। অনুমানকে প্রাধান্য
   * দিলে বোর্ড না-কাজের সময়কে সবুজ দেখাত — মিনিটের পর মিনিট।
   */
  it('তাজা রিপোর্ট থাকলে সেগমেন্টের অনুমান উপেক্ষা হয়', () => {
    expect(statusOf([device({ lastState: 'idle' })], 'active')).toBe('idle');
    expect(statusOf([device({ lastState: 'active' })], 'idle')).toBe('active');
  });

  /**
   * ⚠️ `last_state` কলামটা নতুন — মাইগ্রেশনের পরে সব সারিতে null, আর
   * heartbeat না আসা পর্যন্ত null-ই থাকে। fallback না রাখলে প্রতিটা
   * সুস্থ কর্মী ওই সময়টুকু ⚪ দেখাত, অর্থাৎ ফিচারটা চালু করাই একটা
   * সাময়িক ব্ল্যাকআউট হতো।
   */
  it('এজেন্ট state না পাঠালে আগের অনুমানের পথেই ফেরে', () => {
    const old = device({ lastState: null, lastStateAt: null });

    expect(statusOf([old], 'active')).toBe('active');
    expect(statusOf([old], 'locked')).toBe('idle');
    expect(statusOf([old], null)).toBe('idle');
  });

  /**
   * ⭐ এই টেস্টটা না থাকলে সবচেয়ে খারাপ বাগটা নীরবে বেঁচে যেত। এজেন্ট মরার
   * ঠিক আগে `active` বলে গিয়েছিল; মানটা কলামে বসেই থাকে। মেয়াদ না দেখলে
   * বন্ধ PC-র কার্ড চিরকাল সবুজ থাকত — offline দেখানোর চেয়েও খারাপ,
   * কারণ তখন না-কাজের সময় কাজ বলে দাবি করা হতো।
   */
  it('বাসি রিপোর্ট বিশ্বাস করা হয় না — সেগমেন্টে নেমে যায়', () => {
    // এজেন্ট বেঁচে আছে (segments পাঠাচ্ছে) কিন্তু heartbeat আটকে গেছে
    const stuck = device({
      lastSeenAt: secondsAgo(10),
      lastState: 'active',
      lastStateAt: secondsAgo(OFFLINE_AFTER_SEC + 1),
    });

    expect(statusOf([stuck], 'idle')).toBe('idle');
    expect(statusOf([stuck], null)).toBe('idle');
    // সীমানার ঠিক উপরে রিপোর্টটা এখনো টাটকা
    expect(
      statusOf(
        [device({ lastStateAt: secondsAgo(OFFLINE_AFTER_SEC) })],
        'idle',
      ),
    ).toBe('active');
  });
});

describe('decideLiveStatus — একজনের একাধিক ডিভাইস (§ ২.১-গ)', () => {
  /**
   * ⚠️ ডিভাইসপ্রতি বিচার করলে ডেস্কটপ বন্ধ থাকলেই ল্যাপটপে কাজ করা কর্মী
   * 🔴 দেখাত — IT-কে ডাকা হতো এমন সমস্যার জন্য যা নেই।
   */
  it('একটা ডিভাইস মরে থাকলেও আরেকটার তাজা heartbeat-ই গোনা হয়', () => {
    expect(
      statusOf([
        device({
          lastSeenAt: secondsAgo(6 * 3600),
          lastStateAt: null,
          lastState: null,
        }),
        device(),
      ]),
    ).toBe('active');
  });

  /**
   * ⭐ "সবচেয়ে সাম্প্রতিক রিপোর্ট নাও" লিখলে এটা ভাঙত: দুটো ডিভাইসই প্রতি
   * ৩০ সেকেন্ডে heartbeat পাঠায়, তাই কে "সাম্প্রতিক" সেটা কার্যত এলোমেলো —
   * কার্ড রিফ্রেশে রিফ্রেশে সবুজ-ধূসর করত, অথচ কর্মী একটানা কাজ করছে।
   */
  it('যেকোনো এক PC-তে কাজ করলেই active — ক্রম যাই হোক', () => {
    const working = device({
      lastState: 'active',
      lastStateAt: secondsAgo(20),
    });
    const locked = device({ lastState: 'locked', lastStateAt: secondsAgo(2) });

    expect(statusOf([locked, working])).toBe('active');
    expect(statusOf([working, locked])).toBe('active');
  });

  it('কোনোটাই active না বললে সবচেয়ে সাম্প্রতিক রিপোর্টই চলে', () => {
    expect(
      statusOf([
        device({ lastState: 'locked', lastStateAt: secondsAgo(60) }),
        device({ lastState: 'idle', lastStateAt: secondsAgo(3) }),
      ]),
    ).toBe('idle');
  });

  /** ⚠️ বাসি `active` অন্য ডিভাইসের তাজা রিপোর্টকে ছাপিয়ে যেতে পারে না */
  it('বন্ধ ডেস্কটপের পুরোনো active ল্যাপটপের তাজা idle-কে হারায় না', () => {
    expect(
      statusOf([
        device({
          lastSeenAt: secondsAgo(4 * 3600),
          lastState: 'active',
          lastStateAt: secondsAgo(4 * 3600),
        }),
        device({ lastState: 'idle' }),
      ]),
    ).toBe('idle');
  });
});

describe('latestHeartbeat — কার্ডের "শেষ সাড়া"', () => {
  it('সব ডিভাইসের মধ্যে সবচেয়ে সাম্প্রতিকটা', () => {
    expect(
      latestHeartbeat([
        device({ lastSeenAt: secondsAgo(900) }),
        device({ lastSeenAt: secondsAgo(5) }),
        device({ lastSeenAt: null }),
      ]),
    ).toEqual(secondsAgo(5));
  });

  it('একটাও সাড়া না দিলে null — শূন্য বা epoch নয়', () => {
    expect(latestHeartbeat([])).toBeNull();
    expect(latestHeartbeat([device({ lastSeenAt: null })])).toBeNull();
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

/**
 * ⭐ এজেন্টের **উপস্থিতি** — রঙ নয়, ব্যাখ্যা।
 *
 * ⚠️⚠️ এই টেস্টগুলো লেখা হয়েছে একটা স্ববিরোধী কার্ড থেকে: উপরে ১৬:৫০-এর
 * স্ক্রিনশট, নিচে *"Never checked in"*। কারণ কর্মী একবার নিষ্ক্রিয়
 * হওয়ায় তাঁর ডিভাইস revoke হয়ে গিয়েছিল, আর কোয়েরি বাতিল ডিভাইস
 * ছেঁকে ফেলত — ফলে "কখনো বসেনি" আর "বন্ধ করে দেওয়া" এক দেখাত।
 */
describe('agentPresence', () => {
  it('ডিভাইসই না থাকলে never_installed', () => {
    expect(agentPresence([])).toBe('never_installed');
  });

  it('সচল ডিভাইস থাকলে installed', () => {
    expect(agentPresence([device()])).toBe('installed');
  });

  /** ⭐⭐ এই ফাইলের নতুন মূল টেস্ট */
  it('সব ডিভাইস বাতিল হলে switched_off', () => {
    expect(agentPresence([device({ status: 'revoked' })])).toBe('switched_off');
  });

  /** ⚠️ একটাও সচল থাকলে সেটাই যথেষ্ট — ডেস্কটপ বন্ধ, ল্যাপটপ চালু */
  it('মিশ্র হলে installed', () => {
    expect(agentPresence([device({ status: 'revoked' }), device()])).toBe('installed');
  });
});

describe('বাতিল ডিভাইস হিসাবের বাইরে', () => {
  /**
   * ⚠️⚠️ বাতিল ডিভাইসের পুরোনো heartbeat গোনা হলে বন্ধ করে দেওয়া মেশিন
   * কর্মীকে **সবুজ** দেখাত, অথচ ওটা আর কোনোদিন সাড়া দেবে না।
   */
  it('বাতিল ডিভাইসের সাড়া গোনা হয় না', () => {
    expect(latestHeartbeat([device({ status: 'revoked' })])).toBeNull();
  });

  it('সব ডিভাইস বাতিল হলে কার্ড offline, agent_down নয়', () => {
    expect(statusOf([device({ status: 'revoked' })])).toBe('offline');
  });

  it('বাতিলের পাশে সচল থাকলে সচলটাই গোনা হয়', () => {
    expect(
      statusOf([device({ status: 'revoked', lastSeenAt: secondsAgo(99_999) }), device()]),
    ).toBe('active');
  });
});
