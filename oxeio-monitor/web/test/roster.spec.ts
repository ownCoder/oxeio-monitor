import { describe, expect, it } from 'vitest';

import type { LiveCard } from '../src/api/dashboard';
import {designView,
  meterKind,
  restingStartsAt,
  rosterRows,
} from '../src/pages/live/roster';

/**
 * **রোস্টারের দুটো নিয়ম** — সারির ক্রম, আর মিটার কোন সত্যি বলছে।
 *
 * ⚠️⚠️ ক্রমের টেস্টটা নিছক আনুষ্ঠানিকতা নয়। "ঘণ্টা ধরে সাজাই" এক লাইনের
 * বদল, আর তাতে পাতাটা রোজ সকালে একটা লিডারবোর্ড হয়ে উঠত — যেটা এই পণ্য
 * ইচ্ছাকৃতভাবে করে না। নিয়মটা এখানে বাঁধা থাকলে ওই এক লাইন নীরবে ঢুকতে
 * পারবে না।
 */

function card(over: Partial<LiveCard> = {}): LiveCard {
  return {
    employeeId: 1,
    empCode: 'OX-01',
    fullName: 'Rakib Hasan',
    designation: 'Researcher',
    // ⭐ ডিজাইনের টার্গেট (২১ আগস্ট) — গবেষকের জন্য খাটে না
    staffType: 'researcher',
    designsDone: 0,
    // ⭐ "শেষ" আলাদা ঘর (২২ আগস্ট) — খোলা আর শেষ এক নয়
    designsFinished: 0,
    designTargetPerDay: 25,
    status: 'active',
    todayWorkedSec: 3_600,
    dailyTargetSec: 28_800,
    todayIsWorkday: true,
    monthWorkedSec: 72_000,
    monthTargetSec: 748_800,
    lastHeartbeatAt: '2026-08-18T04:11:00.000Z',
    agentPresence: 'installed',
    ...over,
  };
}

describe('meterKind — শূন্য আর অজানা এক নয়', () => {
  it('কাজ গোনা হয়েছে → counted', () => {
    expect(meterKind(card({ todayWorkedSec: 3_600 }))).toBe('counted');
  });

  /** ⭐ মাপা হয়েছে, ফল শূন্য — এটা একটা **সত্যি**, অনুপস্থিতি নয় */
  it('এজেন্ট আছে, সাড়াও দিয়েছে, কিন্তু আজ শূন্য → zero', () => {
    expect(meterKind(card({ todayWorkedSec: 0 }))).toBe('zero');
  });

  /** ⚠️⚠️ এজেন্টই বসেনি — একে "শূন্য কাজ" বলা একটা নীরব অভিযোগ হতো */
  it('এজেন্ট বসেনি → unknown, যদিও সেকেন্ড ০', () => {
    expect(
      meterKind(
        card({
          todayWorkedSec: 0,
          agentPresence: 'never_installed',
          lastHeartbeatAt: null,
        }),
      ),
    ).toBe('unknown');
  });

  it('এজেন্ট বন্ধ করে দেওয়া হয়েছে → unknown', () => {
    expect(meterKind(card({ agentPresence: 'switched_off' }))).toBe('unknown');
  });

  it('কখনো সাড়া দেয়নি → unknown', () => {
    expect(meterKind(card({ lastHeartbeatAt: null }))).toBe('unknown');
  });
});

describe('rosterRows — ক্রম কখনো ঘণ্টা ধরে নয়', () => {
  /** ⭐⭐ মূল পাহারা: বেশি কাজ করা মানুষ উপরে উঠে যায় না */
  it('সার্ভারের ক্রম (empCode) অক্ষত থাকে, ঘণ্টা যাই হোক', () => {
    const rows = rosterRows([
      card({ employeeId: 1, empCode: 'OX-01', todayWorkedSec: 60 }),
      card({ employeeId: 2, empCode: 'OX-02', todayWorkedSec: 30_000 }),
      card({ employeeId: 3, empCode: 'OX-03', todayWorkedSec: 3_600 }),
    ]);

    expect(rows.map((c) => c.empCode)).toEqual(['OX-01', 'OX-02', 'OX-03']);
  });

  it('কাজ করছেন যাঁরা আগে, না-করছেন যাঁরা পরে', () => {
    const rows = rosterRows([
      card({ employeeId: 1, empCode: 'OX-01', status: 'offline' }),
      card({ employeeId: 2, empCode: 'OX-02', status: 'active' }),
      card({ employeeId: 3, empCode: 'OX-03', status: 'idle' }),
      card({ employeeId: 4, empCode: 'OX-04', status: 'active' }),
    ]);

    expect(rows.map((c) => c.empCode)).toEqual([
      'OX-02',
      'OX-04',
      'OX-01',
      'OX-03',
    ]);
  });

  /** ⚠️ কেউ যেন বাদ না পড়ে, দুবারও না আসে (G88-এর শিক্ষা) */
  it('প্রত্যেকে ঠিক একবার', () => {
    const input = [
      card({ employeeId: 1, status: 'active' }),
      card({ employeeId: 2, status: 'idle' }),
      card({ employeeId: 3, status: 'offline' }),
    ];
    const ids = rosterRows(input).map((c) => c.employeeId).sort();
    expect(ids).toEqual([1, 2, 3]);
  });

  it('খালি তালিকায় খালি ফল', () => {
    expect(rosterRows([])).toEqual([]);
  });
});

describe('restingStartsAt — দলছুট ব্যান্ড কোথায় বসবে', () => {
  it('প্রথম না-কাজ সারির অবস্থান', () => {
    const rows = rosterRows([
      card({ employeeId: 1, status: 'active' }),
      card({ employeeId: 2, status: 'active' }),
      card({ employeeId: 3, status: 'offline' }),
    ]);
    expect(restingStartsAt(rows)).toBe(2);
  });

  /** ⭐ সবাই কাজ করছেন — ব্যান্ডটাই আঁকা হবে না */
  it('সবাই কাজ করলে -1', () => {
    expect(
      restingStartsAt(rosterRows([card({ status: 'active' })])),
    ).toBe(-1);
  });

  /**
   * ⚠️ কেউ কাজ না করলে ব্যান্ডটা **প্রথম সারিতেই** পড়ে — কম্পোনেন্ট তখন
   *    সেটা আঁকে না (`restingAt > 0` শর্ত), নইলে টেবিলের মাথাতেই
   *    "Not working" ব্যান্ড বসে যেত যদিও পুরো তালিকাটাই তাই।
   */
  it('কেউ কাজ না করলে ০', () => {
    const rows = rosterRows([
      card({ employeeId: 1, status: 'offline' }),
      card({ employeeId: 2, status: 'idle' }),
    ]);
    expect(restingStartsAt(rows)).toBe(0);
  });
});

describe('designView — আজকের ডিজাইন', () => {
  /**
   * ⭐⭐ **মালিকের বাছাই, ২২ আগস্ট** — ম্যানেজার (OX-01) নিজেও ডিজাইন
   * করেন, তিন দিনে ৪৩টা। ধরন বদলানোর পর সংখ্যাটা উধাও হয়ে যাচ্ছিল,
   * অথচ কাজটা সত্যি।
   */
  it('ডিজাইনার নন, তবু কাজ করেছেন — সংখ্যা ওঠে, টার্গেট ছাড়া', () => {
    const view = designView(card({ staffType: 'manager', designsDone: 43 }));
    expect(view).toEqual({ done: 43, finished: 0, target: null, met: false });
  });

  /**
   * ⭐⭐ **"খোলা" আর "শেষ" আলাদা** *(মালিকের বাছাই, ২২ আগস্ট)*।
   *
   * ⚠️⚠️ শিরোনামে নম্বরটা দেখা যায় ফাইল **খোলার** মুহূর্তে, শেষ করার নয়।
   * এই পার্থক্যটা না রাখায় একবার টার্গেট খোলামাত্র বন্ধ হয়ে যাচ্ছিল।
   */
  it('খোলা আর শেষ — দুটো আলাদা সংখ্যা', () => {
    const view = designView(
      card({ staffType: 'designer', designsDone: 18, designsFinished: 12 }),
    );
    expect(view).toEqual({ done: 18, finished: 12, target: 25, met: false });
  });

  /**
   * ⚠️⚠️ `met` এখনো **খোলা** ধরে, "শেষ" ধরে নয় — ইচ্ছাকৃত, কারণ Complete
   * বোতাম মাঠে এখনো ব্যবহৃত হচ্ছে না (মেপে দেখা: ০ চাপ)। এটা বদলালে
   * পরদিন সকালে সবাই টার্গেট-মিস দেখাত।
   *
   * ⭐ এই টেস্টটাই সেই সিদ্ধান্তের পাহারাদার — কেউ নীরবে `finished` ধরে
   * বসিয়ে দিলে এটা ভাঙবে।
   */
  it('টার্গেট ছোঁয়ার হিসাব "খোলা" ধরে, "শেষ" ধরে নয়', () => {
    const view = designView(
      card({ staffType: 'designer', designsDone: 25, designsFinished: 0 }),
    );
    expect(view?.met).toBe(true);

    const other = designView(
      card({ staffType: 'designer', designsDone: 0, designsFinished: 25 }),
    );
    expect(other?.met).toBe(false);
  });

  /** ⭐ কেউ কিছু খোলেননি কিন্তু শেষ বলেছেন — ঘরটা তবু দেখাতে হবে */
  it('খোলা ০ কিন্তু শেষ আছে — সারিটা লুকোনো হয় না', () => {
    const view = designView(
      card({ staffType: 'manager', designsDone: 0, designsFinished: 3 }),
    );
    expect(view).toEqual({ done: 0, finished: 3, target: null, met: false });
  });

  /** ⚠️⚠️ টার্গেট ছাড়া কারো `met` কখনো `true` নয় — ৪৩ > ২৫ হলেও */
  it('টার্গেট ছাড়া কেউ কখনো সবুজ হয় না', () => {
    expect(designView(card({ staffType: 'manager', designsDone: 999 }))?.met).toBe(false);
  });

  it('ডিজাইনারের টার্গেটসহ হিসাব', () => {
    expect(designView(card({ staffType: 'designer', designsDone: 25 }))).toEqual({
      done: 25,
      finished: 0,
      target: 25,
      met: true,
    });
    expect(designView(card({ staffType: 'designer', designsDone: 24 }))?.met).toBe(false);
  });

  /** ⚠️ কাজ না করলে কিছুই নয় — "০" পড়তে অভিযোগের মতো লাগে */
  it('ডিজাইন না করলে কিছুই নয়', () => {
    expect(designView(card({ staffType: 'researcher', designsDone: 0 }))).toBeNull();
    expect(designView(card({ staffType: null, designsDone: 0 }))).toBeNull();
  });
});
