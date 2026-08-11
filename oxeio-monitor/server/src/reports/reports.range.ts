import { workDateOf } from '../agent/util/dhaka-time';

/**
 * রিপোর্টের **খাঁটি** অংশ — তারিখ পার্স, রেঞ্জের সীমা (F08), কর্মদিবস গোনা,
 * দৈনিক টার্গেট বের করা, বালতিতে (সপ্তাহ/মাস) ভাগ করা।
 *
 * আলাদা ফাইলে রাখার কারণ: রিপোর্টে ভুল প্রায় সবসময় **এখানেই** হয় — এক দিন
 * এদিক-ওদিক, একটা ছুটির দিন গোনায় ঢুকে যাওয়া, কিংবা মাস বদলের সময় টার্গেট
 * পাল্টাতে ভুলে যাওয়া। DB বা HTTP-র সাথে মিশে থাকলে এগুলো নিরিবিলি পরীক্ষা
 * করা যেত না, অথচ ছাপা রিপোর্টই শেষ পর্যন্ত মানুষ বিশ্বাস করে।
 *
 * ⚠️ সব তারিখ এখানে **UTC-midnight Date** হিসেবে চলে — ঠিক যেভাবে Prisma
 *    `@db.Date` কলাম (`work_date`, `holiday_date`) ফেরত দেয় এবং
 *    `dhaka-time.workDateOf()` বানায়। তাই তুলনা সরাসরি মিলে যায়, কোনো
 *    টাইমজোন রূপান্তর লাগে না।
 */

/** F08 — এক রিকোয়েস্টে সর্বোচ্চ কত দিন চাওয়া যাবে। */
export const MAX_RANGE_DAYS = 370;

const DAY_MS = 86_400_000;
const SEC_PER_HOUR = 3600;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 'YYYY-MM-DD' → ওই তারিখের UTC-midnight।
 *
 * ⚠️ `new Date('2026-8-1')` লোকাল টাইমজোনে পার্স হয়, আর `Date.UTC(2026, 1, 30)`
 *    চুপচাপ ২ মার্চ বানিয়ে দেয়। দুটোর কোনোটাই এরর দেয় না — শুধু রিপোর্টের
 *    তারিখ এক দিন সরে যায়। তাই ফরম্যাট regex দিয়ে বাঁধা, আর তৈরি হওয়া
 *    তারিখটা আবার মিলিয়ে দেখা হয় (round-trip)।
 */
export function parseWorkDate(text: string): Date {
  const m = ISO_DATE_RE.exec(text);
  if (!m) {
    throw new RangeError(`Date must be in YYYY-MM-DD format — got "${text}"`);
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`No such date on the calendar — "${text}"`);
  }

  return date;
}

/**
 * UTC-midnight Date → 'YYYY-MM-DD'।
 * ⚠️ `toLocaleDateString()` বা `getFullYear()` ব্যবহার করা হয় না — সার্ভার
 *    ঢাকার বাইরে (বা CI-তে UTC-র পশ্চিমে) চললে ওগুলো এক দিন পিছিয়ে দিত।
 */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** দুই তারিখের মধ্যে দিনসংখ্যা, **দুই প্রান্তসহ** (একই দিন হলে ১)। */
export function daysInclusive(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

/**
 * ISO দিন: সোম = ১ … রবি = ৭।
 * ⚠️ `getDay()` নয়, `getUTCDay()` — তারিখগুলো UTC-midnight, তাই লোকাল getter
 *    ঋণাত্মক অফসেটের মেশিনে আগের দিন ধরিয়ে দিত (শুক্রবারের ছুটি বৃহস্পতিবারে
 *    সরে যেত)। `work_policies.weekly_off_day`-ও ISO সংখ্যা।
 */
export function isoDayOf(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/** 'YYYY-MM' — `monthly_summary.year_month`-এর সাথে হুবহু এক ফরম্যাট। */
export function monthKeyOf(date: Date): string {
  return toIsoDate(date).slice(0, 7);
}

export function monthBoundsOf(date: Date): { first: Date; last: Date } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    first: new Date(Date.UTC(year, month, 1)),
    // পরের মাসের ০ তারিখ = এই মাসের শেষ দিন — লিপ ইয়ারও নিজে থেকেই মেলে
    last: new Date(Date.UTC(year, month + 1, 0)),
  };
}

export function eachDate(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    out.push(new Date(t));
  }
  return out;
}

/**
 * রেঞ্জ যে যে মাস ছুঁয়েছে, প্রত্যেকটির **পুরো** সীমা।
 *
 * ⭐ দৈনিক টার্গেট = মাসিক টার্গেট ÷ ওই মাসের মোট কর্মদিবস (§ ২.১-খ)। তাই
 * ১০–২০ আগস্টের রিপোর্টের জন্যও **পুরো আগস্টের** ছুটি জানা দরকার — শুধু
 * রেঞ্জের ভেতরের ছুটি আনলে হর ছোট হয়ে যেত আর টার্গেট বেশি দেখাত।
 */
export function monthsIn(
  from: Date,
  to: Date,
): { key: string; first: Date; last: Date }[] {
  const out: { key: string; first: Date; last: Date }[] = [];
  let cursor = monthBoundsOf(from).first;

  while (cursor.getTime() <= to.getTime()) {
    const bounds = monthBoundsOf(cursor);
    out.push({ key: monthKeyOf(cursor), ...bounds });
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    );
  }

  return out;
}

// ── রেঞ্জ যাচাই (F08) ───────────────────────────────────────────────────────

export interface ReportRange {
  from: Date;
  /** কার্যকর শেষ তারিখ — ভবিষ্যতে চাইলে আজ পর্যন্ত ছেঁটে দেওয়া হয় */
  to: Date;
  /** যা চাওয়া হয়েছিল — ছাঁটাই হয়েছে কি না বোঝার জন্য রেসপন্সে যায় */
  requestedTo: Date;
  clampedToToday: boolean;
  /** কার্যকর দিনসংখ্যা */
  days: number;
}

export interface ParseRangeOptions {
  /** টেস্টে নির্দিষ্ট সময় বসানোর জন্য */
  now?: Date;
  maxDays?: number;
}

/**
 * F08 — যেকোনো from–to, কিন্তু **সীমা বেঁধে**।
 *
 * ⚠️ সীমা যাচাই হয় **চাওয়া** রেঞ্জের উপর, ছাঁটাইয়ের আগে। উল্টো করলে
 *    `from=2000-01-01&to=2999-12-31` আজ পর্যন্ত ছেঁটে গিয়ে "১১ দিন" হয়ে
 *    পাস করে যেত — অর্থাৎ সার্ভার একদম অন্য প্রশ্নের উত্তর দিত, অথচ
 *    ব্যবহারকারী জানতই না।
 *
 * ⭐ ভবিষ্যতের তারিখ **নাকচ না করে ছেঁটে** দেওয়া হয়, কারণ ড্যাশবোর্ডে
 * "এই মাস" বাছলে ১১ আগস্টেই ১–৩১ আগস্ট চাওয়া হয় — ওটা এরর দেখানোর মতো
 * ভুল নয়। কিন্তু ছাঁটাইটা চুপচাপ নয়: `clampedToToday` রেসপন্সে যায় এবং
 * Excel-এর "তথ্য" শিটেও লেখা থাকে। না ছাঁটলে ভবিষ্যতের কর্মদিবসগুলোর
 * টার্গেট যোগ হয়ে সবার নামে বিশাল ঘাটতি দেখাত।
 */
export function parseReportRange(
  fromText: string,
  toText: string,
  opts: ParseRangeOptions = {},
): ReportRange {
  const maxDays = opts.maxDays ?? MAX_RANGE_DAYS;
  const from = parseWorkDate(fromText);
  const requestedTo = parseWorkDate(toText);

  if (requestedTo.getTime() < from.getTime()) {
    throw new RangeError('The end date cannot be before the start date');
  }

  const requestedDays = daysInclusive(from, requestedTo);
  if (requestedDays > maxDays) {
    throw new RangeError(
      `The range can be at most ${maxDays} days — ${requestedDays} days were requested`,
    );
  }

  // আজকের ঢাকার তারিখ — নিজে অফসেট হিসাব না করে dhaka-time দিয়েই
  const today = workDateOf(opts.now ?? new Date());

  if (from.getTime() > today.getTime()) {
    throw new RangeError(
      'The whole range is in the future — there is no data for those days',
    );
  }

  const clampedToToday = requestedTo.getTime() > today.getTime();
  const to = clampedToToday ? today : requestedTo;

  return {
    from,
    to,
    requestedTo,
    clampedToToday,
    days: daysInclusive(from, to),
  };
}

// ── কর্মদিবস ও টার্গেট (§ ২.১-খ) ────────────────────────────────────────────

export interface WorkdayRule {
  /** ISO দিন (শুক্র = ৫)। null হলে প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস। */
  weeklyOffDay: number | null;
  /**
   * ছুটির দিনগুলোর `getTime()`।
   * ⚠️ Date অবজেক্ট Set-এ রেফারেন্স ধরে মেলে, মান ধরে নয় — তাই epoch ms।
   */
  holidays: ReadonlySet<number>;
}

/**
 * ⚠️ এটা **ব্লক নয়** — ছুটির দিনে কেউ কাজ করলে ঘণ্টা পুরোপুরি গোনা হবে
 *    (§ ২.১-খ)। এই ফাংশন শুধু বলে ওই দিনটার **টার্গেট** আছে কি না।
 */
export function isWorkday(date: Date, rule: WorkdayRule): boolean {
  if (rule.holidays.has(date.getTime())) return false;
  if (rule.weeklyOffDay !== null && isoDayOf(date) === rule.weeklyOffDay) {
    return false;
  }
  return true;
}

export function countWorkdays(
  first: Date,
  last: Date,
  rule: WorkdayRule,
): number {
  let count = 0;
  for (const date of eachDate(first, last)) {
    if (isWorkday(date, rule)) count += 1;
  }
  return count;
}

/**
 * এক কর্মদিবসের টার্গেট, সেকেন্ডে।
 *
 * ⭐ এই ভাগটাই § ২.১-খ-এর `expected_sec = target_sec × workdays_elapsed ÷
 * expected_workdays` সূত্রের একক রূপ — নতুন কোনো নীতি নয়। ড্যাশবোর্ডের
 * pace আর এই রিপোর্ট তাই কখনো আলাদা কথা বলবে না।
 *
 * ⚠️ ফল **round করা হয় না**। ২২ কর্মদিবসের মাসে ৭৪৮৮০০ ÷ ২২ = ৩৪০৩৬.৩৬…;
 *    প্রতিদিন round করে যোগ করলে মাসের শেষে টার্গেট ২০৮ ঘণ্টায় গিয়ে ঠেকত
 *    না — অর্থাৎ কেউ ঠিক ২০৮ ঘণ্টা করেও কাগজে ঘাটতি দেখত। round শুধু
 *    একদম শেষে, ঘণ্টায় রূপান্তরের সময়।
 *
 * ⚠️ কর্মদিবস শূন্য হলে (পুরো মাস ছুটি) ০ ফেরে — Infinity নয়।
 */
export function dailyTargetSec(
  monthlyTargetSec: number,
  workdaysInMonth: number,
): number {
  if (!Number.isFinite(monthlyTargetSec) || monthlyTargetSec < 0) {
    throw new RangeError('The monthly target cannot be negative or undefined');
  }
  if (workdaysInMonth <= 0) return 0;
  return monthlyTargetSec / workdaysInMonth;
}

// ── সপ্তাহ / মাসের বালতি (F02) ──────────────────────────────────────────────

export type GroupBy = 'week' | 'month';

export interface Bucket {
  /** মাসে 'YYYY-MM', সপ্তাহে সপ্তাহ-শুরুর তারিখ 'YYYY-MM-DD' */
  key: string;
  start: Date;
  end: Date;
}

/**
 * সপ্তাহ কোন দিনে শুরু — **সাপ্তাহিক ছুটির পরের দিন**।
 *
 * ⭐ হার্ডকোড করা হয়নি। ছুটি শুক্রবার (ISO ৫) হলে সপ্তাহ শুরু শনিবার, তাই
 * ছুটির দিনটা সপ্তাহের শেষে পড়ে আর কর্মসপ্তাহ দুই বালতিতে ভাগ হয় না।
 * সোমবার ধরে নিলে বাংলাদেশের প্রতিটি কর্মসপ্তাহ মাঝখান থেকে কেটে যেত।
 * ছুটি না থাকলে (null) আন্তর্জাতিক অভ্যাস — সোমবার।
 */
export function weekStartIsoDay(weeklyOffDay: number | null): number {
  if (weeklyOffDay === null) return 1;
  return (weeklyOffDay % 7) + 1;
}

export function bucketOf(
  date: Date,
  groupBy: GroupBy,
  weekStartIso: number,
): Bucket {
  if (groupBy === 'month') {
    const { first, last } = monthBoundsOf(date);
    return { key: monthKeyOf(date), start: first, end: last };
  }

  const back = (isoDayOf(date) - weekStartIso + 7) % 7;
  const start = addDays(date, -back);
  const end = addDays(start, 6);
  return { key: toIsoDate(start), start, end };
}

// ── উপস্থাপনা ───────────────────────────────────────────────────────────────

/**
 * সেকেন্ড → ঘণ্টা, দুই দশমিক, **সংখ্যা হিসেবে**।
 *
 * ⭐ "৭ঘ ৩২মি" নয় — Excel-এ ওটা টেক্সট হয়ে যায়, তখন কলাম যোগ করা বা
 * sort করা কিছুই চলে না, অথচ রিপোর্ট খুলেই মানুষ প্রথমে ওটাই করে।
 * সাজানো লেখা বানানো ফ্রন্টএন্ডের কাজ, রিপোর্টের নয়।
 */
export function secondsToHours(sec: number): number {
  return Math.round(sec / (SEC_PER_HOUR / 100)) / 100;
}

/** শতাংশ, দুই দশমিক। হর শূন্য হলে ০ — NaN নয়। */
export function sharePct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}
