import type { Productivity } from '@prisma/client';

import type { GroupBy } from './reports.range';

/**
 * রিপোর্টের রেসপন্সের আকৃতি — সার্ভিস এগুলো বানায়, Excel-ভিউ (reports.sheets.ts)
 * এগুলোই পড়ে, আর কন্ট্রোলার এগুলোই ফেরত দেয়।
 *
 * আলাদা ফাইলে রাখার কারণ: কোয়েরি আর ছাপার লেআউট দুটোরই একই চুক্তি দরকার,
 * কিন্তু একজন আরেকজনকে import করলে চক্র তৈরি হতো।
 *
 * ⚠️ এই ফাইলে **টাকার কোনো ফিল্ড নেই এবং কখনো যোগ করা যাবে না** —
 *    ম্যানেজারও এই রিপোর্টগুলো পান (§ ৪.৩), বেতন শুধু owner-এর
 *    (`src/payroll/`, ADR-023)।
 */

export interface ReportMeta {
  from: string;
  to: string;
  /** যা চাওয়া হয়েছিল — `clampedToToday` হলে `to`-র চেয়ে পরে */
  requestedTo: string;
  clampedToToday: boolean;
  days: number;
  generatedAt: string;
  /**
   * যাদের রাখা যায়নি (inactive, অথচ কবে ছেড়েছেন লেখা নেই)।
   * ⭐ চুপচাপ বাদ না দিয়ে নাম ধরে জানানো হয় — নইলে "সবাই আছে" ভেবে
   * কেউ মিলিয়ে দেখত না।
   */
  excludedEmployees: string[];
}

export type DayType = 'workday' | 'weekly_off' | 'holiday';
export type DayStatus = 'worked' | 'no_activity';

/**
 * ⭐ এখানে `first_activity_at` / `latest_hour` **ইচ্ছাকৃতভাবে নেই**। ওগুলো
 * `daily_summary`-তে আছে, কিন্তু অ্যাটেনডেন্স শিটে "কে কখন বসল" কলামটা
 * থাকলেই সেটা কার্যত লেট-রিপোর্ট হয়ে যেত — আর লেট ট্র্যাকিং এই পণ্যে
 * নেই (ADR-011)। রিপোর্ট শুধু বলে কত ঘণ্টা হয়েছে, কখন হয়েছে নয়।
 */
export interface AttendanceRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  department: string | null;
  date: string;
  dayType: DayType;
  status: DayStatus;
  workedHours: number;
  idleHours: number;
  adjustmentHours: number;
  creditedHours: number;
  targetHours: number;
}

export interface AttendanceReport {
  meta: ReportMeta;
  rows: AttendanceRow[];
  totals: {
    employees: number;
    rows: number;
    workedHours: number;
    creditedHours: number;
    targetHours: number;
    daysWithWork: number;
  };
}

export interface SummaryRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  /** মাসে 'YYYY-MM', সপ্তাহে সপ্তাহ-শুরুর তারিখ */
  bucket: string;
  /** বালতির যতটুকু রেঞ্জে ও কর্মকালে পড়েছে — পুরো মাস/সপ্তাহ নয় */
  bucketStart: string;
  bucketEnd: string;
  /** ওই ঢাকা দিনগুলোর মধ্যে কর্মদিবস কয়টি */
  workdays: number;
  daysWithWork: number;
  workedHours: number;
  adjustmentHours: number;
  creditedHours: number;
  targetHours: number;
  shortfallHours: number;
  overtimeHours: number;
}

export interface SummaryReport {
  meta: ReportMeta;
  groupBy: GroupBy;
  /** ⚠️ O4 — OT-র টাকা এই সিস্টেম হিসাব করে না, শুধু ঘণ্টা */
  overtimeNote: string;
  rows: SummaryRow[];
}

export type UsageCategory = Productivity | 'uncategorized';

export interface ProductivityItem {
  /** ব্রাউজার হলে ডোমেইন, নইলে প্রসেসের নাম */
  key: string;
  kind: 'app' | 'site';
  category: UsageCategory;
  /** ক্যাটাগরির নিয়মে দেওয়া নাম, না মিললে null */
  displayName: string | null;
  hours: number;
  sharePct: number;
}

export interface ProductivityEmployeeRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  productiveHours: number;
  neutralHours: number;
  unproductiveHours: number;
  uncategorizedHours: number;
  trackedHours: number;
  /**
   * productive ÷ মোট ট্র্যাক করা সময়।
   * ⚠️ `daily_summary.productivity_pct`-এর সাথে হুবহু মিলবে ধরে নেবেন না —
   *    এখানে uncategorized সময়ও হরে আছে, তাই নিয়ম যোগ হতে হতে সংখ্যাটা
   *    নিজে থেকেই বাড়ে। লুকিয়ে রাখলে "৯৫% productive" দেখা যেত অথচ
   *    অর্ধেক সময় অচিহ্নিত।
   */
  productiveSharePct: number;
}

export interface ProductivityReport {
  meta: ReportMeta;
  totalTrackedHours: number;
  uncategorizedHours: number;
  top: ProductivityItem[];
  byEmployee: ProductivityEmployeeRow[];
}

/** F05 — নামসহ তৈরি .xlsx */
export interface ReportFile {
  filename: string;
  buffer: Buffer;
}

/**
 * ⭐ এই একটা বাক্যই O4-কে খোলা রাখে। "OT × কোনো হার" লিখে ফেললে সেই হারটাই
 * নীরবে কোম্পানির নীতি হয়ে যেত, অথচ সিদ্ধান্তটা কেউ নেয়নি (ADR-023 note,
 * docs/05-Options-Decisions.md)।
 */
export const OVERTIME_NOTE =
  'অতিরিক্ত ঘণ্টার টাকা হিসাব করা হয়নি — হার নির্ধারিত নয় (open question O4)';
