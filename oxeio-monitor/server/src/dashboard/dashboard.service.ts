import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SegmentState } from '@prisma/client';

import { nextLocalMidnight, workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import {
  decideLiveStatus,
  formatWorkDate,
  agentPresence,
  latestHeartbeat,
  type AgentPresence,
  monthStartOf,
  parseWorkDate,
  previousWorkDate,
  rankLaggards,
  spreadIntoHourBuckets,
  spreadTeamIntoHourBuckets,
  type DeviceReport,
  type LiveStatus,
  type TeamHour,
} from './dashboard.math';

import { isWorkday, monthBoundsOf } from '../reports/reports.range';
import { prorate } from '../summary/proration';
import { isObserved } from '../summary/summary.math';
import { designTargetOf } from '../summary/design.rules';
import { trackedFromBy } from '../summary/tracking-start';

const HOUR = 3600;

/**
 * fallback state বের করতে কত পুরোনো সেগমেন্ট পর্যন্ত দেখা হবে।
 *
 * এজেন্ট সেগমেন্ট **ব্যাচে** পাঠায়, তাই heartbeat তাজা হলেও শেষ সেগমেন্ট
 * কয়েক মিনিট পুরোনো হতে পারে। ১৫ মিনিট ধরা হয়েছে কারণ ৯০ সেকেন্ডের
 * বেশি পুরোনো heartbeat-এ এমনিতেই offline বসে যায় — অর্থাৎ এর চেয়ে বড়
 * জানালা রাখলেও উত্তর বদলাত না, শুধু বেশি সারি টানা হতো।
 */
const LIVE_STATE_LOOKBACK_SEC = 900;

/** কর্মীর একটাও সচল ডিভাইস না থাকলে — প্রতি কার্ডে নতুন অ্যারে বানানো নয় */
const NO_DEVICES: readonly DeviceReport[] = [];

/** ⚠️ ডিফল্ট মাসিক টার্গেট — পলিসি না থাকলে (§ ২.১-খ, ২০৮ ঘণ্টা) */
const DEFAULT_TARGET_HOURS = 208;

/**
 * ⚠️ দৈনিক টার্গেটের **হর**, পলিসি না থাকলে — `summary.service.ts`-এর
 * একই নামের ধ্রুবকের সাথে মিলিয়ে রাখা। দুটো আলাদা হলে এই কার্ড আর
 * `monthly_summary` আবার দুই সংখ্যা বলত, ঠিক যে রোগটা নিচে সারানো হয়েছে।
 */
const DEFAULT_POLICY_WORKDAYS = 26;

export interface LiveCard {
  employeeId: number;
  empCode: string;
  fullName: string;
  designation: string | null;
  /** ⭐ কাজের ধরন — কেবল এর উপরেই ডিজাইনের টার্গেট বসে (২১ আগস্ট) */
  staffType: 'designer' | 'researcher' | 'manager' | null;
  /**
   * ⭐⭐ **আজ কতগুলো নতুন ডিজাইন** — ডিজাইনার না হলে সবসময় ০।
   *
   * ⚠️ সংখ্যাটা `design_credits` থেকে, `daily_summary` থেকে নয় — দিনের
   * শুরুতে সারাংশের সারিটা এখনো নাও থাকতে পারে, আর তখন কার্ড "০" দেখাত
   * অথচ কাজ হয়েছে। দুটোই একই দাবি থেকে জন্মায়, তাই সংখ্যা এক।
   * ⚠️ হালনাগাদ হয় সারাংশ-রিফ্রেশে (১৫ মিনিট), অর্থাৎ **লাইভ নয়** —
   * ঘণ্টার মতো সেকেন্ডে সেকেন্ডে নড়ে না।
   */
  /** ⭐ আজ কতগুলো ডিজাইন-ফাইল **খোলা** হয়েছে (শিরোনামের নম্বর ধরে) */
  designsDone: number;
  /** ⭐ আজ কতগুলো বরাদ্দ টার্গেট **শেষ** বলা হয়েছে (Complete বোতাম) */
  designsFinished: number;
  /** ⚠️ ০ মানে টার্গেট বন্ধ; পর্দা তখন কিছুই দেখায় না */
  designTargetPerDay: number;
  status: LiveStatus;
  /** ঢাকার আজকের দিনে গোনা সেকেন্ড */
  todayWorkedSec: number;
  /**
   * ⭐ এক কর্মদিবসের টার্গেট — Live Board-এর রিং এখন **এটার** বিপরীতে।
   *
   * ⚠️ ৮ ঘণ্টা কোনো ধ্রুবক **নয়**, বের করা সংখ্যা: মাসিক টার্গেট ÷ ওই
   * মাসের কর্মদিবস। আগস্ট ২০২৬-এ ২০৮ ÷ ২৬ = ৮ ঘণ্টা, কিন্তু ২৭ কর্মদিবসের
   * মাসে ৭ঘ ৪২মি। ক্লায়েন্টে ৮ হার্ডকোড করলে কোনো কোনো মাসে টার্গেট
   * নীরবে ভুল দেখাত — আর ঠিক এই ভুলটাই মাসিক পাতায় ধরা পড়েছে (২০৮ vs ২১৬)।
   *
   * সংজ্ঞাটা রিপোর্টের সাথে **একই ফাংশন** থেকে আসে, নইলে দুটো পাতা দুই
   * রকম টার্গেট দেখাত।
   */
  dailyTargetSec: number;

  /**
   * আজ কর্মদিবস কি না (সাপ্তাহিক ছুটি বা সরকারি ছুটি নয়)।
   * ⚠️ ছুটির দিনে "০ / ৮ ঘণ্টা" দেখানো অন্যায় — ওই দিনে কারো কিছু করার কথাই নয়।
   */
  todayIsWorkday: boolean;

  /**
   * ⭐⭐ **G130 (R2)** — আজ তিনি অনুমোদিত ছুটিতে কি না।
   *
   * ⚠️⚠️ ছুটি সংখ্যায় আগেই পৌঁছেছে (তাঁর টার্গেট কম, কেউ তাঁকে "পিছিয়ে"
   * দেখায় না), কিন্তু কার্ডে **কিছুই লেখা ছিল না**। ফলে ছুটির দিনটা দেখতে
   * হুবহু একটা অফলাইন কর্মীর মতো: ধূসর, শূন্য ঘণ্টা, কোনো heartbeat নেই।
   * মালিক কার্ডটা দেখে ভাবতেন এজেন্ট বন্ধ, অথচ মানুষটা ছুটিতে।
   *
   * ⚠️ `todayIsWorkday`-র সাথে মেশানো হয়নি: ওটা **অফিসের** ক্যালেন্ডার
   * (শুক্রবার · সরকারি ছুটি), আর এটা **ওই একজনের**। মিশিয়ে ফেললে
   * "আজ ক-জন ছুটিতে" আর গোনা যেত না, আর ছুটির দিনের বার্তাটাও ভুল হতো।
   *
   * ⚠️ `leaves` টেবিল সরাসরি — কোনো কলামে লেখা হয় না, তাই ছুটি বাতিল
   * করলে ব্যাজ পরের রিফ্রেশেই চলে যায়, rollup-এর অপেক্ষায় থাকে না।
   */
  onLeaveToday: boolean;

  /** মাসের হিসাব — এখন গৌণ, কিন্তু বেতনের ভিত্তি এটাই */
  monthWorkedSec: number;
  monthTargetSec: number;
  /** শেষ heartbeat — কোনো **সচল** ডিভাইস সাড়া না দিলে null */
  lastHeartbeatAt: Date | null;

  /**
   * ⭐ `lastHeartbeatAt === null` কেন — সেটার ব্যাখ্যা।
   *
   * ⚠️ এটা ছাড়া পর্দা "কখনো সাড়া দেয়নি" লিখত, অথচ কারণটা হতে পারত
   * "ডিভাইসটা বন্ধ করে দেওয়া হয়েছে" — দুটোর করণীয় সম্পূর্ণ আলাদা।
   */
  agentPresence: AgentPresence;
}

export interface LiveBoard {
  /** ঢাকার আজকের কর্মদিবস, `YYYY-MM-DD` */
  workDate: string;
  generatedAt: Date;
  cards: LiveCard[];
}

export interface TimelineSegment {
  /** ⚠️ BigInt স্ট্রিং হিসেবে — কারণ নিচে দেখো */
  id: string;
  deviceId: number;
  state: SegmentState;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
}

export interface Timeline {
  employeeId: number;
  empCode: string;
  fullName: string;
  date: string;
  segments: TimelineSegment[];
  totals: { activeSec: number; idleSec: number; lockedSec: number };
}

export interface HourlyBucket {
  /** ঢাকার স্থানীয় ঘণ্টা, ০–২৩ */
  hour: number;
  activeSec: number;
}

/** E01 — সাত দিনের চার্টের একটা দিন (`GET /live/trend`) */
/**
 * ⚠️⚠️ ঢাকা UTC+৬, কোনো DST নেই। ⭐ এটা কেবল **লেবেল → মুহূর্ত** অনুবাদে
 * ব্যবহার হয়: `workDateOf()` ঢাকার দিনটাকে UTC-মধ্যরাত হিসেবে ফেরায়, আর
 * আসল ঢাকা-মধ্যরাত ওটার এত মিলিসেকেন্ড আগে।
 */
const DHAKA_OFFSET_MS = 6 * 3600_000;

export interface TrendDay {
  /** ঢাকার কর্মদিবস, `YYYY-MM-DD` */
  date: string;
  /** ওই দিনে দলের মোট গোনা সেকেন্ড */
  workedSec: number;
  /**
   * ⭐⭐ **ওই দিন আমরা আদৌ দেখছিলাম কি না।**
   *
   * ⚠️ এটাই এই চার্টের সবচেয়ে জরুরি ঘরটা। `false` মানে "কেউ কাজ করেনি"
   * **নয়** — মানে ট্র্যাকিংই শুরু হয়নি। দুটোকে এক দেখালে সিস্টেম চালুর
   * আগের দিনগুলো নীরবে "শূন্য কাজ" বলে দাবি করত, আর প্রথম সপ্তাহে গোটা
   * দলকে অকারণে ব্যর্থ দেখাত।
   *
   * ⭐ এটা এই অ্যাপেরই পুরোনো নিয়মের আরেক রূপ: `offline` (কর্মী চলে
   * গেছেন) আর `agent_down` (এজেন্ট মরে গেছে) কখনো এক রঙে দেখানো হয় না।
   * "জানি না"-কে "নেই" বলে ফেলা এখানেও একইভাবে নিষিদ্ধ।
   */
  tracked: boolean;
  /**
   * ⭐⭐ **ওই দিনে কতগুলো ডিজাইন শেষ হয়েছে** *(৫ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️⚠️ **"শেষ", "খোলা" নয়** — আর এটাই মালিকের বাছাই *(২৩ আগস্ট,
   * ADR-033)*। `design_credits` বলে কতগুলো ফাইল **খোলা** হয়েছে, আর সেই
   * সংখ্যাটা মাঠে বিভ্রান্তি তৈরি করেছিল: ম্যানেজার ১৯টা ফাইলে ৪৪ মিনিট
   * দিয়ে "১৬" দেখাচ্ছিলেন। তাই এখানে কেবল `design_targets.completed_at`।
   *
   * ⚠️ দিনের সীমানা **ঢাকার**, UTC-র নয় — `completed_at` timestamptz, আর
   * ওই টেবিলে `work_date` কলাম নেই, তাই বালতি করা হয় `workDateOf()` দিয়ে।
   * একই ফাংশন, যেটা দিয়ে গোটা সিস্টেমের "কোন দিন" ঠিক হয়।
   */
  designsFinished: number;

  /** ওই দিনে কতজনের সত্যিই টার্গেট ছিল — শূন্য মানে সবারই ছুটি */
  expectedStaff: number;
  /** ওই দিনে দলের মোট প্রত্যাশিত সেকেন্ড — চার্টের টার্গেট-রেখা */
  targetSec: number;
}

/** E01 — চলতি মাসের কার্ড (`GET /live/trend`) */
export interface TrendMonth {
  /** `2026-08` */
  yearMonth: string;
  /** worked + owner-এর সংশোধন — টার্গেটের সাথে এটাই মেলানো হয় */
  creditedSec: number;
  targetSec: number;
  /**
   * ⚠️ **ট্র্যাকিং শুরুর দিন থেকে** প্রত্যাশিত, মাসের ১ তারিখ থেকে নয়।
   *
   * ⚠️⚠️ কাঁচা `monthly_summary.expected_sec` বসালে আগস্টের কার্ডে লেখা
   * থাকত *"দল ১০৪২ ঘণ্টা পিছিয়ে"* — সংখ্যাটা সত্য, গল্পটা মিথ্যা। ওই
   * ঘাটতির পুরোটাই ১–১২ আগস্ট, যখন মনিটরিং ছিলই না। প্রথম মাসেই গোটা
   * দলকে অন্যায়ভাবে ব্যর্থ দেখানো হতো, আর কেউ ওই সংখ্যা দিয়েই জবাবদিহি
   * চাইতে পারত।
   */
  expectedSec: number;
  /** credited − expected · ধনাত্মক = এগিয়ে */
  paceSec: number;
  /**
   * ⭐ কবে থেকে দেখা শুরু — কার্ডে এটা **লেখা থাকে**, নইলে উপরের
   * সমন্বয়টা একটা অদৃশ্য অনুমান হয়ে যেত।
   */
  trackedFrom: string | null;

  /**
   * ⭐⭐ **G111 — যোগফলটা আসলে কতজনের।**
   *
   * ⚠️⚠️ উপরের `expectedSec` হলো Σ `monthly_summary.expected_sec`। যাঁর
   * একটাও শেষ-হওয়া কর্মদিবস এখনো দেখা হয়নি তাঁর ওই ঘর ০, তাই তাঁর
   * **পুরো টার্গেটটাই যোগফল থেকে নীরবে বাদ** যায় — অর্থাৎ দল যত পিছিয়ে,
   * বোর্ড তার চেয়ে **কম** দেখায়, আর ভুলটা সবসময় একই দিকে হেলে: সবকিছু
   * আসলের চেয়ে ভালো দেখায়। নতুন কেউ যোগ দিলে বা কারো এজেন্ট বসাতে দেরি
   * হলে ঠিক তখনই এটা ঘটে, আর তখনই কেউ খেয়াল করে না।
   *
   * ⭐ সংখ্যাটা বাদ দেওয়া হয়নি — **বলা** হয়েছে। যোগফলটা তখনো সৎ ("যাঁদের
   * হিসাব আছে তাঁদের"), শুধু কার্ডে পাশে লেখা থাকে কতজন এর বাইরে।
   * ওঁদের টার্গেট যোগ করে দিলে বোর্ড এমন ঘাটতির দাবি করত যেটা কেউ
   * করেইনি — একটা মিথ্যা সারিয়ে ঠিক উল্টো মিথ্যা।
   */
  observedStaff: number;
  /** ⚠️ ০ হলে পর্দায় কিছুই লেখা হয় না — নইলে প্রতিদিন একটা অর্থহীন লাইন */
  notObservedStaff: number;
}

/** E01 — **আজীবন** সবচেয়ে বেশি ঘণ্টা যাঁদের */
export interface TrendLeader {
  employeeId: number;
  fullName: string;
  /** ⭐ **সব মাস মিলিয়ে** worked + সংশোধন — চলতি মাসের নয় */
  creditedSec: number;
}

/**
 * ⭐⭐ **"সবচেয়ে কম" কত দিনের জানালায় দেখা হবে** *(৩০ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **৭, ৩০ নয় — আর দুটো আলাদা কারণে।** এক· মালিকের প্রশ্নটাই ছিল
 * *"last kiso din er upore base kore"*, অর্থাৎ এখনকার অবস্থা, ইতিহাস নয়।
 * দুই· ৩০ দিনের জানালায় একটা খারাপ সপ্তাহ গড়ে মিলিয়ে যেত, আর তালিকাটা
 * সাড়া দিত অনেক দেরিতে — অথচ এই তালিকার কাজই **সময়মতো চোখে পড়া**।
 *
 * ⭐ সংখ্যাটা পর্দাতেও যায় (`laggardDays`), হার্ডকোড করা হয়নি — নইলে
 * একদিন এটা বদলাত আর কার্ডের লেখাটা পুরোনো কথাই বলে যেত।
 */
export const LAGGARD_DAYS = 7;

/**
 * ⭐⭐ **সবচেয়ে কম ঘণ্টা যাঁদের** *(মালিকের চাওয়া, ৩০ আগস্ট ২০২৬)* — বোর্ডের
 * ডান কলামে।
 *
 * ⚠️⚠️ **`daysCounted` ছাড়া এই সারিটা মিথ্যা বলত, আর সেটাই এই ঘরটার
 * গোটা কারণ।** "৪ ঘণ্টা" পড়ে যে কেউ ধরে নিতেন লোকটা কাজ করেননি — অথচ
 * তিনি হয়তো ছুটিতে ছিলেন, বা মাত্র যোগ দিয়েছেন। ⭐ পাশে "৭ দিনের ২ দিন"
 * লেখা থাকলে সংখ্যাটা আর দুভাবে পড়া যায় না ([`Stat`-এর `sub`-এর একই
 * নিয়ম](../../../web/src/pages/settings/ui.tsx))।
 *
 * ⚠️ শূন্য ঘণ্টার কর্মীও তালিকায় থাকেন — `creditedSec > 0` ছাঁকনি দিলে
 * যিনি **একদিনও** আসেননি তিনিই তালিকা থেকে উধাও হতেন, অথচ প্রশ্নটা
 * ঠিক তাঁকে নিয়েই।
 */
export interface TrendLaggard {
  employeeId: number;
  fullName: string;
  /** ⭐ জানালার ভেতরে মোট — worked + সংশোধন */
  creditedSec: number;
  /** ⚠️ কত দিনে কিছু গোনা হয়েছে — অনুপস্থিতি যেন সংখ্যাটার আড়ালে না পড়ে */
  daysCounted: number;
}

export interface TeamTrend {
  /** সবসময় ৭টা, আজ সহ — পুরোনো আগে */
  days: TrendDay[];
  month: TrendMonth;
  /**
   * ⭐ **আজীবন** সবচেয়ে বেশি ঘণ্টা, উপরে থেকে — সর্বোচ্চ পাঁচজন।
   *
   * ⚠️ মাপটা **সব মাস মিলিয়ে মোট ঘণ্টা**, মালিকের বাছা। ফলে যিনি আগে যোগ
   *    দিয়েছেন তিনি **স্থায়ীভাবে** উপরে থাকেন — নতুন কেউ যত ভালোই করুন,
   *    ধরতে পারবেন না। মাসিক হিসাবে অন্তত প্রতি মাসে ক্রমটা নতুন করে শুরু
   *    হতো; আজীবনে হয় না। সেটা জেনেই বাছা হয়েছে।
   *
   * ⭐ তাই কার্ডে প্রতিটা নামের পাশে **আসল ঘণ্টাটা** লেখা থাকে — ক্রমটা
   *    কীসের উপর দাঁড়ানো, সেটা পর্দাতেই দেখা যায়।
   *
   * ⚠️ শুধু **সক্রিয়** কর্মী — ছেড়ে যাওয়া কারো নাম বছরের জমা ঘণ্টা নিয়ে
   *    তালিকার মাথায় বসে থাকলে সেটা বিভ্রান্তিকর হতো।
   */
  leaders: TrendLeader[];
  /**
   * ⭐⭐ **শেষ ৩০ দিনের ক্রম — বোর্ডে এটাই ডিফল্ট।**
   *
   * ⚠️ উপরের আজীবন তালিকায় একটা গঠনগত অন্যায় আছে যা কখনো সারে না: ঘণ্টা
   *    কেবল জমে, কমে না — তাই **যিনি আগে যোগ দিয়েছেন তিনি স্থায়ীভাবে
   *    উপরে**। তালিকাটা তখন "কে ভালো করছে" নয়, "কে বেশিদিন আছে" বলে।
   *    ৩০ দিনের জানালা সবাইকে একই মাপে আনে, আর নতুন কেউও উঠে আসতে পারেন।
   *
   * ⚠️ `daily_summary` থেকে গোনা, `monthly_summary` থেকে নয় — জানালাটা
   *    মাসের সীমানা পেরোয় (আজ ১৫ তারিখ হলে অর্ধেক গত মাসে)।
   *
   * ⭐ দুটো তালিকাই পাঠানো হয়, একটা নয় — মালিক আগে আজীবনেরটা বেছেছিলেন,
   *    আর সেই পছন্দটা কেড়ে না নিয়ে নতুন জানালাটা যোগ করা হয়েছে।
   */
  leaders30: TrendLeader[];
  /**
   * ⭐⭐ **সবচেয়ে কম ঘণ্টা, নিচ থেকে** — সর্বোচ্চ পাঁচজন *(৩০ আগস্ট ২০২৬)*।
   *
   * ⚠️⚠️ জানালাটা **৭ দিন**, ৩০ নয় — আর দুটো আলাদা কারণে। এক· প্রশ্নটাই
   * ছিল *"last kiso din"*, অর্থাৎ এখনকার অবস্থা, ইতিহাস নয়। দুই· ৩০
   * দিনের জানালায় একটা খারাপ সপ্তাহ গড়ে মিলিয়ে যেত, আর তখন তালিকাটা
   * দেরিতে সাড়া দিত — যে তালিকার কাজই সময়মতো চোখে পড়া।
   *
   * ⚠️ `leaders30`-এর মতো `creditedSec > 0` ছাঁকনি **নেই**: এখানে শূন্যই
   * সবচেয়ে জরুরি সারি।
   */
  laggards: TrendLaggard[];
  /**
   * ⭐ উপরের তালিকার জানালা কত দিনের — পর্দার লেখাটা যেন সার্ভারের
   * সংখ্যার সাথে কখনো আলাদা না হয়ে যায়।
   */
  laggardDays: number;
}

/** E01 — লাইভ বোর্ডের দিনের-ছন্দ চার্ট (`GET /live/pulse`) */
export interface TeamPulse {
  /** ঢাকার কর্মদিবস, `YYYY-MM-DD` */
  date: string;
  /** ⭐ সবসময় ২৪টা — খালি ঘণ্টাও `activeSec: 0, people: 0` নিয়ে থাকে */
  hours: TeamHour[];
  totalActiveSec: number;
  /** দিনের সর্বোচ্চ একসাথে কতজন — চার্টের y-অক্ষের সীমা */
  peakPeople: number;
}

export interface HourlyChart {
  employeeId: number;
  date: string;
  buckets: HourlyBucket[];
  totalActiveSec: number;
}

/**
 * E01/E02/E04/E05 — লাইভ বোর্ড, টাইমলাইন ও ঘণ্টাভিত্তিক চার্ট।
 *
 * ⚠️ কোনো হিসাব এখানে লেখা হয়নি — স্ট্যাটাস, বালতি, তারিখ সবই
 * `dashboard.math.ts`-এ। এই ক্লাসের কাজ শুধু ডেটা আনা ও সাজানো।
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E01 — ১৫টা কার্ড, ৩০ সেকেন্ডে রিফ্রেশ।
   *
   * ⚠️ **N+1 লেখা যাবে না।** কর্মীপ্রতি লুপ করে ডিভাইস/সেগমেন্ট আনলে
   *    ১৫ জন × (ডিভাইস + আজ + মাস + state) = ৬০+ কোয়েরি হতো — প্রতি
   *    ৩০ সেকেন্ডে, প্রতিটি খোলা ব্রাউজার ট্যাব থেকে। তাই জোড়া লাগানো
   *    হয় **কোডে**, কর্মীপ্রতি কোয়েরিতে নয় — মোট **পাঁচটি** কোয়েরি,
   *    কর্মীসংখ্যা যাই হোক।
   *
   * ⭐ কার্ডের রঙ আসে `devices.last_state` থেকে — heartbeat-এ এজেন্ট নিজে
   *    যা বলেছে। আগে সেটা শেষ `activity_segments` সারি থেকে **অনুমান**
   *    করা হতো, আর এজেন্ট সেগমেন্ট ব্যাচে পাঠায় বলে বোর্ড কয়েক মিনিট
   *    পিছিয়ে থাকত: কর্মী উঠে চলে গেলেও কার্ড সবুজ, ফিরে এলেও ধূসর।
   *    ৩০ সেকেন্ডে রিফ্রেশ হওয়া বোর্ডে ৩ মিনিট পুরোনো উত্তর মানে
   *    রিফ্রেশটাই অর্থহীন। সেগমেন্ট এখন কেবল fallback (নিচে দেখো)।
   *
   * ⭐ worked সেকেন্ড এখানে **যোগফল**, UNION নয় — যদিও § ২.১-গ বলে UNION।
   *    ইচ্ছাকৃত, এবং কারণটা নির্ভুলতার চেয়েও ভারী:
   *
   *    এই একই দুটো সংখ্যা এজেন্টের tray-তেও দেখানো হয়
   *    (`src/agent/progress.service.ts`), আর সেখানে যোগফলই ব্যবহার হচ্ছে।
   *    এখানে UNION বসালে স্টাফ tray-তে এক সংখ্যা আর ম্যানেজার বোর্ডে
   *    আরেক সংখ্যা দেখত — "কোনটা সত্যি?" প্রশ্নের কোনো উত্তর থাকত না,
   *    আর যে ফিচারের পুরো উদ্দেশ্য আস্থা, সেটাই আস্থা ভাঙত।
   *
   *    ⚠️ ফল: কেউ একইসাথে দুই PC চালালে ওই সময়টা দুইবার গোনা হয়।
   *    ১৫ মিনিটের বেশি overlap-এ `device_overlap` অ্যালার্ট ওঠে, তাই
   *    ব্যাপারটা অদৃশ্য নয়।
   *
   *    ⚠️⚠️ **এই যুক্তিটা ১২ আগস্ট পর্যন্ত ফাঁপা ছিল** — অ্যালার্টটার
   *    প্রযোজক কোনোদিন লেখাই হয়নি (G32), অর্থাৎ "অদৃশ্য নয়" কথাটা
   *    ভুল ছিল, আর দ্বিগুণ গোনা সত্যিই অদৃশ্য ছিল। এখন
   *    `alerts/device-overlap.check.ts` ঘণ্টায় একবার চলে, তাই রক্ষাকবচটা
   *    সত্যি — কিন্তু মনে রাখতে হবে, এখানে যোগফল রাখার সিদ্ধান্তটা
   *    ওই অ্যালার্টের উপরেই দাঁড়িয়ে।
   *
   *    আসল সমাধান দৈনিক rollup জব (daily_summary.worked_sec) — সেটা এলে
   *    **এই দুই জায়গা একসাথে** বদলাতে হবে, আলাদা করে নয়।
   */
  async live(now: Date = new Date()): Promise<LiveBoard> {
    const today = workDateOf(now);
    const monthStart = monthStartOf(today);
    const stateCutoff = new Date(
      now.getTime() - LIVE_STATE_LOOKBACK_SEC * 1000,
    );

    const employees = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        empCode: true,
        fullName: true,
        designation: true,
        staffType: true,
        // ⚠️ `joinedOn`/`leftOn` লাগে কারণ টার্গেট **prorate** হয় — মাসের
        //    মাঝপথে যোগ দেওয়া কর্মীর মাসিক টার্গেট পুরো মাসেরটা নয়।
        joinedOn: true,
        leftOn: true,
        /** ⭐ তার নিজের ডিজাইন-টার্গেট — খালি হলে পলিসিরটা খাটে (২৩ আগস্ট) */
        dailyDesignTarget: true,
        policy: {
          // ⭐⭐ `expectedWorkdays` — দৈনিক টার্গেটের **হর**। এটা না আনলে
          //    এখানে ক্যালেন্ডার কর্মদিবস দিয়ে ভাগ করতে হতো, আর সেটাই ছিল
          //    tray ও এই কার্ডের মধ্যে ফারাকের আসল কারণ।
          select: {
            monthlyTargetHours: true,
            weeklyOffDay: true,
            expectedWorkdays: true,
            // ⭐ ডিজাইনারের দৈনিক টার্গেট (২১ আগস্ট) — ঘণ্টার পাশে
            dailyDesignTarget: true,
          },
        },
      },
      orderBy: { empCode: 'asc' },
    });

    if (employees.length === 0) {
      return { workDate: formatWorkDate(today), generatedAt: now, cards: [] };
    }

    // ⭐ দৈনিক টার্গেট বের করতে ওই মাসের কর্মদিবস লাগে, আর কর্মদিবস গুনতে
    //    সরকারি ছুটি লাগে। ছুটি বাদ না দিলে ভাগফল ছোট হতো — অর্থাৎ দৈনিক
    //    টার্গেট কম, আর মাস শেষে যোগফল ২০৮-এ পৌঁছাত না।
    const { first: monthFirst, last: monthLast } = monthBoundsOf(today);
    const holidayRows = await this.prisma.holiday.findMany({
      where: { holidayDate: { gte: monthFirst, lte: monthLast } },
      select: { holidayDate: true },
    });
    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    const ids = employees.map((e) => e.id);

    /**
     * ⭐ R2 — কার্ডের টার্গেটও ছুটি বাদ দিয়ে। ⚠️ না দিলে ছুটিতে থাকা
     *    কর্মীর কার্ড মাসিক টার্গেট দেখাত পুরোটা, অথচ Monthly পাতা কম —
     *    আর ঠিক এই ধরনের অমিলের নিন্দাই নিচের `prorate()`-এর নোটে লেখা।
     */
    const leaveRows = await this.prisma.leave.findMany({
      where: { employeeId: { in: ids }, leaveDate: { gte: monthFirst, lte: monthLast } },
      select: { employeeId: true, leaveDate: true },
    });
    const leaveBy = new Map<number, Set<number>>();
    for (const l of leaveRows) {
      let set = leaveBy.get(l.employeeId);
      if (!set) leaveBy.set(l.employeeId, (set = new Set()));
      set.add(l.leaveDate.getTime());
    }

    const [devices, todaySums, designToday, finishedToday, monthSums, recentSegments] =
      await Promise.all([
      // ⚠️ revoked ডিভাইস বাদ — ওগুলোর lastSeenAt চিরকাল পুরোনো হয়ে
      //    আটকে থাকে, ফলে PC বদলে দেওয়া কর্মীও চিরকাল 🔴 দেখাত।
      //
      // ⭐ `groupBy(_max: lastSeenAt)` নয়, সারিগুলোই — কারণ এখন state-ও
      //    লাগে, আর `_max(lastSeenAt)` ও `_max(lastStateAt)` **আলাদা দুটো
      //    ডিভাইসের** হতে পারত: SQL aggregate কলামগুলোকে জোড়া ভাঙে।
      //    তখন বন্ধ ডেস্কটপের বাসি `active` ল্যাপটপের তাজা সময়ের সাথে
      //    জোড়া লেগে যেত, আর কার্ড চিরকাল সবুজ দেখাত। ১৫ জনের ২০-৩০টা
      //    সারি — এটা এখনো একটাই কোয়েরি, N+1 নয়।
      this.prisma.device.findMany({
        /**
         * ⚠️⚠️ আগে এখানে `status: 'active'` ছাঁকা ছিল। ফলে বন্ধ করে দেওয়া
         * ডিভাইস তালিকা থেকেই উধাও হয়ে যেত, আর কার্ড "কখনো এজেন্ট বসেনি"
         * থেকে আলাদা করা যেত না — একই কার্ডে ১৬:৫০-এর স্ক্রিনশট আর পাশে
         * *"Never checked in"*।
         *
         * ⭐ ছাঁকাটা এখন `dashboard.math.ts`-এ, যেখানে সিদ্ধান্তটা নেওয়া হয়
         * আর টেস্টে বাঁধা যায়।
         */
        where: { employeeId: { in: ids } },
        select: {
          employeeId: true,
          status: true,
          lastSeenAt: true,
          lastState: true,
          lastStateAt: true,
        },
      }),
      this.prisma.activitySegment.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, countsAsWork: true, workDate: today },
        _sum: { durationSec: true },
      }),
      // ⭐ আজ দাবি করা ডিজাইন — ইনডেক্স করা (employee_id, first_work_date)
      this.prisma.designCredit.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, firstWorkDate: today },
        _count: { _all: true },
      }),
      /**
       * ⭐⭐ **আজ কতগুলো টার্গেট "শেষ" বলা হয়েছে** *(২২ আগস্ট ২০২৬)*।
       *
       * ⚠️⚠️ উপরেরটা (`designCredit`) বলে **কতগুলো ফাইল খোলা হয়েছে**, এটা
       * বলে **কতগুলো শেষ হয়েছে**। দুটো এক নয়, আর সেটাই মালিকের বাছাই:
       * *"দুটোই — শুরু ও শেষ আলাদা"*। এক করে দেখালে ফাইল খোলামাত্র কাজটা
       * শেষ বলে গোনা হতো — ঠিক যে ভুলটা ২৩ আগস্ট ধরা পড়েছিল (ADR-033-এর
       * পাশের নোট, `completed_via = 'filename'` ফিরিয়ে দেওয়া)।
       *
       * ⚠️ `completedAt` timestamptz, তাই ঢাকার দিনের **সীমানা** দিয়ে
       * ছাঁকা হয় — `workDate` কলাম নেই বলে সমান-তুলনা করা যেত না।
       */
      this.prisma.designTarget.groupBy({
        by: ['assignedToId'],
        where: {
          assignedToId: { in: ids },
          completedAt: {
            gte: new Date(nextLocalMidnight(now).getTime() - 86_400_000),
            lt: nextLocalMidnight(now),
          },
        },
        _count: { _all: true },
      }),
      this.prisma.activitySegment.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: ids },
          countsAsWork: true,
          workDate: { gte: monthStart, lte: today },
        },
        _sum: { durationSec: true },
      }),
      // ⚠️ এটা এখন শুধু **fallback** (`devices.last_state` null হলে), তবু
      //    সবসময়ই চালানো হয় — কর্মীভেদে লাগবে কি না আগে থেকে জানা যায় না,
      //    আর "দরকার হলে তখন আনি" মানে কর্মীপ্রতি একটা কোয়েরি, অর্থাৎ
      //    ঠিক সেই N+1 যা এই মেথড এড়ানোর জন্য লেখা।
      //
      // ⚠️ `workDate` দিয়েও ছাঁকা হয় শুধু ইনডেক্সের জন্য —
      //    (employeeId, workDate, state) ইনডেক্স তখনই কাজে লাগে। গতকালকে
      //    রাখতেই হয়: মধ্যরাতের ঠিক পরে আজকের কোনো সেগমেন্টই থাকে না,
      //    অথচ কর্মী তখনো কাজ করছে (§ ২.১-ক — রাতে কাজ স্বাভাবিক)।
      this.prisma.activitySegment.findMany({
        where: {
          employeeId: { in: ids },
          workDate: { in: [previousWorkDate(today), today] },
          endedAt: { gte: stateCutoff },
        },
        select: { employeeId: true, state: true, endedAt: true },
        orderBy: { endedAt: 'desc' },
      }),
    ]);

    const byEmployee = new Map<number, DeviceReport[]>();
    for (const d of devices) {
      if (d.employeeId === null) continue;
      const list = byEmployee.get(d.employeeId);
      if (list) list.push(d);
      else byEmployee.set(d.employeeId, [d]);
    }

    const todaySec = sumByEmployee(todaySums);
    const designsBy = new Map(designToday.map((d) => [d.employeeId, d._count._all]));
    // ⚠️ `assignedToId` null হতে পারে (পুলে ফেরত যাওয়া সারি) — বাদ
    const finishedBy = new Map(
      finishedToday
        .filter((d) => d.assignedToId !== null)
        .map((d) => [d.assignedToId as number, d._count._all]),
    );
    const monthSec = sumByEmployee(monthSums);

    // ⚠️ `orderBy endedAt desc` + "প্রথমটাই রাখা" — তাই কর্মীপ্রতি সবচেয়ে
    //    সাম্প্রতিক সেগমেন্টই থাকে। উল্টো ক্রমে লিখলে সবচেয়ে পুরোনোটা
    //    বসে যেত এবং কার্ড কখনো হালনাগাদ হতো না।
    const segmentState = new Map<number, SegmentState>();
    for (const s of recentSegments) {
      if (!segmentState.has(s.employeeId))
        segmentState.set(s.employeeId, s.state);
    }

    const cards = employees.map((e): LiveCard => {
      const own = byEmployee.get(e.id) ?? NO_DEVICES;
      const targetHours = Number(
        e.policy?.monthlyTargetHours ?? DEFAULT_TARGET_HOURS,
      );

      // ⚠️ নীতি আলাদা হলে সাপ্তাহিক ছুটির বারও আলাদা, তাই কর্মদিবস
      //    কর্মীপ্রতি গোনা হয় — সবার জন্য একটাই সংখ্যা ধরে নেওয়া যায় না।
      const rule = { weeklyOffDay: e.policy?.weeklyOffDay ?? null, holidays };

      /**
       * ⭐⭐ **টার্গেট এখানে নতুন করে গোনা হয় না — `prorate()` ডাকা হয়**,
       * অর্থাৎ যে ফাংশনটা `monthly_summary.target_sec` লেখে ঠিক সেটাই।
       *
       * ⚠️ আগে এখানে নিজের হিসাব ছিল, আর তার হর ছিল **ক্যালেন্ডার কর্মদিবস**,
       *    অথচ `prorate()` ভাগ করে **পলিসির `expected_workdays`** দিয়ে। ২৭
       *    কর্মদিবসের আগস্টে তাই tray বলত ৮ঘ/দিন · ২১৬ঘ/মাস, আর এই কার্ড
       *    বলত ৭ঘ ৪২মি/দিন · ২০৮ঘ/মাস — একই কর্মী, একই মাস, দুই সংখ্যা।
       *    কর্মী নিজের পর্দাটাকে আর মালিক তাঁরটাকে সত্যি ধরতেন, আর কারো
       *    পক্ষেই টের পাওয়ার উপায় ছিল না (G88)।
       *
       * ⭐ সমাধানটা ইচ্ছাকৃতভাবে "একই সূত্র দুই জায়গায় লেখা" নয়, **একই
       *    ফাংশন ডাকা** — নইলে পরের বার একটা বদলে অন্যটা থেকে যেত।
       */
      const target = prorate({
        monthStart: monthFirst,
        monthEnd: monthLast,
        joinedOn: e.joinedOn,
        leftOn: e.leftOn,
        weeklyOffDay: rule.weeklyOffDay,
        holidays,
        monthlyTargetSec: targetHours * HOUR,
        policyWorkdays: e.policy?.expectedWorkdays ?? DEFAULT_POLICY_WORKDAYS,
        leaveDates: leaveBy.get(e.id),
      });

      return {
        employeeId: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        designation: e.designation,
        staffType: e.staffType,
        designsDone: designsBy.get(e.id) ?? 0,
        designsFinished: finishedBy.get(e.id) ?? 0,
        designTargetPerDay: designTargetOf(
          e.dailyDesignTarget,
          e.policy?.dailyDesignTarget,
        ),
        status: decideLiveStatus({
          devices: own,
          fallbackState: segmentState.get(e.id) ?? null,
          now,
        }),
        todayWorkedSec: todaySec.get(e.id) ?? 0,
        dailyTargetSec: Math.round(target.dailyTargetSec),
        todayIsWorkday: isWorkday(today, rule),
        // ⭐ G130 — ঠিক সেই `leaveBy` সেট, যেটা দিয়ে উপরে টার্গেট কমানো হয়
        onLeaveToday: leaveBy.get(e.id)?.has(today.getTime()) ?? false,
        monthWorkedSec: monthSec.get(e.id) ?? 0,
        monthTargetSec: Math.round(target.targetSec),
        lastHeartbeatAt: latestHeartbeat(own),
        agentPresence: agentPresence(own),
      };
    });

    return { workDate: formatWorkDate(today), generatedAt: now, cards };
  }

  /** E04 — ওই কর্মদিবসের সব সেগমেন্ট, সময় অনুযায়ী সাজানো */
  async timeline(employeeId: number, rawDate?: string): Promise<Timeline> {
    const workDate = this.resolveWorkDate(rawDate);
    const employee = await this.requireEmployee(employeeId);

    const rows = await this.prisma.activitySegment.findMany({
      where: { employeeId, workDate },
      select: {
        id: true,
        deviceId: true,
        state: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    const totals = { activeSec: 0, idleSec: 0, lockedSec: 0 };
    for (const r of rows) {
      if (r.state === 'active') totals.activeSec += r.durationSec;
      else if (r.state === 'idle') totals.idleSec += r.durationSec;
      else totals.lockedSec += r.durationSec;
    }

    return {
      employeeId,
      empCode: employee.empCode,
      fullName: employee.fullName,
      date: formatWorkDate(workDate),
      // ⚠️ `id` BigInt — app.setup.ts-এ BigInt-এর JSON সিরিয়ালাইজেশন
      //    বসানো নেই, তাই সরাসরি ফেরত দিলে রেসপন্স তৈরির সময়ই
      //    "Do not know how to serialize a BigInt" ছুড়ে ৫০০ হতো।
      //    স্ট্রিং রাখা এমনিতেও নিরাপদ — JS number ৯,০০৭ ট্রিলিয়নের পরে
      //    নীরবে নির্ভুলতা হারায়।
      segments: rows.map((r) => ({ ...r, id: r.id.toString() })),
      totals,
    };
  }

  /** E05 — ২৪টা বালতি, প্রতিটিতে active সেকেন্ড */
  async hourly(employeeId: number, rawDate?: string): Promise<HourlyChart> {
    const workDate = this.resolveWorkDate(rawDate);
    await this.requireEmployee(employeeId);

    // ⚠️ শুধু `countsAsWork` — idle বা locked ঘণ্টার চার্টে ঢুকলে
    //    "কোন ঘণ্টায় কত কাজ" প্রশ্নের উত্তর ফুলে যেত।
    const rows = await this.prisma.activitySegment.findMany({
      where: { employeeId, workDate, countsAsWork: true },
      select: { startedAt: true, endedAt: true, durationSec: true },
      orderBy: { startedAt: 'asc' },
    });

    const buckets = spreadIntoHourBuckets(rows, workDate);

    return {
      employeeId,
      date: formatWorkDate(workDate),
      buckets: buckets.map((activeSec, hour) => ({ hour, activeSec })),
      totalActiveSec: buckets.reduce((a, b) => a + b, 0),
    };
  }

  /**
   * ⭐ E01 — **সাত দিন ও চলতি মাস** (`GET /live/trend`)।
   *
   * ⭐ উৎস `daily_summary` ও `monthly_summary`, কাঁচা সেগমেন্ট নয় — আর
   *    সেটা ইচ্ছাকৃত। ওই দুটোই বেতনের ভিত্তি (`worked_sec` হলো ACTIVE-এর
   *    **UNION**, দুই PC-র সময় দুবার গোনা হয় না), আর `summary-refresh`
   *    জব ওদের **প্রতি ১৫ মিনিটে** তাজা রাখে (K06)।
   *
   * ⚠️ ফলে আজকের কলামটা উপরের "Hours today" টাইলের চেয়ে একটু কম হতে
   *    পারে — টাইলটা লাইভ **যোগফল**, ওতে overlap দুবার গোনা হয় (বোর্ডের
   *    নিচের caveat-এ সেটা লেখাই আছে)। দুটো চার্ট একই ভিত্তিতে রাখা
   *    হয়েছে, কারণ পাশাপাশি বসা দুটো চার্ট আলাদা ভিত্তিতে চললে
   *    "কোনটা সত্যি?" প্রশ্নের কোনো উত্তর থাকত না।
   */
  async teamTrend(): Promise<TeamTrend> {
    const today = this.resolveWorkDate();
    const first = new Date(today.getTime() - 6 * 86_400_000);
    const monthKey = formatWorkDate(today).slice(0, 7);

    /**
     * ⚠️⚠️ **সক্রিয় কর্মীদের তালিকা আগে**, আর সেটা এখানে জরুরি — শুধু
     *    নাম দেখানোর জন্য নয়।
     *
     *    কাউকে নিষ্ক্রিয় করলে তাঁর `monthly_summary` ও `daily_summary`
     *    সারি **থেকেই যায়** (ইতিহাস মোছা হয় না, ইচ্ছাকৃত)। ছাঁকা না দিলে
     *    দলের টার্গেটে ছেড়ে-যাওয়া মানুষের ভাগ যোগ হয়েই থাকত — আর তাতে
     *    "কত পিছিয়ে" সংখ্যাটা চিরকাল ফুলে থাকত।
     *
     *    ⭐ ১৪ আগস্ট ঠিক এটাই ঘটেছিল: seed-এর তিনটে নমুনা সারি নিষ্ক্রিয়
     *    করার পরেও টার্গেট ২২৭২ ঘণ্টাই দেখাচ্ছিল, অর্থাৎ তিনজন অস্তিত্বহীন
     *    মানুষের লক্ষ্য দল বয়ে বেড়াত।
     *
     * ⚠️ Live Board-এর কার্ডও কেবল সক্রিয় কর্মী দেখায়, তাই এই ছাঁকনিটা
     *    পর্দার বাকি অংশের সাথে **মিল রাখে** — নইলে একই পাতায় দুই রকম "দল"।
     */
    const active = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        fullName: true,
        /**
         * ⚠️ যোগ/ছাড়ার দিন ও সাপ্তাহিক ছুটির বার এখানে **নতুন করে** টানা
         * হয়েছে — ফিতের প্রত্যাশা এখন `daily_summary` সারি গুনে নয়,
         * ক্যালেন্ডার দেখে হয় (নিচের `trendDayExpectation()`)। এগুলো
         * ছাড়া "ওই দিনটা ওর কর্মদিবস ছিল কি না" প্রশ্নের উত্তরই নেই।
         */
        joinedOn: true,
        leftOn: true,
        policy: { select: { weeklyOffDay: true } },
      },
    });
    const nameOf = new Map(active.map((e) => [e.id, e.fullName]));

    // ⚠️ কর্মীপ্রতি সারি, গোষ্ঠীবদ্ধ নয় — দৈনিক টার্গেট ও সাপ্তাহিক ছুটি
    //    দুটোই কর্মীভেদে আলাদা, তাই যোগফলটা কোডে করা হয়।
    const [rowsAll, monthRowsAll, firstSeen, holidayRows, finishedRows] =
      await Promise.all([
      this.prisma.dailySummary.findMany({
        where: { workDate: { gte: first, lte: today } },
        select: {
          employeeId: true,
          workDate: true,
          workedSec: true,
          /**
           * ⚠️⚠️ `dayType` এখানে আর **পড়াই হয় না**। ওটা দিয়েই আগে
           * প্রত্যাশা গোনা হতো (`dayType !== 'holiday'`), আর সেটা নীরবে
           * ভুল ছিল — কারণ নিচের `trendDayExpectation()`-এর নোটে।
           */
        },
      }),
      this.prisma.monthlySummary.findMany({
        where: { yearMonth: monthKey },
        select: {
          employeeId: true,
          creditedSec: true,
          targetSec: true,
          expectedWorkdays: true,
          // ⭐ প্রত্যাশা আর এখানে গোনা হয় না — কেন, নিচের নোট দেখুন
          expectedSec: true,
          // ⭐ G111 — যোগফলটা কাদের নিয়ে, সেটা বলার জন্য
          workdaysElapsed: true,
        },
      }),
      /**
       * ⭐⭐ **কাকে কবে থেকে দেখছি — কর্মীপ্রতি।**
       *
       * ⚠️ আগে এখানে দল-স্তরের একটা `findFirst` ছিল, আর ফিতের প্রত্যাশায়
       *    সেটা ব্যবহারই হতো না। এখন হয়: দল-স্তরের min নিলে ১ অক্টোবর
       *    যোগ দেওয়া কর্মীর জন্য জানালা জুলাই থেকে শুরু হতো।
       *
       * ⭐ দল-স্তরের min এখান থেকেই বেরিয়ে আসে (নিচের `trackedFromMs`) —
       *    দুটো আলাদা কোয়েরির দরকার নেই, আর দুটো সংখ্যা কখনো আলাদাও হতে
       *    পারে না।
       *
       * ⚠️ মাস দিয়ে ছাঁকা হয় **না** — `summary.service.ts`-এর একই
       *    কোয়েরির মতোই। ছাঁকলে প্রতি মাসের ১ তারিখে ট্র্যাকিং নতুন করে
       *    "শুরু" হতো।
       */
      trackedFromBy(
        this.prisma,
        active.map((e) => e.id),
      ),
      /**
       * ⚠️ ফিতের সাত দিনের সরকারি ছুটি। ছুটির দিনে কারো টার্গেট থাকে না,
       *    আর সেটা `daily_summary` সারি দেখে জানার উপায় নেই।
       */
      this.prisma.holiday.findMany({
        where: { holidayDate: { gte: first, lte: today } },
        select: { holidayDate: true },
      }),
      /**
       * ⭐⭐ **ফিতের সাত দিনে কতগুলো ডিজাইন শেষ হয়েছে** *(৫ সেপ্টেম্বর ২০২৬)*।
       *
       * ⚠️ `groupBy` দিয়ে নয়, কাঁচা `completed_at` এনে কোডে বালতি করা হয় —
       *    কারণ দিনের সীমানা **ঢাকার**, আর SQL-এ সেটা করতে হলে টাইমজোনের
       *    নিয়মটা দ্বিতীয়বার লিখতে হতো। ⭐ `workDateOf()` গোটা সিস্টেমে
       *    "কোন দিন" ঠিক করার একমাত্র জায়গা; দ্বিতীয় সংজ্ঞা মানেই একদিন
       *    দুটো পাতা দুই সংখ্যা বলা।
       *
       * ⚠️⚠️ **`first` ও `today` হলো লেবেল, মুহূর্ত নয়** — `workDateOf()`
       *    ঢাকার দিনটাকে **UTC-মধ্যরাত** হিসেবে লিখে রাখে, আর আসল
       *    ঢাকা-মধ্যরাতের মুহূর্ত ওটার **৬ ঘণ্টা আগে**। এই পার্থক্যটাই
       *    এই রেপোতে বারবার বাগের উৎস, তাই সীমানা দুটো হাতে গুনে বসানো:
       *      শুরু = `first`-এর ঢাকা-মধ্যরাত      → `first − ৬ঘ`
       *      শেষ  = `today`-এর পরের ঢাকা-মধ্যরাত → `today + ২৪ঘ − ৬ঘ`
       *    ⚠️ ভুল করলে আগের দিনের সন্ধ্যার কাজ আজকের ঘরে পড়ত।
       */
      this.prisma.designTarget.findMany({
        where: {
          completedAt: {
            gte: new Date(first.getTime() - DHAKA_OFFSET_MS),
            lt: new Date(today.getTime() + 86_400_000 - DHAKA_OFFSET_MS),
          },
        },
        select: { completedAt: true },
      }),
    ]);

    const rows = rowsAll.filter((r) => nameOf.has(r.employeeId));
    const monthRows = monthRowsAll.filter((m) => nameOf.has(m.employeeId));
    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    /**
     * ⭐ **কবে থেকে দেখা শুরু** — সবচেয়ে পুরোনো `daily_summary` সারি।
     * ⚠️ এর আগের দিনগুলোতে শূন্য দেখানো যাবে না; ওগুলো "জানি না"।
     *
     * ⚠️ এটা **দল-স্তরের** প্রশ্ন — ফিতের `days[].tracked` আর "কবে থেকে
     *    দেখছি" লেবেল, দুটোই গোটা বোর্ডের কথা বলে। কর্মীপ্রতি সীমাটা
     *    আলাদা আর সেটা নিচে `TrendStaff.trackedFrom`-এ যায়।
     *
     * ⚠️ সক্রিয় কর্মীদের মধ্যেই খোঁজা হয় — বোর্ডের বাকি সব সংখ্যাও তাই,
     *    আর ছেড়ে-যাওয়া কারো পুরোনো সারি ফিতেটাকে অকারণে পিছিয়ে দিত।
     */
    // ⭐ হেল্পার Map-ই ফেরত দেয় (G120) — জোড়া লাগানোর কিছু নেই
    const trackedFromMs = [...firstSeen.values()].reduce<number | null>(
      (min, d) => {
        const ms = d.getTime();
        return min === null || ms < min ? ms : min;
      },
      null,
    );

    /**
     * ⭐ কর্মীপ্রতি **এক কর্মদিবসের** টার্গেট = মাসিক ÷ তার কর্মদিবস।
     * ⚠️ ৮ ঘণ্টা ধ্রুবক নয় (`LiveCard.dailyTargetSec`-এর নোট) — মাসভেদে
     *    ও কর্মীভেদে আলাদা, তাই হিসাব করেই নিতে হয়।
     */
    const dailyTargetOf = new Map<number, number>();
    for (const m of monthRows) {
      dailyTargetOf.set(
        m.employeeId,
        m.expectedWorkdays > 0 ? m.targetSec / m.expectedWorkdays : 0,
      );
    }

    /**
     * ⚠️ যাঁর চলতি মাসের `monthly_summary` সারিই নেই, তিনি প্রত্যাশার
     * হিসাবে **আসেন না** — `?? 0` বসিয়ে ধরে নেওয়া হয় না। ০ ধরলে তিনি
     * `expectedStaff`-এ গুনতেন অথচ দলের টার্গেট-রেখাটা নীরবে নিচে নামত,
     * অর্থাৎ দল আসলের চেয়ে ভালো দেখাত। বাস্তবে অবস্থাটা প্রায় অসম্ভব —
     * `refreshDate()` দৈনিক ও মাসিক দুটো সারিই একসাথে লেখে, তাই মাসিক
     * সারি না থাকা মানে দৈনিক সারিও নেই, মানে `trackedFrom` এমনিতেই খালি।
     */
    const staff: TrendStaff[] = active
      .filter((e) => dailyTargetOf.has(e.id))
      .map((e) => ({
        employeeId: e.id,
        weeklyOffDay: e.policy?.weeklyOffDay ?? null,
        joinedOn: e.joinedOn,
        leftOn: e.leftOn,
        /**
         * ⚠️⚠️ এখানে `?? null`-ই থাকে — অন্য তিন কল-সাইটের উল্টো।
         *
         * এই ফিল্ডে `null`-এর অর্থ ইতিমধ্যেই **"কখনো দেখা হয়নি ⇒ প্রত্যাশা
         * ০"**, অর্থাৎ যেটা আমরা চাই। `today` বসালে ওটা "আজ থেকে দেখছি"
         * হয়ে যেত, আর অর্থটাই উল্টে যেত (G120)।
         */
        trackedFrom: firstSeen.get(e.id) ?? null,
        dailyTargetSec: dailyTargetOf.get(e.id) ?? 0,
      }));

    /**
     * ⭐ ঢাকার দিন ধরে বালতি — একবারই, তারপর নিচের লুপে শুধু পড়া হয়।
     * ⚠️ `completedAt` কখনো `null` হতে পারে (`DateTime?`), যদিও কোয়েরি
     *    ছেঁকে আনে; TypeScript-কে সেটা বলে দিতে হয়, আর `null` বাদ দেওয়াই
     *    ঠিক — অসম্পূর্ণ টার্গেট "আজ শেষ হয়েছে" নয়।
     */
    const finishedByDay = new Map<number, number>();
    for (const d of finishedRows) {
      if (d.completedAt === null) continue;
      const key = workDateOf(d.completedAt).getTime();
      finishedByDay.set(key, (finishedByDay.get(key) ?? 0) + 1);
    }

    const days: TrendDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(first.getTime() + i * 86_400_000);
      const ms = date.getTime();

      let workedSec = 0;
      for (const r of rows) {
        if (r.workDate.getTime() === ms) workedSec += r.workedSec;
      }

      const expectation = trendDayExpectation(date, staff, holidays);

      days.push({
        date: formatWorkDate(date),
        workedSec,
        designsFinished: finishedByDay.get(ms) ?? 0,
        // ⚠️ সারি থাকা নয়, **তারিখটা ট্র্যাকিং শুরুর পরে কি না** — সেটাই
        //    মাপকাঠি। নইলে ভবিষ্যতের কোনো ফাঁকা দিনও "দেখা হয়নি" হয়ে যেত।
        tracked: trackedFromMs !== null && ms >= trackedFromMs,
        expectedStaff: expectation.expectedStaff,
        targetSec: Math.round(expectation.targetSec),
      });
    }

    /**
     * ⭐⭐ **প্রত্যাশা `monthly_summary.expected_sec` থেকেই নেওয়া হয় —
     *    এখানে আর গোনা হয় না।**
     *
     * ⚠️⚠️ আগে এখানে নিজের একটা হিসাব ছিল, আর সেটা দু-দিক থেকে ভুল ছিল:
     *
     *    ১· **`daily_summary` সারি গোনা হতো** (`day_type !== 'holiday'`)।
     *       কিন্তু ছুটির দিনে কেউ এক ঘণ্টা কাজ করলে `dayTypeOf()` দিনটাকে
     *       `worked` লেখে — তাই ওই ছুটির দিনটাই একটা পুরো কর্মদিবসের
     *       **প্রত্যাশা** হয়ে যেত। ছুটির দিনে কাজ করার শাস্তি।
     *    ২· ট্র্যাকিং-শুরু ধরা হতো **দল-স্তরে**, অথচ প্রশ্নটা কর্মী-স্তরের।
     *       নতুন কর্মীর প্রথম কয়েকটা না-দেখা দিন তার ঘাটতি হয়ে যেত।
     *
     *    আর সবচেয়ে বড় কথা: এটা ছিল প্রত্যাশার **তৃতীয়** বাস্তবায়ন, তাই
     *    Live Board, Monthly পাতা আর tray তিনটে আলাদা সংখ্যা বলত।
     *
     * ⭐ এখন সংখ্যাটা একবারই তৈরি হয় (`summary.service.ts` →
     *    `elapsedWorkdays()` → `proratedExpectedSec()`, প্রতি ১৫ মিনিটে
     *    K06), আর সবাই সেটাই পড়ে। উপরের `creditedSec`/`targetSec`-ও একই
     *    সারি থেকে আসে, তাই rollup পিছিয়ে থাকলেও বোর্ডের তিনটে সংখ্যা
     *    অন্তত **একে অপরের সাথে মেলে** — আগে একটা তাজা, দুটো বাসি হতো।
     *
     * ⚠️⚠️ **উপরের ফিতেটা ওই একই দুটো ভুল ৪০ লাইন দূরে বয়ে বেড়াচ্ছিল**,
     *    আর এই নোটটা তার নিন্দা লিখেই পাশ কাটিয়ে গিয়েছিল। এখন ফিতেও
     *    `trendDayExpectation()` দিয়ে চলে: একই কর্মদিবসের সংজ্ঞা
     *    (ক্যালেন্ডার, সারি নয়), একই কর্মী-স্তরের ট্র্যাকিং-শুরু, একই
     *    যোগ/ছাড়ার সীমা।
     *
     * ⚠️ **দুটো পার্থক্য বাকি, দুটোই ইচ্ছাকৃত, দুটোই লেখা আছে** —
     *    `test/trend-expectation.spec.ts`-এর শেষ describe সেগুলো পাহারা
     *    দেয়। প্রধানটা **আজকের দিন**: এই `expectedSec` "এ পর্যন্ত কত
     *    হওয়ার কথা ছিল" (আজ শেষ হয়নি বলে আজ বাদ), আর ফিতের `targetSec`
     *    অন্য প্রশ্নের উত্তর — "**ওই দিনটার** টার্গেট কত ছিল"; আজকেরও
     *    টার্গেট আছে, দিনটা কেবল এখনো চলছে।
     *    ⚠️ আজকের টার্গেট শূন্য করা যেত না: `WeekAndMonth.tsx` এখনো
     *    `expectedStaff === 0` দেখলে দিনটাকে "day off" লেখে, তাই শূন্য
     *    বসালে বোর্ড দাবি করত আজ সবার ছুটি — একটা বাগ সারাতে গিয়ে সরাসরি
     *    মিথ্যা। দ্বিতীয়টা `TrendStaff.trackedFrom`-এর নোটে।
     */
    const expectedSec = monthRows.reduce((a, m) => a + m.expectedSec, 0);
    const creditedSec = monthRows.reduce((a, m) => a + m.creditedSec, 0);

    /**
     * ⭐ G111 — নিয়মটা এখানে লেখা নেই, `isObserved()`-এ। tray-ও ঠিক ওটাই
     * ডাকে, তাই বোর্ড আর tray কখনো দুই রকম গুনতে পারে না।
     */
    const observedStaff = monthRows.filter(isObserved).length;

    /**
     * ⚠️ **সব মাস মিলিয়ে**, `yearMonth` ছাঁকা ছাড়া — উপরের `monthRows`
     *    চলতি মাসের, ওটা দিয়ে আজীবনের ক্রম বানানো যেত না।
     *
     * ⭐ যোগফলটা ডাটাবেসে (`groupBy`), কোডে নয় — কর্মী ও মাস দুটোই বাড়ে,
     *    তাই সব সারি টেনে এনে যোগ করাটা সময়ের সাথে ভারী হতো।
     */
    /**
     * ⭐⭐ **শেষ ৩০ দিন — আর এটাই ডিফল্ট।**
     *
     * ⚠️⚠️ আজীবনের ক্রমে একটা গঠনগত অন্যায় আছে, আর সেটা কখনো সারে না:
     *    **যিনি আগে যোগ দিয়েছেন তিনি স্থায়ীভাবে উপরে**, কারণ ঘণ্টা কেবল
     *    জমে, কমে না। নতুন কেউ যত ভালোই করুন, ছ-মাসের পুরোনো কাউকে
     *    ধরতে তাঁর ছ-মাস লাগবে — অর্থাৎ তালিকাটা "কে ভালো করছে" নয়,
     *    "কে বেশিদিন আছে" বলে। ৩০ দিনের জানালা সবাইকে একই মাপে আনে।
     *
     * ⚠️ `daily_summary` থেকে, `monthly_summary` থেকে নয় — মাসিক সারি
     *    গোটা মাস ধরে, তাই "শেষ ৩০ দিন" মাসের সীমানা পেরোলে ওটা দিয়ে
     *    গোনা যেত না (আজ ১৫ তারিখ হলে জানালার অর্ধেক গত মাসে)।
     *
     * ⭐ ৩০ **ক্যালেন্ডার** দিন, ৩০ কর্মদিবস নয় — জানালাটা সবার জন্য
     *    একই দৈর্ঘ্যের রাখতে। কর্মদিবস ধরলে যাঁর সাপ্তাহিক ছুটি আলাদা
     *    তাঁর জানালা অন্য তারিখে শুরু হতো, আর তুলনাটাই অসম হতো।
     */
    // ⚠️ ২৯, ৩০ নয় — আজ **সহ** ৩০ দিন। ৩০ বিয়োগ করলে জানালাটা ৩১ দিনের হতো।
    const since = new Date(today.getTime() - 29 * 24 * 3600_000);
    /**
     * ⚠️ ৬ বিয়োগ, ৭ নয় — আজ **সহ** সাত দিন (উপরের ৩০ দিনের একই যুক্তি)।
     */
    const since7 = new Date(today.getTime() - (LAGGARD_DAYS - 1) * 24 * 3600_000);
    const [lifetime, recent, worked7] = await Promise.all([
      this.prisma.monthlySummary.groupBy({
        by: ['employeeId'],
        _sum: { creditedSec: true },
      }),
      this.prisma.dailySummary.groupBy({
        by: ['employeeId'],
        where: { workDate: { gte: since, lte: today } },
        _sum: { creditedSec: true },
      }),
      /**
       * ⚠️⚠️ `creditedSec: { gt: 0 }` ছাঁকনিটা **গোনার জন্য**, যোগফলের জন্য
       * নয় — শূন্য সেকেন্ডের সারি যোগফলে কিছুই যোগ করত না, কিন্তু
       * `_count`-এ একটা "দিন" হিসেবে বসে যেত। ⭐ তাতে ছুটিতে থাকা কেউ
       * "৭ দিনের ৭ দিন কাজ করেছেন, মাত্র ০ ঘণ্টা" দেখাতেন — ঠিক উল্টো কথা।
       */
      this.prisma.dailySummary.groupBy({
        by: ['employeeId'],
        where: {
          workDate: { gte: since7, lte: today },
          creditedSec: { gt: 0 },
        },
        _sum: { creditedSec: true },
        _count: { _all: true },
      }),
    ]);

    /** ⚠️ একই ছাঁকনি ও ক্রম দুটোতেই — নইলে টগল করলে নিয়মও বদলে যেত */
    const rank = (
      rows: { employeeId: number; _sum: { creditedSec: number | null } }[],
    ): TrendLeader[] =>
      rows
        .map((row) => ({
          employeeId: row.employeeId,
          fullName: nameOf.get(row.employeeId) ?? '',
          creditedSec: row._sum.creditedSec ?? 0,
        }))
        .filter((l) => nameOf.has(l.employeeId) && l.creditedSec > 0)
        .sort((a, b) => b.creditedSec - a.creditedSec)
        .slice(0, 5);

    const leaders = rank(lifetime);
    const leaders30 = rank(recent);

    /**
     * ⭐ ক্রমের নিয়মটা `dashboard.math.ts`-এ, খাঁটি ফাংশনে — কারণ ভুল হলে
     * এটা কোনো এরর দেয় না, শুধু ভুল পাঁচটা নাম দেখায়। ⚠️ এখানে কেবল
     * কোয়েরির আকারটা নিয়মের আকারে আনা হয়।
     */
    const by7 = new Map(
      worked7.map((r) => [
        r.employeeId,
        { creditedSec: r._sum.creditedSec ?? 0, daysCounted: r._count._all },
      ]),
    );
    const laggards: TrendLaggard[] = rankLaggards(nameOf, by7);

    return {
      days,
      leaders,
      leaders30,
      laggards,
      laggardDays: LAGGARD_DAYS,
      month: {
        yearMonth: monthKey,
        creditedSec,
        targetSec: monthRows.reduce((a, m) => a + m.targetSec, 0),
        expectedSec,
        paceSec: creditedSec - expectedSec,
        observedStaff,
        notObservedStaff: monthRows.length - observedStaff,
        trackedFrom: trackedFromMs
          ? formatWorkDate(new Date(trackedFromMs))
          : null,
      },
    };
  }

  /**
   * ⭐ E01 — **দলের দিনের ছন্দ**, লাইভ বোর্ডের চার্টের জন্য।
   *
   * ⚠️ এটা ছাড়া বোর্ডে সময়ের কোনো রেখা আঁকা যেত না: `/live` কেবল **এখনকার**
   *    অবস্থা পাঠায়, আর `/employees/:id/hourly` একজনের। দশজনের ছন্দ পেতে
   *    ব্রাউজারকে দশটা কল করতে হতো — প্রতি রিফ্রেশে, প্রতিটি খোলা ট্যাব
   *    থেকে। তাই যোগফলটা সার্ভারেই, **একটি** কোয়েরিতে।
   *
   * ⚠️ `/live`-এর সাথে **জোড়া লাগানো হয়নি** ইচ্ছাকৃতভাবে। বোর্ড ৩০ সেকেন্ডে
   *    রিফ্রেশ হয়, কিন্তু দিনের ছন্দ অত দ্রুত বদলায় না — এক ঘণ্টার বালতি
   *    ৩০ সেকেন্ডে একবার আনা মানে একই উত্তর ১২০ বার আনা। আলাদা রাখায়
   *    ওয়েব নিজের তালে (ধীরে) ডাকতে পারে।
   */
  async teamPulse(rawDate?: string): Promise<TeamPulse> {
    const workDate = this.resolveWorkDate(rawDate);

    // ⚠️ `hourly()`-র মতোই শুধু `countsAsWork` — idle বা locked ঢুকলে
    //    "কোন ঘণ্টায় কত কাজ" প্রশ্নের উত্তর ফুলে যেত।
    const rows = await this.prisma.activitySegment.findMany({
      where: { workDate, countsAsWork: true },
      select: {
        employeeId: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    const hours = spreadTeamIntoHourBuckets(rows, workDate);

    return {
      date: formatWorkDate(workDate),
      hours,
      totalActiveSec: hours.reduce((a, h) => a + h.activeSec, 0),
      /**
       * ⭐ দিনের **সর্বোচ্চ একসাথে** কতজন — চার্টের y-অক্ষ এটার উপরেই
       * দাঁড়ায়। ক্লায়েন্টে বের করলেও চলত, কিন্তু তখন অক্ষের সীমা আর
       * ডেটা দুই জায়গা থেকে আসত।
       */
      peakPeople: hours.reduce((m, h) => Math.max(m, h.people), 0),
    };
  }

  /**
   * ⚠️ `date` না দিলে ঢাকার আজকের দিন — সার্ভারের নয়। সার্ভার UTC-তে চললে
   *    ঢাকার সকাল ৬টার আগে `new Date()`-এর তারিখ আগের দিন দেখাত।
   */
  private resolveWorkDate(raw?: string): Date {
    if (raw === undefined) return workDateOf(new Date());

    const parsed = parseWorkDate(raw);
    if (!parsed) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
    return parsed;
  }

  private async requireEmployee(
    employeeId: number,
  ): Promise<{ empCode: string; fullName: string }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { empCode: true, fullName: true },
    });
    if (!employee) throw new NotFoundException('No such staff member');
    return employee;
  }
}

function sumByEmployee(
  rows: Array<{ employeeId: number; _sum: { durationSec: number | null } }>,
): Map<number, number> {
  return new Map(rows.map((r) => [r.employeeId, r._sum.durationSec ?? 0]));
}

// ── সাত দিনের ফিতের প্রত্যাশা ───────────────────────────────────────────────

/**
 * ⭐ ফিতের এক দিনের প্রত্যাশা গুনতে একজন কর্মীর যা যা লাগে।
 *
 * ⭐ এই ফাংশনদুটো স্বভাবে `dashboard.math.ts`-এর, এই ফাইলের নয় — কিন্তু
 * ওই ফাইলটা এই কাজের সীমানার বাইরে (অন্য কেউ সমান্তরালে সেখানে কাজ
 * করছেন)। তাই আপাতত এখানে **module-স্তরে**, ক্লাসের বাইরে; সরানোটা
 * কাট-পেস্ট আর `test/trend-expectation.spec.ts`-এর import বদলানো।
 */
export interface TrendStaff {
  employeeId: number;
  /** ISO দিন (শুক্র = ৫)। `null` = প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস। */
  weeklyOffDay: number | null;
  joinedOn: Date | null;
  leftOn: Date | null;
  /**
   * ⭐⭐ **তার নিজের** সবচেয়ে পুরোনো `daily_summary.work_date`।
   *
   * ⚠️ `null` = এই কর্মীর একটাও সারি নেই, অর্থাৎ তাকে কোনোদিন দেখাই
   * হয়নি — তখন কোনো দিনেরই প্রত্যাশা দাবি করা হয় না।
   *
   * ⚠️⚠️ **এই এক জায়গায় `elapsedWindow()`-এর সাথে অমিল, আর সেটা এখানে
   * লিখে রাখা হলো।** ওখানে `trackingStartedOn: null` মানে "সীমাটা জানা
   * নেই, তাই জানালার উপর কোনো প্রভাব নেই" — অর্থাৎ কখনো না-দেখা কর্মীও
   * পুরো মাসের প্রত্যাশা পান। এখানে উল্টো: না দেখে থাকলে প্রত্যাশাও নেই।
   * ⭐ পার্থক্যটা **পর্দায় কখনো দেখা যায় না**, কারণ কলার কেবল সেই
   * কর্মীদেরই পাঠায় যাঁদের চলতি মাসের `monthly_summary` সারি আছে, আর
   * `refreshDate()` দৈনিক ও মাসিক সারি একসাথেই লেখে — মাসিক সারি থাকা
   * মানে দৈনিক সারিও আছে, মানে এই `null` অপৌঁছনীয়। দুটোর মধ্যে কড়াটাই
   * বাছা হয়েছে: "জানি না"-কে প্রত্যাশা বানানো এই ফাইলের মূল নিয়মের
   * বিরুদ্ধে যায় (নিয়ম ২)।
   */
  trackedFrom: Date | null;
  /** এক কর্মদিবসের টার্গেট (সেকেন্ড) — `monthly_summary` থেকে */
  dailyTargetSec: number;
}

/**
 * ⭐⭐ **ফিতের এক দিনে দলের প্রত্যাশা — মাসের কার্ড যে নিয়ম মানে, সেটাই।**
 *
 * ⚠️⚠️ আগে এটা `daily_summary` **সারি গুনে** হতো (`day_type !== 'holiday'`),
 * আর সেটা নীরবে ভুল ছিল: ছুটির দিনে কেউ এক ঘণ্টা কাজ করলে `dayTypeOf()`
 * দিনটাকে `worked` লেখে (`summary.math.ts`), তাই ওই ছুটির দিনটাই একটা
 * পুরো কর্মদিবসের **প্রত্যাশা** হয়ে যেত — ছুটির দিনে কাজ করার শাস্তি।
 * উল্টো দিকে সারি না থাকলে প্রত্যাশাও থাকত না, অর্থাৎ rollup পিছিয়ে
 * থাকলে দলের টার্গেট-রেখা নিজে থেকেই নেমে যেত।
 *
 * ⭐ তাই এখন প্রশ্নটা **ক্যালেন্ডারকে** করা হয়, সারিকে নয় — ঠিক যেমন
 * `summary.math.ts`-এর `elapsedWorkdays()` করে। চারটে সীমা, ওখানকার
 * `elapsedWindow()`-এর সাথে মিলিয়ে:
 *   ১· ওই দিনটা তার কর্মদিবস (সাপ্তাহিক ছুটি নয়, সরকারি ছুটিও নয়)
 *   ২· সে তখন কর্মরত (`joined_on` … `left_on`)
 *   ৩· দিনটা **তার নিজের** ট্র্যাকিং-শুরুর পরে — না দেখা দিন কারো ঘাটতি নয়
 *   ৪· …এবং জানালার শেষপ্রান্ত, যেটা এখানে **ইচ্ছাকৃতভাবে আলাদা** ⬇
 *
 * ⚠️⚠️ `elapsedWindow()` আজকের দিনটা বাদ দেয়, এই ফাংশন **দেয় না** — আর
 * সেটা ভুল নয়, ভিন্ন প্রশ্ন। মাসের কার্ড বলে "এ পর্যন্ত কত হওয়ার কথা
 * ছিল" (আজ শেষ হয়নি, তাই আজ বাদ); ফিতে বলে "**ওই দিনটার** টার্গেট কত
 * ছিল" (আজকেরও টার্গেট আছে, দিনটা কেবল চলছে)। ⚠️ এটাকে "সমান" করতে গিয়ে
 * আজকের প্রত্যাশা শূন্য করবেন না — `WeekAndMonth.tsx` `expectedStaff === 0`
 * দেখলে দিনটাকে "day off" লেখে, আর তখন বোর্ড দাবি করত আজ সবার ছুটি।
 *
 * ⚠️ দ্বিতীয় (ও শেষ) অমিলটা `TrendStaff.trackedFrom`-এর নোটে — কখনো
 * না-দেখা কর্মীর ক্ষেত্রে, আর সেটা পর্দায় অপৌঁছনীয়।
 */
export function trendDayExpectation(
  day: Date,
  staff: readonly TrendStaff[],
  holidays: ReadonlySet<number>,
): { expectedStaff: number; targetSec: number } {
  let expectedStaff = 0;
  let targetSec = 0;

  for (const s of staff) {
    if (!isExpectedOn(day, s, holidays)) continue;
    expectedStaff += 1;
    targetSec += s.dailyTargetSec;
  }

  // ⚠️ round এখানে হয় না — কলার একবারই করে (`Math.round`)। প্রতিটা
  //    কর্মীর ভাগ আলাদা করে round করলে দলের যোগফল মাসিক টার্গেটে গিয়ে
  //    ঠেকত না; `reports.range.ts`-এর `dailyTargetSec()`-এর নোটে একই কথা।
  return { expectedStaff, targetSec };
}

/** ⭐ একজন-এক দিন — উপরের চারটে সীমার তিনটে (চতুর্থটা কলারের প্রশ্নভেদে) */
function isExpectedOn(
  day: Date,
  s: TrendStaff,
  holidays: ReadonlySet<number>,
): boolean {
  const ms = day.getTime();

  // ⚠️ ট্র্যাকিং-শুরু আগে দেখা হয়, কারণ `null` মানে "জানি না" — আর তখন
  //    বাকি প্রশ্নগুলোর উত্তর জেনেও লাভ নেই
  if (s.trackedFrom === null || ms < s.trackedFrom.getTime()) return false;
  if (s.joinedOn !== null && ms < s.joinedOn.getTime()) return false;
  if (s.leftOn !== null && ms > s.leftOn.getTime()) return false;

  return isWorkday(day, { weeklyOffDay: s.weeklyOffDay, holidays });
}
