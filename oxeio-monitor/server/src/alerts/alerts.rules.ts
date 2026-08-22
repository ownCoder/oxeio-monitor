/**
 * অ্যালার্ট কখন বসবে আর কখন **বসবে না** — সব সিদ্ধান্ত এখানে, খাঁটি ফাংশনে।
 * কোনো I/O নেই, কোনো Prisma নেই, কোনো ঘড়ি নেই (সময় সবসময় প্যারামিটারে আসে)।
 *
 * আলাদা ফাইলে রাখার কারণ: অ্যালার্টের আসল কঠিন প্রশ্নটা "কীভাবে পাঠাব" নয়,
 * "কখন **চুপ** থাকব"। ওই সিদ্ধান্তটুকু ডাটাবেসের সাথে মিশে থাকলে পরীক্ষা করা
 * যেত না, অথচ ভুল হলে ফল ভয়াবহ — হয় বন্যা, নয় নীরবতা।
 */

import { dhakaPathParts, workDateOf } from '../agent/util/dhaka-time';
import {
  AGENT_SILENCE_MIN,
  CLEAN_STOP_GRACE_MIN,
  DISK_CRITICAL_PCT,
  DISK_WARN_PCT,
  NO_ACTIVITY_FROM_HOUR,
  NO_ACTIVITY_TO_HOUR,
  OVERLAP_ALERT_SEC,
  SHUTDOWN_PAIR_WINDOW_MIN,
  STARTUP_GRACE_MIN,
  THROTTLE_HOURS,
  UNINSTALL_EVENT_TYPES,
  type AlertType,
} from './alerts.constants';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

// ════════════════════════════════════════════════════════════════════════════
// ১. বন্যা ঠেকানো — ⭐ এই অংশটুকুই পুরো মডিউলের মেরুদণ্ড
// ════════════════════════════════════════════════════════════════════════════

/** "একই অ্যালার্ট" মানে কী — এই তিনটে মিলে গেলে একই */
export interface AlertKey {
  type: AlertType;
  deviceId?: number | null;
  employeeId?: number | null;
}

/**
 * ⭐ একই ডিভাইসের একই কারণ = একই key।
 *
 * ডিভাইস না থাকলে (যেমন ডিস্ক, বা কর্মীভিত্তিক অ্যালার্ট) key-তে তার জায়গায়
 * `-` বসে — ফলে "সার্ভারের ডিস্ক" নিজেই একটা একক সত্তা হিসেবে throttle হয়।
 */
export function dedupeKey(key: AlertKey): string {
  return `${key.type}|d:${key.deviceId ?? '-'}|e:${key.employeeId ?? '-'}`;
}

/** throttle জানালার শুরু — DB-তে `createdAt >= এই সময়` খোঁজা হয় */
export function throttleFloor(now: Date, windowHours = THROTTLE_HOURS): Date {
  return new Date(now.getTime() - windowHours * HOUR_MS);
}

/**
 * আগেরটা এখনো "টাটকা" কি না।
 *
 * ⚠️ ভবিষ্যতের সময়ও throttled ধরা হয় (`>` তুলনা) — সার্ভারের ঘড়ি পিছিয়ে
 *    গেলে যেন চুপ থাকার দিকে ভুল হয়, বন্যার দিকে নয়।
 */
export function isThrottled(
  lastRaisedAt: Date | null | undefined,
  now: Date,
  windowHours = THROTTLE_HOURS,
): boolean {
  if (!lastRaisedAt) return false;
  return lastRaisedAt.getTime() > throttleFloor(now, windowHours).getTime();
}

/** কখন আবার একই অ্যালার্ট দেওয়া যাবে — ড্যাশবোর্ডে দেখানোর জন্য */
export function nextAllowedAt(
  lastRaisedAt: Date,
  windowHours = THROTTLE_HOURS,
): Date {
  return new Date(lastRaisedAt.getTime() + windowHours * HOUR_MS);
}

/**
 * ⭐ এক দফার সব প্রার্থীকে ছেঁকে নেওয়া — দুই ধাপে:
 *
 *  ১. DB-তে ৬ ঘণ্টার ভেতরে একই key-এর অ্যালার্ট থাকলে বাদ।
 *  ২. ⚠️ **একই দফার ভেতরেও** একই key দুবার এলে একটাই থাকবে। এই দ্বিতীয়
 *     ধাপটা ভুলে যাওয়া সবচেয়ে সহজ ফাঁদ: ১৫ মিনিটের জানালায় একই PC-র
 *     তিনটে agent_stop ইভেন্ট থাকলে DB-তে তখনো কিছুই বসেনি, তাই প্রথম
 *     ধাপ তিনটেকেই ছেড়ে দিত — আর একই সেকেন্ডে তিনটে অ্যালার্ট বসে যেত।
 */
export function suppressFlood<T extends AlertKey>(
  candidates: readonly T[],
  lastRaisedByKey: ReadonlyMap<string, Date>,
  now: Date,
  windowHours = THROTTLE_HOURS,
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];

  for (const candidate of candidates) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    if (isThrottled(lastRaisedByKey.get(key), now, windowHours)) continue;
    seen.add(key);
    kept.push(candidate);
  }

  return kept;
}

// ════════════════════════════════════════════════════════════════════════════
// ২. ঢাকার সময় — ⚠️ নিজে অফসেট কষা হয় না, সব dhaka-time.ts থেকে
// ════════════════════════════════════════════════════════════════════════════

/** ঢাকার স্থানীয় ঘণ্টা, ০–২৩ */
export function dhakaHourOf(instant: Date): number {
  return Number(dhakaPathParts(instant).hhmmss.slice(0, 2));
}

/**
 * ঢাকার তারিখের ISO দিন — সোম = ১ … শুক্র = ৫ … রবি = ৭।
 *
 * ⚠️ `work_policies.weekly_off_day` ঠিক এই সংখ্যাটাই রাখে (শুক্র = ৫), কিন্তু
 *    JavaScript-এর `getUTCDay()` দেয় রবি = ০ … শনি = ৬। রূপান্তর না করলে
 *    সাপ্তাহিক ছুটি একদিন সরে যেত, আর ভুলটা শুধু ছুটির দিনেই ধরা পড়ত।
 */
export function dhakaIsoWeekday(instant: Date): number {
  const day = workDateOf(instant).getUTCDay();
  return day === 0 ? 7 : day;
}

/** ঢাকার স্থানীয় সময় দিনের কত মিনিটে (০–১৪৩৯) */
export function dhakaMinuteOfDay(instant: Date): number {
  const hhmmss = dhakaPathParts(instant).hhmmss;
  return Number(hhmmss.slice(0, 2)) * 60 + Number(hhmmss.slice(2, 4));
}

/** 'HH:MM' → দিনের মিনিট। বেঠিক হলে null (তখন কলার "খোলা" ধরে) */
export function parseHhmm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface OfficeHoursInput {
  now: Date;
  /** 'HH:MM' — খালি হলে সারাদিনই খোলা */
  officeFrom: string | null;
  officeTo: string | null;
  /** পলিসির সাপ্তাহিক ছুটি (ISO দিন, শুক্র = ৫), না থাকলে null */
  weeklyOffDay: number | null;
  /** আজ ক্যালেন্ডারে ছুটি কি না */
  isHoliday: boolean;
}

/**
 * ⭐⭐ **অফিস কি এখন খোলা?** *(২২ আগস্ট ২০২৬)*
 *
 * ⚠️⚠️ এই ফাংশনটার একমাত্র উদ্দেশ্য **চুপ থাকা** — `agent_down` অ্যালার্ট
 * কখন তোলা হবে না তা ঠিক করা। মালিকের কথা: *"office close er pore agent
 * gula down thakobe. seita abar alart kore dekhate hobe ken?"*
 *
 * ⭐ মাঠের মাপ (১৪ দিন, ঢাকার ঘণ্টা অনুযায়ী): ১৮টা → ৯০, ০০টা → ৭৮,
 * ০৬টা → ৭৮, ১২টা → ৩৩। অর্থাৎ অফিস ছুটির পর PC নিভলেই অ্যালার্ট, আর
 * `THROTTLE_HOURS = 6` বলে সেটা সারা রাত ধরে তিনবার ফিরে আসে।
 *
 * ⚠️ **সময় না বসানো থাকলে "খোলা" ধরা হয়**, বন্ধ নয়। ভুলের দুটো দিকই
 * খারাপ, কিন্তু সমান নয়: বেশি অ্যালার্ট বিরক্তিকর, আর **নীরবে বন্ধ হয়ে
 * যাওয়া অ্যালার্ট বিপজ্জনক** — কেউ টেরই পাবে না যে পাহারা নেই।
 * একই কারণে `officeTo <= officeFrom` (উল্টো বা সমান) হলেও খোলা ধরা হয়।
 */
export function isOfficeOpen(input: OfficeHoursInput): boolean {
  const { now, officeFrom, officeTo, weeklyOffDay, isHoliday } = input;

  if (isHoliday) return false;
  if (weeklyOffDay !== null && dhakaIsoWeekday(now) === weeklyOffDay) {
    return false;
  }

  const from = parseHhmm(officeFrom);
  const to = parseHhmm(officeTo);
  if (from === null || to === null || to <= from) return true;

  const minute = dhakaMinuteOfDay(now);
  return minute >= from && minute < to;
}

// ════════════════════════════════════════════════════════════════════════════
// ৩. G01 — এজেন্ট ১০ মিনিট চুপ
// ════════════════════════════════════════════════════════════════════════════

/** এই ইভেন্টগুলোর পরে চুপ থাকাটাই স্বাভাবিক */
export const CLEAN_STOP_EVENTS: readonly string[] = [
  'agent_stop',
  'logoff',
  'shutdown',
  'sleep',
];

export interface DeviceSilence {
  deviceId: number;
  /** সার্ভারের ঘড়িতে শেষ কবে কিছু এসেছে */
  lastSeenAt: Date | null;
  /** ওই ডিভাইসের সর্বশেষ **বিদায়ী** ইভেন্ট (agent_stop/logoff/…), না থাকলে null */
  lastCleanStopAt?: Date | null;
}

/**
 * ⭐ চুপ থাকাটা কি ব্যাখ্যা করা আছে?
 *
 * PC বন্ধ করে বাড়ি যাওয়া আর এজেন্ট মরে যাওয়া — দুটোতেই ডেটা আসা বন্ধ হয়,
 * কিন্তু প্রথমটা খবর নয়। পার্থক্য একটাই: প্রথমটায় শেষ যা শুনেছি সেটা ছিল
 * একটা বিদায়ী ইভেন্ট। সেটাই যদি না দেখা হতো, তাহলে প্রতিদিন সন্ধ্যায়
 * প্রত্যেকের PC বন্ধ হওয়ামাত্র বারোটা অ্যালার্ট যেত — অর্থাৎ চেকটা সবসময়
 * সত্যি কথা বললেও কোনো কাজে লাগত না।
 */
export function isExpectedSilence(
  device: DeviceSilence,
  graceMin = CLEAN_STOP_GRACE_MIN,
): boolean {
  const { lastSeenAt, lastCleanStopAt } = device;
  if (!lastCleanStopAt) return false;
  if (!lastSeenAt) return true;

  // বিদায়ী ইভেন্টটাই কি শেষ খবর ছিল? পরে আবার কিছু এসে থাকলে এজেন্ট
  // ফিরে এসেছিল — তারপরের নীরবতার আর কোনো ব্যাখ্যা নেই।
  return lastCleanStopAt.getTime() >= lastSeenAt.getTime() - graceMin * MINUTE_MS;
}

/** কতক্ষণ চুপ, মিনিটে (`lastSeenAt` না থাকলে null) */
export function silentMinutes(
  lastSeenAt: Date | null,
  now: Date,
): number | null {
  if (!lastSeenAt) return null;
  return Math.floor((now.getTime() - lastSeenAt.getTime()) / MINUTE_MS);
}

/**
 * যেসব ডিভাইসের নীরবতার কোনো ব্যাখ্যা নেই।
 *
 * ⚠️ `lastSeenAt === null` ডিভাইস বাদ — ওরা এনরোল হয়েও কখনো কিছু পাঠায়নি।
 *    সেটা এনরোলমেন্টের সমস্যা, "এজেন্ট বন্ধ হয়ে গেছে" নয়; আর ওদের অ্যালার্ট
 *    দিলে ইনস্টল না করা প্রতিটা ডিভাইস চিরকাল অভিযোগ করে যেত।
 */
export function agentDownCandidates(
  devices: readonly DeviceSilence[],
  now: Date,
  silenceMin = AGENT_SILENCE_MIN,
): DeviceSilence[] {
  const floor = now.getTime() - silenceMin * MINUTE_MS;

  return devices.filter((d) => {
    if (!d.lastSeenAt) return false;
    if (d.lastSeenAt.getTime() > floor) return false;
    return !isExpectedSilence(d);
  });
}

/** একটা খোলা agent_down alert + তার ডিভাইসের সর্বশেষ অবস্থা */
export interface OpenAgentDownAlert {
  alertId: bigint;
  /** ডিভাইসটা এখনো active (revoke হয়নি) */
  deviceActive: boolean;
  /** সার্ভারের ঘড়িতে শেষ কবে কিছু এসেছে */
  lastSeenAt: Date | null;
}

/**
 * ⭐ ফিরে আসা এজেন্ট — কোন খোলা agent_down alert এখন নিজে বন্ধ করা যায়।
 *
 * `agentDownCandidates()`-এর ঠিক **আয়না**: ওটা "চুপ হয়ে গেছে" বাছে
 * (`lastSeenAt < floor`), এটা বাছে "আবার কথা বলছে" (`lastSeenAt >= floor`)।
 * যে PC-র জন্য alert উঠেছিল সে আবার ডেটা পাঠাতে শুরু করলে alert-এর প্রশ্নটা
 * ("এই PC কি ঠিক আছে?") নিজেই মিটে যায় — উত্তর হ্যাঁ। তাই সকালে মালিক শুধু
 * **এখন যা সত্যিই down** তা-ই দেখেন, রাতে-বন্ধ-হওয়া বারোটা বাসি warning নয়।
 *
 * ⚠️ revoke করা ডিভাইস বাদ — চুপ থাকাটাই তো উদ্দেশ্য, ওর alert এই পথে
 *    বন্ধ করা হয় না।
 */
export function recoveredAlertIds(
  alerts: readonly OpenAgentDownAlert[],
  now: Date,
  silenceMin = AGENT_SILENCE_MIN,
): bigint[] {
  const floor = now.getTime() - silenceMin * MINUTE_MS;
  return alerts
    .filter(
      (a) =>
        a.deviceActive && a.lastSeenAt != null && a.lastSeenAt.getTime() >= floor,
    )
    .map((a) => a.alertId);
}

/**
 * ⭐ সার্ভার সবে উঠেছে — এখন agent_down দেখা মানে শুধু নিজেরই অনুপস্থিতি দেখা।
 * এজেন্টদের ফিরে আসার সময় দেওয়ার আগে প্রশ্নটাই করা উচিত নয়।
 */
export function isWithinStartupGrace(
  bootedAt: Date,
  now: Date,
  graceMin = STARTUP_GRACE_MIN,
): boolean {
  return now.getTime() - bootedAt.getTime() < graceMin * MINUTE_MS;
}

// ════════════════════════════════════════════════════════════════════════════
// ৪. G02 — এজেন্ট বন্ধ / আনইনস্টলের চেষ্টা
// ════════════════════════════════════════════════════════════════════════════

export interface StopEvent {
  deviceId: number | null;
  employeeId?: number | null;
  type: string;
  occurredAt: Date;
}

/** ⚠️ শুধু এই দুটোই "PC বন্ধ হচ্ছে" বোঝায় — agent_stop নিজে কিছুই বোঝায় না */
const SHUTDOWN_CONTEXT: readonly string[] = ['logoff', 'shutdown'];

/**
 * ⭐ agent_stop একই সাথে সবচেয়ে সাধারণ আর সবচেয়ে সন্দেহজনক ইভেন্ট।
 *
 * দিনে দুবার করে প্রত্যেকের PC-তে এটা ঘটে (লগঅফ/শাটডাউন), আবার কেউ Task
 * Manager থেকে এজেন্ট মেরে দিলেও ঠিক এটাই আসে। পার্থক্য করার একমাত্র সূত্র:
 * আশেপাশে logoff/shutdown আছে কি না।
 *
 * ⚠️ সন্দেহের সুবিধা দেওয়া হয় **নীরবতার পক্ষে নয়** — জোড়া না মিললে
 *    অ্যালার্ট হয়। একটা মিথ্যা অ্যালার্ট বিরক্তিকর, কিন্তু চুপচাপ বন্ধ করে
 *    রাখা এজেন্ট পুরো মাসের হিসাব নষ্ট করে দেয়।
 */
export function isTamperStop(
  stop: StopEvent,
  sameDeviceEvents: readonly StopEvent[],
  windowMin = SHUTDOWN_PAIR_WINDOW_MIN,
): boolean {
  if (UNINSTALL_EVENT_TYPES.includes(stop.type)) return true;

  const windowMs = windowMin * MINUTE_MS;
  const paired = sameDeviceEvents.some(
    (e) =>
      e.deviceId === stop.deviceId &&
      SHUTDOWN_CONTEXT.includes(e.type) &&
      Math.abs(e.occurredAt.getTime() - stop.occurredAt.getTime()) <= windowMs,
  );

  return !paired;
}

/** আনইনস্টল = critical, শুধু বন্ধ করা = warning */
export function tamperSeverity(eventType: string): 'warning' | 'critical' {
  return UNINSTALL_EVENT_TYPES.includes(eventType) ? 'critical' : 'warning';
}

// ════════════════════════════════════════════════════════════════════════════
// ৫. G03 — সার্ভারের ডিস্ক
// ════════════════════════════════════════════════════════════════════════════

/** `fs.statfs()`-এর যে অংশটুকু কাজে লাগে */
export interface DiskStats {
  /** মোট ব্লক */
  blocks: number;
  /** খালি ব্লক (root-এর জন্য রাখা অংশসহ) */
  bfree: number;
  /** সাধারণ ব্যবহারকারীর জন্য আসলে যতটা খালি */
  bavail: number;
  bsize: number;
}

/**
 * ব্যবহৃত শতাংশ — `df`-এর সংজ্ঞা অনুযায়ী।
 *
 * ⚠️ হর হিসেবে `blocks` (মোট) নয়, `used + bavail` ধরা হয়। Linux-এ ext4
 *    ডিফল্টে ৫% ব্লক root-এর জন্য সরিয়ে রাখে; মোট দিয়ে ভাগ করলে বেরোনো
 *    সংখ্যাটা `df`-এর সাথে মিলত না, আর ডিস্ক আসলে ভরে যাওয়ার পরেও আমাদের
 *    হিসাবে ৯৫% পেরোত না — অর্থাৎ ঠিক যে মুহূর্তে অ্যালার্টটা দরকার, তখনই
 *    সেটা আসত না।
 */
export function diskUsedPct(stats: DiskStats): number {
  const used = stats.blocks - stats.bfree;
  const usable = used + stats.bavail;
  if (!Number.isFinite(usable) || usable <= 0) return 0;
  return (used / usable) * 100;
}

export interface DiskVerdict {
  type: Extract<AlertType, 'disk_warning' | 'disk_critical'>;
  severity: 'warning' | 'critical';
}

/**
 * ⭐ দুটো আলাদা `type` ব্যবহার করা ইচ্ছাকৃত।
 *
 * ৮০% পেরোনোর পর ৬ ঘণ্টায় একটা করে সতর্কতা যায়। ডিস্ক ৯৫%-এ পৌঁছালে
 * type বদলে যায় বলে throttle-এর key-ও বদলে যায় — ফলে গুরুতর খবরটা
 * সাথে সাথেই পৌঁছায়, আগের সতর্কতার ছায়ায় চাপা পড়ে থাকে না।
 */
export function diskVerdict(usedPct: number): DiskVerdict | null {
  if (usedPct >= DISK_CRITICAL_PCT) {
    return { type: 'disk_critical', severity: 'critical' };
  }
  if (usedPct >= DISK_WARN_PCT) {
    return { type: 'disk_warning', severity: 'warning' };
  }
  return null;
}

/** বাইট → মানুষের পড়ার মতো (অ্যালার্টের বার্তায় যায়) */
export function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// ════════════════════════════════════════════════════════════════════════════
// ৬. G06 — কেউ পুরো দিন কোনো কাজ করেনি
// ════════════════════════════════════════════════════════════════════════════

export function isNoActivityWindow(
  now: Date,
  fromHour = NO_ACTIVITY_FROM_HOUR,
  toHour = NO_ACTIVITY_TO_HOUR,
): boolean {
  const hour = dhakaHourOf(now);
  return hour >= fromHour && hour < toHour;
}

export interface NoActivityInput {
  /** আজ ওই কর্মীর কতগুলো `counts_as_work` সেগমেন্ট আছে */
  workedSegments: number;
  /** কর্মীর পলিসির সাপ্তাহিক ছুটি (ISO দিন), না থাকলে null */
  weeklyOffDay: number | null;
  /** আজ ক্যালেন্ডারে ছুটি কি না */
  isHoliday: boolean;
  joinedOn: Date | null;
  leftOn: Date | null;
  now: Date;
}

/**
 * ⭐ এই ফাংশনের আসল কাজ **না** বলা।
 *
 * "আজ কেউ কাজ করেনি" প্রশ্নের সোজা উত্তরটা প্রায়ই সঠিক অথচ অর্থহীন — শুক্রবার,
 * ঈদের ছুটি, বা যে গতকাল যোগ দিয়েছে। ⚠️ ছুটির দিন বাদ না দিলে প্রতি শুক্রবার
 * বারোটা মিথ্যা অ্যালার্ট যেত; মাসে চারবার। ওই অভ্যাসেই মানুষ অ্যালার্ট
 * ফোল্ডারটা না-পড়া অবস্থায় রেখে দেয়।
 *
 * ⚠️ ছুটির দিন "বাদ" মানে শুধু অ্যালার্ট না দেওয়া — ওইদিন কেউ কাজ করলে তার
 *    ঘণ্টা পুরোপুরিই গোনা হয় (§ ২.১-খ, ছুটি কোনো ব্লক নয়)।
 */
export function shouldFlagNoActivity(input: NoActivityInput): boolean {
  const { workedSegments, weeklyOffDay, isHoliday, joinedOn, leftOn, now } =
    input;

  if (workedSegments > 0) return false;
  if (!isNoActivityWindow(now)) return false;
  if (isHoliday) return false;
  if (weeklyOffDay !== null && dhakaIsoWeekday(now) === weeklyOffDay) {
    return false;
  }

  const today = workDateOf(now).getTime();
  // যোগ দেওয়ার আগের দিনগুলোয় কাজ না থাকাই স্বাভাবিক
  if (joinedOn && joinedOn.getTime() > today) return false;
  // ⚠️ `<` — চাকরির শেষ দিনটাও কর্মদিবস, তাই সেদিন কাজ না থাকলে অ্যালার্ট হবে
  if (leftOn && leftOn.getTime() < today) return false;

  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// ৬ক. G32 — একই স্টাফের দুটো ডিভাইস একসাথে
// ════════════════════════════════════════════════════════════════════════════

export interface OverlapInput {
  /** ওই দিনে ওই স্টাফের কতগুলো আলাদা ডিভাইস সেগমেন্ট পাঠিয়েছে */
  deviceCount: number;
  /** `overlapSec()` — দুই ডিভাইস একই ঘড়ির সময়ে কত সেকেন্ড চলেছে */
  overlapSec: number;
  /** ওই দিনের UNION করা কাজের সময় — বার্তায় প্রেক্ষাপট দিতে */
  workedSec: number;
}

/**
 * **G32** — অ্যালার্ট উঠবে কি না।
 *
 * ⭐ <b>দোরগোড়াটা ১৫ মিনিট, আর সেটা ইচ্ছাকৃতভাবে উঁচু।</b> দুটো মেশিনে
 * কয়েক মিনিটের overlap একেবারে স্বাভাবিক: ডেস্কটপ লক না করে ল্যাপটপ নিয়ে
 * মিটিংয়ে যাওয়া, বা একটা মেশিনের সেগমেন্ট বন্ধ হওয়ার আগেই আরেকটায় কাজ শুরু।
 * ⚠️ দোরগোড়া ছোট করলে (ধরা যাক ১ মিনিট) প্রায় রোজই সবার নামে অ্যালার্ট
 * উঠত — আর তখন এই অ্যালার্টটার মানেই থাকত না।
 *
 * ⚠️⚠️ severity `warning`, `critical` নয় — এবং এটা কোনো অভিযোগ **নয়**।
 * স্পেক (§ ২.১-গ) বলে সাধারণ কারণ দুটো: এক PC দুজন ব্যবহার করছে, অথবা
 * কোনো ভুলে-ফেলে-রাখা মেশিন চালু আছে। ঘণ্টার হিসাবে এর কোনো প্রভাব
 * পড়ে না — `worked_sec` এমনিতেই UNION, তাই সময় দুবার গোনা হয় না।
 * অ্যালার্টটা তাই তথ্য: <i>"এই দিনটার সংখ্যা দেখার আগে জেনে রাখুন"</i>।
 */
export function shouldFlagOverlap(
  input: OverlapInput,
  thresholdSec = OVERLAP_ALERT_SEC,
): boolean {
  // ⚠️ ডিভাইস একটা হলে `overlapSec` গাণিতিকভাবেই ০, তবু শর্তটা স্পষ্ট করে
  //    রাখা — ভবিষ্যতে হিসাবটা বদলালে এই পাহারাটা টিকে থাকে।
  if (input.deviceCount < 2) return false;

  return input.overlapSec >= thresholdSec;
}

// ════════════════════════════════════════════════════════════════════════════
// ৭. G07 — কোন অ্যালার্টগুলো এখন ইমেইলে যাবে
// ════════════════════════════════════════════════════════════════════════════

/** বিষয়ে যে লেবেলটা বসে */
export function severityLabel(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'warning':
      return 'Warning';
    default:
      return 'Info';
  }
}
