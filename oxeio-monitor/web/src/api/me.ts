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
