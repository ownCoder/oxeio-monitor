import { describe, expect, it } from 'vitest';

import type { LiveCard } from '../src/api/dashboard';
import {
  dayDuty,
  designView,
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
    // ⭐ G130 — ডিফল্টে কেউ ছুটিতে নেই; ছুটির দাবিগুলো নিজের describe-এ
    onLeaveToday: false,
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
   * ⭐⭐ **কেবল "শেষ" গোনা হয়** *(মালিকের সিদ্ধান্ত, ২৩ আগস্ট ২০২৬)* —
   * *"file khoila hole seta count koro na, only complete dile count koro"*।
   *
   * ⚠️⚠️ **কেন বদলাল।** আগে "খোলা" সংখ্যাও দেখানো হতো, আর `met`ও ওটাই
   * ধরত। মাঠে ধরা পড়ল ম্যানেজার (OX-01) দেখাচ্ছেন **১৬** — অথচ তিনি
   * ১৯টা ফাইলে মোট **৪৪ মিনিট** দিয়ে সেগুলো **খুলে দেখছিলেন**, বানাননি।
   *
   * ⭐ এই ব্লকটাই সেই সিদ্ধান্তের পাহারাদার: কেউ নীরবে `designsDone`
   * (খোলা) ধরে বসিয়ে দিলে নিচের টেস্টগুলো ভাঙবে।
   */
  it('⭐⭐ ফাইল খোলা গোনা হয় না — কেবল Complete', () => {
    /**
     * ⚠️⚠️ **ঠিক বেলালের ঘটনাটাই** — ম্যানেজার ১০০টা ফাইল খুলেছেন কিন্তু
     * একটাও শেষ বলেননি। আগে এটা "১০০" দেখাত; এখন কিছুই দেখায় না।
     *
     * ⭐ ম্যানেজার বাছা হয়েছে ইচ্ছাকৃতভাবে: ডিজাইনারের টার্গেট থাকলে
     * `০ / ২৫` দেখানোই সঠিক (তিনি মাপের আওতায়), তাই সেখানে `null` হয় না।
     */
    expect(
      designView(card({ staffType: 'manager', designsDone: 100, designsFinished: 0 })),
    ).toBeNull();

    /** ⭐ একটাও খোলেননি, কিন্তু ৩টা শেষ বলেছেন → সংখ্যাটা ওঠে */
    expect(
      designView(card({ staffType: 'manager', designsDone: 0, designsFinished: 3 })),
    ).toEqual({ done: 3, target: null, met: false });

    /** ⚠️ ডিজাইনার শূন্যেও দেখা যান — টার্গেট আছে, তাই মাপটা প্রযোজ্য */
    expect(
      designView(card({ staffType: 'designer', designsDone: 100, designsFinished: 0 })),
    ).toEqual({ done: 0, target: 25, met: false });
  });

  /**
   * ⭐⭐ **মালিকের বাছাই, ২২ আগস্ট** — ম্যানেজার নিজেও ডিজাইন করেন।
   * ⚠️ ধরন বদলানোর পর সংখ্যাটা উধাও হয়ে যাচ্ছিল, অথচ কাজটা সত্যি।
   */
  it('ডিজাইনার নন, তবু শেষ করেছেন — সংখ্যা ওঠে, টার্গেট ছাড়া', () => {
    const view = designView(card({ staffType: 'manager', designsFinished: 43 }));
    expect(view).toEqual({ done: 43, target: null, met: false });
  });

  /** ⚠️⚠️ টার্গেট ছাড়া কারো `met` কখনো `true` নয় — ৪৩ > ২৫ হলেও */
  it('টার্গেট ছাড়া কেউ কখনো সবুজ হয় না', () => {
    expect(
      designView(card({ staffType: 'manager', designsFinished: 999 }))?.met,
    ).toBe(false);
  });

  it('ডিজাইনারের টার্গেটসহ হিসাব', () => {
    expect(
      designView(card({ staffType: 'designer', designsFinished: 25 })),
    ).toEqual({ done: 25, target: 25, met: true });

    expect(
      designView(card({ staffType: 'designer', designsFinished: 24 }))?.met,
    ).toBe(false);
  });

  /** ⚠️ কাজ না করলে কিছুই নয় — "০" পড়তে অভিযোগের মতো লাগে */
  it('ডিজাইন না করলে কিছুই নয়', () => {
    expect(designView(card({ staffType: 'researcher', designsFinished: 0 }))).toBeNull();
    expect(designView(card({ staffType: null, designsDone: 0 }))).toBeNull();
  });
});


describe('G130 — আজ তার কী দায়িত্ব, আর না থাকলে কেন', () => {
  it('সাধারণ কর্মদিবস — টার্গেট আছে', () => {
    expect(dayDuty(card())).toBe('target');
  });

  /**
   * ⭐⭐⭐ **এই describe-এর কারণ পুরোটাই এই একটা টেস্ট।**
   *
   * ⚠️⚠️ `todayIsWorkday` **অফিসের** ক্যালেন্ডার — শুক্রবার ও সরকারি ছুটি।
   * ব্যক্তিগত ছুটি ওতে নেই, তাই ছুটিতে থাকা কর্মীর কার্ডে ফুটত
   * **"0h / 8h" আর একটা খালি মিটার** — দেখতে হুবহু ফাঁকি দেওয়া মানুষের
   * মতো। অথচ সংখ্যাগুলো (টার্গেট, প্রত্যাশা, pace) তাঁকে অনেক আগেই ছাড়
   * দিয়েছে; শুধু **ছবিটা দেয়নি**।
   */
  it('⭐ কর্মদিবস, কিন্তু তিনি ছুটিতে — টার্গেট নেই, আর কারণটা "leave"', () => {
    expect(dayDuty(card({ todayIsWorkday: true, onLeaveToday: true }))).toBe(
      'leave',
    );
  });

  /**
   * ⚠️⚠️ **ক্রমটা ইচ্ছাকৃত।** কারো ছুটি যদি শুক্রবারে লেখা থাকে, কার্ডে
   * তখনো "day off"-ই ঠিক: ওই দিনে **কারোরই** টার্গেট নেই, তাই একজনকে
   * আলাদা করে চিহ্নিত করা অর্থহীন — আর "on leave" পড়ে কেউ ভাবতেন
   * বাকিরা কাজ করছেন।
   */
  it('⭐ শুক্রবারে লেখা ছুটি — তবু "day off", "on leave" নয়', () => {
    expect(dayDuty(card({ todayIsWorkday: false, onLeaveToday: true }))).toBe(
      'off',
    );
  });

  it('সরকারি ছুটি / সাপ্তাহিক ছুটি — "off"', () => {
    expect(dayDuty(card({ todayIsWorkday: false }))).toBe('off');
  });

  /**
   * ⚠️ টার্গেট ০ মানে ওই দিনে কিছু করার নেই — ছুটির দিনের মতোই। ⭐ শর্তটা
   *    রাখা হয়েছে কারণ prorate করা কর্মীর (মাসের পরে যোগ) দৈনিক টার্গেট
   *    ০ হতে পারে, আর তখন "0h / 0h" দেখানো অর্থহীন।
   */
  it('টার্গেট ০ হলে "off" — ছুটি লেখা থাকলেও', () => {
    expect(dayDuty(card({ dailyTargetSec: 0, onLeaveToday: true }))).toBe('off');
  });

  /**
   * ⭐⭐ **সমতাটাই আসল পাহারা।** ছুটির দিন আর সাপ্তাহিক ছুটি — দুটোতেই
   * মিটার ওঠে না, অর্থাৎ `hasTarget` দুটোকে **এক** দেখে। তবু `dayDuty`
   * দুটোকে আলাদা রাখে, কারণ পর্দার লেখাটা আলাদা। এক করে দিলে ছুটির দিনে
   * কার্ড বলত "day off" — অর্থাৎ গোটা অফিস বন্ধ, একটা মিথ্যা সারাতে গিয়ে
   * নতুন একটা মিথ্যা।
   */
  it('⭐ ছুটি আর সাপ্তাহিক ছুটি — দুটোতেই মিটার নেই, তবু কথা দুটো আলাদা', () => {
    const onLeave = dayDuty(card({ onLeaveToday: true }));
    const dayOff = dayDuty(card({ todayIsWorkday: false }));

    expect(onLeave).not.toBe('target');
    expect(dayOff).not.toBe('target');
    expect(onLeave).not.toBe(dayOff);
  });
});
