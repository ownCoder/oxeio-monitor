import type { MatchType, Productivity } from '@prisma/client';

import { MAX_REGEX_LENGTH } from './category-matcher';

/**
 * D07–D09-এর সব হিসাব — স্কোর, শতাংশ, সাজানো, ভাঁজ করা। খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * আলাদা ফাইলে রাখার কারণ [payroll.math.ts](../payroll/payroll.math.ts)-এর মতোই:
 * এখানকার প্রতিটা সিদ্ধান্ত ভুল হলে **কোথাও কোনো এরর উঠত না** — শুধু কারো
 * নামের পাশে একটা ভুল শতাংশ বসে থাকত। DB-র সাথে মিশে থাকলে এগুলো নিরিবিলি
 * পরীক্ষা করা যেত না।
 *
 * ⚠️ **ক্যাটাগরি কখনো বেতনের হিসাবে ঢোকে না** — এই ফাইলের কোনো সংখ্যা
 * `payroll` বা `credited_sec`-এর ধারেকাছে যায় না। কেউ সারাদিন "unproductive"
 * থাকলেও তার ঘণ্টা অক্ষত ([09 § ৪](../../../../docs/09-Build-Log.md))।
 */

/** D08-এর "টপ ১০" — ডিফল্ট, তবে endpoint-এ বদলানো যায়। */
export const TOP_N = 10;

/** এক অনুরোধে সর্বোচ্চ কত দিনের রেঞ্জ — নইলে একটা টাইপো পুরো টেবিল স্ক্যান করাত। */
export const MAX_RANGE_DAYS = 366;

const HOUR = 3600;

// ── ঝুড়ি ও স্কোর (D07) ───────────────────────────────────────────────────────

/**
 * সেকেন্ডের চারটি ঝুড়ি।
 *
 * ⭐ **`unknownSec` আলাদা ঝুড়ি, `neutralSec`-এর অংশ নয়।** `categoryId = null`
 * মানে "আমরা জানি না", আর neutral মানে "জানি, এবং এটা নিরপেক্ষ"। দুটো
 * মিলিয়ে ফেললে অচেনা প্রতিটা অ্যাপ নিঃশব্দে স্কোরের হর বাড়িয়ে দিত —
 * অর্থাৎ যত বেশি অচেনা, স্কোর তত কম, অথচ কারণটা কোথাও দেখা যেত না।
 */
export interface SecondBuckets {
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  /** মিল পাওয়া যায়নি — "জানি না"। কোনো হিসাবের হরে ঢোকে না। */
  unknownSec: number;
}

export interface ProductivityScore extends SecondBuckets {
  /** productive + neutral + unproductive — স্কোরের **হর** এটাই */
  categorizedSec: number;
  /** categorized + unknown */
  totalSec: number;
  /**
   * productive ÷ categorized × ১০০।
   *
   * ⚠️ **শূন্য হর হলে `null`, শূন্য নয়।** ০% বলত "এই লোক কিছুই productive
   * করেনি", অথচ সত্যিটা হলো "বলার মতো কোনো তথ্যই নেই"। ছুটির দিনে বা
   * এজেন্ট বন্ধ থাকা দিনে দুটোর পার্থক্য পুরো রিপোর্টের অর্থ বদলে দেয়।
   */
  scorePct: number | null;
  /**
   * মোট সময়ের কত শতাংশ অচেনা।
   *
   * ⭐ স্কোরের পাশে এটা **সবসময়** যায়। ৯০% সময় অচেনা হলে ১০০% স্কোরও
   * অর্থহীন, কিন্তু শুধু স্কোরটা দেখলে সেটা দারুণ দেখাত।
   *
   * ⚠️ "কত শতাংশ অচেনা হলে স্কোরটা আর বিশ্বাসযোগ্য নয়" — সেই সীমাটা এখানে
   * ধরে নেওয়া **হয়নি**। ওটা ব্যবসায়িক সিদ্ধান্ত, কেউ নেয়নি; নিজে থেকে
   * একটা সংখ্যা বসালে সেটা নীরবে নীতি হয়ে যেত (payroll-এর OT-র মতোই)।
   * দুটো সংখ্যা পাশাপাশি দেওয়া হয়, সিদ্ধান্ত যে দেখছে তার।
   */
  unknownPct: number;
}

export function emptyBuckets(): SecondBuckets {
  return { productiveSec: 0, neutralSec: 0, unproductiveSec: 0, unknownSec: 0 };
}

/**
 * ⚠️ ঋণাত্মক সময় চুপচাপ মেনে নেওয়া হয় না। `duration_sec` DTO-তেই `@Min(0)`,
 * তাই এমনটা হওয়ার কথা নয় — কিন্তু হলে স্কোর ১০০% ছাড়িয়ে যেত বা ঋণাত্মক হতো,
 * আর কেউ কখনো ধরতে পারত না সংখ্যাটা কোথা থেকে এল।
 */
export function addSeconds(
  into: SecondBuckets,
  category: Productivity | null,
  seconds: number,
): void {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError('Time cannot be negative or undefined');
  }

  switch (category) {
    case 'productive':
      into.productiveSec += seconds;
      break;
    case 'neutral':
      into.neutralSec += seconds;
      break;
    case 'unproductive':
      into.unproductiveSec += seconds;
      break;
    default:
      // null — মিল পাওয়া যায়নি
      into.unknownSec += seconds;
      break;
  }
}

export function mergeBuckets(into: SecondBuckets, from: SecondBuckets): void {
  into.productiveSec += from.productiveSec;
  into.neutralSec += from.neutralSec;
  into.unproductiveSec += from.unproductiveSec;
  into.unknownSec += from.unknownSec;
}

export function scoreOf(buckets: SecondBuckets): ProductivityScore {
  const categorizedSec =
    buckets.productiveSec + buckets.neutralSec + buckets.unproductiveSec;
  const totalSec = categorizedSec + buckets.unknownSec;

  return {
    ...buckets,
    categorizedSec,
    totalSec,
    scorePct:
      categorizedSec === 0
        ? null
        : round2((buckets.productiveSec * 100) / categorizedSec),
    // মোট শূন্য হলে "০% অচেনা" বলা হয় — কারণ অচেনা সময় সত্যিই শূন্য।
    // বিভ্রান্তি ঠেকায় পাশের `scorePct = null`, যেটা বলে তথ্যই নেই।
    unknownPct:
      totalSec === 0 ? 0 : round2((buckets.unknownSec * 100) / totalSec),
  };
}

// ── ক্যাটাগরির পরিচয় ─────────────────────────────────────────────────────────

/** `app_categories`-এর যতটুকু রিপোর্ট বানাতে লাগে। */
export interface CategoryMeta {
  displayName: string;
  category: Productivity;
  matchType: MatchType;
}

/**
 * ⚠️ id ম্যাপে না থাকলে `null` — অর্থাৎ "অচেনা", crash নয়। foreign key
 * থাকায় এমন হওয়ার কথা নয়, কিন্তু একটা রুল মুছে ফেলার আর ম্যাপটা পড়ার
 * মাঝখানে এটা ঘটতে পারে, আর তখন গোটা রিপোর্ট ৫০০ দেওয়ার কোনো মানে নেই।
 */
function categoryOf(
  meta: ReadonlyMap<number, CategoryMeta>,
  categoryId: number | null,
): Productivity | null {
  if (categoryId === null) return null;
  return meta.get(categoryId)?.category ?? null;
}

// ── দৈনিক স্কোর (D07) ────────────────────────────────────────────────────────

/** `groupBy(['employeeId','workDate','categoryId'])`-এর একটা সারি। */
export interface DailyGroup {
  employeeId: number;
  /** `@db.Date` — ঢাকার তারিখ, UTC-midnight হিসেবে জমা */
  workDate: Date;
  categoryId: number | null;
  seconds: number;
}

export interface DailyScore extends ProductivityScore {
  /** YYYY-MM-DD */
  workDate: string;
}

export interface EmployeeDays {
  days: DailyScore[];
  total: ProductivityScore;
}

/**
 * কর্মী → দিন → স্কোর।
 *
 * ⚠️ যেসব দিনে একটাও সারি নেই সেই দিনগুলো **থাকে না** — শূন্য স্কোরের সারি
 * বানানো হয় না। "ওইদিন কিছু করেনি" আর "ওইদিন এজেন্ট চলেনি / ছুটি ছিল"
 * এক নয়, আর app_usage থেকে দুটোর পার্থক্য বোঝার উপায় নেই। ফাঁকা দিন
 * ছুটি না কি অনুপস্থিতি — সেটা `daily_summary`-র `day_type`-এর কাজ।
 */
export function foldDailyScores(
  groups: readonly DailyGroup[],
  meta: ReadonlyMap<number, CategoryMeta>,
): Map<number, EmployeeDays> {
  const byEmployee = new Map<number, Map<string, SecondBuckets>>();

  for (const g of groups) {
    let days = byEmployee.get(g.employeeId);
    if (!days) {
      days = new Map<string, SecondBuckets>();
      byEmployee.set(g.employeeId, days);
    }

    const key = toDateKey(g.workDate);
    let bucket = days.get(key);
    if (!bucket) {
      bucket = emptyBuckets();
      days.set(key, bucket);
    }

    addSeconds(bucket, categoryOf(meta, g.categoryId), g.seconds);
  }

  const out = new Map<number, EmployeeDays>();

  for (const [employeeId, days] of byEmployee) {
    const total = emptyBuckets();
    const rows: DailyScore[] = [];

    // তারিখ অনুযায়ী সাজানো — YYYY-MM-DD-তে লেক্সিকোগ্রাফিক ক্রমই কালানুক্রম
    for (const key of [...days.keys()].sort()) {
      const bucket = days.get(key)!;
      mergeBuckets(total, bucket);
      rows.push({ workDate: key, ...scoreOf(bucket) });
    }

    out.set(employeeId, { days: rows, total: scoreOf(total) });
  }

  return out;
}

// ── টপ অ্যাপ ও সাইট (D08) ────────────────────────────────────────────────────

/** `groupBy(['processName'|'domain', 'categoryId'])`-এর একটা সারি। */
export interface UsageGroup {
  /** কাঁচা `process_name` বা `domain` — যেমন এজেন্ট পাঠিয়েছে */
  key: string;
  categoryId: number | null;
  seconds: number;
  records: number;
}

export interface UsageTally {
  /** স্বাভাবিক করা কী (ছোট হাতের, সাইটে `www.` ছাড়া) */
  key: string;
  /** দেখানোর নাম — নিশ্চিত হলে রুলের `display_name`, নইলে কী-টাই */
  label: string;
  seconds: number;
  hours: string;
  /** কতগুলো `app_usage` সারি এতে মিলেছে */
  records: number;
  buckets: SecondBuckets;
  /**
   * সবচেয়ে বেশি সেকেন্ড যে ঝুড়িতে। জানা কিছু না থাকলে `null`।
   * `mixed` সত্যি হলে এটা শুধু ইঙ্গিত — একক সত্য নয়।
   */
  category: Productivity | null;
  /**
   * ⚠️ একাধিক **জানা** ক্যাটাগরি মিশে আছে কি না।
   *
   * `chrome.exe`-এর সারিগুলোর ক্যাটাগরি আসে **ডোমেইন** থেকে — youtube.com
   * (unproductive) আর github.com (productive) দুটোই একই প্রসেসে। তাই
   * অ্যাপের তালিকায় `chrome.exe`-কে একটামাত্র ক্যাটাগরি দেওয়া মিথ্যে হতো।
   */
  mixed: boolean;
  /** **সব** কী-র মোট সময়ের কত শতাংশ (টপ-১০-এর যোগফলের নয়, নিচে দেখুন) */
  sharePct: number;
}

export interface UsageReport {
  rows: UsageTally[];
  /** রেঞ্জের **সব** কী মিলিয়ে মোট — টপ ১০-এর যোগফল নয় */
  totalSec: number;
  /** কতগুলো আলাদা অ্যাপ/সাইট ছিল */
  distinctKeys: number;
  /**
   * ⭐ টপ তালিকার বাইরে পড়ে যাওয়া সময়।
   *
   * এটা ছাড়া "টপ ১০"-ই যেন সব — অথচ ৩০০টা সাইটের লেজে দিনের অর্ধেক
   * সময় থাকতে পারে। সংখ্যাটা দেখা গেলে অন্তত জানা যায় কতটা দেখা হচ্ছে না।
   */
  otherSec: number;
}

interface Accumulator {
  seconds: number;
  records: number;
  buckets: SecondBuckets;
  /** categoryId → সেকেন্ড; লেবেল বাছতে লাগে */
  byCategoryId: Map<number, number>;
}

/**
 * প্রসেসের নাম স্বাভাবিক করা।
 *
 * ⚠️ Windows প্রসেসের নাম `Chrome.exe` বা `chrome.exe` — যেভাবেই আসতে পারে।
 * ছোট হাতের না করলে একই অ্যাপ দু-তিনটে আলাদা সারি হয়ে টপ ১০-এ জায়গা
 * নষ্ট করত, আর প্রত্যেকের সময় আসল সময়ের ভগ্নাংশ দেখাত।
 * ([category-matcher.ts](./category-matcher.ts) ম্যাচ করার সময় একই কাজ করে।)
 */
export function normalizeProcess(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * ডোমেইন স্বাভাবিক করা — ছোট হাতের, শেষের ডট ছাঁটা, আর `www.` বাদ।
 *
 * এজেন্ট (`DomainParser`) ইতিমধ্যেই ছোট হাতের করে দেয়, কিন্তু `www.` রাখে —
 * ঠিকই করে, ওটা তথ্য নষ্ট করার জায়গা নয়। রিপোর্টে অবশ্য `www.youtube.com`
 * আর `youtube.com` দুটো আলাদা সারি হলে টপ ১০ ভেঙে যেত।
 *
 * ⚠️ `www.` ছাঁটা হয় **শুধু তখনই** যখন বাকিটায় এখনো একটা ডট থাকে —
 * নইলে `www.com` (একটা আসল ডোমেইন) `com` হয়ে যেত।
 *
 * ⭐ এটা **শুধু দেখানোর** স্বাভাবিকীকরণ। ক্যাটাগরি ম্যাচিং এতে বদলায় না —
 * ওটা ইতিমধ্যেই লেবেলের সীমানায় মেলে, তাই `www.youtube.com` আর
 * `youtube.com` দুটোই একই রুলে পড়ে।
 */
export function normalizeDomain(domain: string): string {
  const value = domain.trim().toLowerCase().replace(/\.+$/, '');
  if (value.startsWith('www.')) {
    const rest = value.slice(4);
    if (rest.includes('.')) return rest;
  }
  return value;
}

/** বেশি সেকেন্ড আগে; সমান হলে কী-র বর্ণক্রমে। */
function bySecondsDesc(a: { seconds: number; key: string }, b: { seconds: number; key: string }): number {
  return b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * D08 — অ্যাপ বা সাইটের তালিকা।
 *
 * ⚠️ **`kind` শুধু লেবেলের জন্য নয়।** অ্যাপের তালিকায় `chrome.exe`-এর
 * ক্যাটাগরি আসতে পারে একটা **domain** রুল থেকে; তখন রুলের `display_name`
 * ("YouTube") অ্যাপের নাম হিসেবে বসিয়ে দিলে তালিকায় লেখা থাকত
 * "YouTube — ৩ ঘণ্টা", অথচ সেটা আসলে ব্রাউজারের মোট সময়। তাই লেবেল
 * হিসেবে রুলের নাম নেওয়া হয় **শুধু তখনই** যখন রুলের `match_type`
 * তালিকার ধরনের সাথে মেলে, আর ওই কী-র সব সেকেন্ড একটামাত্র রুলের।
 */
export function foldUsage(
  groups: readonly UsageGroup[],
  meta: ReadonlyMap<number, CategoryMeta>,
  kind: 'app' | 'site',
  limit: number = TOP_N,
): UsageReport {
  const wanted: MatchType = kind === 'app' ? 'process' : 'domain';
  const normalize = kind === 'app' ? normalizeProcess : normalizeDomain;

  const acc = new Map<string, Accumulator>();
  let totalSec = 0;

  for (const g of groups) {
    const key = normalize(g.key);
    if (key.length === 0) continue;

    let entry = acc.get(key);
    if (!entry) {
      entry = {
        seconds: 0,
        records: 0,
        buckets: emptyBuckets(),
        byCategoryId: new Map<number, number>(),
      };
      acc.set(key, entry);
    }

    addSeconds(entry.buckets, categoryOf(meta, g.categoryId), g.seconds);
    entry.seconds += g.seconds;
    entry.records += g.records;
    totalSec += g.seconds;

    if (g.categoryId !== null) {
      entry.byCategoryId.set(
        g.categoryId,
        (entry.byCategoryId.get(g.categoryId) ?? 0) + g.seconds,
      );
    }
  }

  const sorted = [...acc.entries()]
    .map(([key, entry]) => ({ key, entry, seconds: entry.seconds }))
    .sort(bySecondsDesc);

  const rows: UsageTally[] = [];
  let shown = 0;

  for (const { key, entry } of sorted.slice(0, Math.max(0, limit))) {
    shown += entry.seconds;

    const only =
      entry.byCategoryId.size === 1
        ? meta.get([...entry.byCategoryId.keys()][0])
        : undefined;

    rows.push({
      key,
      label: only && only.matchType === wanted ? only.displayName : key,
      seconds: entry.seconds,
      hours: toHours(entry.seconds),
      records: entry.records,
      buckets: entry.buckets,
      category: dominant(entry.buckets),
      mixed: knownKinds(entry.buckets) > 1,
      // ⚠️ হর **মোট** সময়, দেখানো ১০টার যোগফল নয়। নইলে শতাংশগুলো
      //    সবসময় ১০০-তে মিলত আর লেজটা অদৃশ্য হয়ে যেত।
      sharePct: totalSec === 0 ? 0 : round2((entry.seconds * 100) / totalSec),
    });
  }

  return {
    rows,
    totalSec,
    distinctKeys: acc.size,
    otherSec: totalSec - shown,
  };
}

/**
 * সবচেয়ে বড় **জানা** ঝুড়ি। সব জানা ঝুড়ি শূন্য হলে `null`।
 *
 * ক্রম স্থির (productive → neutral → unproductive) যাতে ঠিক সমান হলেও ফল
 * প্রতিবার এক আসে — একই রিপোর্ট দু-বার খুললে দু-রকম দেখালে কেউ আর
 * সংখ্যাটা বিশ্বাস করত না। সমান হওয়াটা প্রায় অসম্ভব, আর হলে `mixed`
 * পতাকাটা এমনিতেই সত্যি থাকে।
 */
function dominant(buckets: SecondBuckets): Productivity | null {
  const order: Array<[Productivity, number]> = [
    ['productive', buckets.productiveSec],
    ['neutral', buckets.neutralSec],
    ['unproductive', buckets.unproductiveSec],
  ];

  let best: Productivity | null = null;
  let bestSec = 0;

  for (const [name, sec] of order) {
    if (sec > bestSec) {
      best = name;
      bestSec = sec;
    }
  }

  return best;
}

function knownKinds(buckets: SecondBuckets): number {
  return (
    (buckets.productiveSec > 0 ? 1 : 0) +
    (buckets.neutralSec > 0 ? 1 : 0) +
    (buckets.unproductiveSec > 0 ? 1 : 0)
  );
}

// ── টিম-ভিত্তিক সাইট সারাংশ (D09) ────────────────────────────────────────────

/** `groupBy(['domain','employeeId','categoryId'])`-এর একটা সারি। */
export interface TeamGroup {
  domain: string;
  employeeId: number;
  categoryId: number | null;
  seconds: number;
}

export interface TeamSiteRow {
  domain: string;
  label: string;
  category: Productivity | null;
  mixed: boolean;
  totalSec: number;
  hours: string;
  /** কতজন কর্মী ওই সাইটে সময় দিয়েছেন */
  employees: number;
  /**
   * ⭐ সবচেয়ে বেশি সময় দেওয়া কর্মী ও তার সেকেন্ড।
   *
   * এটা ছাড়া D09 বিপজ্জনক: একজনের ৬ ঘণ্টা "টিমের ৬ ঘণ্টা" হয়ে দেখাত,
   * আর মালিক ভাবতেন পুরো টিমের অভ্যাস। `employees = 1` দেখলেই সেটা ধরা পড়ে।
   */
  topEmployeeId: number | null;
  topEmployeeSec: number;
  sharePct: number;
}

export interface TeamSiteReport {
  rows: TeamSiteRow[];
  totalSec: number;
  distinctDomains: number;
  otherSec: number;
}

export function foldTeamSites(
  groups: readonly TeamGroup[],
  meta: ReadonlyMap<number, CategoryMeta>,
  limit: number = TOP_N,
): TeamSiteReport {
  interface TeamAcc extends Accumulator {
    byEmployee: Map<number, number>;
  }

  const acc = new Map<string, TeamAcc>();
  let totalSec = 0;

  for (const g of groups) {
    const key = normalizeDomain(g.domain);
    if (key.length === 0) continue;

    let entry = acc.get(key);
    if (!entry) {
      entry = {
        seconds: 0,
        records: 0,
        buckets: emptyBuckets(),
        byCategoryId: new Map<number, number>(),
        byEmployee: new Map<number, number>(),
      };
      acc.set(key, entry);
    }

    addSeconds(entry.buckets, categoryOf(meta, g.categoryId), g.seconds);
    entry.seconds += g.seconds;
    totalSec += g.seconds;
    entry.byEmployee.set(
      g.employeeId,
      (entry.byEmployee.get(g.employeeId) ?? 0) + g.seconds,
    );

    if (g.categoryId !== null) {
      entry.byCategoryId.set(
        g.categoryId,
        (entry.byCategoryId.get(g.categoryId) ?? 0) + g.seconds,
      );
    }
  }

  const sorted = [...acc.entries()]
    .map(([key, entry]) => ({ key, entry, seconds: entry.seconds }))
    .sort(bySecondsDesc);

  const rows: TeamSiteRow[] = [];
  let shown = 0;

  for (const { key, entry } of sorted.slice(0, Math.max(0, limit))) {
    shown += entry.seconds;

    let topEmployeeId: number | null = null;
    let topEmployeeSec = 0;
    // ছোট employeeId আগে দেখা হয় — সমান সময় হলেও ফল স্থির থাকে
    for (const employeeId of [...entry.byEmployee.keys()].sort((a, b) => a - b)) {
      const sec = entry.byEmployee.get(employeeId)!;
      if (sec > topEmployeeSec) {
        topEmployeeId = employeeId;
        topEmployeeSec = sec;
      }
    }

    const only =
      entry.byCategoryId.size === 1
        ? meta.get([...entry.byCategoryId.keys()][0])
        : undefined;

    rows.push({
      domain: key,
      label: only && only.matchType === 'domain' ? only.displayName : key,
      category: dominant(entry.buckets),
      mixed: knownKinds(entry.buckets) > 1,
      totalSec: entry.seconds,
      hours: toHours(entry.seconds),
      employees: entry.byEmployee.size,
      topEmployeeId,
      topEmployeeSec,
      sharePct: totalSec === 0 ? 0 : round2((entry.seconds * 100) / totalSec),
    });
  }

  return {
    rows,
    totalSec,
    distinctDomains: acc.size,
    otherSec: totalSec - shown,
  };
}

// ── রুলের প্যাটার্ন যাচাই (D06) ──────────────────────────────────────────────

/**
 * ⭐ মালিকের লেখা প্যাটার্নে সমস্যা আছে কি না — থাকলে বার্তা, নইলে `null`।
 *
 * ⚠️ **এটা লেখার সময়ই ধরতে হয়।** `compile()` ভুল প্যাটার্ন **নীরবে বাদ**
 * দেয় (ingest ভেঙে পড়া ঠেকাতে, আর সেটাই ঠিক)। ফলে যাচাই না করলে মালিক
 * একটা রুল যোগ করতেন, তালিকায় সেটা দেখতেন, অথচ সেটা **কোনোদিন কিছুই
 * করত না** — কোথাও কোনো এরর নেই, শুধু সার্ভিস লগে একটা লাইন।
 *
 * এটা খাঁটি ফাংশন হিসেবে এখানেই থাকে, কারণ সীমা (`MAX_REGEX_LENGTH`)
 * ম্যাচারের সাথে **এক** থাকতে হবে — দুই জায়গায় দুটো সংখ্যা থাকলে একদিন
 * একটা বদলাত, আর তখন যাচাই পাস করা রুলও নীরবে বাদ পড়ত।
 */
export function patternProblem(
  matchType: MatchType,
  pattern: string,
): string | null {
  const value = pattern.trim();

  if (value.length === 0) {
    return 'The pattern cannot be empty';
  }

  switch (matchType) {
    case 'process':
      // পুরো পাথ কখনো মেলে না — `app_usage`-এ শুধু ফাইলের নাম জমা হয়
      if (value.includes('\\') || value.includes('/')) {
        return 'Give only the file name in a process pattern, not the full path (for example code.exe)';
      }
      if (value.includes(' ') && !value.toLowerCase().endsWith('.exe')) {
        return 'A process name must look like a file name (for example code.exe)';
      }
      return null;

    case 'domain':
      // ⚠️ ফুল URL কখনো জমা হয় না (ADR-013) — তাই '/'-ওয়ালা প্যাটার্ন
      //    কোনোদিন মিলত না, আর মালিক ভাবতেন নিয়মটা কাজ করছে
      if (value.includes('://') || value.includes('/')) {
        return 'Give the domain only, not the full URL (for example youtube.com)';
      }
      if (value.includes(' ')) {
        return 'A domain cannot contain spaces';
      }
      if (!value.includes('.') && value !== 'localhost') {
        return 'A domain must contain at least one dot (for example youtube.com)';
      }
      return null;

    case 'title_regex':
      if (pattern.length > MAX_REGEX_LENGTH) {
        return `A regex cannot be longer than ${MAX_REGEX_LENGTH} characters — a long regex can lock up the whole server`;
      }
      try {
        new RegExp(pattern, 'i');
      } catch {
        return 'The regex is not valid — JavaScript cannot compile it';
      }
      return null;
  }
}

// ── তারিখের রেঞ্জ ────────────────────────────────────────────────────────────

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface WorkDateRange {
  from: Date;
  to: Date;
  /** দুই প্রান্ত ধরে কত দিন */
  days: number;
}

/**
 * `work_date` (`@db.Date`) → `YYYY-MM-DD`।
 *
 * ⚠️ **কোনো টাইমজোন রূপান্তর নয়।** কলামটা ইতিমধ্যেই ঢাকার তারিখ, UTC-midnight
 * হিসেবে জমা ([dhaka-time.ts](../agent/util/dhaka-time.ts)-এর `workDateOf`
 * ঠিক তাই বসায়)। এখানে আবার +৬ ঘণ্টা করলে বা `toLocaleDateString` ব্যবহার
 * করলে সার্ভারের টাইমজোন অনুযায়ী প্রতিটা তারিখ একদিন সরে যেত —
 * আর সেটা কেবল কিছু মেশিনে ধরা পড়ত।
 */
export function toDateKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * `YYYY-MM-DD` → ওই তারিখের UTC-midnight (`@db.Date`-এর সাথে তুলনীয়)।
 *
 * ⚠️ `new Date('2026-02-31')`-এর মতো `Date.UTC(2026, 1, 31)` চুপচাপ ৩ মার্চে
 * গড়িয়ে যায়। তাই ফিরে এসে মিলিয়ে দেখা হয় — নইলে ভুল তারিখের রিপোর্ট
 * সফলভাবে ফেরত আসত।
 */
export function parseWorkDate(text: string): Date {
  if (!DATE_PATTERN.test(text)) {
    throw new RangeError(`Date must be in YYYY-MM-DD format — got "${text}"`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (toDateKey(date) !== text) {
    throw new RangeError(`"${text}" is not a real date`);
  }

  return date;
}

/**
 * রেঞ্জ ঠিক করা। কিছু না দিলে **চলতি মাসের ১ তারিখ → আজ**।
 *
 * `today` প্যারামিটার হিসেবে আসে (`workDateOf(new Date())` থেকে) যাতে
 * ফাংশনটা খাঁটি থাকে আর টেস্টে ঘড়ির উপর নির্ভর করতে না হয় — কারণ
 * ঘড়ি-নির্ভর টেস্ট রোজ রাত ১২টার পর ভাঙে ([09 § ৩অ.১১](../../../../docs/09-Build-Log.md))।
 *
 * ⚠️ ভুল ইনপুটে `RangeError` ছোড়ে, `BadRequestException` নয় — খাঁটি ফাংশন
 * HTTP-র কিছু জানে না ([payroll.math.ts](../payroll/payroll.math.ts)-এর মতোই)।
 * সার্ভিস সেটাকে ৪০০-তে বদলায়।
 */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  today: Date,
  maxDays: number = MAX_RANGE_DAYS,
): WorkDateRange {
  const end = to === undefined || to === '' ? today : parseWorkDate(to);
  const start =
    from === undefined || from === ''
      ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
      : parseWorkDate(from);

  if (start.getTime() > end.getTime()) {
    throw new RangeError('`from` can never be after `to`');
  }

  const days =
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  if (days > maxDays) {
    throw new RangeError(
      `The range can be at most ${maxDays} days — ${days} days were requested`,
    );
  }

  return { from: start, to: end, days };
}

// ── ছোট সহায়ক ────────────────────────────────────────────────────────────────

/** শতাংশ দুই দশমিকে — নইলে JSON-এ 33.33333333333333 যেত। */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** সেকেন্ড → দেখানোর মতো ঘণ্টা (দুই দশমিক)। */
export function toHours(seconds: number): string {
  return (seconds / HOUR).toFixed(2);
}
