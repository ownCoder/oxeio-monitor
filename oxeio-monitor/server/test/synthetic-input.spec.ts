import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SYNTHETIC_LIMITS,
  distinctWindows,
  findSyntheticInput,
  mergeActive,
  scoreSpread,
  type ActiveSegment,
  type WindowSpan,
} from '../src/alerts/synthetic-input.rules';

/**
 * **G46 — মাউস-জিগলার ধরা।**
 *
 * ⚠️⚠️ এই ফাইলের ভুলের দুটো দিক, আর দুটোই খারাপ:
 *   · **কম ধরলে** ফিচারটা নীরবে অকেজো — কেউ সারাদিন ঠকিয়ে যাবে
 *   · **বেশি ধরলে** নির্দোষ কর্মী সন্দেহে পড়বেন, আর সেটা আরও খারাপ
 *
 * ⭐ তাই মিথ্যা-ইঙ্গিতের টেস্টগুলো এখানে অন্তত ততটাই গুরুত্ব পায়।
 */
const T0 = new Date('2026-08-16T03:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

/** একটানা ACTIVE খণ্ড বানানো — `每` খণ্ড ৫ মিনিট, স্কোর দেওয়া যায় */
function run(
  fromMin: number,
  toMin: number,
  score: number | ((i: number) => number) | null = 100,
): ActiveSegment[] {
  const out: ActiveSegment[] = [];
  for (let m = fromMin, i = 0; m < toMin; m += 5, i++) {
    out.push({
      startedAt: at(m),
      endedAt: at(m + 5),
      inputScore: typeof score === 'function' ? score(i) : score,
    });
  }
  return out;
}

const win = (fromMin: number, toMin: number, key: string): WindowSpan => ({
  startedAt: at(fromMin),
  endedAt: at(toMin),
  key,
});

describe('mergeActive', () => {
  it('পাশাপাশি খণ্ড এক স্ট্রেচ হয়', () => {
    expect(mergeActive(run(0, 30))).toHaveLength(1);
  });

  /** ⚠️ idle বিরতি স্ট্রেচ ভাঙে — এটাই মানুষ ও যন্ত্রের আসল তফাত */
  it('ফাঁক থাকলে আলাদা স্ট্রেচ', () => {
    const segments = [...run(0, 30), ...run(45, 75)];

    expect(mergeActive(segments)).toHaveLength(2);
  });

  /**
   * ⚠️⚠️ কয়েক সেকেন্ডের ফাঁক সহ্য করতেই হবে — খণ্ডগুলো সেকেন্ডে গোল করা,
   * তাই ঠিক পিঠোপিঠি বসে না। না করলে প্রতিটা স্ট্রেচ ভেঙে যেত আর নিয়মটা
   * **কোনোদিন** কাউকে ধরত না।
   */
  it('কয়েক সেকেন্ডের ফাঁক ভাঙে না', () => {
    const segments: ActiveSegment[] = [
      { startedAt: at(0), endedAt: at(5), inputScore: 100 },
      { startedAt: new Date(at(5).getTime() + 3000), endedAt: at(10), inputScore: 100 },
    ];

    expect(mergeActive(segments)).toHaveLength(1);
  });

  it('ক্রম এলোমেলো থাকলেও ঠিক জোড়া লাগে', () => {
    const segments = [...run(20, 40), ...run(0, 20)];

    expect(mergeActive(segments)).toHaveLength(1);
  });

  it('খালি তালিকায় কিছুই নেই', () => {
    expect(mergeActive([])).toEqual([]);
  });
});

describe('distinctWindows', () => {
  const usage = [win(0, 60, 'chrome|Inbox'), win(60, 120, 'chrome|Docs')];

  it('আলাদা শিরোনাম আলাদা করে গোনে', () => {
    expect(distinctWindows(at(0), at(120), usage)).toBe(2);
  });

  /**
   * ⚠️ সীমানায় বসা উইন্ডোও গোনা হয় — পুরোপুরি ভেতরে থাকতে হয় না। নইলে
   * গোনাটা কম দেখাত, আর **নির্দোষ মানুষ সন্দেহে পড়তেন**।
   */
  it('আংশিক মিললেও গোনা হয়', () => {
    expect(distinctWindows(at(30), at(90), usage)).toBe(2);
  });

  it('বাইরের উইন্ডো গোনা হয় না', () => {
    expect(distinctWindows(at(200), at(260), usage)).toBe(0);
  });

  it('একই চাবি দুবার এলে একবারই', () => {
    const repeated = [win(0, 30, 'ps|Windows PowerShell'), win(30, 60, 'ps|Windows PowerShell')];

    expect(distinctWindows(at(0), at(60), repeated)).toBe(1);
  });
});

describe('scoreSpread', () => {
  it('সর্বোচ্চ ও সর্বনিম্নের ব্যবধান', () => {
    expect(scoreSpread(run(0, 15, (i) => [60, 90, 100][i]))).toBe(40);
  });

  it('সব সমান হলে শূন্য', () => {
    expect(scoreSpread(run(0, 30, 99))).toBe(0);
  });

  /**
   * ⚠️⚠️ স্কোর না থাকলে `null` — **শূন্য নয়**। শূন্য ধরলে "ওঠানামা নেই"
   * মনে হতো, আর সেটাই সন্দেহের শর্ত; অর্থাৎ তথ্যের অভাবকে প্রমাণ ধরা হতো।
   */
  it('স্কোর না থাকলে null', () => {
    expect(scoreSpread(run(0, 30, null))).toBeNull();
  });

  it('কিছু খণ্ডে স্কোর না থাকলে বাকিগুলো ধরে হিসাব', () => {
    const segments: ActiveSegment[] = [
      { startedAt: at(0), endedAt: at(5), inputScore: null },
      { startedAt: at(5), endedAt: at(10), inputScore: 80 },
      { startedAt: at(10), endedAt: at(15), inputScore: 100 },
    ];

    expect(scoreSpread(segments)).toBe(20);
  });
});

describe('findSyntheticInput — যাকে ধরা উচিত', () => {
  /**
   * ⭐⭐ **আসল ঘটনার নকল।** মালিকের পাঠানো স্ক্রিপ্টটা ঠিক এটাই করে:
   * প্রতি মিনিটে `SendKeys("{F15}")`, PowerShell খোলা, কোনো বিরতি নেই।
   */
  it('তিন ঘণ্টা একটানা, এক উইন্ডো, সমান স্কোর — ধরা পড়ে', () => {
    const segments = run(0, 180, 98);
    const usage = [win(0, 180, 'powershell|Windows PowerShell')];

    const found = findSyntheticInput(segments, usage);

    expect(found).toHaveLength(1);
    expect(found[0].durationSec).toBe(180 * 60);
    expect(found[0].windows).toBe(1);
    expect(found[0].scoreSpread).toBe(0);
  });

  it('স্কোরে সামান্য ওঠানামা থাকলেও ধরা পড়ে', () => {
    const segments = run(0, 150, (i) => (i % 2 === 0 ? 98 : 100));

    expect(findSyntheticInput(segments, [win(0, 150, 'ps|x')])).toHaveLength(1);
  });

  /** ⚠️ দিনে দুবার চালালে দুটোই আলাদা করে ধরা পড়ে */
  it('একই দিনে দুটো স্ট্রেচ হলে দুটোই', () => {
    const segments = [...run(0, 130, 99), ...run(200, 330, 99)];
    const usage = [win(0, 130, 'ps|x'), win(200, 330, 'ps|x')];

    expect(findSyntheticInput(segments, usage)).toHaveLength(2);
  });
});

describe('findSyntheticInput — যাকে ধরা যাবে না', () => {
  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি টেস্ট।** মানুষ থামে — চা, বাথরুম, কারো ডাক।
   * একটা বিরতিই স্ট্রেচ ভেঙে দেয়, আর দুটো টুকরোর কোনোটাই সীমা ছোঁয় না।
   */
  it('মাঝে একবার থামলে ধরা পড়ে না', () => {
    const segments = [...run(0, 55, 99), ...run(70, 125, 99)];

    expect(findSyntheticInput(segments, [win(0, 125, 'ps|x')])).toHaveLength(0);
  });

  /**
   * ⭐ ডিজাইনার তিন ঘণ্টা এক ফাইলে কাজ করতে পারেন — কিন্তু তাঁর হাত
   * অসমান, আর শিরোনামও বদলায়। তাই তিনি ধরা পড়েন না।
   */
  it('একটানা কাজ কিন্তু হাত অসমান — ধরা পড়ে না', () => {
    const segments = run(0, 180, (i) => 60 + ((i * 7) % 40));

    expect(findSyntheticInput(segments, [win(0, 180, 'ai|design')])).toHaveLength(0);
  });

  it('উইন্ডো বদলালে ধরা পড়ে না', () => {
    const usage = [win(0, 90, 'chrome|Inbox'), win(90, 180, 'chrome|Docs')];

    expect(findSyntheticInput(run(0, 180, 99), usage)).toHaveLength(0);
  });

  it('সময় কম হলে ধরা পড়ে না', () => {
    expect(findSyntheticInput(run(0, 45, 99), [win(0, 45, 'ps|x')])).toHaveLength(0);
  });

  /**
   * ⚠️⚠️ স্কোর না জানলে **সন্দেহ করা হয় না**। পুরোনো এজেন্ট বা মাইগ্রেশনের
   * পরের সারিতে `input_score` null থাকতে পারে — তথ্যের অভাবকে প্রমাণ ধরলে
   * একদিন গোটা দল একসাথে অভিযুক্ত হতো।
   */
  it('স্কোর না জানলে ধরা পড়ে না', () => {
    expect(findSyntheticInput(run(0, 200, null), [win(0, 200, 'ps|x')])).toHaveLength(0);
  });

  /**
   * ⚠️⚠️ **শূন্য উইন্ডো মানে "জানা নেই", "বদলায়নি" নয়।** `app_usage` না
   * এলে শূন্য পাওয়া যায়, আর সেটাকে "একই উইন্ডো" ধরলে তথ্যের অভাবই
   * অভিযোগ হয়ে দাঁড়াত।
   *
   * ⭐ এতে ফাঁকির পথ খোলে না — কেউ ইচ্ছে করে `app_usage` থামালে সেটা
   * আরও জোরালো লক্ষণ, আর সেটা `agent_tamper`-এর কাজ, এই নিয়মের নয়।
   */
  it('foreground তথ্য একেবারে না থাকলে ধরা পড়ে না', () => {
    expect(findSyntheticInput(run(0, 200, 99), [])).toHaveLength(0);
  });

  it('খালি দিনে কিছুই নেই', () => {
    expect(findSyntheticInput([], [])).toEqual([]);
  });
});

describe('সীমাগুলো বদলানো যায়', () => {
  it('কড়া সীমা দিলে ছোট স্ট্রেচও ধরা পড়ে', () => {
    const found = findSyntheticInput(run(0, 40, 99), [win(0, 40, 'ps|x')], {
      ...DEFAULT_SYNTHETIC_LIMITS,
      minStretchSec: 30 * 60,
    });

    expect(found).toHaveLength(1);
  });

  /** ⚠️ ১৬ আগস্ট ২ → ১ ঘণ্টা — দেরিতে ধরা মানে ততক্ষণ ভুল ঘণ্টা জমা */
  it('ডিফল্ট সীমা এক ঘণ্টা', () => {
    expect(DEFAULT_SYNTHETIC_LIMITS.minStretchSec).toBe(60 * 60);
  });
});
