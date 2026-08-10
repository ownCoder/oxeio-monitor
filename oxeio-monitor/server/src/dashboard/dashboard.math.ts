/**
 * লাইভ বোর্ড (E01/E02) ও টাইমলাইনের (E04/E05) খাঁটি হিসাব — কোনো I/O নেই।
 *
 * আলাদা ফাইলে রাখার কারণ payroll.math-এর মতোই: এই তিনটে নিয়ম
 * (স্ট্যাটাস নির্ধারণ · ঘণ্টার বালতিতে ভাগ · তারিখ parse) ভুল হলে
 * ড্যাশবোর্ড **কোনো এরর দেখাবে না** — শুধু নীরবে ভুল সংখ্যা দেখাবে।
 * ডাটাবেস ছাড়া পরীক্ষা করা যায় বলেই ভুলগুলো এখানে ধরা পড়ে।
 */
import type { SegmentState } from '@prisma/client';

import { DHAKA_OFFSET_MIN } from '../agent/util/dhaka-time';

const MS = 1000;
const HOUR_MS = 3600 * MS;
const OFFSET_MS = DHAKA_OFFSET_MIN * 60 * MS;

export const HOURS_PER_DAY = 24;

/**
 * ⚠️ এজেন্ট বন্ধ (🔴) আর কর্মী চলে গেছে (⚪) — দুটো সম্পূর্ণ আলাদা ঘটনা।
 * প্রথমটা IT-র সমস্যা, দ্বিতীয়টা স্বাভাবিক। একটাকে আরেকটার রঙে দেখালে
 * হয় মিথ্যা অভিযোগ হয়, নয় আসল সমস্যা চাপা পড়ে।
 */
export const AGENT_DOWN_AFTER_SEC = 600;
export const OFFLINE_AFTER_SEC = 90;

/** কার্ডের চারটি রঙ (E01)। SegmentState-এর `locked` এখানে `idle`-এ মেশে। */
export type LiveStatus = 'active' | 'idle' | 'offline' | 'agent_down';

export interface LiveStatusInput {
  /**
   * ওই কর্মীর **সব সচল ডিভাইসের মধ্যে সবচেয়ে সাম্প্রতিক** `lastSeenAt`।
   * ⚠️ ডিভাইসপ্রতি আলাদা করে দেখলে ডেস্কটপ বন্ধ থাকলেই ল্যাপটপে কাজ করা
   * কর্মীকে offline দেখাত (§ ২.১-গ — একজনের একাধিক ডিভাইস)।
   */
  lastSeenAt: Date | null;
  /** কোনো সচল (non-revoked) ডিভাইস আদৌ আছে কি না */
  hasDevice: boolean;
  /** শেষ পাওয়া সেগমেন্টের state — না জানা থাকলে null */
  lastState: SegmentState | null;
  now: Date;
}

/**
 * ⭐ কার্ডের রঙ ঠিক করার একমাত্র জায়গা।
 *
 * ⚠️ ক্রমটাই আসল কথা: **আগে agent_down, তারপর offline**। উল্টো লিখলে
 * ১০ ঘণ্টা ধরে মরে থাকা এজেন্টও `> ৯০ সে.` শর্তে আটকে গিয়ে নিরীহ ⚪
 * দেখাত — 🔴 কোনোদিন উঠত না, আর ঠিক যে অবস্থাটা ধরার জন্য এই ফিচার,
 * সেটাই অদৃশ্য থাকত।
 */
export function decideLiveStatus(input: LiveStatusInput): LiveStatus {
  const { lastSeenAt, hasDevice, lastState, now } = input;

  // ⚠️ ডিভাইসই নেই মানে এজেন্ট "পড়ে গেছে" নয় — নতুন কর্মী, PC এখনো দেওয়া
  //    হয়নি। এটাকে agent_down দেখালে প্রথম দিন থেকেই ভুয়া লাল অ্যালার্ম
  //    জ্বলত এবং লাল রঙের মানেই হারিয়ে যেত।
  if (!hasDevice) return 'offline';

  // ডিভাইস আছে কিন্তু একবারও সাড়া দেয়নি — ইনস্টল হয়েও চালু হয়নি,
  // অর্থাৎ ঠিক যে জিনিস 🔴 ধরার কথা।
  if (lastSeenAt === null) return 'agent_down';

  const ageSec = (now.getTime() - lastSeenAt.getTime()) / MS;

  if (ageSec > AGENT_DOWN_AFTER_SEC) return 'agent_down';
  if (ageSec > OFFLINE_AFTER_SEC) return 'offline';

  // ⚠️ এজেন্ট জীবিত, কিন্তু সাম্প্রতিক কোনো সেগমেন্ট আসেনি (ব্যাচ এখনো
  //    পৌঁছায়নি বা সত্যিই কিছু ঘটেনি)। "জানি না"-কে active দেখানো যাবে না —
  //    না-জানা সময় কখনো কাজের সময় হিসেবে দাবি করা হয় না।
  if (lastState === null) return 'idle';

  // `locked` আলাদা রঙ পায় না — বোর্ডে মাত্র চারটে রঙ, আর স্টাফের দিক থেকে
  // PC লক করা আর নিষ্ক্রিয় বসে থাকা একই: কোনোটাই কাজের সময় নয়।
  return lastState === 'active' ? 'active' : 'idle';
}

/** ঢাকার ওই তারিখের স্থানীয় মধ্যরাত, UTC instant হিসেবে। */
function dayStartUtcMs(workDate: Date): number {
  return workDate.getTime() - OFFSET_MS;
}

export interface HourSpreadInput {
  startedAt: Date;
  endedAt: Date;
  /** monotonic ঘড়ি থেকে আসা প্রকৃত দৈর্ঘ্য (§ ৩.২) */
  durationSec: number;
}

/**
 * ⭐ E05 — একটা সেগমেন্টকে ২৪টা ঘণ্টা-বালতিতে **অনুপাতে** ছড়িয়ে দেওয়া।
 *
 * ⚠️ পুরো সেগমেন্টটা তার শুরুর ঘণ্টায় ফেলে দেওয়া সবচেয়ে সহজ ভুল।
 *    ১০:৪৫ থেকে ১২:১৫ পর্যন্ত ৯০ মিনিট কাজ তখন দেখাত "১০টায় ৯০ মিনিট" —
 *    অর্থাৎ এক ঘণ্টার বালতিতে দেড় ঘণ্টা, আর ১১টার ঘরে শূন্য। চার্টটা
 *    দেখতে ঠিকঠাক থাকত, কিন্তু বলত সম্পূর্ণ ভুল গল্প।
 *
 * ⭐ ভাগ করা হয় `durationSec`-কে, দেয়ালঘড়ির ব্যবধানকে নয় — কিন্তু **অনুপাত**
 *    আসে দেয়ালঘড়ি থেকে। কারণ দুটো সংখ্যা এক নয়: durationSec monotonic
 *    ঘড়ির (PC-র ঘড়ি বদলালেও অটুট), আর ঘণ্টার সীমানা দেয়ালঘড়ির। এভাবে
 *    চার্টের মোট সবসময় টাইমলাইনের মোটের সমান থাকে — দুই স্ক্রিনে দুই
 *    সংখ্যা দেখা গেলে কোনটা সত্যি সেটা আর প্রমাণ করা যেত না।
 */
export function spreadIntoHourBuckets(
  segments: readonly HourSpreadInput[],
  workDate: Date,
): number[] {
  const buckets = new Array<number>(HOURS_PER_DAY).fill(0);
  const dayStart = dayStartUtcMs(workDate);
  const dayEnd = dayStart + HOURS_PER_DAY * HOUR_MS;

  for (const seg of segments) {
    if (seg.durationSec <= 0) continue;

    // § ২.১-ক অনুযায়ী সেগমেন্ট মধ্যরাত পার হওয়ার কথা নয়, তবু clamp করা হয় —
    // পুরোনো এজেন্টের পাঠানো ডেটা সার্ভার ভাগ করার আগেই ঢুকে থাকতে পারে।
    const start = Math.max(seg.startedAt.getTime(), dayStart);
    const end = Math.min(seg.endedAt.getTime(), dayEnd);
    const span = end - start;

    if (span <= 0) {
      // দেয়ালঘড়ির ব্যবধান শূন্য বা উল্টো (ঘড়ি পিছিয়ে গেছে) — অনুপাত বের
      // করা যায় না, তাই পুরোটা শুরুর ঘণ্টায়। সময়টা হারিয়ে ফেলার চেয়ে
      // এক বালতিতে থাকা ভালো, কারণ দিনের মোট তাহলেও ঠিক থাকে।
      const hour = hourIndexOf(seg.startedAt.getTime(), dayStart);
      if (hour !== null) buckets[hour] += seg.durationSec;
      continue;
    }

    // ⚠️ প্রতি ঘণ্টায় আলাদা করে Math.round করলে ২৪টা রাউন্ডিং জমে গিয়ে
    //    বালতির যোগফল durationSec-এর চেয়ে কয়েক সেকেন্ড কম-বেশি হতো।
    //    তাই **ক্রমযোজিত** (cumulative) হিসাব: প্রতিবার "এ পর্যন্ত মোট কত
    //    হওয়ার কথা" বের করে, আগে যা দেওয়া হয়েছে তার বাকিটুকু বসানো হয়।
    //    শেষ ঘণ্টায় covered === span, তাই যোগফল হুবহু durationSec-ই হয়।
    let coveredMs = 0;
    let assignedSec = 0;

    for (let h = 0; h < HOURS_PER_DAY; h++) {
      const hourStart = dayStart + h * HOUR_MS;
      const overlap =
        Math.min(end, hourStart + HOUR_MS) - Math.max(start, hourStart);
      if (overlap > 0) coveredMs += overlap;
      if (coveredMs === 0) continue;

      const targetSec = Math.round((seg.durationSec * coveredMs) / span);
      buckets[h] += targetSec - assignedSec;
      assignedSec = targetSec;

      if (coveredMs >= span) break;
    }
  }

  return buckets;
}

function hourIndexOf(instantMs: number, dayStartMs: number): number | null {
  const hour = Math.floor((instantMs - dayStartMs) / HOUR_MS);
  if (hour < 0 || hour >= HOURS_PER_DAY) return null;
  return hour;
}

/**
 * `?date=YYYY-MM-DD` → ওই কর্মদিবস, UTC-midnight Date হিসেবে
 * (Prisma-র `@db.Date` ঠিক এটাই চায়, workDateOf-ও এটাই ফেরত দেয়)।
 *
 * ⚠️ সরাসরি `new Date('2026-02-31')` লিখলে JS চুপচাপ ৩ মার্চ বানিয়ে দেয়।
 *    তখন ব্যবহারকারী ৩১ ফেব্রুয়ারি চেয়ে ৩ মার্চের ডেটা দেখত এবং বুঝতেই
 *    পারত না — তাই ফিরিয়ে দেওয়া মানগুলো আবার মিলিয়ে দেখা হয়।
 */
export function parseWorkDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
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

/**
 * কর্মদিবস → `YYYY-MM-DD`।
 *
 * ⚠️ `@db.Date` সরাসরি JSON-এ পাঠালে `2026-08-10T00:00:00.000Z` যেত।
 *    ঢাকায় ওই instant আসলে ১০ তারিখ ভোর ৬টা — ব্রাউজার সেটাকে স্থানীয়
 *    সময়ে দেখাতে গিয়ে কারো কারো কাছে আগের দিন দেখাত। তাই তারিখ সবসময়
 *    স্ট্রিং হিসেবেই যায়, Date হিসেবে নয়।
 */
export function formatWorkDate(workDate: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return [
    workDate.getUTCFullYear(),
    pad(workDate.getUTCMonth() + 1),
    pad(workDate.getUTCDate()),
  ].join('-');
}

/** ঢাকার ওই তারিখের মাসের ১ তারিখ — মাসিক রিং-এর শুরু (E02)। */
export function monthStartOf(workDate: Date): Date {
  return new Date(
    Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), 1),
  );
}

/** আগের কর্মদিবস — লাইভ বোর্ডে মধ্যরাতের আশেপাশের সেগমেন্ট ধরার জন্য। */
export function previousWorkDate(workDate: Date): Date {
  return new Date(workDate.getTime() - HOURS_PER_DAY * HOUR_MS);
}
