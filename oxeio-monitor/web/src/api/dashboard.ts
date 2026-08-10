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
 *
 * ⭐ `agent_down` (এজেন্ট মরে গেছে — IT-র সমস্যা) আর `offline` (কর্মী চলে
 * গেছে — স্বাভাবিক) সম্পূর্ণ আলাদা ঘটনা। একটাকে আরেকটার রঙে দেখালে হয়
 * মিথ্যা অভিযোগ হয়, নয় আসল সমস্যা চাপা পড়ে। তাই `agent_down` = **সলিড
 * লাল**, `offline` = ধূসর (`StatusDot` এটাই মেনে চলে)।
 *
 * ⚠️ সেগমেন্টের `locked` এখানে `idle`-এ মেশে — বোর্ডে মাত্র চারটে রঙ।
 */
export type LiveStatus = 'active' | 'idle' | 'offline' | 'agent_down';

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
  /** ⭐ E02 — রিংটা **মাসিক**, দৈনিক নয় */
  monthWorkedSec: number;
  monthTargetSec: number;
  /**
   * শেষ heartbeat, ISO instant। কোনো ডিভাইস কখনো সাড়া না দিলে `null`।
   * ⚠️ সার্ভারে টাইপটা `Date`, কিন্তু JSON-এ এটা **স্ট্রিং** হয়ে আসে।
   */
  lastHeartbeatAt: string | null;
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
