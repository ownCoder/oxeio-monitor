import { api } from './client';

/**
 * **J04 · J05 · J08** — কর্মীর **নিজের** ডেটা।
 *
 * ⭐⭐ <b>এখানে কোনো `employeeId` প্যারামিটার নেই, আর সেটাই মূল নকশা।</b>
 * সার্ভার আইডিটা সেশন থেকে নেয়, পথ থেকে নয় — তাই ওয়েব থেকে সহকর্মীর
 * ডেটা চাওয়ার কোনো **উপায়ই নেই**। অন্য কোনো ফাইলে `/me/...`-এ আইডি
 * জুড়বেন না।
 *
 * ⚠️ টাইপগুলো `server/src/me/me.service.ts` পড়ে লেখা, অনুমান নয়।
 */

/** সার্ভারের `EmployeeProgress` — এজেন্টের tray-ও ঠিক এই সংখ্যাগুলোই পায় */
export interface MyProgress {
  todayActiveSec: number;
  monthActiveSec: number;
  monthlyTargetHours: number;
  /** + = এগিয়ে · − = পিছিয়ে (সেকেন্ডে) */
  paceSec: number;
  /** ⚠️ ছুটির দিনে ০ — তখন খালি বার নয়, একটা বাক্য দেখাতে হয় */
  dailyTargetSec: number;
  week7ActiveSec: number;
  week7TargetSec: number;
}

export interface MySummary {
  employee: {
    empCode: string;
    fullName: string;
    designation: string | null;
    joinedOn: string | null;
  };
  progress: MyProgress;
  policySignedAt: string | null;
  /** ⭐ সার্ভার থেকেই আসে — পর্দায় হাতে লেখা হলে নীতি বদলালে মিথ্যা বলত */
  screenshotRetentionDays: number;
}

export interface MyDay {
  workDate: string;
  workedSec: number;
  adjustmentSec: number;
  creditedSec: number;
  isOffDay: boolean;
}

export function getMySummary(signal?: AbortSignal): Promise<MySummary> {
  return api<MySummary>('/me', { signal });
}

/** নতুন দিন আগে — সার্ভারই সেই ক্রমে পাঠায় */
export function getMyDays(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<MyDay[]> {
  return api<MyDay[]>(
    `/me/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { signal },
  );
}

/**
 * **R21 — নিজের জামানত (সিকিউরিটি মানি)।**
 *
 * ⚠️ টাকার অঙ্ক **স্ট্রিং হিসেবে** আসে (`"500.00"`), সংখ্যা নয় — সার্ভারে
 * সব হিসাব পয়সায় (integer), আর JSON-এ number করে পাঠালে সেটা ভাসমান
 * দশমিকে গিয়ে কোনো কোনো অঙ্কে এক পয়সা এদিক-ওদিক হতো।
 */
export interface MyDepositMonth {
  /** '2026-08' */
  yearMonth: string;
  amount: string;
}

export interface MyDepositSettlement {
  outcome: 'refunded' | 'forfeited';
  amount: string;
  noticeGivenOn: string | null;
  lastWorkingDay: string | null;
  noticeDaysGiven: number | null;
  noticeDaysRule: number;
  note: string | null;
  settledAt: string;
  settledBy: string;
}

export interface MyDeposit {
  months: MyDepositMonth[];
  total: string;
  totalPaisa: number;
  /** নিষ্পত্তি হয়ে গেলে খাতা বন্ধ — তখন `total` কেবল ইতিহাস */
  settlement: MyDepositSettlement | null;
  /** ছাড়ার কত দিন আগে জানাতে হয় — পর্দায় শর্তটা লেখা থাকে */
  noticeDays: number;
}

export function getMyDeposit(signal?: AbortSignal): Promise<MyDeposit> {
  return api<MyDeposit>('/me/deposit', { signal });
}
