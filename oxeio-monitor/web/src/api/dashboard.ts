import { api } from './client';
import { qs } from './query';

/**
 * E01 · E02 · E04 · E05 — লাইভ বোর্ড, দিনের টাইমলাইন, ঘণ্টার চার্ট।
 *
 * সার্ভারের উৎস: `server/src/dashboard/` (live.controller.ts ·
 * employee-activity.controller.ts · dashboard.service.ts)।
 *
 * ⚠️ তিনটেই **owner + manager**। `role = employee` এখানে ঢুকলে ৪০৩ পাবে।
 */

/**
 * কার্ডের চারটে রঙ।
/**
 * কার্ডের **তিনটে** অবস্থা।
 *
 * ⚠️⚠️ **`agent_down` তুলে দেওয়া হয়েছে** *(১৭ আগস্ট)*। বোর্ড কোনোদিনই
 * নিশ্চিত করে বলতে পারত না এজেন্ট "মরেছে" নাকি "PC বন্ধ" — বিদায়ী
 * ইভেন্টটা এজেন্ট ডিস্কে লিখে রাখে আর পাঠায় পরের বার চালু হলে। দুবার
 * এই নিয়ম মাঠে ভেঙেছে, আর দুবারই সৎ মানুষ লাল দেখিয়েছে।
 *
 * ⭐ এজেন্ট সত্যিই ভাঙলে খবরটা আসে **অ্যালার্ট** হয়ে (`AgentDownCheck`),
 * যেখানে সাথে ব্যাখ্যাও থাকে — "no shutdown event arrived either"।
 */
export type LiveStatus = 'active' | 'idle' | 'offline';

/** টাইমলাইনের সেগমেন্টে অবশ্য `locked` আলাদা থাকে */
export type SegmentState = 'active' | 'idle' | 'locked';

export interface LiveCard {
  employeeId: number;
  empCode: string;
  fullName: string;
  designation: string | null;
  status: LiveStatus;
  /** ঢাকার আজকের দিনে গোনা সেকেন্ড */
  todayWorkedSec: number;

  /**
   * ⭐ এক কর্মদিবসের টার্গেট — লাইভ বোর্ডের রিং এখন **এটার** বিপরীতে
   * (`todayWorkedSec / dailyTargetSec`), মাসের ২০৮ ঘণ্টার নয়।
   *
   * ⚠️ ৮ ঘণ্টা কোনো ধ্রুবক **নয়**, বের করা সংখ্যা: মাসিক টার্গেট ÷ ওই
   *    মাসের কর্মদিবস (`dashboard.service.ts` → `reports.range.ts`-এর
   *    `dailyTargetSec`)। আগস্ট ২০২৬-এ ২০৮ ÷ ২৬ = ৮ ঘণ্টা, কিন্তু ২৭
   *    কর্মদিবসের মাসে ৭ঘ ৪২মি। ক্লায়েন্টে ৮ হার্ডকোড করলে কোনো কোনো মাসে
   *    টার্গেট নীরবে ভুল দেখাত — এই ভুলটাই মাসিক পাতায় ধরা পড়েছে
   *    (২০৮ vs ২১৬)। **সংখ্যাটা সবসময় এই ফিল্ড থেকে নিন।**
   *
   * ⚠️ কর্মীভেদে আলাদা: সাপ্তাহিক ছুটির বার ও মাসিক টার্গেট নীতিতে বাঁধা,
   *    তাই বোর্ডের সবার জন্য একটাই সংখ্যা ধরে নেওয়া যাবে না।
   */
  dailyTargetSec: number;

  /**
   * আজ **এই কর্মীর** কর্মদিবস কি না — সাপ্তাহিক ছুটি ও সরকারি ছুটি দুটোই
   * এখানে `false`।
   *
   * ⚠️ ছুটির দিনে "0h / 8h" দেখানো অন্যায় — ওই দিনে তার কিছু করার কথাই
   *    নয়। `false` হলে টার্গেটের বদলে "day off" লেখা হয় (`TeamRoster`)।
   *
   * ⚠️ কোনটা — সাপ্তাহিক ছুটি না সরকারি ছুটি — সেটা `/live` **বলে না**,
   *    শুধু bool। তাই কার্ডে নিরপেক্ষ "Day off" লেখা হয়; একটা বেছে নিলে
   *    অর্ধেক দিন ভুল শব্দ বসত।
   *
   * ⚠️ এটা ব্লক নয় — ছুটির দিনে কেউ কাজ করলে `todayWorkedSec` পুরোপুরি
   *    গোনা হয় (§ ২.১-খ), তাই ঘণ্টাটা তখনো দেখানো হয়।
   */
  todayIsWorkday: boolean;

  /** ⚠️ মাসের হিসাব এখন গৌণ (ছোট করে নিচে) — কিন্তু **বেতনের ভিত্তি এটাই** */
  monthWorkedSec: number;
  monthTargetSec: number;
  /**
   * শেষ heartbeat, ISO instant। কোনো ডিভাইস কখনো সাড়া না দিলে `null`।
   * ⚠️ সার্ভারে টাইপটা `Date`, কিন্তু JSON-এ এটা **স্ট্রিং** হয়ে আসে।
   */
  lastHeartbeatAt: string | null;

  /**
   * ⭐ `lastHeartbeatAt === null` **কেন** — সেটার ব্যাখ্যা।
   *
   * ⚠️ এটা ছাড়া কার্ড "Never checked in" লিখত, অথচ কারণটা হতে পারত
   * "ডিভাইসটা বন্ধ করে দেওয়া হয়েছে"। ফল ছিল একটা স্ববিরোধী কার্ড:
   * উপরে ১৬:৫০-এর স্ক্রিনশট, নিচে "কখনো সাড়া দেয়নি"।
   */
  agentPresence: 'never_installed' | 'switched_off' | 'installed';
}

export interface LiveBoard {
  /** ঢাকার আজকের কর্মদিবস, `YYYY-MM-DD` */
  workDate: string;
  /** ISO instant */
  generatedAt: string;
  cards: LiveCard[];
}

export interface TimelineSegment {
  /** ⚠️ স্ট্রিং — সার্ভারে BigInt, JS number-এ ধরে না */
  id: string;
  deviceId: number;
  state: SegmentState;
  /** ISO instant */
  startedAt: string;
  endedAt: string;
  /** monotonic ঘড়ি থেকে — দেয়ালঘড়ির ব্যবধানের সমান নাও হতে পারে */
  durationSec: number;
}

export interface Timeline {
  employeeId: number;
  empCode: string;
  fullName: string;
  /** `YYYY-MM-DD` */
  date: string;
  segments: TimelineSegment[];
  totals: { activeSec: number; idleSec: number; lockedSec: number };
}

/** E01 — সাত দিনের চার্টের একটা দিন (`GET /live/trend`) */
export interface TrendDay {
  /** ঢাকার কর্মদিবস, `YYYY-MM-DD` */
  date: string;
  workedSec: number;
  /**
   * ⭐⭐ ওই দিন আমরা আদৌ দেখছিলাম কি না।
   *
   * ⚠️ `false` মানে "কেউ কাজ করেনি" **নয়** — মানে ট্র্যাকিংই শুরু হয়নি।
   * চার্টে তাই ওই দিনগুলো ভরাট বার নয়, **ডটেড রূপরেখা**।
   */
  tracked: boolean;
  /** কতজনের সত্যিই টার্গেট ছিল — শূন্য মানে সবারই ছুটি */
  expectedStaff: number;
  targetSec: number;
}

/** E01 — চলতি মাসের কার্ড (`GET /live/trend`) */
export interface TrendMonth {
  yearMonth: string;
  creditedSec: number;
  targetSec: number;
  /** ⚠️ **ট্র্যাকিং শুরুর দিন থেকে** প্রত্যাশিত, মাসের ১ তারিখ থেকে নয় */
  expectedSec: number;
  /** credited − expected · ধনাত্মক = এগিয়ে */
  paceSec: number;
  trackedFrom: string | null;
}

/** E01 — **আজীবন** সবচেয়ে বেশি ঘণ্টা যাঁদের */
export interface TrendLeader {
  employeeId: number;
  fullName: string;
  /** ⭐ সব মাস মিলিয়ে — চলতি মাসের নয় */
  creditedSec: number;
}

export interface TeamTrend {
  /** সবসময় ৭টা, আজ সহ — পুরোনো আগে */
  days: TrendDay[];
  month: TrendMonth;
  /**
   * ⭐ সর্বোচ্চ পাঁচজন, **আজীবন** বেশি ঘণ্টা উপরে।
   *
   * ⚠️ যিনি আগে যোগ দিয়েছেন তিনি স্থায়ীভাবে উপরে থাকেন — নতুন কেউ
   *    ধরতে পারেন না। কার্ডে প্রতিটা নামের পাশে আসল ঘণ্টাটা লেখা থাকে,
   *    যাতে ক্রমটা কীসের উপর দাঁড়ানো সেটা পর্দাতেই দেখা যায়।
   */
  leaders: TrendLeader[];
  /**
   * ⭐⭐ শেষ ৩০ দিনের ক্রম — কার্ডে **এটাই ডিফল্ট**।
   *
   * ⚠️ আজীবনের তালিকায় যিনি আগে যোগ দিয়েছেন তিনি স্থায়ীভাবে উপরে থাকেন
   *    (ঘণ্টা জমে, কমে না), তাই ওটা "কে ভালো করছে"-র বদলে "কে বেশিদিন
   *    আছে" বলে। ৩০ দিনের জানালা সবাইকে একই মাপে আনে।
   */
  leaders30: TrendLeader[];
}

/** E01 — দলের দিনের ছন্দের এক ঘণ্টা (`GET /live/pulse`) */
export interface TeamHour {
  /** ঢাকার স্থানীয় ঘণ্টা, ০–২৩ */
  hour: number;
  /** ওই ঘণ্টায় দলের মোট গোনা সেকেন্ড */
  activeSec: number;
  /**
   * ওই ঘণ্টায় কতজন কিছু না কিছু কাজ করেছেন।
   *
   * ⚠️ চার্টে **আঁকা হয় না** — একই অক্ষে দুটো মাপ বসালে সেটা dual-axis
   * হয়ে যেত, আর ওটা চার্টের সবচেয়ে চেনা মিথ্যা। সংখ্যাটা hover-এ থাকে,
   * কারণ "৬ ঘণ্টা" মানে ছ-জন এক ঘণ্টা না একজন ছ-ঘণ্টা — সেটা আলাদা গল্প।
   */
  people: number;
}

export interface TeamPulse {
  /** ঢাকার কর্মদিবস, `YYYY-MM-DD` */
  date: string;
  /** ⭐ সবসময় ২৪টা — খালি ঘণ্টাও শূন্য নিয়ে থাকে */
  hours: TeamHour[];
  totalActiveSec: number;
  peakPeople: number;
}

export interface HourlyBucket {
  /** ঢাকার স্থানীয় ঘণ্টা, ০–২৩ */
  hour: number;
  activeSec: number;
}

export interface HourlyChart {
  employeeId: number;
  date: string;
  /** ⭐ সবসময় ২৪টা — খালি ঘণ্টাও `activeSec: 0` নিয়ে থাকে */
  buckets: HourlyBucket[];
  totalActiveSec: number;
}

/**
 * E01/E02 — `GET /api/v1/live`
 *
 * ⭐ `usePolling(getLiveBoard, 30_000, [])` — ৩০ সেকেন্ডে রিফ্রেশ।
 *
 * ⚠️ `todayWorkedSec`/`monthWorkedSec` **যোগফল**, UNION নয় — কেউ একইসাথে
 *    দুই PC চালালে ওই সময়টা দুবার গোনা হয়। ইচ্ছাকৃত (এজেন্টের tray-তেও
 *    একই সংখ্যা দেখানো হয়), আর ১৫ মিনিটের বেশি overlap-এ `device_overlap`
 *    অ্যালার্ট ওঠে। এই endpoint-এ কোনো `caveat` ফিল্ড আসে না।
 */
export function getLiveBoard(signal?: AbortSignal): Promise<LiveBoard> {
  return api<LiveBoard>('/live', { signal });
}

/**
 * E01 — `GET /api/v1/live/pulse` · দলের দিনের ছন্দ, ২৪টা ঘণ্টা।
 *
 * ⚠️ বোর্ডের সাথে **এক তালে রিফ্রেশ হয় না** (`/live` ৩০ সেকেন্ড, এটা
 *    ধীরে) — এক ঘণ্টার বালতি ৩০ সেকেন্ডে একবার আনা মানে একই উত্তর
 *    ১২০ বার আনা।
 */
export function getTeamPulse(signal?: AbortSignal): Promise<TeamPulse> {
  return api<TeamPulse>('/live/pulse', { signal });
}

/**
 * E01 — `GET /api/v1/live/trend` · সাত দিন ও চলতি মাস।
 *
 * ⚠️ `pulse`-এর মতোই ধীরে ডাকা হয় — দিনের যোগফল ও মাসের rollup দুটোই
 *    ১৫ মিনিটের জবে তৈরি হয় (K06), তাই ৩০ সেকেন্ডে ডাকা নিরর্থক।
 */
export function getTeamTrend(signal?: AbortSignal): Promise<TeamTrend> {
  return api<TeamTrend>('/live/trend', { signal });
}

/**
 * E04 — `GET /api/v1/employees/:id/timeline?date=YYYY-MM-DD`
 *
 * ⚠️ `date` না দিলে সার্ভার ঢাকার আজকের দিন ধরে। কিন্তু পেজে তারিখ
 *    বাছাই থাকলে `todayInDhaka()` দিয়ে স্পষ্ট করে পাঠানোই ভালো — নইলে
 *    ব্যবহারকারীর বাছা তারিখ আর দেখানো ডেটা আলাদা হয়ে যেতে পারে।
 */
export function getTimeline(
  employeeId: number,
  date?: string,
  signal?: AbortSignal,
): Promise<Timeline> {
  return api<Timeline>(`/employees/${employeeId}/timeline${qs({ date })}`, {
    signal,
  });
}

/** E05 — `GET /api/v1/employees/:id/hourly?date=YYYY-MM-DD` */
export function getHourly(
  employeeId: number,
  date?: string,
  signal?: AbortSignal,
): Promise<HourlyChart> {
  return api<HourlyChart>(`/employees/${employeeId}/hourly${qs({ date })}`, {
    signal,
  });
}
