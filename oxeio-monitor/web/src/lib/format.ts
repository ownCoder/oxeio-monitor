/**
 * সংখ্যা ও তারিখ দেখানোর একমাত্র জায়গা।
 *
 * ⭐ ছ-টা পেজ একই ফাংশন ব্যবহার করে বলেই "৭.৫ ঘণ্টা" আর "7ঘ 32মি" দুই
 *    পর্দায় দুই রকম দেখাবে না। নিজের পেজে আলাদা করে ফরম্যাট লিখবেন না।
 *
 * ⚠️ **সংখ্যা ইংরেজি অঙ্কে** (7ঘ 32মি), বাংলা অঙ্কে নয় — মকআপ § দেখুন।
 *    মাস ও বারের নাম বাংলায়, কিন্তু অঙ্ক সবসময় ইংরেজি: `.num` ক্লাসের
 *    tabular-nums তখনই কাজ করে।
 */

/**
 * ⭐ Asia/Dhaka = UTC+06:00, কোনো DST নেই — সার্ভারের `dhaka-time.ts`-এর
 * ঠিক একই ধ্রুবক। দুই জায়গায় দুটো সংখ্যা থাকলে একদিন একটা বদলাত।
 */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR = 3600;

const MONTHS_BN = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

/**
 * ⭐⚠️ সরু কলামের জন্য মাসের **হাতে লেখা** সংক্ষিপ্ত রূপ।
 *
 * আগে এখানে `MONTHS_BN[i].slice(0, 3)` করা হতো, আর সেটা বাংলায় ভুল:
 * JS-এর `slice()` UTF-16 একক গোনে, যুক্তাক্ষর বা কার-চিহ্ন চেনে না।
 *   · `'অক্টোবর'.slice(0,3)` → `'অক্'` — **হসন্তে শেষ**, ভাঙা লেখা
 *   · `'ডিসেম্বর'.slice(0,3)` → `'ডিস'` — ঠিক, কিন্তু কাকতালীয়
 *   · `'ফেব্রুয়ারি'.slice(0,3)` → `'ফেব্'` — আবার হসন্ত
 * অর্থাৎ বছরে অন্তত তিনটে মাস অ্যাটেনডেন্স, সারাংশ আর audit log-এর
 * প্রতিটা সারিতে ভাঙা দেখাত — কোনো এরর ছাড়াই।
 */
const MONTHS_SHORT_BN = [
  'জানু',
  'ফেব',
  'মার্চ',
  'এপ্রি',
  'মে',
  'জুন',
  'জুলা',
  'আগ',
  'সেপ্ট',
  'অক্টো',
  'নভে',
  'ডিসে',
];

/** রবি = 0 … শনি = 6 (JS-এর `getUTCDay()` ক্রম) */
const WEEKDAYS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];

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

/** `'2026-08-10'` → `'10 আগস্ট 2026'` */
export function formatDate(date: string): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return date;
  return `${parsed.getUTCDate()} ${MONTHS_BN[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** `'2026-08-10'` → `'10 আগ'` — টেবিলের সরু কলামে */
export function formatDateShort(date: string): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return date;
  return `${parsed.getUTCDate()} ${MONTHS_SHORT_BN[parsed.getUTCMonth()]}`;
}

/** `'2026-08-10'` → `'সোম'` */
export function weekdayOf(date: string): string {
  const parsed = parseWorkDate(date);
  if (!parsed) return '';
  return WEEKDAYS_BN[parsed.getUTCDay()];
}

/** `'2026-08'` → `'আগস্ট 2026'` */
export function formatMonth(monthKey: string): string {
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return monthKey;
  return `${MONTHS_BN[month - 1]} ${monthKey.slice(0, 4)}`;
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

/** ISO instant → `'10 আগস্ট 2026, 14:32'` (ঢাকার সময়) */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return `${formatDate(workDateOf(at))}, ${formatTime(iso)}`;
}

/**
 * "কত আগে" — `'3 মিনিট আগে'`।
 *
 * লাইভ বোর্ডে heartbeat-এর বয়স দেখাতে। ⚠️ ভবিষ্যতের সময় (ঘড়ি এদিক-ওদিক)
 * এলে `'এইমাত্র'` — ঋণাত্মক সংখ্যা দেখালে মনে হতো সিস্টেম ভেঙে গেছে।
 */
export function formatAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'কখনো নয়';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';

  const sec = Math.floor((now.getTime() - at.getTime()) / 1000);
  if (sec < 45) return 'এইমাত্র';
  if (sec < 3600) return `${Math.round(sec / 60)} মিনিট আগে`;
  if (sec < 86400) return `${Math.round(sec / 3600)} ঘণ্টা আগে`;
  return `${Math.round(sec / 86400)} দিন আগে`;
}

// ── সময়কাল ─────────────────────────────────────────────────────────────────

/**
 * ⭐ সেকেন্ড → `'7ঘ 32মি'`। এক ঘণ্টার কম হলে শুধু `'32মি'`।
 *
 * ⚠️ মিনিট round করার পর ৬০ হয়ে যেতে পারে (৩৫৯৮ সেকেন্ড → 0ঘ 60মি)।
 *    তখন ঘণ্টায় তুলে না দিলে পর্দায় "60মি" বসে থাকত — দেখতে ভুল না হলেও
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

  return hours === 0 ? `${minutes}মি` : `${hours}ঘ ${minutes}মি`;
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
 * দশমিক ঘণ্টা → `'7ঘ 32মি'`।
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
