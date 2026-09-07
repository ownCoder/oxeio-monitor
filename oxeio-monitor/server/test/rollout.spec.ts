import { describe, expect, it } from 'vitest';

import {
  isNewer,
  isOfferedTo,
  pilotNeededFor,
  rolloutBucket,
} from '../src/agent/rollout';

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
/**
 * ⭐⭐ **বেছে দেওয়া PC (pilot)** *(১ সেপ্টেম্বর ২০২৬, মালিকের চাওয়া:
 * "OX-05 ei update age powa dorkar")*।
 *
 * ⚠️⚠️ ফাঁকটা নকশার: বালতি ঠিক হয় **মেশিন ধরে**, মানুষ ধরে নয় — তাই যে
 * PC-তে বাগটা ধরা পড়ে, সংশোধনটা ঠিক সেখানেই আগে পরীক্ষা করা যেত না।
 * মাঠে মাপা: OX-05-এর বালতি ৮৬, অথচ canary ৭ · partial ৫০।
 */
describe('rollout — বেছে দেওয়া PC', () => {
  /** বালতি ৫০-এর উপরে, অর্থাৎ canary বা partial কোনোটাতেই পড়ে না */
  const outsider = FLEET.find(
    (g) => rolloutBucket(g, '1.0.0') >= 50,
  ) as string;

  it('বালতির বাইরে থাকলেও পাইলট অফার পায়', () => {
    expect(isOfferedTo('canary', outsider, '1.0.0')).toBe(false);
    expect(isOfferedTo('canary', outsider, '1.0.0', true)).toBe(true);
    expect(isOfferedTo('partial', outsider, '1.0.0', true)).toBe(true);
  });

  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি দাবি:** থামানো বিল্ড পাইলটেও যায় না। নইলে খারাপ
   * আপডেট থামানোর পরেও ঠিক সেই মেশিনটায় যেতেই থাকত যেটায় আমরা সবচেয়ে
   * বেশি নজর রাখছি — আর স্বয়ংক্রিয় rollback নেই (G69)।
   */
  it('halted-এ পাইলটও পায় না', () => {
    expect(isOfferedTo('halted', outsider, '1.0.0', true)).toBe(false);
  });

  it('পাইলট না দিলে আগের আচরণ অপরিবর্তিত', () => {
    for (const guid of FLEET) {
      expect(isOfferedTo('canary', guid, '1.0.0', false)).toBe(
        isOfferedTo('canary', guid, '1.0.0'),
      );
    }
  });

  it('all-এ সবাই পায়, পাইলট হোক বা না হোক', () => {
    expect(isOfferedTo('all', outsider, '1.0.0')).toBe(true);
    expect(isOfferedTo('all', outsider, '1.0.0', true)).toBe(true);
  });
});


/**
 * ⭐⭐⭐ **canary-র বালতি খালি হলে ভার্সনটা চিরকাল আটকে থাকত**
 * *(৭ সেপ্টেম্বর ২০২৬, G168)*।
 *
 * ⚠️⚠️ বালতি পড়ে **মেশিন ধরে**, আর অফিসে আলাদা `machine_guid` মাত্র
 * **নয়টা** (উইন্ডোজ ইমেজ ক্লোন করা — ১২টা PC, ৯টা GUID)। ৯টা মেশিনে ৭%
 * মানে গড়ে ০.৬৩টা, অর্থাৎ **প্রায়ই কেউই বালতিতে পড়ে না**।
 *
 * ⚠️ কেউ অফার না পেলে কেউ ইনস্টল করে না → `RolloutAdvanceJob` কোনো প্রমাণ
 * পায় না → ধাপ বাড়ে না → ভার্সনটা **চিরকাল canary-তেই**। ঠিক সেই
 * অচলাবস্থা যেটা সারাতে ৫ সেপ্টেম্বর গোটা জবটা লেখা হয়েছিল।
 *
 * ⚠️⚠️ **তত্ত্ব নয়, মেপে দেখা:** অফিসের আসল ৯টা GUID নিয়ে ২০০টা সম্ভাব্য
 * ভার্সন-নম্বরে চালিয়ে **১০১টাতেই (৫০%)** বালতি খালি পাওয়া গেছে।
 */
describe('G168 — বালতি খালি হলে একজনকে বেছে নেওয়া', () => {
  const now = new Date('2026-09-07T04:00:00Z');
  const fresh = new Date(now.getTime() - 60 * 60 * 1000);
  const stale = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  const cand = (id: number, lastSeenAt: Date | null = fresh) => ({
    id,
    machineGuid: `machine-guid-${id}`,
    lastSeenAt,
  });

  /** ওই মেশিনগুলোর কেউই canary-তে পড়ে না, এমন একটা ভার্সন */
  const versionWithEmptyCanary = (guids: readonly string[]): string => {
    for (let i = 0; i < 500; i += 1) {
      const v = `9.0.${i}`;
      if (guids.every((g) => !isOfferedTo('canary', g, v))) return v;
    }
    throw new Error('no version with an empty canary bucket');
  };

  /** অন্তত একজন canary-তে পড়ে, এমন একটা ভার্সন */
  const versionWithSomeoneInCanary = (guids: readonly string[]): string => {
    for (let i = 0; i < 500; i += 1) {
      const v = `9.0.${i}`;
      if (guids.some((g) => isOfferedTo('canary', g, v))) return v;
    }
    throw new Error('no version with a filled canary bucket');
  };

  const people = [cand(1), cand(2), cand(3), cand(4), cand(5)];
  const guids = people.map((p) => p.machineGuid);

  /** ⭐⭐⭐ এই ব্লকের মূল দাবি */
  it('⭐ বালতি খালি হলে একজন pilot ফেরত আসে', () => {
    const v = versionWithEmptyCanary(guids);
    const picked = pilotNeededFor('canary', people, v, now);

    expect(picked).not.toBeNull();
    expect(guids).toHaveLength(5);
    expect(people.some((p) => p.id === picked)).toBe(true);
  });

  /** ⚠️ কেউ এমনিতেই পড়লে হস্তক্ষেপ নয় — নিয়মটা নিজেই কাজ করছে */
  it('⭐ কেউ বালতিতে পড়লে কিছু করা হয় না', () => {
    const v = versionWithSomeoneInCanary(guids);

    expect(pilotNeededFor('canary', people, v, now)).toBeNull();
  });

  /**
   * ⚠️⚠️ `all`-এ সবাই এমনিতেই পাচ্ছে, আর `halted` মানে **ইচ্ছাকৃতভাবে**
   * কাউকে নয় — জরুরি ব্রেক। দুটোতেই pilot বসানো ভুল হতো, আর দ্বিতীয়টা
   * সরাসরি বিপজ্জনক: থামানোর পরেও একটা মেশিনে খারাপ বিল্ড যেত।
   */
  it('⭐ all আর halted — দুটোতেই কিছু করা হয় না', () => {
    const v = versionWithEmptyCanary(guids);

    expect(pilotNeededFor('all', people, v, now)).toBeNull();
    expect(pilotNeededFor('halted', people, v, now)).toBeNull();
  });

  /**
   * ⚠️⚠️ **জীবিত মেশিন আগে** — যে PC এক দিনেও সাড়া দেয়নি সে কোনো প্রমাণ
   * দিতে পারবে না, আর তাকে বাছলে অচলাবস্থাটা রয়েই যেত।
   */
  it('⭐ অনেকদিন চুপ থাকা মেশিন বাছা হয় না', () => {
    const v = versionWithEmptyCanary(guids);
    const mixed = [cand(1, stale), cand(2, stale), cand(3, fresh)];

    // ⚠️ ৩ নম্বরই একমাত্র জীবিত — বালতির সংখ্যা যাই হোক
    expect(pilotNeededFor('canary', mixed, versionWithEmptyCanary(
      mixed.map((m) => m.machineGuid),
    ), now)).toBe(3);
    expect(v).toBeTruthy();
  });

  /** ⭐ কেউ জীবিত না থাকলে সবার মধ্যে থেকেই — না-বাছাইয়ের চেয়ে ভালো */
  it('কেউ জীবিত না থাকলেও একজন বাছা হয়', () => {
    const dead = [cand(1, stale), cand(2, stale), cand(3, null)];
    const v = versionWithEmptyCanary(dead.map((d) => d.machineGuid));

    expect(pilotNeededFor('canary', dead, v, now)).not.toBeNull();
  });

  /**
   * ⚠️ বাছাইটা **নির্ধারিত** — একই ইনপুটে সবসময় একই উত্তর। এলোমেলো হলে
   *    প্রতিটা প্রকাশে অন্য একজন গিনিপিগ হতেন, আর কেন সেই মেশিনটা বাছা
   *    হলো সেই প্রশ্নের কোনো উত্তর থাকত না।
   */
  it('⭐ একই ইনপুটে সবসময় একই উত্তর', () => {
    const v = versionWithEmptyCanary(guids);
    const once = pilotNeededFor('canary', people, v, now);

    for (let i = 0; i < 5; i += 1) {
      expect(pilotNeededFor('canary', people, v, now)).toBe(once);
    }
  });

  /** ⚠️ যাকে বাছা হয়, তার বালতির সংখ্যাই সবচেয়ে কম */
  it('⭐ বালতির সংখ্যা সবচেয়ে কম যার, তাকেই', () => {
    const v = versionWithEmptyCanary(guids);
    const picked = pilotNeededFor('canary', people, v, now);

    const lowest = Math.min(...guids.map((g) => rolloutBucket(g, v)));
    const chosen = people.find((p) => p.id === picked)!;

    expect(rolloutBucket(chosen.machineGuid, v)).toBe(lowest);
  });

  it('একটাও ডিভাইস না থাকলে null', () => {
    expect(pilotNeededFor('canary', [], '9.9.9', now)).toBeNull();
  });
});
