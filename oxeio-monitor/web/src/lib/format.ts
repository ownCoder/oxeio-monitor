/**
 * সংখ্যা ও তারিখ দেখানোর একমাত্র জায়গা।
 *
 * ⭐ ছ-টা পেজ একই ফাংশন ব্যবহার করে বলেই "৭.৫ ঘণ্টা" আর "7h 32m" দুই
 *    পর্দায় দুই রকম দেখাবে না। নিজের পেজে আলাদা করে ফরম্যাট লিখবেন না।
 *
 * ⚠️ **পর্দার ভাষা ইংরেজি** (মালিকের সিদ্ধান্ত) — মাস, বার আর একক সবই
 *    ইংরেজি: `7h 32m`, `11 August 2026`। অঙ্ক আগেও ইংরেজি ছিল, এখনো তাই;
 *    `.num` ক্লাসের tabular-nums তখনই কাজ করে।
 *
 * ⚠️ এই ফাইলের **মন্তব্য বাংলাতেই থাকে** — ওগুলো প্রকল্পের ডকুমেন্টেশন,
 *    পর্দার লেখা নয়। শুধু return-করা স্ট্রিংগুলো ইংরেজি।
 */

/**
 * ⭐ Asia/Dhaka = UTC+06:00, কোনো DST নেই — সার্ভারের `dhaka-time.ts`-এর
 * ঠিক একই ধ্রুবক। দুই জায়গায় দুটো সংখ্যা থাকলে একদিন একটা বদলাত।
 */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR = 3600;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * ⭐⚠️ সরু কলামের জন্য মাসের **হাতে লেখা** সংক্ষিপ্ত রূপ।
 *
 * ইংরেজিতে `MONTHS[i].slice(0, 3)` লিখলে কাজ করত, তবু তালিকাটা হাতে লেখা
 * রইল — কারণ বাংলা তালিকার সময় ঠিক ওই `slice()`-ই নীরবে লেখা ভেঙে দিত:
 * JS-এর `slice()` UTF-16 একক গোনে, যুক্তাক্ষর বা কার-চিহ্ন চেনে না।
 *   · `'অক্টোবর'.slice(0,3)` → `'অক্'` — **হসন্তে শেষ**, ভাঙা লেখা
 *   · `'ডিসেম্বর'.slice(0,3)` → `'ডিস'` — ঠিক, কিন্তু কাকতালীয়
 *   · `'ফেব্রুয়ারি'.slice(0,3)` → `'ফেব্'` — আবার হসন্ত
 * অর্থাৎ বছরে অন্তত তিনটে মাস অ্যাটেনডেন্স, সারাংশ আর audit log-এর
 * প্রতিটা সারিতে ভাঙা দেখাত — কোনো এরর ছাড়াই। কোনোদিন আবার বাংলা (বা
 * অন্য কোনো ইন্ডিক লিপি) ফিরলে যেন ফাঁদটা আবার পাতা না হয়, তাই দুটো
 * তালিকা আলাদা করেই রাখা।
 */
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Sun = 0 … Sat = 6 (JS-এর `getUTCDay()` ক্রম) */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── কর্মদিবস (`YYYY-MM-DD`) ─────────────────────────────────────────────────

/**
 * ⭐⚠️ ঢাকার **আজকের কর্মদিবস** — ব্রাউজারের টাইমজোন ধরে নেওয়া হয় না।
 *
 * `new Date().toISOString().slice(0, 10)` লিখলে UTC তারিখ আসত, আর ঢাকায়
 * রাত ১২টা থেকে ভোর ৬টার মধ্যে সেটা **আগের দিন** দেখাত — অর্থাৎ রাতে কাজ
 * করা কর্মী (§ ২.১-ক অনুযায়ী স্বাভাবিক) নিজের আজকের ঘণ্টা খুঁজেই পেত না।
 * উল্টোদিকে ব্যাংককের কোনো ব্রাউজারে `toLocaleDateString()` এক দিন এগিয়ে
 * যেত। তাই অফসেটটা এখানে স্পষ্ট করে বসানো।
 */
export function todayInDhaka(now: Date = new Date()): string {
  return isoDateOf(new Date(now.getTime() + DHAKA_OFFSET_MS));
}

/** কোনো instant ঢাকার কোন কর্মদিবসে পড়ে — `YYYY-MM-DD` */
export function workDateOf(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return isoDateOf(new Date(date.getTime() + DHAKA_OFFSET_MS));
}

/** UTC অংশ ধরে `YYYY-MM-DD` — কোনো লোকাল getter নয় */
function isoDateOf(shifted: Date): string {
  return [
    shifted.getUTCFullYear(),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
  ].join('-');
}

/**
 * `YYYY-MM-DD` → UTC-midnight Date।
 *
 * ⚠️ `new Date('2026-02-31')` চুপচাপ ৩ মার্চ বানিয়ে দেয়, তাই ফিরে এসে
 *    মিলিয়ে দেখা হয়। না মিললে `null` — ব্যবহারকারী ভুল তারিখের ডেটা
 *    দেখে বুঝতেও পারত না।
 */
export function parseWorkDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;

  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function isValidWorkDate(text: string): boolean {
  return parseWorkDate(text) !== null;
}

/** কর্মদিবস সরানো — `shiftWorkDate('2026-08-10', -1)` → `'2026-08-09'` */
export function shiftWorkDate(date: string, days: number): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return date;
  return isoDateOf(new Date(parsed.getTime() + days * DAY_MS));
}

/** ওই তারিখের মাসের ১ তারিখ — রিপোর্টের ডিফল্ট `from` */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** ওই মাসের শেষ দিন — `'2026-02'` বা `'2026-02-10'` দুটোই চলে */
export function monthEndOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  // পরের মাসের ০ তারিখ = এই মাসের শেষ দিন; লিপ ইয়ারও নিজে থেকেই মেলে
  return isoDateOf(new Date(Date.UTC(year, month, 0)));
}

/** `'2026-08-10'` → `'2026-08'` — payroll ও monthly_summary-র ফরম্যাট */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/** মাস সরানো — `shiftMonth('2026-01', -1)` → `'2025-12'` */
export function shiftMonth(monthKey: string, months: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`;
}

/** চলতি মাসের ১ তারিখ → ঢাকার আজ। রিপোর্ট পেজগুলোর ডিফল্ট রেঞ্জ। */
export function thisMonthRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const today = todayInDhaka(now);
  return { from: monthStartOf(today), to: today };
}

// ── তারিখ দেখানো ────────────────────────────────────────────────────────────

/** `'2026-08-10'` → `'10 August 2026'` */
export function formatDate(date: string): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return date;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** `'2026-08-10'` → `'10 Aug'` — টেবিলের সরু কলামে */
export function formatDateShort(date: string): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return date;
  return `${parsed.getUTCDate()} ${MONTHS_SHORT[parsed.getUTCMonth()]}`;
}

/**
 * `'2026-08-10'` → `'Mon'`
 *
 * ⚠️ বাংলায় এর পরে "বার" জুড়ে দেওয়া হতো (`সোম` + `বার`)। ইংরেজিতে সেটা
 *    করবেন না — `Mon` নিজেই সম্পূর্ণ, আর জুড়লে "Monবার" ধরনের কিছু হতো।
 */
export function weekdayOf(date: string): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return '';
  return WEEKDAYS[parsed.getUTCDay()];
}

/** `'2026-08'` → `'August 2026'` */
export function formatMonth(monthKey: string): string {
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return monthKey;
  return `${MONTHS[month - 1]} ${monthKey.slice(0, 4)}`;
}

/**
 * ISO instant → ঢাকার ঘড়ির সময়, `'14:32'`।
 *
 * ⚠️ `toLocaleTimeString()` ব্যবহারকারীর টাইমজোনে দেখাত — ঢাকার বাইরের কেউ
 *    (বা VPN-এ থাকা কেউ) স্ক্রিনশটের সময় ভুল দেখত, আর সেটা ধরার কোনো উপায়
 *    থাকত না। অফিসের সব সময় ঢাকার সময়।
 */
export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const shifted = new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS);
  if (Number.isNaN(shifted.getTime())) return '—';
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** ISO instant → `'10 August 2026, 14:32'` (ঢাকার সময়) */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return `${formatDate(workDateOf(at))}, ${formatTime(iso)}`;
}

/**
 * "কত আগে" — `'3 minutes ago'`।
 *
 * লাইভ বোর্ডে heartbeat-এর বয়স দেখাতে। ⚠️ ভবিষ্যতের সময় (ঘড়ি এদিক-ওদিক)
 * এলে `'Just now'` — ঋণাত্মক সংখ্যা দেখালে মনে হতো সিস্টেম ভেঙে গেছে।
 *
 * ⚠️ ইংরেজিতে **একবচন/বহুবচন** মেলাতে হয় (বাংলায় লাগত না): `1 minute ago`,
 *    `2 minutes ago`। "1 minutes ago" দেখলে লেখাটা যন্ত্রের মতো শোনায়, আর
 *    সংখ্যাগুলোর উপর ভরসাও কমে।
 */
export function formatAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';

  const sec = Math.floor((now.getTime() - at.getTime()) / 1000);
  if (sec < 45) return 'Just now';
  if (sec < 3600) return ago(Math.round(sec / 60), 'minute');
  if (sec < 86400) return ago(Math.round(sec / 3600), 'hour');
  return ago(Math.round(sec / 86400), 'day');
}

function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

// ── সময়কাল ─────────────────────────────────────────────────────────────────

/**
 * ⭐ সেকেন্ড → `'7h 32m'`। এক ঘণ্টার কম হলে শুধু `'32m'`, শূন্য হলে `'0m'`।
 *
 * ⚠️ শূন্যে **খালি স্ট্রিং নয়** — `'0m'`। খালি ঘর দেখলে বোঝা যায় না ডেটা
 *    নেই না কি সত্যিই শূন্য, আর "তথ্য নেই" বোঝাতে এই ফাইলে `'—'` আছে।
 *
 * ⚠️ মিনিট round করার পর ৬০ হয়ে যেতে পারে (৩৫৯৮ সেকেন্ড → 0h 60m)।
 *    তখন ঘণ্টায় তুলে না দিলে পর্দায় "60m" বসে থাকত — দেখতে ভুল না হলেও
 *    কেউ সেটাকে সংখ্যা হিসেবে বিশ্বাস করত না।
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '—';
  }

  const total = Math.max(0, Math.round(seconds));
  let hours = Math.floor(total / HOUR);
  let minutes = Math.round((total - hours * HOUR) / 60);

  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/**
 * ⭐ ঘণ্টা-সংশোধনের মান — `'+2:00'` / `'−0:30'` (B14 · G35)।
 *
 * ⚠️ **চিহ্নটাই আসল তথ্য**, তাই কখনো বাদ দেওয়া হয় না — ধনাত্মকেও `+`।
 * `2:00` লেখা থাকলে বোঝাই যেত না ঘণ্টা যোগ হলো না কাটা হলো, অথচ
 * পার্থক্যটা কারো বেতনের।
 *
 * ⚠️ ইউনিকোড মাইনাস (`−`, U+2212), হাইফেন নয় — সংখ্যার পাশে হাইফেন ছোট
 * দেখায় আর ঋণাত্মক চিহ্নটা চোখ এড়িয়ে যেতে পারত।
 *
 * ⚠️ এখানে `formatDuration()` ব্যবহার করা হয় **না**, ইচ্ছাকৃতভাবে: ওটা
 * `7h 32m` লেখে আর এক ঘণ্টার কম হলে ঘণ্টাটা বাদ দেয়। সংশোধনের তালিকায়
 * সব সারি একই চওড়ায় থাকা দরকার (`+0:30` আর `+2:00` পাশাপাশি), তাই
 * ঘণ্টাটা সবসময় থাকে।
 */
export function formatSignedDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  let minutes = Math.round((abs % 3600) / 60);
  let carried = hours;

  // ⚠️ `formatDuration()`-এর মতোই ফাঁদ: ৩৫৯৮ সেকেন্ড → `0:60`
  if (minutes === 60) {
    carried += 1;
    minutes = 0;
  }

  return `${seconds < 0 ? '−' : '+'}${carried}:${pad(minutes)}`;
}

/** সেকেন্ড → দশমিক ঘণ্টা, `'7.5'` — চার্টের অক্ষ ও তুলনার জন্য */
export function formatHours(
  seconds: number | null | undefined,
  digits = 1,
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '—';
  }
  return (seconds / HOUR).toFixed(digits);
}

/**
 * দশমিক ঘণ্টা → `'7h 32m'`।
 *
 * ⚠️ রিপোর্টের API ঘণ্টা পাঠায় (`workedHours: 7.53`), লাইভ বোর্ড সেকেন্ড
 *    (`todayWorkedSec`)। দুই পর্দায় একই লেখা দেখাতে এই সেতুটা দরকার।
 *    Payroll ঘণ্টা **স্ট্রিং** হিসেবে পাঠায় (`'7.53'`) — সেটাও চলে।
 */
export function formatHoursAsDuration(
  hours: number | string | null | undefined,
): string {
  if (hours === null || hours === undefined) return '—';
  const value = typeof hours === 'string' ? Number(hours) : hours;
  if (!Number.isFinite(value)) return '—';
  return formatDuration(value * HOUR);
}

/** দশমিক ঘণ্টা → সেকেন্ড — ProgressRing-এ পাঠানোর জন্য */
export function hoursToSeconds(hours: number | string): number {
  const value = typeof hours === 'string' ? Number(hours) : hours;
  return Number.isFinite(value) ? value * HOUR : 0;
}

// ── শতাংশ, বাইট, টাকা ───────────────────────────────────────────────────────

/**
 * ⭐ `null` মানে **তথ্য নেই**, শূন্য নয় (সার্ভারের `scorePct` ঠিক এভাবেই
 * পাঠায়)। `0%` লিখে দিলে "কিছুই productive করেনি" বলা হতো, অথচ সত্যিটা
 * "বলার মতো কিছুই নেই" — ছুটির দিনে দুটোর পার্থক্য পুরো রিপোর্ট বদলে দেয়।
 */
export function formatPct(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(digits)}%`;
}

/** অগ্রগতির শতাংশ — হর শূন্য হলে ০, NaN বা Infinity নয় */
export function pctOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return (part / whole) * 100;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * টাকা — `'13000.50'` → `'৳ 13,000.50'`।
 *
 * ⚠️ সার্ভার টাকা **স্ট্রিং** হিসেবে পাঠায় (Decimal, float নয়)। এখানে
 *    `Number()` করে হিসাব করা হয় **না**, শুধু হাজারের কমা বসানো হয় —
 *    নইলে ১৩০০০.১০ পর্দায় ১৩০০০.০৯৯৯… হয়ে যেত।
 *
 * ⭐ এটা owner ছাড়া কারো পর্দায় ডাকা যাবে না (§ ৪.৩, ADR-023)।
 */
export function formatTaka(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const [whole, fraction] = amount.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `৳ ${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** সাধারণ সংখ্যা — হাজারের কমা সহ */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return Math.round(value).toLocaleString('en-US');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
