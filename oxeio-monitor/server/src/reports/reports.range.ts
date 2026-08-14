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
 * ⚠️ **দৈনিক টার্গেটের হর এখান থেকে আসে না** — ওটা পলিসির
 * `expected_workdays` (`dailyTargetSec()`-এর নোট)। আগে এই ফাংশনের কারণ
 * হিসেবে ঠিক উল্টোটা লেখা ছিল, আর সেই লেখাটাই ভুল হরটাকে বৈধ দেখাত।
 *
 * ⭐ তবু পুরো মাস দরকার, দুটো কারণে:
 *   ১· `meta.approximateHolidayDates` পাঠককে বলে **এই মাসগুলোর** কোন
 *      তারিখ এখনো পাকা নয়। রেঞ্জ কেটে আনলে ২৬ আগস্টের অনিশ্চিত ছুটিটা
 *      ১–১৪ আগস্টের রিপোর্টে চাপা পড়ত।
 *   ২· পে-রোলের `d ÷ D` ভগ্নাংশে D = **ওই মাসের** ক্যালেন্ডার কর্মদিবস,
 *      অর্থাৎ মাসের যেকোনো ছুটি নড়লে টাকা নড়ে — রেঞ্জের বাইরে পড়লেও।
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
 * ⭐⭐ **হর পলিসির `expected_workdays` (২৬) — ওই মাসের ক্যালেন্ডার কর্মদিবস
 * নয়।** এটাই § ২.১-খ-এর `expected_sec = target_sec × workdays_elapsed ÷
 * expected_workdays` সূত্রের একক রূপ, আর `summary/proration.ts`-এর
 * `prorate()` হুবহু এই একই ভাগ করে।
 *
 * ⚠️⚠️ **কেন ক্যালেন্ডার নয়, সেটাই এই ফাংশনের গোটা বক্তব্য।** হর ওই মাসের
 * কর্মদিবস হলে ছুটি বাড়লে দৈনিক টার্গেট **বাড়ত** আর মাসের মোট ২০৮
 * ঘণ্টাতেই থেকে যেত — অর্থাৎ সরকারি ছুটি দিয়ে কর্মীর কোনো লাভই হতো না,
 * শুধু বাকি দিনগুলোর বোঝা ভারী হতো। পলিসির ধ্রুবক দিয়ে ভাগ করলে দিনটা
 * সবসময় ৮ ঘণ্টাই থাকে আর ছুটির মাসে মোট নেমে আসে (২৫ × ৮ = ২০০) — এটাই
 * মানুষ যা বোঝে তার সাথে মেলে।
 *
 * ⚠️ ফল **round করা হয় না**। ২২ কর্মদিবসের পলিসিতে ৭৪৮৮০০ ÷ ২২ =
 *    ৩৪০৩৬.৩৬…; প্রতিদিন round করে যোগ করলে মাসের শেষে টার্গেট আসল
 *    সংখ্যায় গিয়ে ঠেকত না — অর্থাৎ কেউ ঠিক টার্গেট ছুঁয়েও কাগজে ঘাটতি
 *    দেখত। round শুধু একদম শেষে, ঘণ্টায় রূপান্তরের সময়।
 *
 * ⚠️ হর শূন্য হলে ০ ফেরে — Infinity নয়। বাস্তবে অপৌঁছনীয়:
 *    `expected_workdays` কলামটা non-null, default ২৬, আর DTO-তে
 *    `@Min(1) @Max(31)` (`admin/dto.ts`)।
 */
export function dailyTargetSec(
  monthlyTargetSec: number,
  /** পলিসির `expected_workdays` — ক্যালেন্ডার থেকে গোনা সংখ্যা নয় */
  expectedWorkdays: number,
): number {
  if (!Number.isFinite(monthlyTargetSec) || monthlyTargetSec < 0) {
    throw new RangeError('The monthly target cannot be negative or undefined');
  }
  if (expectedWorkdays <= 0) return 0;
  return monthlyTargetSec / expectedWorkdays;
}

// ── পরিসর ও পরিসরের টার্গেট ─────────────────────────────────────────────────

/**
 * দুই প্রান্তই ধরা একটা তারিখ-পরিসর।
 *
 * ⚠️ `summary.math.ts`-এর `ElapsedWindow`-ও হুবহু এই আকৃতি, তাই ওটা সরাসরি
 *    এখানে পাঠানো যায়। ইচ্ছাকৃতভাবে import করা হয়নি: এই ফাইলে DB বা
 *    rollup-এর কোনো ধারণা ঢুকতে দেওয়া হয় না।
 */
export interface DateSpan {
  from: Date;
  to: Date;
}

/**
 * দুই পরিসরের ছেদ, না মিললে `null`।
 *
 * ⭐ `null` আর "০ দিনের পরিসর" আলাদা রাখা হয়েছে — কলার তখন "শূন্য কারণ
 * ছেদ নেই" আর "শূন্য কারণ ওই দিনগুলোয় কোনো কর্মদিবস নেই" দুটো আলাদা করে
 * বলতে পারে।
 */
export function overlapOf(a: DateSpan, b: DateSpan): DateSpan | null {
  const from = a.from.getTime() >= b.from.getTime() ? a.from : b.from;
  const to = a.to.getTime() <= b.to.getTime() ? a.to : b.to;
  return from.getTime() > to.getTime() ? null : { from, to };
}

/**
 * ওই পরিসরের মোট টার্গেট, সেকেন্ডে = **কর্মদিবস × দৈনিক টার্গেট**।
 *
 * ⭐⭐ এটাই `prorate()`-এর `targetSec`-এর হুবহু একই সূত্র (ওখানে
 * `employeeWorkdays × dailyTargetSec`)। দুটো এক থাকে কি না, তা
 * `test/reports.target.spec.ts`-এর একটা টেস্ট **ঘণ্টা মিলিয়ে** পাহারা দেয়
 * — শুধু কর্মদিবসের সংখ্যা মিলিয়ে নয়, কারণ আগের রাউন্ডে ঠিক ওভাবেই
 * ৮.০০ বনাম ৮.৩২ ঘণ্টার ফারাক সবুজ টেস্টের ফাঁক দিয়ে বেরিয়ে গিয়েছিল।
 *
 * ⚠️ গুণ, দিনে-দিনে যোগ নয় — দৈনিক টার্গেট এখন প্রতিটি মাসে এক (হর
 *    পলিসির ধ্রুবক), তাই দুটো একই **ঘণ্টা** দেয়। আগে হর মাসভেদে বদলাত,
 *    তখন দুই মাস ছোঁয়া রেঞ্জে গুণ করলে ভুল হতো। রিপোর্টের কলামগুলো
 *    দিনে-দিনে ছাপা হয়, তাই "যোগফল = এই সংখ্যা" থাকাটা জরুরি — ওটার
 *    জন্যও আলাদা টেস্ট আছে।
 */
export function targetSecIn(
  span: DateSpan,
  rule: WorkdayRule,
  /** `dailyTargetSec()`-এর ফল — round না করা */
  perWorkdaySec: number,
): number {
  return countWorkdays(span.from, span.to, rule) * perWorkdaySec;
}

// ── আনুমানিক ছুটি: অনিশ্চয়তা সংখ্যা পর্যন্ত পৌঁছানো ─────────────────────────

/**
 * আনুমানিক ছুটির DB-নামের শেষে বসা লেজ — seed এটাই লিখে যায়।
 *
 * ⚠️⚠️ **হ্যাঁ, স্ট্রিংটা দু'জায়গায় লেখা** (এখানে আর
 *    `prisma/holidays.data.ts`-এর `APPROX_SUFFIX`-এ) — আর সেটা ইচ্ছাকৃত,
 *    কারণ import দুই দিকেই ভাঙে:
 *    · `src/` → `prisma/` import করলে `nest build`-এর rootDir সরে যায় আর
 *      আউটপুট `dist/main.js`-এর বদলে `dist/src/main.js`-এ পড়ে —
 *      `start:prod` (`node dist/main.js`) তখন ফাইলটাই খুঁজে পেত না
 *      (`tsconfig.build.json`-এর নোট ঠিক এই কারণেই prisma/ বাদ দেয়)।
 *    · উল্টোটা, `prisma/` → `src/` import করলে seed **runtime ইমেজে** ভাঙত —
 *      ওখানে `prisma/` ও `dist/` আছে, `src/` নেই (`server/Dockerfile`)।
 *    তাই দুটো কপি, আর দুটো যে এক থাকে তা `test/holidays.spec.ts`-এর একটা
 *    টেস্ট পাহারা দেয়। কপিটা নীরবে সরে গেলে রিপোর্ট চিরকাল "কোনো সম্ভাব্য
 *    তারিখ নেই" বলত — অর্থাৎ অনিশ্চয়তাটা নিঃশব্দে উবে যেত, যা এই ফাইলের
 *    সবচেয়ে বড় পাপ।
 */
export const APPROX_HOLIDAY_SUFFIX = ' (সম্ভাব্য)';

/**
 * DB-র ছুটির নামে অনিশ্চয়তার চিহ্নটা আছে কি না।
 *
 * ⭐ চিহ্নটা **নামেই** থাকে, আলাদা কলামে নয় (কেন, তা
 * `prisma/holidays.data.ts`-এর মাথায় লেখা)। এর একটা ভালো পার্শ্বফল আছে:
 * সরকার ঘোষণা দিলে মালিক Settings → Holidays-এ চিহ্নটা মুছে দেন, আর এই
 * ফাংশন **সেই মুহূর্ত থেকেই** `false` বলে। রিপোর্ট আর ছুটির পাতা তাই কখনো
 * দুই কথা বলে না — একটা তালিকা ফাইল দেখে বললে বলত।
 */
export function isApproximateHoliday(name: string): boolean {
  return name.trim().endsWith(APPROX_HOLIDAY_SUFFIX.trim());
}

/** একটা ছুটির সারি, অনিশ্চয়তা গুনতে যতটুকু লাগে */
export interface NamedHoliday {
  /** UTC-midnight — `holidays.holiday_date` ঠিক এভাবেই ফেরে */
  date: Date;
  /** DB-তে লেখা নাম — চিহ্নটা এখান থেকেই পড়া হয় */
  name: string;
}

/**
 * যে ছুটির দিনগুলোর উপর হিসাবটা দাঁড়ানো, তার মধ্যে কোন **তারিখগুলো এখনো
 * পাকা নয়** — 'YYYY-MM-DD', সাজানো।
 *
 * ⭐⭐ **যে সারিগুলো দিয়ে কর্মদিবস গোনা হয়েছে, ঠিক সেগুলোই দিন** — এক
 *    সংখ্যা, এক সংজ্ঞা। আলাদা কোনো কোয়েরি বা তালিকা-ফাইল থেকে গুনলে
 *    রিপোর্টের হর আর রিপোর্টের সতর্কবার্তা দুই জায়গা থেকে আসত, আর একদিন
 *    দুটো আলাদা কথা বলত।
 *
 * ⭐⭐ **কেন দরকার:** ছুটির তারিখ নড়লে ওই দিনটা কর্মদিবস কি না তা বদলায় —
 *    অর্থাৎ এই রিপোর্টের টার্গেটের **কয়টা দিন** বদলায় (হর নয়, হর পলিসির
 *    ধ্রুবক), আর পে-রোলের `d ÷ D` ভগ্নাংশও বদলায় — অর্থাৎ **সরাসরি
 *    টাকা**। ২৬ আগস্ট ২০২৬-এর ঈদে
 *    মিলাদুন্নবী ঠিক এমন একটা তারিখ: চাঁদ দেখার উপর নির্ভরশীল, অথচ ওটা
 *    বসলেই আগস্টের কর্মদিবস কমে আর প্রত্যেকের `target_sec` বদলায়। চিহ্নটা
 *    এতদিন কেবল **নামে** ছিল, সংখ্যার পাশে ছিল না — তাই টার্গেটটা একটা
 *    অনুমানের উপর দাঁড়িয়ে থাকত, কোনো সতর্কবার্তা ছাড়াই।
 *
 * ⚠️ এটা "কতটা ভুল" বলে না, বলে "কোথায় ভুল হতে পারে"। খালি তালিকা মানে
 *    এই মাসগুলোর প্রতিটা ছুটি পাকা — "ছুটি নেই" নয়।
 *
 * ⚠️ সাপ্তাহিক ছুটির দিনে পড়া আনুমানিক ছুটিও গোনা হয়। আজ ওটা কর্মদিবস
 *    কমায় না ঠিকই, কিন্তু তারিখটা **নড়তে পারে** — নড়ে কর্মদিবসে পড়লেই হর
 *    বদলাবে। "আজ প্রভাব নেই" আর "অনিশ্চয়তা নেই" এক কথা নয়।
 */
export function approximateHolidayDates(
  rows: readonly NamedHoliday[],
): string[] {
  // ⚠️ Set — `holiday_date` unique, তবু একাধিক মাসের রেঞ্জ জোড়া দিলে
  //    কলার ভুল করে একই সারি দুবার পাঠাতে পারে; তখন একই তারিখ দুবার
  //    গোনা হয়ে "২টি সম্ভাব্য তারিখ" বলত, অথচ তারিখ একটাই।
  const out = new Set<string>();
  for (const row of rows) {
    if (isApproximateHoliday(row.name)) out.add(toIsoDate(row.date));
  }
  return [...out].sort();
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
