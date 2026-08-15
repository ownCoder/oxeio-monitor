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
/**
 * ⚠️⚠️ **`AGENT_DOWN_AFTER_SEC` তুলে দেওয়া হয়েছে** (ছিল ৬০০ সে.)।
 *
 * ওটা দিয়ে ঠিক হতো এজেন্ট "মরেছে" কি না — কেবল কত সময় চুপ, সেটা দেখে।
 * ⚠️ কিন্তু চুপ থাকার **দৈর্ঘ্য** কোনোদিনই বলতে পারে না ঘটনাটা কী: রাত
 * ন-টায় সবাই দশ ঘণ্টা চুপ, আর তাদের PC ঠিকঠাক বন্ধই আছে। ফলে রোজ
 * সন্ধ্যায় গোটা দল 🔴 হয়ে যেত (১৫ আগস্ট মাঠে ধরা পড়েছে), আর তাতে লাল
 * রঙের মানেই হারিয়ে যেত।
 *
 * ⭐ এখন প্রশ্নটা **শেষ কথাটার** — `decideLiveStatus()` দেখুন। ধ্রুবকটা
 * রেখে দিলে পরের পাঠক ধরে নিতেন নিয়মটা এখনো সময়ের, তাই মুছে ফেলাই সৎ।
 */
export const OFFLINE_AFTER_SEC = 90;

/** কার্ডের চারটি রঙ (E01)। SegmentState-এর `locked` এখানে `idle`-এ মেশে। */
export type LiveStatus = 'active' | 'idle' | 'offline' | 'agent_down';

/**
 * একটা ডিভাইস সম্পর্কে বোর্ডের জানা সবটুকু (`devices` সারির তিনটে কলাম)।
 *
 * ⚠️ তিনটে তিনটে **আলাদা** প্রশ্নের উত্তর, আর গুলিয়ে ফেললে বোর্ড কোনো এরর
 *    ছাড়াই ভুল রঙ দেখাবে:
 *    · `lastSeenAt`  — এজেন্ট বেঁচে আছে কি না (এজেন্টের *যেকোনো* রিকোয়েস্টে বসে)
 *    · `lastState`   — সে শেষবার কী বলেছিল (শুধু heartbeat-এ বসে)
 *    · `lastStateAt` — **কখন** বলেছিল, অর্থাৎ কথাটা এখনো বিশ্বাসযোগ্য কি না
 */
export interface DeviceReport {
  /**
   * ⚠️ revoked ডিভাইসও এখন তালিকায় **আসে** — আগে কোয়েরিতেই ছাঁকা হতো।
   * ছেঁকে ফেললে "কখনো বসেনি" আর "বন্ধ করে দেওয়া" আলাদা করা যেত না।
   */
  status: 'active' | 'revoked';
  lastSeenAt: Date | null;
  lastState: SegmentState | null;
  lastStateAt: Date | null;
}

/**
 * ⭐ এজেন্টের **উপস্থিতি** — রঙ নয়, ব্যাখ্যা।
 *
 * ⚠️⚠️ তিনটেই বোর্ডে ধূসর "Offline" দেখায়, কিন্তু মালিকের করণীয় তিন রকম।
 * আগে তফাতটা ছিলই না, আর ফল ছিল একটা **স্ববিরোধী কার্ড**: উপরে ১৬:৫০-এর
 * স্ক্রিনশট, নিচে *"Never checked in"* — একই কার্ডে দুটো পরস্পরবিরোধী কথা।
 */
export type AgentPresence =
  /** কখনো এজেন্ট বসানোই হয়নি — নতুন কর্মী, PC এখনো দেওয়া হয়নি */
  | 'never_installed'
  /**
   * ডিভাইস আছে, কিন্তু সবগুলোই বন্ধ করে দেওয়া (H06)।
   *
   * ⚠️ কর্মী **নিষ্ক্রিয় করলেও** এটা ঘটে — `deactivate()` তাঁর সব ডিভাইস
   * revoke করে, আর `reactivate()` ইচ্ছাকৃতভাবে সেগুলো ফেরায় না।
   */
  | 'switched_off'
  /** অন্তত একটা সচল ডিভাইস আছে */
  | 'installed';

export interface LiveStatusInput {
  /**
   * ওই কর্মীর **সব সচল (non-revoked) ডিভাইস**।
   * ⚠️ ডিভাইসপ্রতি আলাদা করে বিচার করলে ডেস্কটপ বন্ধ থাকলেই ল্যাপটপে কাজ
   * করা কর্মীকে offline দেখাত (§ ২.১-গ — একজনের একাধিক ডিভাইস)।
   */
  devices: readonly DeviceReport[];
  /**
   * শেষ `activity_segments` সারির state — **শুধু fallback**।
   *
   * ⚠️ এটাকে প্রথম পছন্দ করা যায় না: এজেন্ট সেগমেন্ট **ব্যাচে** পাঠায়, তাই
   * সারিটা কয়েক মিনিট পুরোনো হতে পারে — কর্মী তিন মিনিট আগে উঠে গেলেও
   * কার্ড সবুজ থাকত। আবার একেবারে বাদও দেওয়া যায় না: `last_state` কলামটা
   * নতুন, তাই মাইগ্রেশনের পরে (বা এখনো heartbeat না পাঠানো এজেন্টে) ওটা
   * null — তখন এই অনুমানই একমাত্র খবর।
   */
  fallbackState: SegmentState | null;
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
/**
 * ⚠️ শুধু গোনার জন্য নয় — এই এক লাইনটাই ঠিক করে কার্ডে কী **লেখা** হবে।
 */
export function agentPresence(devices: readonly DeviceReport[]): AgentPresence {
  if (devices.length === 0) return 'never_installed';
  if (devices.some((d) => d.status === 'active')) return 'installed';

  return 'switched_off';
}

export function decideLiveStatus(input: LiveStatusInput): LiveStatus {
  const { fallbackState, now } = input;

  /**
   * ⚠️⚠️ বাতিল ডিভাইস এখানে **গোনা হয় না** — আগে কোয়েরিই ওগুলো বাদ দিত,
   * এখন বাদ দেওয়াটা এখানে, স্পষ্ট করে। না ছাঁকলে বহু মাস আগে বন্ধ করা
   * একটা মেশিনের পুরোনো `lastSeenAt` কর্মীকে "সবুজ" দেখাত।
   */
  const devices = input.devices.filter((d) => d.status === 'active');

  // ⚠️ সচল ডিভাইস নেই মানে এজেন্ট "পড়ে গেছে" নয় — হয় নতুন কর্মী (PC
  //    এখনো দেওয়া হয়নি), নয় ডিভাইসটা বন্ধ করে দেওয়া হয়েছে। দুটোর
  //    কোনোটাই লাল অ্যালার্মের মতো জরুরি নয়, আর ভুয়া লাল জ্বললে লাল
  //    রঙের মানেই হারিয়ে যেত। তফাতটা `agentPresence` লেখায় বলে।
  if (devices.length === 0) return 'offline';

  const lastSeenAt = latestHeartbeat(devices);

  // ডিভাইস আছে কিন্তু একবারও সাড়া দেয়নি — ইনস্টল হয়েও চালু হয়নি,
  // অর্থাৎ ঠিক যে জিনিস 🔴 ধরার কথা।
  if (lastSeenAt === null) return 'agent_down';

  const ageSec = secondsSince(lastSeenAt, now);

  /**
   * ⭐⭐ **চুপ হয়ে যাওয়া এজেন্ট: মরেছে, না বাড়ি গেছে?**
   *
   * ⚠️⚠️ এখানে আগে কেবল ঘড়ি দেখা হতো — `> ৬০০ সে.` হলেই `agent_down`,
   * নইলে `offline`। ফলে `offline` কেবল ৯০ সে. থেকে ১০ মিনিটের **সরু
   * জানালাতেই** সম্ভব ছিল, আর তার পরে সবাই চিরকালের জন্য লাল।
   *
   * ⚠️⚠️ পরিণতিটা রোজকার, আর মাঠে ধরা পড়েছে: **প্রতিদিন সন্ধ্যায়, সবাই
   * বাড়ি যাওয়ার দশ মিনিট পর গোটা দল 🔴 হয়ে যেত।** ১৫ আগস্ট সন্ধ্যায়
   * বোর্ড দেখাচ্ছিল `Agent down 12`, `Offline 0` — অথচ কিছুই ভাঙেনি,
   * অফিস ছুটি হয়েছিল। আর এভাবেই **লাল রঙের মানেই হারিয়ে যায়**, যেটা
   * ঠেকাতে এই ফাইলের বাকি সব নিয়ম লেখা।
   *
   * ⭐ এখন প্রশ্নটা ঘড়ির নয়, **শেষ কথাটার**: এজেন্ট চুপ হওয়ার আগে
   * সর্বশেষ কী বলেছিল?
   *
   *   `idle` / `locked` বলে চুপ  →  offline   (কেউ উঠে গেছে, তারপর PC বন্ধ)
   *   `active` বলে হঠাৎ চুপ      →  agent_down (কাজের মাঝপথে থেমেছে)
   *
   * ⚠️ `active` অবস্থায় চুপ হওয়াটাই আসল সংকেত: ঠিক তখনই ঘণ্টা হারায়।
   * কেউ কাজ শেষ করে PC বন্ধ করলে তার আগে অন্তত এক মিনিট নিষ্ক্রিয় থাকে
   * (idle threshold ৬০ সে.), তাই শেষ কথাটা প্রায় সবসময় `idle` বা `locked`।
   *
   * ⚠️ **শেষ কথা না জানা থাকলে (`null`) — `agent_down`।** "জানি না"-কে
   * নিরীহ ধরে নেওয়া মানে ইনস্টল হয়েও কোনোদিন চালু না হওয়া এজেন্ট চুপচাপ
   * ⚪ হয়ে থাকত, আর ঠিক ওই কেসটা ধরার জন্যই ফিচারটা।
   */
  if (ageSec > OFFLINE_AFTER_SEC) {
    const parted = partingState(devices);
    return parted === 'idle' || parted === 'locked' ? 'offline' : 'agent_down';
  }

  // ⭐ এজেন্ট নিজে যা বলেছে সেটাই প্রথম সত্য; সেগমেন্ট থেকে অনুমান কেবল
  //    তখনই, যখন এজেন্ট কিছু বলেনি বা তার কথাটা বাসি হয়ে গেছে।
  const state = freshReportedState(devices, now) ?? fallbackState;

  // ⚠️ এজেন্ট জীবিত, কিন্তু কেউ কিছু বলেনি (পুরোনো এজেন্ট, আর ব্যাচও এখনো
  //    পৌঁছায়নি)। "জানি না"-কে active দেখানো যাবে না — না-জানা সময় কখনো
  //    কাজের সময় হিসেবে দাবি করা হয় না।
  if (state === null) return 'idle';

  // `locked` আলাদা রঙ পায় না — বোর্ডে মাত্র চারটে রঙ, আর স্টাফের দিক থেকে
  // PC লক করা আর নিষ্ক্রিয় বসে থাকা একই: কোনোটাই কাজের সময় নয়।
  return state === 'active' ? 'active' : 'idle';
}

/**
 * ⭐ **চুপ হওয়ার ঠিক আগে এজেন্ট সর্বশেষ যে অবস্থা জানিয়েছিল।**
 *
 * ⚠️ যে ডিভাইসটা **সবচেয়ে পরে** সাড়া দিয়েছে তারটাই নেওয়া হয় — একজনের
 * দুটো PC থাকলে ডেস্কটপ সকালে `active` বলে বন্ধ হয়ে গেলেও সন্ধ্যায়
 * ল্যাপটপের `idle` কথাটাই শেষ কথা।
 *
 * ⚠️ `lastStateAt` **দেখা হয় না**, ইচ্ছাকৃত: প্রশ্নটা "কথাটা কত পুরোনো"
 * নয় — এজেন্ট তো চুপই, কথাটা পুরোনো হবেই। প্রশ্নটা "**শেষ** কথাটা কী ছিল"।
 */
function partingState(
  devices: readonly DeviceReport[],
): SegmentState | null {
  let latest: DeviceReport | null = null;
  for (const d of devices) {
    if (d.lastSeenAt === null) continue;
    if (latest?.lastSeenAt == null || d.lastSeenAt > latest.lastSeenAt) {
      latest = d;
    }
  }
  return latest?.lastState ?? null;
}

/**
 * কর্মীর সব ডিভাইসের মধ্যে সবচেয়ে সাম্প্রতিক `lastSeenAt`।
 *
 * কার্ডের `lastHeartbeatAt`-ও এটাই — এক জায়গায় রাখা হয়েছে যাতে "কত আগে
 * সাড়া দিয়েছিল" লেখাটা আর রঙটা কোনোদিন দুই হিসাব থেকে না আসে।
 */
export function latestHeartbeat(devices: readonly DeviceReport[]): Date | null {
  let latest: Date | null = null;
  for (const d of devices) {
    // ⚠️ বাতিল ডিভাইসের পুরোনো heartbeat গোনা হয় না — নইলে বন্ধ করে
    //    দেওয়া মেশিনের সাত দিন আগের সাড়া "Seen 7 days ago" হয়ে দেখাত,
    //    অথচ ওটা আর কোনোদিন সাড়া দেবে না।
    if (d.status !== 'active') continue;
    if (d.lastSeenAt === null) continue;
    if (latest === null || d.lastSeenAt.getTime() > latest.getTime()) {
      latest = d.lastSeenAt;
    }
  }
  return latest;
}

/**
 * ⭐ heartbeat-এ বলা state, **যদি সেটা এখনো টাটকা হয়** — নইলে null।
 *
 * ⚠️ বাসি রিপোর্ট বিশ্বাস করা যায় না। এজেন্ট মরে যাওয়ার মুহূর্তে সে
 *    `active` বলে গিয়েছিল; ওই মানটা কলামে বসে থাকে চিরকাল। মেয়াদ না বসালে
 *    বন্ধ PC-র কার্ড **সবুজ হয়েই আটকে থাকত** — আর সেটা offline দেখানোর
 *    চেয়েও খারাপ, কারণ তখন না-কাজের সময় কাজ বলে দাবি করা হতো।
 *
 * ⚠️ মেয়াদ ইচ্ছাকৃতভাবে `OFFLINE_AFTER_SEC`-ই, আলাদা কোনো ধ্রুবক নয়:
 *    রিপোর্ট এর চেয়ে পুরোনো মানে এজেন্ট ততক্ষণ চুপ ছিল, আর চুপ থাকার
 *    মানে এই ফাইলে একটাই। দুটো নব থাকলে একদিন একটা বদলাত, আরেকটা নয়।
 *
 * ⚠️ একাধিক ডিভাইসে **যেকোনো একটা** সচল রিপোর্ট `active` হলেই কর্মী active
 *    — "সবচেয়ে সাম্প্রতিকটা নাও" নয়। ডেস্কটপ লক করে ল্যাপটপে কাজ করলে
 *    দুটো ডিভাইসই প্রতি ৩০ সেকেন্ডে heartbeat পাঠায়, তাই "সবচেয়ে
 *    সাম্প্রতিক" কার্যত এলোমেলো — কার্ডের রঙ রিফ্রেশে রিফ্রেশে সবুজ-ধূসর
 *    করত, অথচ কর্মী একটানা কাজ করছে।
 */
export function freshReportedState(
  devices: readonly DeviceReport[],
  now: Date,
): SegmentState | null {
  let bestState: SegmentState | null = null;
  let bestAtMs = -Infinity;

  for (const { lastState, lastStateAt } of devices) {
    if (lastState === null || lastStateAt === null) continue;
    if (secondsSince(lastStateAt, now) > OFFLINE_AFTER_SEC) continue;

    if (lastState === 'active') return 'active';
    if (lastStateAt.getTime() > bestAtMs) {
      bestAtMs = lastStateAt.getTime();
      bestState = lastState;
    }
  }
  return bestState;
}

/**
 * ⚠️ ঋণাত্মক হতে পারে এবং সেটাই চাওয়া — ডিভাইসের ঘড়ি সামান্য এগিয়ে থাকলে
 * (drift) "ভবিষ্যতের" heartbeat আসে, আর `Math.abs` বসালে সেটা পুরোনো মনে
 * হয়ে সুস্থ এজেন্টকে offline দেখাত।
 */
function secondsSince(then: Date, now: Date): number {
  return (now.getTime() - then.getTime()) / MS;
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

/** এক ঘণ্টায় গোটা দলের ছবি */
export interface TeamHour {
  /** ঢাকার স্থানীয় ঘণ্টা, ০–২৩ */
  hour: number;
  /** ওই ঘণ্টায় দলের মোট গোনা সেকেন্ড */
  activeSec: number;
  /**
   * ওই ঘণ্টায় **কতজন** কিছু না কিছু কাজ করেছেন।
   *
   * ⭐ দুটো সংখ্যা আলাদা করে রাখা দরকার, কারণ একা `activeSec` প্রশ্নটার
   * অর্ধেক উত্তর দেয়: ৪ ঘণ্টা মানে চারজন এক ঘণ্টা, নাকি একজন চার ঘণ্টা?
   * cockpit-এ পার্থক্যটা গুরুত্বপূর্ণ — প্রথমটা স্বাভাবিক সকাল, দ্বিতীয়টা
   * একজনের একা কাজ করা রাত।
   */
  people: number;
}

interface TeamHourInput extends HourSpreadInput {
  employeeId: number;
}

/**
 * ⭐ E01 — গোটা দলের দিনের ছন্দ, ২৪টা বালতিতে।
 *
 * ⚠️ **কর্মীপ্রতি আলাদা করে ছড়ানো হয়, একসাথে নয়** — আর এটাই এখানকার
 *    একমাত্র সূক্ষ্ম সিদ্ধান্ত। সব সেগমেন্ট এক গাদা করে
 *    `spreadIntoHourBuckets`-এ দিলে মোট সেকেন্ড ঠিকই আসত, কিন্তু
 *    **কতজন** সেটা আর বের করা যেত না — বালতিতে ঢোকার পর সেগমেন্টগুলো
 *    আর কার, তা জানা যায় না।
 *
 * ⭐ ছড়ানোর নিয়মটা হুবহু একই ফাংশন (`spreadIntoHourBuckets`) থেকে আসে,
 *    তাই একজনের `/hourly` চার্ট আর দলের ছন্দ কখনো আলাদা গল্প বলবে না।
 *    নিয়মটা নকল করলে একদিন একটা বদলাত আর অন্যটা নয়।
 *
 * ⚠️ `people` গোনা হয় `> 0` দিয়ে, কোনো সীমা ছাড়া। এক সেকেন্ডও যদি ওই
 *    ঘণ্টায় পড়ে, মানুষটা "ছিলেন" — সীমা বসালে সেটা হতো একটা নীরব মত,
 *    আর কেউ জানত না কেন ভোর ৬টার একজন উধাও।
 */
export function spreadTeamIntoHourBuckets(
  segments: readonly TeamHourInput[],
  workDate: Date,
): TeamHour[] {
  const byEmployee = new Map<number, TeamHourInput[]>();
  for (const seg of segments) {
    const list = byEmployee.get(seg.employeeId);
    if (list) list.push(seg);
    else byEmployee.set(seg.employeeId, [seg]);
  }

  const activeSec = new Array<number>(HOURS_PER_DAY).fill(0);
  const people = new Array<number>(HOURS_PER_DAY).fill(0);

  for (const own of byEmployee.values()) {
    const buckets = spreadIntoHourBuckets(own, workDate);
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      activeSec[h] += buckets[h];
      if (buckets[h] > 0) people[h] += 1;
    }
  }

  return activeSec.map((sec, hour) => ({
    hour,
    activeSec: sec,
    people: people[hour],
  }));
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
