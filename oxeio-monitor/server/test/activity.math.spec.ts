import { describe, expect, it } from 'vitest';

import {
  addSeconds,
  emptyBuckets,
  foldDailyScores,
  foldTeamSites,
  foldUsage,
  normalizeDomain,
  normalizeProcess,
  parseWorkDate,
  patternProblem,
  resolveRange,
  scoreOf,
  toDateKey,
  type CategoryMeta,
  type DailyGroup,
  type TeamGroup,
  type UsageGroup,
} from '../src/activity/activity.math';

/** seed-এর নিয়মগুলোর ছোট নমুনা — id-গুলো মনগড়া, কিন্তু ধরনগুলো আসল। */
const META = new Map<number, CategoryMeta>([
  [1, { displayName: 'Visual Studio Code', category: 'productive', matchType: 'process' }],
  [2, { displayName: 'Google Chrome', category: 'neutral', matchType: 'process' }],
  [3, { displayName: 'GitHub', category: 'productive', matchType: 'domain' }],
  [4, { displayName: 'YouTube', category: 'unproductive', matchType: 'domain' }],
  [5, { displayName: 'Facebook', category: 'unproductive', matchType: 'domain' }],
]);

const H = 3600;

const day = (text: string): Date => parseWorkDate(text);

// ── স্কোর (D07) ──────────────────────────────────────────────────────────────

describe('productivity স্কোর — অচেনা সময় হরে ঢোকে না', () => {
  it('স্কোর হয় productive ÷ (জানা সব), অচেনা বাদ দিয়ে', () => {
    const b = emptyBuckets();
    addSeconds(b, 'productive', 3 * H);
    addSeconds(b, 'neutral', 1 * H);
    addSeconds(b, 'unproductive', 0);
    addSeconds(b, null, 96 * H);

    const score = scoreOf(b);

    // ⭐ ৯৬ ঘণ্টা অচেনা থাকা সত্ত্বেও হর ৪ ঘণ্টাই — null মানে "জানি না",
    //    সেটা কারো বিপক্ষেও যায় না, পক্ষেও না
    expect(score.categorizedSec).toBe(4 * H);
    expect(score.scorePct).toBe(75);
  });

  it('অচেনা সময়কে neutral ধরলে যে ভুলটা হতো, সেটা হয় না', () => {
    const b = emptyBuckets();
    addSeconds(b, 'productive', 1 * H);
    addSeconds(b, null, 9 * H);

    // এখন: ১০০%, পাশে "৯০% সময় অচেনা"
    // ভুল ভাবে neutral ধরলে: ১০% — সম্পূর্ণ অন্য গল্প, অথচ একই ডেটা
    expect(scoreOf(b).scorePct).toBe(100);
    expect(scoreOf(b).unknownPct).toBe(90);
  });

  it('স্কোরের পাশে সবসময় "কত শতাংশ অচেনা" থাকে', () => {
    const b = emptyBuckets();
    addSeconds(b, 'productive', 1 * H);
    addSeconds(b, null, 99 * H);

    const score = scoreOf(b);
    expect(score.scorePct).toBe(100);
    expect(score.unknownPct).toBe(99);
  });

  /**
   * ⭐ সবচেয়ে দরকারি টেস্ট। শূন্য দিয়ে ভাগ করলে NaN, আর `?? 0` দিয়ে ঢাকলে
   * "০% productive" — যেটা বলত লোকটা সারাদিন অকাজ করেছে। সত্যিটা হলো
   * বলার মতো কোনো তথ্যই নেই।
   */
  it('জানা সময় শূন্য হলে স্কোর null, শূন্য নয়', () => {
    expect(scoreOf(emptyBuckets()).scorePct).toBeNull();

    const allUnknown = emptyBuckets();
    addSeconds(allUnknown, null, 8 * H);
    const score = scoreOf(allUnknown);

    expect(score.scorePct).toBeNull();
    expect(score.unknownPct).toBe(100);
    expect(score.totalSec).toBe(8 * H);
  });

  it('একেবারে খালি দিনে কোনো সংখ্যা NaN হয় না', () => {
    const score = scoreOf(emptyBuckets());

    expect(score.totalSec).toBe(0);
    expect(score.categorizedSec).toBe(0);
    expect(score.unknownPct).toBe(0);
    expect(Number.isNaN(score.unknownPct)).toBe(false);
  });

  it('শতাংশ দুই দশমিকে থামে', () => {
    const b = emptyBuckets();
    addSeconds(b, 'productive', 1);
    addSeconds(b, 'neutral', 2);

    expect(scoreOf(b).scorePct).toBe(33.33);
  });

  it('ঋণাত্মক সময় চুপচাপ মেনে নেওয়া হয় না', () => {
    expect(() => addSeconds(emptyBuckets(), 'productive', -1)).toThrow(RangeError);
    expect(() => addSeconds(emptyBuckets(), null, Number.NaN)).toThrow(RangeError);
  });
});

describe('দিনভিত্তিক ভাঁজ (D07)', () => {
  const groups: DailyGroup[] = [
    { employeeId: 7, workDate: day('2026-08-02'), categoryId: 1, seconds: 2 * H },
    { employeeId: 7, workDate: day('2026-08-02'), categoryId: 4, seconds: 2 * H },
    { employeeId: 7, workDate: day('2026-08-01'), categoryId: 1, seconds: 6 * H },
    { employeeId: 7, workDate: day('2026-08-01'), categoryId: null, seconds: 1 * H },
    { employeeId: 9, workDate: day('2026-08-01'), categoryId: 5, seconds: 3 * H },
  ];

  it('দিনগুলো তারিখের ক্রমে আসে, উল্টোভাবে ঢোকালেও', () => {
    const folded = foldDailyScores(groups, META);
    expect(folded.get(7)!.days.map((d) => d.workDate)).toEqual([
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('প্রতিটি দিনের স্কোর আলাদা, আর মোটটা সব দিনের যোগফলের উপর', () => {
    const folded = foldDailyScores(groups, META)!;
    const seven = folded.get(7)!;

    expect(seven.days[0].scorePct).toBe(100); // ৬ ঘণ্টা VS Code, ১ ঘণ্টা অচেনা
    expect(seven.days[0].unknownPct).toBe(round(1 / 7));
    expect(seven.days[1].scorePct).toBe(50); // ২ ঘণ্টা কোড, ২ ঘণ্টা YouTube

    // মোট: ৮ ঘণ্টা productive, ২ ঘণ্টা unproductive → ৮০%
    expect(seven.total.scorePct).toBe(80);
    expect(seven.total.unknownSec).toBe(1 * H);
  });

  it('যেসব দিনে কোনো সারি নেই সেগুলোর জন্য শূন্য সারি বানানো হয় না', () => {
    // ১ ও ২ আগস্টের সারি আছে, ৩ আগস্টের নেই — তাই দুটোই দিন
    expect(foldDailyScores(groups, META).get(7)!.days).toHaveLength(2);
  });

  it('কোনো সারি না থাকলে ম্যাপে ওই কর্মী থাকেন না (সার্ভিস তখন শূন্য স্কোর বসায়)', () => {
    expect(foldDailyScores([], META).size).toBe(0);
  });

  it('ম্যাপে না থাকা categoryId "অচেনা" হয়, ক্র্যাশ নয়', () => {
    const folded = foldDailyScores(
      [{ employeeId: 1, workDate: day('2026-08-01'), categoryId: 999, seconds: H }],
      META,
    );

    expect(folded.get(1)!.total.unknownSec).toBe(H);
    expect(folded.get(1)!.total.scorePct).toBeNull();
  });
});

// ── টপ ১০ (D08) ─────────────────────────────────────────────────────────────

describe('normalize — একই জিনিস একটাই সারি', () => {
  it('প্রসেসের নাম ছোট হাতের হয়', () => {
    expect(normalizeProcess('  Chrome.EXE ')).toBe('chrome.exe');
  });

  it('ডোমেইনের www. ছাঁটা হয়', () => {
    expect(normalizeDomain('WWW.YouTube.com')).toBe('youtube.com');
    expect(normalizeDomain('youtube.com.')).toBe('youtube.com');
  });

  /** ⚠️ `www.com` একটা আসল ডোমেইন — অন্ধভাবে ছাঁটলে ওটা `com` হয়ে যেত */
  it('www. ছাঁটার পর কিছুই না থাকলে ছাঁটা হয় না', () => {
    expect(normalizeDomain('www.com')).toBe('www.com');
    expect(normalizeDomain('wwwx.com')).toBe('wwwx.com');
  });
});

describe('টপ অ্যাপ ও সাইট (D08)', () => {
  it('বড় থেকে ছোট সাজানো, আর সমান হলে ফল প্রতিবার এক', () => {
    const groups: UsageGroup[] = [
      { key: 'b.exe', categoryId: 1, seconds: 100, records: 1 },
      { key: 'a.exe', categoryId: 1, seconds: 100, records: 1 },
      { key: 'c.exe', categoryId: 1, seconds: 300, records: 1 },
    ];

    const first = foldUsage(groups, META, 'app').rows.map((r) => r.key);
    const again = foldUsage([...groups].reverse(), META, 'app').rows.map((r) => r.key);

    expect(first).toEqual(['c.exe', 'a.exe', 'b.exe']);
    expect(again).toEqual(first);
  });

  it('বড়-ছোট হাতের ভিন্নতা এক সারিতে মেশে', () => {
    const report = foldUsage(
      [
        { key: 'Code.exe', categoryId: 1, seconds: 2 * H, records: 3 },
        { key: 'code.exe', categoryId: 1, seconds: 1 * H, records: 2 },
      ],
      META,
      'app',
    );

    expect(report.distinctKeys).toBe(1);
    expect(report.rows[0].seconds).toBe(3 * H);
    expect(report.rows[0].records).toBe(5);
  });

  /**
   * ⭐ এটাই D08-এর সবচেয়ে নীরব ফাঁদ। `chrome.exe`-এর সারিগুলোর ক্যাটাগরি
   * আসে **ডোমেইন** রুল থেকে (youtube.com, github.com)। রুলের display_name
   * অ্যাপের নাম হিসেবে বসিয়ে দিলে তালিকায় লেখা থাকত "YouTube — ৫ ঘণ্টা",
   * অথচ সেটা আসলে গোটা ব্রাউজারের সময়।
   */
  it('ব্রাউজারের সময় ডোমেইন রুলের নামে দেখানো হয় না', () => {
    const report = foldUsage(
      [
        { key: 'chrome.exe', categoryId: 4, seconds: 3 * H, records: 10 }, // YouTube
        { key: 'chrome.exe', categoryId: 3, seconds: 2 * H, records: 8 }, // GitHub
      ],
      META,
      'app',
    );

    expect(report.rows[0].label).toBe('chrome.exe');
    expect(report.rows[0].mixed).toBe(true);
    expect(report.rows[0].category).toBe('unproductive'); // ৩ ঘণ্টা > ২ ঘণ্টা
    expect(report.rows[0].buckets.productiveSec).toBe(2 * H);
  });

  it('একটামাত্র process রুলে পড়লে সুন্দর নামটাই আসে', () => {
    const report = foldUsage(
      [{ key: 'code.exe', categoryId: 1, seconds: H, records: 1 }],
      META,
      'app',
    );

    expect(report.rows[0].label).toBe('Visual Studio Code');
    expect(report.rows[0].mixed).toBe(false);
  });

  it('সাইটের তালিকায় ডোমেইন রুলের নাম আসে', () => {
    const report = foldUsage(
      [{ key: 'www.youtube.com', categoryId: 4, seconds: H, records: 1 }],
      META,
      'site',
    );

    expect(report.rows[0].key).toBe('youtube.com');
    expect(report.rows[0].label).toBe('YouTube');
  });

  /**
   * ⭐ শতাংশের হর **মোট** সময়, দেখানো ১০টার যোগফল নয়। নইলে শতাংশগুলো
   * সবসময় ১০০-তে মিলে যেত আর ৩০০টা সাইটের লেজটা অদৃশ্য হতো।
   */
  it('sharePct-এর হর মোট সময়, টপ তালিকার যোগফল নয়', () => {
    const groups: UsageGroup[] = Array.from({ length: 20 }, (_, i) => ({
      key: `app${String(i).padStart(2, '0')}.exe`,
      categoryId: 1,
      seconds: 100,
      records: 1,
    }));

    const report = foldUsage(groups, META, 'app', 10);

    expect(report.totalSec).toBe(2000);
    expect(report.distinctKeys).toBe(20);
    expect(report.otherSec).toBe(1000);
    expect(report.rows[0].sharePct).toBe(5); // ১০০ ÷ ২০০০, ১০০ ÷ ১০০০ নয়

    const shown = report.rows.reduce((sum, r) => sum + r.sharePct, 0);
    expect(shown).toBe(50); // ⭐ ১০০ নয় — বাকি অর্ধেক তালিকার বাইরে
  });

  it('খালি রেঞ্জে সব শূন্য, কোনো ভাগ NaN হয় না', () => {
    const report = foldUsage([], META, 'app');

    expect(report.rows).toEqual([]);
    expect(report.totalSec).toBe(0);
    expect(report.otherSec).toBe(0);
    expect(report.distinctKeys).toBe(0);
  });

  it('সব সারি অচেনা হলে ক্যাটাগরি null, তবু তালিকাটা আসে', () => {
    const report = foldUsage(
      [{ key: 'unknown.exe', categoryId: null, seconds: 5 * H, records: 4 }],
      META,
      'app',
    );

    expect(report.rows[0].category).toBeNull();
    expect(report.rows[0].mixed).toBe(false);
    expect(report.rows[0].label).toBe('unknown.exe');
    expect(report.rows[0].buckets.unknownSec).toBe(5 * H);
  });

  it('খালি কী বাদ পড়ে, কিন্তু ফাঁকা সারি তৈরি করে না', () => {
    const report = foldUsage(
      [
        { key: '   ', categoryId: null, seconds: H, records: 1 },
        { key: 'code.exe', categoryId: 1, seconds: H, records: 1 },
      ],
      META,
      'app',
    );

    expect(report.distinctKeys).toBe(1);
  });

  it('limit শূন্য বা ঋণাত্মক হলেও ভাঙে না', () => {
    const report = foldUsage(
      [{ key: 'code.exe', categoryId: 1, seconds: H, records: 1 }],
      META,
      'app',
      0,
    );

    expect(report.rows).toEqual([]);
    expect(report.otherSec).toBe(H); // সবটাই তালিকার বাইরে
  });
});

// ── টিম সারাংশ (D09) ────────────────────────────────────────────────────────

describe('টিম-ভিত্তিক সাইট সারাংশ (D09)', () => {
  const groups: TeamGroup[] = [
    { domain: 'youtube.com', employeeId: 1, categoryId: 4, seconds: 5 * H },
    { domain: 'www.youtube.com', employeeId: 2, categoryId: 4, seconds: 1 * H },
    { domain: 'github.com', employeeId: 1, categoryId: 3, seconds: 2 * H },
    { domain: 'github.com', employeeId: 2, categoryId: 3, seconds: 2 * H },
    { domain: 'github.com', employeeId: 3, categoryId: 3, seconds: 2 * H },
  ];

  it('একই সাইট এক সারিতে আসে, www. থাকুক বা না থাকুক', () => {
    const report = foldTeamSites(groups, META);
    const youtube = report.rows.find((r) => r.domain === 'youtube.com')!;

    expect(youtube.totalSec).toBe(6 * H);
    expect(youtube.employees).toBe(2);
  });

  /**
   * ⭐ D09-এর আসল বিপদ: একজনের অভ্যাসকে "টিমের" বলে চালিয়ে দেওয়া।
   * ৬ ঘণ্টার ৫ ঘণ্টাই একজনের — `employees` আর `topEmployeeSec` না থাকলে
   * মালিক ভাবতেন গোটা টিম YouTube-এ পড়ে আছে।
   */
  it('কোন কর্মীর কত অংশ সেটা দেখা যায়', () => {
    const report = foldTeamSites(groups, META);
    const youtube = report.rows.find((r) => r.domain === 'youtube.com')!;

    expect(youtube.topEmployeeId).toBe(1);
    expect(youtube.topEmployeeSec).toBe(5 * H);

    const github = report.rows.find((r) => r.domain === 'github.com')!;
    expect(github.employees).toBe(3);
    expect(github.topEmployeeSec).toBe(2 * H); // সমান ভাগ — একজনের নয়
  });

  it('সমান সময় হলেও topEmployeeId প্রতিবার একই আসে', () => {
    const tied: TeamGroup[] = [
      { domain: 'a.com', employeeId: 9, categoryId: 3, seconds: H },
      { domain: 'a.com', employeeId: 4, categoryId: 3, seconds: H },
    ];

    expect(foldTeamSites(tied, META).rows[0].topEmployeeId).toBe(4);
    expect(foldTeamSites([...tied].reverse(), META).rows[0].topEmployeeId).toBe(4);
  });

  it('সময় অনুযায়ী সাজানো, আর শতাংশের হর মোট সময়', () => {
    const report = foldTeamSites(groups, META, 1);

    expect(report.rows[0].domain).toBe('github.com'); // ৬ ঘণ্টা
    expect(report.totalSec).toBe(12 * H);
    expect(report.rows[0].sharePct).toBe(50);
    expect(report.otherSec).toBe(6 * H);
    expect(report.distinctDomains).toBe(2);
  });

  it('খালি রেঞ্জে সব শূন্য', () => {
    const report = foldTeamSites([], META);
    expect(report.rows).toEqual([]);
    expect(report.totalSec).toBe(0);
    expect(report.distinctDomains).toBe(0);
  });
});

// ── রুলের প্যাটার্ন (D06) ────────────────────────────────────────────────────

describe('প্যাটার্ন যাচাই — নীরবে বাদ পড়া রুল ঠেকানো', () => {
  it('ভালো প্যাটার্নে কোনো আপত্তি নেই', () => {
    expect(patternProblem('process', 'code.exe')).toBeNull();
    expect(patternProblem('process', 'docker desktop.exe')).toBeNull();
    expect(patternProblem('domain', 'mail.google.com')).toBeNull();
    expect(patternProblem('domain', 'localhost')).toBeNull();
    expect(patternProblem('title_regex', '^Jira\\b')).toBeNull();
  });

  it('খালি প্যাটার্ন নাকচ — compile() ওটা নীরবে ফেলে দিত', () => {
    expect(patternProblem('domain', '   ')).not.toBeNull();
  });

  /** ⚠️ `app_usage`-এ ফুল URL কখনো জমা হয় না, তাই এমন রুল কোনোদিন মিলত না */
  it('ডোমেইনের জায়গায় পুরো URL নাকচ', () => {
    expect(patternProblem('domain', 'https://youtube.com/watch')).not.toBeNull();
    expect(patternProblem('domain', 'youtube.com/feed')).not.toBeNull();
    expect(patternProblem('domain', 'ভিডিও দেখা')).not.toBeNull();
    expect(patternProblem('domain', 'youtube')).not.toBeNull();
  });

  it('প্রসেসের জায়গায় পুরো পাথ নাকচ', () => {
    expect(patternProblem('process', 'C:\\Program Files\\code.exe')).not.toBeNull();
  });

  /** ⚠️ ভুল regex `compile()` চুপচাপ ফেলে দেয় — মালিক কোনোদিন জানতেন না */
  it('ভাঙা regex নাকচ', () => {
    expect(patternProblem('title_regex', '([unclosed')).not.toBeNull();
  });

  it('অতিরিক্ত লম্বা regex নাকচ — ওটা ইভেন্ট লুপ আটকে দিতে পারে', () => {
    expect(patternProblem('title_regex', 'a'.repeat(201))).not.toBeNull();
    expect(patternProblem('title_regex', 'a'.repeat(200))).toBeNull();
  });
});

// ── তারিখ ও রেঞ্জ ────────────────────────────────────────────────────────────

describe('work_date পড়া ও লেখা', () => {
  /**
   * ⚠️ `work_date` একটা `@db.Date` — ঢাকার তারিখ, UTC-midnight হিসেবে জমা।
   * এখানে আবার টাইমজোন প্রয়োগ করলে প্রতিটা তারিখ একদিন সরে যেত, আর
   * সেটা কেবল কিছু সার্ভারে ধরা পড়ত।
   */
  it('তারিখ UTC ধরে লেখা হয়, সার্ভারের টাইমজোন ধরে নয়', () => {
    expect(toDateKey(new Date(Date.UTC(2026, 7, 9)))).toBe('2026-08-09');
    expect(toDateKey(parseWorkDate('2026-01-01'))).toBe('2026-01-01');
    expect(toDateKey(parseWorkDate('2026-12-31'))).toBe('2026-12-31');
  });

  it('ভুল ফরম্যাট নাকচ', () => {
    expect(() => parseWorkDate('2026-8-9')).toThrow(RangeError);
    expect(() => parseWorkDate('09-08-2026')).toThrow(RangeError);
    expect(() => parseWorkDate('')).toThrow(RangeError);
  });

  /** ⚠️ `Date.UTC(2026, 1, 31)` চুপচাপ ৩ মার্চ হয়ে যায় — ফিরে মিলিয়ে দেখা হয় */
  it('অস্তিত্বহীন তারিখ চুপচাপ গড়িয়ে যায় না', () => {
    expect(() => parseWorkDate('2026-02-31')).toThrow(RangeError);
    expect(() => parseWorkDate('2026-13-01')).toThrow(RangeError);
    expect(() => parseWorkDate('2026-00-10')).toThrow(RangeError);
  });

  it('অধিবর্ষের ২৯ ফেব্রুয়ারি বৈধ, সাধারণ বছরে নয়', () => {
    expect(toDateKey(parseWorkDate('2028-02-29'))).toBe('2028-02-29');
    expect(() => parseWorkDate('2026-02-29')).toThrow(RangeError);
  });
});

describe('রেঞ্জ ঠিক করা', () => {
  const today = parseWorkDate('2026-08-11');

  it('কিছু না দিলে চলতি মাসের ১ তারিখ থেকে আজ', () => {
    const range = resolveRange(undefined, undefined, today);

    expect(toDateKey(range.from)).toBe('2026-08-01');
    expect(toDateKey(range.to)).toBe('2026-08-11');
    expect(range.days).toBe(11);
  });

  it('একই দিন দিলে রেঞ্জ এক দিনের — শূন্য দিনের নয়', () => {
    expect(resolveRange('2026-08-11', '2026-08-11', today).days).toBe(1);
  });

  it('উল্টো রেঞ্জ নাকচ — নইলে চুপচাপ খালি রিপোর্ট আসত', () => {
    expect(() => resolveRange('2026-08-11', '2026-08-01', today)).toThrow(RangeError);
  });

  it('অতি লম্বা রেঞ্জ নাকচ — একটা টাইপো পুরো টেবিল স্ক্যান করাত', () => {
    expect(() => resolveRange('2000-01-01', '2026-08-11', today)).toThrow(RangeError);
  });

  it('শুধু from দিলে to হয় আজ', () => {
    const range = resolveRange('2026-08-05', undefined, today);
    expect(toDateKey(range.to)).toBe('2026-08-11');
    expect(range.days).toBe(7);
  });

  it('খালি স্ট্রিং "দেওয়া হয়নি" হিসেবেই ধরা হয়', () => {
    // query string-এ `?from=&to=` লিখলে express খালি স্ট্রিং দেয়
    const range = resolveRange('', '', today);
    expect(toDateKey(range.from)).toBe('2026-08-01');
    expect(toDateKey(range.to)).toBe('2026-08-11');
  });
});

/** টেস্টে শতাংশ মেলানোর জন্য — গোলাকার করার নিয়ম কোডের সাথেই এক */
function round(fraction: number): number {
  return Math.round(fraction * 100 * 100) / 100;
}
