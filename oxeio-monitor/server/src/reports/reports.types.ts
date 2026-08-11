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

  /**
   * কর্মীপ্রতি **পুরো মাসের** টার্গেট ঘণ্টা (`employeeId` → ঘণ্টা)।
   *
   * ⭐ এটা হিসাব করার জিনিস নয় — নীতিতে লেখা সংখ্যাটাই (২০৮)। দৈনিক
   * টার্গেট = মাসিক ÷ মাসের কর্মদিবস, তাই সব কর্মদিবস যোগ করলে ফল
   * **সবসময়** মাসিক টার্গেটেই ফেরে, মাসে কটা শুক্রবার বা ছুটি থাকুক না কেন।
   *
   * ⚠️ পাঠানো হচ্ছে কারণ ওয়েব পাতা এটা **নিজে বানাতে গিয়ে ভুল করছিল**:
   * ভবিষ্যতের দিনগুলোতে শুধু সাপ্তাহিক ছুটি বাদ দিত, **সরকারি ছুটি নয়**।
   * আগস্ট ২০২৬-এ তাতে টার্গেট ২০৮ নয় ২১৬ দেখাত — অর্থাৎ প্রত্যেকে ৮ ঘণ্টা
   * বেশি পিছিয়ে আছেন বলে মনে হতো, অথচ পে-রোল হিসাব করত ২০৮ ধরে।
   * ড্যাশবোর্ড আর বেতন দুটো আলাদা সংখ্যা বললে কোনোটাই আর বিশ্বাসযোগ্য থাকে না।
   *
   * ⚠️ রেঞ্জ পুরো মাস না হলেও এটা **পুরো মাসেরই** — "এ পর্যন্ত কত হওয়ার
   * কথা" আলাদা জিনিস, সেটা `totals.targetHours`।
   */
  monthTargetHours: Record<number, number>;
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
  /**
   * ব্রাউজার হলে ডোমেইন, নইলে প্রসেসের নাম।
   * ⚠️ **স্বাভাবিক করা** — ছোট হাতের, ডোমেইনে `www.` ছাড়া
   * (`activity.math.ts`-এর `normalizeProcess` / `normalizeDomain`)। নইলে
   * `Chrome.exe` আর `chrome.exe` দুটো আলাদা সারি হয়ে টপ তালিকার জায়গা
   * নষ্ট করত, আর প্রত্যেকের সময় আসল সময়ের ভগ্নাংশ দেখাত।
   */
  key: string;
  kind: 'app' | 'site';
  category: UsageCategory;
  /** ক্যাটাগরির নিয়মে দেওয়া নাম, না মিললে null */
  displayName: string | null;
  /**
   * ⚠️ একাধিক **জানা** ক্যাটাগরি মিশে আছে কি না।
   *
   * `chrome.exe`-এর ক্যাটাগরি আসে ডোমেইন থেকে — youtube.com (unproductive)
   * আর github.com (productive) দুটোই একই প্রসেসে। `true` হলে পাশের
   * `category` কেবল **সবচেয়ে বড় ভাগ**, একক সত্য নয়।
   */
  mixed: boolean;
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
   * productive ÷ **মোট** ট্র্যাক করা সময় (অচিহ্নিতসহ)।
   *
   * ⚠️ `daily_summary.productivity_pct` বা `/activity/productivity`-র
   *    `scorePct`-এর সাথে হুবহু মিলবে ধরে নেবেন না — ওখানে হর কেবল
   *    **চিহ্নিত** সময়। এখানে অচিহ্নিত সময়ও হরে আছে, তাই নিয়ম যোগ হতে
   *    হতে সংখ্যাটা নিজে থেকেই বাড়ে। লুকিয়ে রাখলে "৯৫% productive"
   *    দেখা যেত অথচ অর্ধেক সময় অচিহ্নিত।
   *
   * ⭐ সম্পর্কটা হলো
   * `productiveSharePct = scorePct × (১০০ − uncategorizedSharePct) ÷ ১০০`,
   * আর তিনটে সংখ্যাই এখন **একই** ঝুড়ি থেকে আসে
   * ([activity.math.ts](../activity/activity.math.ts)-এর `scoreOf`)।
   */
  productiveSharePct: number;
  /**
   * ⭐ `activity.math.ts`-এর একমাত্র সংজ্ঞা: productive ÷ **চিহ্নিত** সময়।
   *
   * ⚠️ চিহ্নিত সময় শূন্য হলে `null`, `0` নয়। `0` বলত "এই লোক কিছুই
   *    productive করেনি", অথচ সত্যিটা "বলার মতো কোনো তথ্যই নেই"।
   *    ছুটির দিনে বা এজেন্ট বন্ধ থাকা দিনে পার্থক্যটা পুরো রিপোর্টের অর্থ বদলায়।
   */
  productivityScorePct: number | null;
  /**
   * মোট ট্র্যাক করা সময়ের কত শতাংশ অচেনা।
   * ⭐ স্কোরের পাশে এটা **সবসময়** যায় — ৯০% সময় অচেনা হলে ১০০% স্কোরও
   *    অর্থহীন, কিন্তু শুধু স্কোরটা দেখলে সেটা দারুণ দেখাত।
   */
  uncategorizedSharePct: number;
}

export interface ProductivityReport {
  meta: ReportMeta;
  totalTrackedHours: number;
  uncategorizedHours: number;
  top: ProductivityItem[];
  byEmployee: ProductivityEmployeeRow[];
}

/**
 * F05/F06 — নামসহ তৈরি ফাইল।
 *
 * ⚠️ `mime` সার্ভিসেই বসে, কন্ট্রোলারে নয়। কন্ট্রোলারে বসালে সেখানে আবার
 * "কোন ফরম্যাট চাওয়া হয়েছিল" মনে রাখতে হতো, আর একদিন `.pdf` নামের ফাইল
 * `xlsx` MIME নিয়ে যেত — ব্রাউজার তখন ওটা Excel দিয়ে খুলতে গিয়ে
 * "ফাইল নষ্ট" বলত, অথচ ফাইলটা ঠিকই ছিল।
 */
export interface ReportFile {
  filename: string;
  mime: string;
  buffer: Buffer;
}

/**
 * ⭐ এই একটা বাক্যই O4-কে খোলা রাখে। "OT × কোনো হার" লিখে ফেললে সেই হারটাই
 * নীরবে কোম্পানির নীতি হয়ে যেত, অথচ সিদ্ধান্তটা কেউ নেয়নি (ADR-023 note,
 * docs/05-Options-Decisions.md)।
 */
export const OVERTIME_NOTE =
  'Overtime pay is not calculated — no rate has been decided (open question O4)';
