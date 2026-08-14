/**
 * সারাংশের সব **খাঁটি হিসাব** — কোনো I/O নেই, তাই ডাটাবেস ছাড়াই পরীক্ষা করা যায়।
 *
 * আলাদা ফাইলে রাখার কারণ: `daily_summary` আর `monthly_summary`-র সংখ্যাগুলো
 * পুরো সিস্টেমের **দৃশ্যমান সত্য** — হিটম্যাপ, pace কার্ড, "My hours", আর
 * শেষে পে-রোল শিট সবই এখান থেকে আসা সংখ্যা দেখায়। এগুলো DB কোয়েরির সাথে
 * মিশে থাকলে ভুল ধরা পড়ত কেবল আসল ডেটায়, মাস শেষে।
 *
 * নিয়মের উৎস: [07-Technical-Spec § ২.১](../../../docs/07-Technical-Spec.md)।
 */

import { resolve, sep } from 'node:path';

import type { DayType, SegmentState } from '@prisma/client';

import { dhakaPathParts, workDateOf } from '../agent/util/dhaka-time';

const MS_PER_DAY = 86_400_000;
const SEC_PER_HOUR = 3600;

// ═════════════════════════════ span union (§ ২.১-গ) ═════════════════════════

export interface Span {
  startedAt: Date;
  endedAt: Date;
}

/**
 * ⭐ ওভারল্যাপ করা সময়খণ্ডগুলো জোড়া লাগিয়ে দেয় (§ ২.১-গ)।
 *
 * ⚠️ **যোগফল নয়, UNION** — এটাই এই ফাইলের সবচেয়ে গুরুত্বপূর্ণ পার্থক্য।
 * কারো ডেস্কটপ ও ল্যাপটপ একসাথে চললে দুটো ডিভাইস থেকেই একই ঘড়ির সময়ে
 * ACTIVE সেগমেন্ট আসে; যোগ করলে ৮ ঘণ্টার দিন ১৬ ঘণ্টা দেখাত, আর মাসের
 * টার্গেট অর্ধেক সময়েই "পূর্ণ" হয়ে যেত।
 *
 * ⚠️ ফেরত আসা খণ্ডগুলো **নতুন অবজেক্ট**। ইনপুটের অবজেক্টে সরাসরি
 * `endedAt` বদলালে সেগুলো আসলে Prisma-র সারি — কলার পরে ওই সারিগুলো
 * ব্যবহার করলে নীরবে বিকৃত সময় পেত।
 */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.endedAt.getTime() > s.startedAt.getTime())
    .slice()
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const merged: Span[] = [];

  for (const s of sorted) {
    const last = merged[merged.length - 1];

    // `<=` — ঠিক গা-ঘেঁষা দুটো খণ্ড (আগেরটার শেষ = পরেরটার শুরু) একটাই
    // ধারাবাহিক কাজ। আলাদা রাখলে সীমানায় কিছু হারাত না বটে, কিন্তু
    // "কতবার বসেছে" জাতীয় হিসাব ভুল হতো।
    if (last && s.startedAt.getTime() <= last.endedAt.getTime()) {
      if (s.endedAt.getTime() > last.endedAt.getTime()) last.endedAt = s.endedAt;
    } else {
      merged.push({ startedAt: s.startedAt, endedAt: s.endedAt });
    }
  }

  return merged;
}

/**
 * UNION-এর মোট দৈর্ঘ্য, সেকেন্ডে।
 *
 * ⚠️ মিলিসেকেন্ড আগে যোগ, তারপর একবার round। প্রতি খণ্ডে আলাদা round করলে
 * দিনে কয়েকশো খণ্ডে অর্ধ-সেকেন্ডের ত্রুটি জমে মিনিটে দাঁড়াত।
 */
export function unionSec(spans: readonly Span[]): number {
  const ms = mergeSpans(spans).reduce(
    (total, s) => total + (s.endedAt.getTime() - s.startedAt.getTime()),
    0,
  );
  return Math.round(ms / 1000);
}

/** একটা ডিভাইসের ওই দিনের সব ACTIVE খণ্ড */
export interface DeviceSpans {
  deviceId: number;
  spans: readonly Span[];
}

/**
 * **G32** — একই স্টাফের দুটো ডিভাইস একই ঘড়ির সময়ে কত সেকেন্ড চলেছে।
 *
 * ⭐ <b>হিসাবটা বিয়োগ, কিন্তু কোন দুটো সংখ্যার তা সাবধানে বাছা:</b>
 *
 * ```
 * overlap = Σ (প্রতিটা ডিভাইসের নিজের UNION) − (সব ডিভাইস মিলিয়ে UNION)
 * ```
 *
 * ⚠️ `active_sec − worked_sec` **নয়**, যদিও সেটাই হাতের কাছে ছিল আর
 * `summarizeDay`-এর মন্তব্যেও ওটাকেই "কাঁচামাল" বলা আছে। কারণ
 * `active_sec` আসে এজেন্টের monotonic ঘড়ি থেকে (`duration_sec`), আর
 * `worked_sec` মাপা হয় দেয়ালঘড়ির `started_at`–`ended_at` দিয়ে। একটা
 * মেশিনেও ওই দুটো হুবহু মেলে না — ঘুম থেকে ওঠা, ঘড়ির সংশোধন, ছোট ফাঁক।
 * ওই ফারাকটাকে overlap ধরলে **একটাই ডিভাইসওয়ালা স্টাফের নামেও** অ্যালার্ট
 * উঠত, আর সেটাই হতো সবচেয়ে খারাপ ধরনের মিথ্যা: কারো কাজের সততা নিয়ে।
 *
 * এখানে দুটো দিকেই একই মাপকাঠি (দেয়ালঘড়ির UNION), তাই একটা ডিভাইসে
 * ফলটা গাণিতিকভাবেই ঠিক শূন্য।
 *
 * ⚠️ প্রতি ডিভাইসের নিজের UNION নেওয়া হয়, কাঁচা যোগফল নয় — একই মেশিনের
 * দুটো সেগমেন্ট পরস্পরকে ছুঁয়ে থাকলে (রিট্রাই, সেশন পুনরায় খোলা) সেটা
 * দুই ডিভাইসের overlap বলে গোনা হতো।
 */
export function overlapSec(devices: readonly DeviceSpans[]): number {
  // একটাই ডিভাইস মানে overlap-এর প্রশ্নই নেই — কুয়েরির খরচও বাঁচে
  if (devices.length < 2) return 0;

  const perDevice = devices.reduce((total, d) => total + unionSec(d.spans), 0);
  const together = unionSec(devices.flatMap((d) => d.spans));

  // ⚠️ ০-তে আটকানো: ভাসমান হিসাব বা round-এর কারণে -১ জাতীয় মান এলে
  //    সেটা "ঋণাত্মক overlap" নয়, শূন্য।
  return Math.max(0, perDevice - together);
}

// ═══════════════════════════ দৈনিক সারাংশ (K06) ═══════════════════════════

export interface DaySegment extends Span {
  state: SegmentState;
  /** এজেন্টের monotonic ঘড়ি থেকে — PC-র ঘড়ি বদলালেও অটুট */
  durationSec: number;
}

export interface DayInput {
  /** ওই কর্মদিবসের **সব** সেগমেন্ট — active, idle, locked সবই */
  segments: readonly DaySegment[];
  /** এখনো মুছে না-যাওয়া স্ক্রিনশটের সংখ্যা */
  screenshotCount: number;
  /** Σ time_adjustments.delta_sec (revoke করা বাদে), § ২.১-ঙ */
  adjustmentSec: number;
  /** productive ক্যাটাগরির app_usage খণ্ড */
  productiveSpans: readonly Span[];
  unproductiveSpans: readonly Span[];
  /** ওই তারিখ কি সাপ্তাহিক ছুটি বা ক্যালেন্ডার ছুটি? */
  isOffDay: boolean;
}

export interface DayNumbers {
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
  activeSec: number;
  idleSec: number;
  workedSec: number;
  adjustmentSec: number;
  creditedSec: number;
  earliestHour: number | null;
  latestHour: number | null;
  productiveSec: number;
  unproductiveSec: number;
  productivityPct: number | null;
  screenshotCount: number;
  dayType: DayType;
}

/**
 * ⭐ একজনের একদিনের পুরো সারাংশ — একটাই খাঁটি ফাংশন।
 *
 * সার্ভিসের কাজ শুধু সারি আনা আর সারি লেখা; **কী সংখ্যা বসবে সেই সিদ্ধান্ত
 * পুরোটাই এখানে**, যাতে ডাটাবেস ছাড়াই সবগুলো ধার পরীক্ষা করা যায়।
 */
export function summarizeDay(input: DayInput): DayNumbers {
  const active = input.segments.filter((s) => s.state === 'active');

  // ⚠️ `active_sec` কাঁচা যোগফল, আর `worked_sec` UNION — দুটো ইচ্ছাকৃতভাবে
  //    আলাদা। দুই ডিভাইসে একসাথে কাজ করলে active > worked হবে।
  //
  // ⚠️ কিন্তু ওই ফারাকটা `device_overlap`-এর কাঁচামাল **নয়** (এখানে আগে
  //    তাই লেখা ছিল): `active_sec` আসে এজেন্টের monotonic ঘড়ি থেকে, আর
  //    `worked_sec` দেয়ালঘড়ি থেকে — একটা মেশিনেও দুটো হুবহু মেলে না।
  //    G32-র হিসাবটা `overlapSec()`-এ, আর সেখানে দুই দিকেই একই মাপকাঠি।
  const activeSec = sumDuration(active);

  // ⚠️ `locked`-ও idle-এ ধরা হয়। schema-তে `locked_sec` বলে কোনো কলাম নেই;
  //    বাদ দিলে "লক করে লাঞ্চে গেল" সময়টা কোথাও দেখা যেত না এবং
  //    active + idle আর দিনের মোট ট্র্যাক করা সময়ের সমান থাকত না।
  const idleSec = sumDuration(
    input.segments.filter((s) => s.state === 'idle' || s.state === 'locked'),
  );

  const workedSec = unionSec(active);

  const firstActivityAt = active.length > 0 ? earliestStart(active) : null;
  const lastActivityAt = active.length > 0 ? latestEnd(active) : null;

  const productiveSec = unionSec(input.productiveSpans);
  const unproductiveSec = unionSec(input.unproductiveSpans);

  return {
    firstActivityAt,
    lastActivityAt,
    activeSec,
    idleSec,
    workedSec,
    adjustmentSec: input.adjustmentSec,

    // ⚠️ এখানে ০-তে আটকানো হয় **না**। owner যদি কাজ করা সময়ের চেয়ে বেশি
    //    কেটে নেন, দিনের হিসাব ঋণাত্মকই দেখাবে — সেটাই তাঁর দেওয়া নির্দেশ।
    //    আটকানোটা মাসিক স্তরে, আর কেন — `rollupMonth()` দেখুন।
    creditedSec: workedSec + input.adjustmentSec,

    earliestHour: firstActivityAt === null ? null : dhakaHourOf(firstActivityAt),
    latestHour: lastActivityAt === null ? null : dhakaHourOf(lastActivityAt),

    productiveSec,
    unproductiveSec,
    productivityPct: productivityPct(productiveSec, unproductiveSec),
    screenshotCount: input.screenshotCount,
    dayType: dayTypeOf(workedSec, input.isOffDay),
  };
}

function sumDuration(segments: readonly DaySegment[]): number {
  return segments.reduce((total, s) => total + s.durationSec, 0);
}

function earliestStart(spans: readonly Span[]): Date {
  return spans.reduce((min, s) => (s.startedAt < min ? s.startedAt : min), spans[0].startedAt);
}

function latestEnd(spans: readonly Span[]): Date {
  return spans.reduce((max, s) => (s.endedAt > max ? s.endedAt : max), spans[0].endedAt);
}

/**
 * productive ÷ (productive + unproductive), শতকরা।
 *
 * ⚠️ `neutral` হিসাবের বাইরে — ইচ্ছাকৃত। Explorer, Notepad বা terminal-এ
 * কাটানো সময় neutral; ওগুলো হরে ঢোকালে যত বেশি কাজ, স্কোর তত কম হতো।
 *
 * ⚠️ **এই সংখ্যা কখনো বেতনের হিসাবে ঢোকে না** — `worked_sec` ও
 * `credited_sec` ক্যাটাগরির কথা জানেই না। ক্যাটাগরি নিছক পর্যবেক্ষণ।
 */
export function productivityPct(
  productiveSec: number,
  unproductiveSec: number,
): number | null {
  const total = productiveSec + unproductiveSec;
  // ⚠️ শূন্য হলে `null`, `0` নয়। "কোনো ক্যাটাগরি করা অ্যাপ চলেনি" আর
  //    "যা চলেছে সবই unproductive" — দুটো সম্পূর্ণ আলাদা কথা, আর
  //    দ্বিতীয়টা কারো সম্পর্কে একটা অভিযোগ।
  if (total <= 0) return null;
  return Math.round((productiveSec / total) * 10000) / 100;
}

/**
 * ⚠️ `worked` আগে দেখা হয় — ছুটির দিনে কেউ কাজ করলে দিনটা `worked`,
 * `holiday` নয় (§ ২.১-খ: ছুটির দিনের ঘণ্টাও পুরোপুরি গোনা হয়)। উল্টো
 * করলে হিটম্যাপে ওই দিনের কাজ ছুটির রঙে ঢাকা পড়ে যেত।
 */
export function dayTypeOf(workedSec: number, isOffDay: boolean): DayType {
  if (workedSec > 0) return 'worked';
  return isOffDay ? 'holiday' : 'no_activity';
}

/**
 * ঢাকার ঘণ্টা (০–২৩)।
 *
 * ⚠️ নিজে `+৬ ঘণ্টা` যোগ করা হয়নি — অফসেটের হিসাব একটাই জায়গায় থাকা চাই
 * (`agent/util/dhaka-time.ts`)। ওখানে ঘণ্টা ফেরত দেওয়ার আলাদা helper নেই,
 * তাই `dhakaPathParts()`-এর `HHMMSS` থেকেই ঘণ্টাটা কাটা হচ্ছে।
 */
export function dhakaHourOf(instant: Date): number {
  return Number(dhakaPathParts(instant).hhmmss.slice(0, 2));
}

// ═══════════════════ কর্মদিবস ও গতি — § ২.১-খ (K05/K06) ═══════════════════

/**
 * ISO সপ্তাহদিন: সোম = ১ … রবি = ৭।
 *
 * ⚠️ `getUTCDay()` সরাসরি ব্যবহার করা যায় না — ওখানে রবিবার **০**, আর
 * `work_policies.weekly_off_day` ISO মেনে চলে (শুক্র = ৫)। কেউ রবিবার
 * সাপ্তাহিক ছুটি (৭) দিলে সরাসরি তুলনায় কোনোদিনই মিলত না, আর ছুটির দিনটা
 * নীরবে কর্মদিবস হিসেবে গোনা হতো — প্রত্যেকের pace সারা মাস পিছিয়ে থাকত।
 *
 * ⚠️ ইনপুট অবশ্যই `workDateOf()`-এর মতো **UTC-মধ্যরাত** তারিখ হতে হবে;
 * তাহলেই UTC-র দিনটা ঢাকার দিন।
 */
export function isoWeekday(workDate: Date): number {
  const js = workDate.getUTCDay();
  return js === 0 ? 7 : js;
}

/** § ২.১-খ — সাপ্তাহিক ছুটি নয়, আর holidays টেবিলেও নেই। */
export function isWorkday(
  workDate: Date,
  weeklyOffDay: number | null,
  holidays: ReadonlySet<number>,
): boolean {
  // null = প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস (schema-র নিয়ম)
  if (weeklyOffDay !== null && isoWeekday(workDate) === weeklyOffDay) {
    return false;
  }
  // ⚠️ Prisma `@db.Date` সবসময় UTC-মধ্যরাত Date দেয়, আর `workDateOf()`-ও
  //    তাই — দুই দিকের `getTime()` তাই নির্দ্বিধায় মেলানো যায়।
  return !holidays.has(workDate.getTime());
}

/** `from` ও `to` — দুই প্রান্তই ধরা (§ ২.১-খ: "আজ ধরে")। */
export function countWorkdays(
  from: Date,
  to: Date,
  weeklyOffDay: number | null,
  holidays: ReadonlySet<number>,
): number {
  let count = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += MS_PER_DAY) {
    if (isWorkday(new Date(t), weeklyOffDay, holidays)) count++;
  }
  return count;
}

/**
 * `now`-এর ঠিক আগের কর্মদিবস — দিন-ক্লোজ (K05) এটাই ক্লোজ করে।
 *
 * ⚠️ প্রথমে ঢাকার তারিখ বের করে **তারপর** একদিন বাদ। উল্টো করলে
 * (আগে ২৪ ঘণ্টা বাদ দিয়ে তারপর `workDateOf`) রাত ০০:১৫-এ চালানো জব
 * ঢাকার সময় আগের দিনের ০০:১৫-এ গিয়ে পড়ত — একই তারিখ পেত বটে, কিন্তু
 * দিনের যেকোনো সময়ে ডাকলে ফল আর নির্ভরযোগ্য থাকত না।
 */
export function previousWorkDate(now: Date): Date {
  return new Date(workDateOf(now).getTime() - MS_PER_DAY);
}

export interface MonthBounds {
  start: Date;
  end: Date;
  /** '2026-08' — `monthly_summary.year_month` */
  yearMonth: string;
}

/** কোনো কর্মদিবস কোন মাসে, আর সেই মাসের প্রথম ও শেষ তারিখ। */
export function monthBounds(workDate: Date): MonthBounds {
  const year = workDate.getUTCFullYear();
  const month = workDate.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1)),
    // পরের মাসের "০ তারিখ" = চলতি মাসের শেষ দিন — লিপ ইয়ারও নিজে সামলায়
    end: new Date(Date.UTC(year, month + 1, 0)),
    yearMonth: `${year}-${String(month + 1).padStart(2, '0')}`,
  };
}

// ══════════ প্রত্যাশার জানালা — ট্র্যাকিং শুরু থেকে গতকাল পর্যন্ত ══════════

/** দুই প্রান্তই ধরা — `countWorkdays()`-এর মতোই */
export interface ElapsedWindow {
  from: Date;
  to: Date;
}

/**
 * ⭐⭐ **এই প্রকল্পে "কত দিন পেরিয়েছে" প্রশ্নের একমাত্র ইনপুট।**
 *
 * ⚠️ একসময় এর তিনটে আলাদা সংস্করণ ছিল — মাসিক rollup, tray (`/me`) আর Live
 * Board প্রত্যেকে নিজের মতো গুনত, আর কর্মী নিজের পর্দায় যা দেখতেন owner
 * তার চেয়ে ~৮৯ ঘণ্টা আলাদা দেখতেন। দুই পর্দায় দুই উত্তর মানে কোনটা সত্যি
 * সেই প্রশ্নের উত্তর নেই। এখন **তিনটে পথ** এই একটাই আকৃতি ভরে দেয় —
 * `summary.service`, `progress.service`, `reports.service`।
 *
 * ⚠️ `dashboard.service` এই তালিকায় **নেই**, আর সেটা ভুল নয়: Live Board
 * মাসের সংখ্যাটা নতুন করে গোনে না, `monthly_summary.expected_sec` **পড়ে** —
 * অর্থাৎ এই ফাংশনেরই সংরক্ষিত ফল। তার সাত-দিনের ফিতেটা অবশ্য নিজের
 * `trendDayExpectation()` ব্যবহার করে, যা **ইচ্ছাকৃতভাবে** আজকের দিনটা রাখে
 * (কারণ ফিতের কাজ "আজ পর্যন্ত কী হলো" দেখানো); সেই ফারাকটা ওই ফাংশনের
 * নিজের নোটে ব্যাখ্যা করা আছে।
 */
export interface ElapsedWindowInput {
  /**
   * জানালার বাইরের সীমা।
   *
   * ⚠️ নাম `monthStart`/`monthEnd` **নয়**, কারণ শুধু মাসিক rollup এটা
   *    ডাকে না: রিপোর্ট (F01/F02) চাওয়া রেঞ্জের দুই প্রান্ত পাঠায়। নিয়ম
   *    এক, সীমাটা কলারের।
   */
  periodStart: Date;
  periodEnd: Date;
  /** ঢাকার **আজকের** কর্মদিবস (`workDateOf(now)`) — নিজে জানালার বাইরে থাকে */
  today: Date;
  /** G37 — `null` = পর্বের আগে থেকেই আছে */
  joinedOn: Date | null;
  leftOn: Date | null;
  /**
   * ⭐ **এই কর্মীর** সবচেয়ে পুরোনো `daily_summary.work_date`।
   *
   * ⚠️⚠️ **এটা "এজেন্ট কবে বসেছে" নয়** — এটা "সার্ভার কবে থেকে এই
   *    কর্মীকে নিয়ে হিসাব করছে"। `refreshDate()` প্রতিটি **active**
   *    কর্মীর সারি লেখে, তার ডেটা থাক বা না থাক (`summary.service.ts`),
   *    তাই সক্রিয় হওয়ার দিনই সাধারণত এই তারিখ।
   *
   * ⚠️⚠️ ফলে এটা যা ঢাকে আর যা ঢাকে না, দুটো আলাদা করে জানা দরকার:
   *    **ঢাকে** — এই সার্ভার বসার আগের দিনগুলো (প্রথম ইনস্টল), আর
   *    কেউ সিস্টেমে যোগ হওয়ার আগে সংস্থার যে ইতিহাস আছে (org-min নিলে
   *    জুলাই থেকে গোনা শুরু হতো)।
   *    **ঢাকে না** — ১ অক্টোবর সক্রিয় হয়ে ৮ অক্টোবর এজেন্ট পাওয়া কর্মীর
   *    ৫টা এজেন্টহীন দিন। ১ তারিখেই তার `no_activity` সারি বসে যায়, তাই
   *    এই তারিখ ১ অক্টোবরই হয় আর দিনগুলো পুরো ঘাটতি হিসেবেই থাকে।
   *    ⚠️ আগে এখানে উল্টোটা **দাবি করা ছিল**; দাবিটা মিথ্যা ছিল।
   *
   * ⭐ সংখ্যাটা সবসময় org-min-এর সমান বা পরে, তাই দুটো মেলানোর দরকার নেই।
   *
   * ⚠️ `null` বা অনুপস্থিত = জানা নেই, আর তখন এই ধারণাটা জানালার উপর
   *    **কোনো প্রভাবই ফেলে না** (জানালা শুরু হয় পর্বের শুরু বা যোগ দেওয়ার
   *    দিন থেকে)।
   */
  trackingStartedOn?: Date | null;
}

export interface ElapsedInput extends ElapsedWindowInput {
  weeklyOffDay: number | null;
  holidays: ReadonlySet<number>;
}

/**
 * ⭐⭐ প্রত্যাশা কোন দিনগুলোর উপর হিসাব হবে — **সেই জানালাটা**।
 *
 * ⚠️⚠️ **ট্র্যাকিং শুরুর আগের দিন গোনা হয় না।** এই ইনস্টলেশনে এজেন্ট বসেছে
 *    ১৩ আগস্ট ২০২৬; তার আগে কে কত কাজ করেছে আমরা **জানি না**। মাসের ১
 *    তারিখ থেকে গুনলে ওই না-দেখা দিনগুলো নীরবে "০ ঘণ্টা কাজ" হয়ে যেত, আর
 *    Monthly পাতা প্রত্যেককে ~৯৪ ঘণ্টা পিছিয়ে দেখাত — এমন এক সময়ের জন্য
 *    যখন মাপার যন্ত্রটাই বসেনি। **অনুপস্থিত পর্যবেক্ষণ ব্যর্থতা নয়।**
 *
 * ⚠️⚠️ **আজকের দিনটাও বাদ** — জানালা শেষ হয় `today − ১ দিনে`। Live
 *    Board-এ ঠিক এই ভুলটাই ধরা পড়েছিল: আজকের পুরো ৮ ঘণ্টা প্রত্যাশায়
 *    ধরলে ভোর ৬টায় দল "১১৪ ঘণ্টা পিছিয়ে" দেখাত, আর সন্ধ্যা নাগাদ সংখ্যাটা
 *    নিজে থেকেই ঠিক হয়ে যেত — একই দল দিনে দুবার দুই রকম রায় পেত, কেবল
 *    ঘড়ির কাঁটার কারণে। তাই pace-এর মানে: **গতকাল পর্যন্ত কে কোথায়।**
 *
 * ⭐ এই দুটো সিদ্ধান্তই এখন **সব পর্দায় এক** — তবে দুইভাবে: মাসিক rollup
 *    (Monthly পাতা ও পে-রোলের pace), tray/`/me` আর রিপোর্ট এই ফাংশনটা
 *    **ডাকে**; Live Board ও দৈনিক ডাইজেস্ট তার সংরক্ষিত ফল
 *    (`monthly_summary.expected_sec`, `meta.expectedHours`) **পড়ে**। দুটোর
 *    উত্তর তাই এক, আর সংজ্ঞাটা একটাই জায়গায় লেখা।
 *    ⚠️ ব্যতিক্রম একটাই ও ইচ্ছাকৃত — Live Board-এর সাত-দিনের ফিতে
 *    (`trendDayExpectation()`), যা আজকের দিনটা রাখে।
 *    আগে তিনটে আলাদা সংজ্ঞা ছিল আর দুই পাতা দুই সংখ্যা বলত (Live Board ৪২ঘ,
 *    Monthly ৯৪৬ঘ)। দুটো সংখ্যা দুই কথা বললে কোনটা সত্যি সেই প্রশ্নের
 *    উত্তর থাকে না।
 *
 * ⚠️ `null` ফেরত = জানালাটাই খালি (পর্ব এখনো শুরু হয়নি, আজ মাসের ১ তারিখ,
 *    ট্র্যাকিং আজই শুরু, বা সে চলে যাওয়ার পরের মাস) — "০ কর্মদিবস", যেটা
 *    `0` কর্মদিবসের চেয়ে আলাদা কিছু নয়, তবু কলারের কাছে স্পষ্ট থাকে।
 */
export function elapsedWindow(input: ElapsedWindowInput): ElapsedWindow | null {
  // ⚠️ শুরুর তিনটে সীমার মধ্যে **সবচেয়ে পরেরটা** — একজন ১৭ তারিখে যোগ
  //    দিলে ট্র্যাকিং ১৩ তারিখে শুরু হলেও তার জানালা ১৭ থেকেই।
  const from = maxDate(input.periodStart, input.joinedOn, input.trackingStartedOn ?? null);

  // ⚠️ শেষের তিনটে সীমার মধ্যে **সবচেয়ে আগেরটা**। `periodEnd` না রাখলে গত
  //    মাসের `workdays_elapsed` চিরকাল পুরো মাস ছাড়িয়ে বাড়ত।
  const to = minDate(
    new Date(input.today.getTime() - MS_PER_DAY),
    input.periodEnd,
    input.leftOn,
  );

  return from.getTime() > to.getTime() ? null : { from, to };
}

/**
 * ওই জানালায় কত কর্মদিবস — `rollupMonth()`-এর `workdaysElapsed`।
 *
 * ⚠️⚠️ গোনা হয় **ক্যালেন্ডার কর্মদিবস** (`isWorkday`), `daily_summary`
 *    **সারি নয়**। Live Board একসময় সারি গুনত (`day_type !== 'holiday'`)
 *    আর সেটা নীরবে ভুল ছিল: ছুটির দিনে কেউ এক ঘণ্টা কাজ করলে `dayTypeOf()`
 *    দিনটাকে `worked` লেখে, তাই ওই ছুটির দিনটাই একটা পুরো ৮ ঘণ্টার
 *    **প্রত্যাশা** হয়ে যেত — অর্থাৎ ছুটির দিনে কাজ করার শাস্তি।
 */
export function elapsedWorkdays(input: ElapsedInput): number {
  const window = elapsedWindow(input);
  if (window === null) return 0;
  return countWorkdays(window.from, window.to, input.weeklyOffDay, input.holidays);
}

/** `proratedExpectedSec()`-এর তিনটে সংখ্যা */
export interface ExpectedInput {
  /** ⭐ G37 — **তার নিজের** মাসিক টার্গেট (`prorate()` থেকে), ফ্ল্যাট ২০৮ নয় */
  targetSec: number;
  /** ⭐ G37 — **তার নিজের** কর্মদিবস (d) */
  expectedWorkdays: number;
  /** `elapsedWorkdays()` থেকে — নিজে বানিয়ে নিলে জানালাটাই আবার আলাদা হয়ে যেত */
  workdaysElapsed: number;
}

/**
 * ⭐⭐ **প্রত্যাশা কত সেকেন্ড** — § ২.১-খ-র সূত্রের একমাত্র বাস্তবায়ন।
 *
 * ```
 * expected_sec = target_sec × workdays_elapsed ÷ expected_workdays
 * ```
 *
 * ⚠️ `rollupMonth()` (Monthly পাতা, Live Board, পে-রোলের pace) আর
 *    `progress.math.ts` (tray, `/me`) — দুটোই এখান দিয়ে যায়। আগে সূত্রটা
 *    দু-জায়গায় হাতে লেখা ছিল; একই সূত্র দুবার লেখা মানে একদিন একটা বদলাবে
 *    আর অন্যটা বদলাবে না।
 *
 * ⚠️ এখানে **ছোড়া হয় না**, ০ ফেরে। heartbeat-এর পথে একটা ভুল কনফিগ করা
 *    work policy তখন ওই কর্মীর প্রতিটা heartbeat-কে ৫০০ বানিয়ে দিত —
 *    একটা ভুল সংখ্যার শাস্তি হতো পুরো ট্র্যাকিং বন্ধ। কড়া যাচাই যেখানে
 *    দরকার সেখানে (`rollupMonth`) আলাদা করে বসানো আছে।
 */
export function proratedExpectedSec(input: ExpectedInput): number {
  const { targetSec, expectedWorkdays, workdaysElapsed } = input;

  // ⚠️ কর্মদিবস শূন্য হলে ভাগ করা যায় না (পুরো মাস ছুটি ঘোষণা করলে হতে
  //    পারে)। না আটকালে `NaN` ডাটাবেসে ও তারে চলে যেত, আর এজেন্টের
  //    `System.Text.Json` `NaN` চেনে না — গোটা heartbeat-এর উত্তরটাই
  //    (revoke কমান্ড সহ) পড়া যেত না।
  if (!Number.isFinite(targetSec) || targetSec <= 0) return 0;
  if (!Number.isFinite(expectedWorkdays) || expectedWorkdays <= 0) return 0;

  // ⚠️ ০ ও `expectedWorkdays`-এর মধ্যে আটকানো — নইলে পুরোনো তারিখ দিয়ে
  //    ডাকলে প্রত্যাশা টার্গেট ছাড়িয়ে যেত আর তখন সবাই "পিছিয়ে" দেখাত।
  return Math.round((targetSec * clamp(workdaysElapsed, 0, expectedWorkdays)) / expectedWorkdays);
}

/** ⚠️ `null` মানে "এই সীমাটা নেই", তাই সে কখনো জেতে না। */
function maxDate(base: Date, ...others: readonly (Date | null)[]): Date {
  return others.reduce<Date>(
    (best, d) => (d !== null && d.getTime() > best.getTime() ? d : best),
    base,
  );
}

function minDate(base: Date, ...others: readonly (Date | null)[]): Date {
  return others.reduce<Date>(
    (best, d) => (d !== null && d.getTime() < best.getTime() ? d : best),
    base,
  );
}

// ══════════════════════════ মাসিক rollup (K05/K06) ══════════════════════════

export interface MonthInput {
  /** Σ দৈনিক worked_sec — কেন যোগ করাই যথেষ্ট, `rollupMonth()`-এর নোট দেখুন */
  workedSec: number;
  adjustmentSec: number;
  /** ⭐ G37 — **তার কর্মদিবস × দৈনিক টার্গেট** (`prorate()` থেকে), ফ্ল্যাট ২০৮ নয় */
  targetSec: number;
  /** ⭐ G37 — **তার নিজের** কর্মদিবস (d) */
  expectedWorkdays: number;
  /** ⭐ G37 — ওই মাসের মোট কর্মদিবস (D), বেতনের ভগ্নাংশের হর */
  monthWorkdays: number;
  /**
   * কত কর্মদিবস **শেষ হয়ে গেছে** — `elapsedWorkdays()` থেকে।
   *
   * ⚠️ "মাসের ১ তারিখ থেকে আজ পর্যন্ত" নয়: ট্র্যাকিং শুরুর আগের দিন আর
   * আজকের দিনটা এর বাইরে (কারণ `elapsedWindow()`-এ)। সংখ্যাটা নিজে থেকে
   * বানিয়ে নিলে Monthly পাতা আবার Live Board-এর সাথে অমিল দেখাত।
   */
  workdaysElapsed: number;
  /** যত দিনে worked_sec > 0 */
  daysWithWork: number;
}

export interface MonthNumbers {
  workedSec: number;
  adjustmentSec: number;
  creditedSec: number;
  targetSec: number;
  expectedSec: number;
  paceSec: number;
  expectedWorkdays: number;
  monthWorkdays: number;
  workdaysElapsed: number;
  daysWithWork: number;
  avgDailySec: number;
  overtimeSec: number;
  shortfallSec: number;
  targetMet: boolean;
}

/**
 * ⭐ মাসের সব সংখ্যা (§ ২.১-খ, § ২.১-ঙ, § ৩.২.১)।
 *
 * ⭐ **মাসিক worked = দৈনিক worked-এর সরল যোগফল** — আবার UNION করতে হয় না।
 * কারণ § ২.১-ক অনুযায়ী কোনো সেগমেন্ট দুই `work_date` জুড়ে থাকতে পারে না,
 * তাই দুই আলাদা দিনের খণ্ড কখনো ওভারল্যাপ করে না। এই একটি নিশ্চয়তার জোরেই
 * মাসের লাখখানেক সারিতে প্রতি ১৫ মিনিটে merge চালানো এড়ানো যায়।
 *
 * ⚠️ pace-এ `credited` ব্যবহার করা হয়েছে, `worked` নয়। § ৩.২.১-এর
 * সিউডোকোডে `worked_sec − expected_sec` লেখা আছে, কিন্তু § ২.১-খ ও
 * § ২.১-ঙ (G35, পরে যোগ হওয়া) বলে টার্গেটের সাথে মেলে `credited_sec`।
 * `worked` ধরলে সার্ভারের দোষে ঘণ্টা হারানো স্টাফ owner-এর সংশোধনের
 * পরেও সারা মাস "পিছিয়ে" দেখাত — সংশোধনটার পুরো উদ্দেশ্যই ব্যর্থ হতো।
 */
export function rollupMonth(input: MonthInput): MonthNumbers {
  const {
    workedSec,
    adjustmentSec,
    targetSec,
    expectedWorkdays,
    monthWorkdays,
    workdaysElapsed,
    daysWithWork,
  } = input;

  /**
   * ⚠️⚠️ **টার্গেট ০ এখন বৈধ — কিন্তু শুধু একটাই কারণে** (G37): তার ওই
   * মাসে কোনো কর্মদিবসই নেই (মাসের পরে যোগ দিয়েছে, আগেই চলে গেছে, বা
   * পুরো মাসটাই ছুটি)। তখন ঘাটতিও অসম্ভব।
   *
   * ⚠️ কর্মদিবস **থাকা সত্ত্বেও** টার্গেট ০ মানে পলিসি ভুল বসানো, আর
   * সেটা মেনে নিলে কেউ এক ঘণ্টা কাজ না করেই "টার্গেট পূরণ" দেখাত।
   * `payroll.math.ts`-এ হুবহু একই শর্ত।
   */
  if (!Number.isFinite(targetSec) || targetSec < 0) {
    throw new RangeError('Monthly target cannot be negative');
  }
  if (targetSec === 0 && expectedWorkdays > 0) {
    throw new RangeError('Monthly target cannot be zero when there are workdays');
  }

  /**
   * ⚠️ ⭐ এখানে ০-তে আটকানো **বাধ্যতামূলক**। `payroll.math.ts` ঋণাত্মক
   * `creditedSec` পেলে `RangeError` ছোড়ে, আর সেটা পে-রোল শিটের লুপের
   * ভেতরে — একজনের একটা অতিরিক্ত কর্তন গোটা মাসের পে-রোল রিকোয়েস্টকে
   * ৫০০ বানিয়ে দিত, অথচ ভুলটা দেখাত সম্পূর্ণ অন্য জায়গায়।
   */
  const creditedSec = Math.max(0, workedSec + adjustmentSec);

  // ⭐ সূত্রটা এখানে আর লেখা নেই — `proratedExpectedSec()`-এ, কারণ tray-ও
  //    ঠিক এই সূত্রই ডাকে। দুবার লিখলে একদিন একটা বদলাত আর অন্যটা নয়।
  const expectedSec = proratedExpectedSec({
    targetSec,
    expectedWorkdays,
    workdaysElapsed,
  });

  return {
    workedSec,
    adjustmentSec,
    creditedSec,
    targetSec,
    expectedSec,
    paceSec: creditedSec - expectedSec,
    expectedWorkdays,
    monthWorkdays,
    workdaysElapsed,
    daysWithWork,
    // ⚠️ শূন্য দিয়ে ভাগ — কেউ সারা মাসে একদিনও কাজ না করলে Infinity বসত
    avgDailySec: daysWithWork > 0 ? Math.round(workedSec / daysWithWork) : 0,
    overtimeSec: Math.max(0, creditedSec - targetSec),
    shortfallSec: Math.max(0, targetSec - creditedSec),
    /**
     * ⚠️ টার্গেট ০ হলে `creditedSec >= 0` সবসময় সত্যি — অর্থাৎ যে ওই মাসে
     * ছিলই না, সে-ও "✅ টার্গেট পূরণ" দেখাত, আর `target_met_at`-এ একটা
     * সময়ও বসে যেত। অর্জন বলে দাবি করার মতো কিছু সেখানে ঘটেনি।
     */
    targetMet: targetSec > 0 && creditedSec >= targetSec,
  };
}

/** ঘণ্টা → সেকেন্ড (work policy-র `Decimal` থেকে `target_sec`)। */
export function hoursToSec(hours: number): number {
  return Math.round(hours * SEC_PER_HOUR);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ═══════════════════════════ retention (K01) ═══════════════════════════

/**
 * এর **আগের** `work_date`-এর স্ক্রিনশট মুছে ফেলার যোগ্য।
 *
 * ⭐ `days` যাচাই করা হয় কারণ এটাই এই গোটা মডিউলের সবচেয়ে ধ্বংসাত্মক সংখ্যা।
 * ভুলে `0` বা ঋণাত্মক এলে cutoff আজ বা ভবিষ্যতে গিয়ে পড়ত, আর রাত ২টার জব
 * নীরবে **আজকের ছবিসহ পুরো আর্কাইভ** মুছে দিত — ফাইল ও সারি দুটোই, কোনো
 * ব্যাকআপ ছাড়া। তাই সন্দেহ হলেই থেমে যাওয়া।
 *
 * ⚠️ তুলনাটা `<` (`<=` নয়) — ঠিক ৯০ দিন আগের ছবি **থাকবে**, কাটা পড়বে
 * তার চেয়ে পুরোনোগুলো। একদিন বেশি রাখা ভুলের নিরাপদ দিক।
 */
export function retentionCutoff(now: Date, days: number): Date {
  if (!Number.isFinite(days) || days < 1) {
    throw new RangeError(
      `Retention days must be at least 1, got ${String(days)}`,
    );
  }
  return new Date(workDateOf(now).getTime() - Math.floor(days) * MS_PER_DAY);
}

/**
 * ফাইলটা সত্যিই storage রুটের ভেতরে তো?
 *
 * ⭐ "খাঁটি হিসাব" ফাইলে একটা পাথ-চেক অদ্ভুত লাগতে পারে, কিন্তু এটাই এই
 * মডিউলের তৃতীয় খাঁটি সিদ্ধান্ত — আর একমাত্র যেটার ভুলে **storage-এর
 * বাইরের ফাইল মুছে যেতে পারে**। `screenshots.file_path` ডাটাবেসের কলাম;
 * আজ সেটা সার্ভার নিজে বানায়, কিন্তু একটা `..` ঢুকে পড়লে retention জব
 * D:\ ড্রাইভের যেকোনো ফাইল `unlink` করত। তাই মোছার আগে যাচাই।
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const absRoot = resolve(root);
  const absPath = resolve(root, candidate);
  return absPath === absRoot || absPath.startsWith(absRoot + sep);
}
