import { api } from './client';
import { qs } from './query';

/**
 * G01–G07 — অ্যালার্টের তালিকা ও acknowledge।
 *
 * সার্ভারের উৎস: `server/src/alerts/` (alerts.controller.ts ·
 * alerts.service.ts · alerts.constants.ts)।
 *
 * ⚠️ পুরোটাই **owner-only** — অ্যালার্টে হোস্টনেম, কর্মীর নাম আর ডিভাইসের
 *    অবস্থা একসাথে থাকে, আর সেগুলো ম্যানেজারের নাগালের বাইরে (§ ৪.৩)।
 *    ম্যানেজারকে অ্যালার্টের ব্যাজটাও দেখাবেন না।
 */

export type AlertType =
  | 'agent_down'
  | 'agent_killed'
  | 'disk_warning'
  | 'disk_critical'
  | 'backup_failed'
  | 'clock_drift'
  | 'no_activity_today'
  | 'device_overlap'
  | 'synthetic_input';

export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * পর্দায় দেখানোর নাম — সব পেজে এক থাকুক।
 *
 * ⚠️ এখনো কোনো পেজ এগুলো render করে না (অ্যালার্টের পাতাটা এখনো নেই)।
 *    তবু বাকি UI-র সাথে **একই ভাষায়** রাখা হলো, নইলে পাতাটা যেদিন লেখা
 *    হতো সেদিন গোটা ড্যাশবোর্ড ইংরেজি অথচ অ্যালার্টের তালিকা বাংলা —
 *    আর ততদিনে কেউ মনে রাখত না এই ফাইলটা অনুবাদ বাকি ছিল।
 *
 * ⚠️ `agent_down`-এর লেখাটা `StatusDot`-এর `STATUS_LABEL`-এর সাথে **হুবহু
 *    এক** ("Agent down") — একই ঘটনা দুই পর্দায় দুই নামে ডাকলে ওগুলো
 *    আলাদা জিনিস মনে হতো।
 */
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  agent_down: 'Agent down',
  agent_killed: 'Agent was stopped',
  disk_warning: 'Disk filling up',
  disk_critical: 'Disk almost full',
  backup_failed: 'Backup failed',
  clock_drift: 'Clock drift',
  no_activity_today: 'No activity today',
  device_overlap: 'Two devices at once',
  /**
   * ⭐ **G46** — নাম ইচ্ছাকৃতভাবে নিরপেক্ষ: "Unbroken activity", "Fake
   * input" নয়। অ্যালার্টটা সন্দেহ, প্রমাণ নয় — আর ফিল্টারের ড্রপডাউনে
   * "Fake input" লেখা থাকলে মালিক তালিকাটা খুলেই সিদ্ধান্ত নিয়ে ফেলতেন।
   */
  synthetic_input: 'Unbroken activity',
};

export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

export interface AlertRow {
  /** ⚠️ স্ট্রিং — সার্ভারে BigInt */
  id: string;
  /** ⚠️ কলামটা TEXT, তাই তালিকার বাইরের মানও তাত্ত্বিকভাবে আসতে পারে */
  type: string;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  deviceId: number | null;
  deviceHostname: string | null;
  employeeId: number | null;
  employeeName: string | null;
  meta: unknown;
  /** কোন কোন চ্যানেলে পাঠানো হয়েছে (`email` …) */
  channelsSent: string[];
  acknowledgedAt: string | null;
  /** যিনি প্রথম "দেখেছি" বলেছিলেন — পরে কেউ ডাকলেও নাম বদলায় না */
  acknowledgedBy: string | null;
  /**
   * ⭐ সার্ভার **নিজে** বন্ধ করেছে (এজেন্ট ফিরে এসেছে) — কোনো মানুষ দেখেনি।
   *    acknowledgedAt থেকে আলাদা: "open" মানে দুটোই null।
   */
  resolvedAt: string | null;
  createdAt: string;
}

export interface AlertPage {
  total: number;
  page: number;
  limit: number;
  /** ⭐ ফিল্টার যাই হোক, এখনো acknowledge হয়নি এমন মোট সংখ্যা — nav ব্যাজে এটাই */
  openCount: number;
  rows: AlertRow[];
}

export interface AlertListQuery {
  /** ডিফল্ট `open` — তালিকাটার উদ্দেশ্যই "এখনো দেখা বাকি" */
  status?: 'open' | 'all';
  type?: AlertType;
  severity?: AlertSeverity;
  page?: number;
  /** ডিফল্ট ৫০, সর্বোচ্চ ২০০ */
  limit?: number;
}

export function listAlerts(
  query: AlertListQuery = {},
  signal?: AbortSignal,
): Promise<AlertPage> {
  return api<AlertPage>(`/alerts${qs({ ...query })}`, { signal });
}

/**
 * "দেখেছি" বলা।
 *
 * ⚠️ অ্যালার্ট কখনো **ডিলিট হয় না**, শুধু acknowledged হয় — তাই UI-তে
 *    "মুছে ফেলুন" নয়, "দেখেছি" লিখুন। ইতিহাসটাই পরে ঘণ্টা সংশোধনের প্রমাণ।
 *
 * ⭐ idempotent, আর **প্রথমজনের নামই থেকে যায়**।
 */
export function acknowledgeAlert(id: string): Promise<AlertRow> {
  return api<AlertRow>(`/alerts/${id}/acknowledge`, { method: 'POST' });
}

/**
 * ⭐ একসাথে সব খোলা অ্যালার্ট "দেখেছি" — G01-এর মতো একই জিনিস ১২টা PC-তে
 * বারবার এলে এক-এক করে চাপার যন্ত্রণা কমায়।
 *
 * ⚠️ আগে-দেখা সারি ছোঁয় না; ফেরত দেয় কতগুলো নতুন করে seen হলো।
 */
export function acknowledgeAllAlerts(): Promise<{ count: number }> {
  return api<{ count: number }>(`/alerts/acknowledge-all`, { method: 'POST' });
}
