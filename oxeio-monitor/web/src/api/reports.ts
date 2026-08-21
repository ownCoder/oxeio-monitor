import { api } from './client';
import { qs } from './query';

/**
 * F01 · F02 · F03 · F04 · F05 · F08 — রিপোর্ট, Excel এক্সপোর্ট ও পে-রোল।
 *
 * সার্ভারের উৎস: `server/src/reports/` ও `server/src/payroll/`।
 *
 * ⚠️ `/reports/*` — owner + manager। `/payroll` — **owner-only**, আলাদা
 *    মডিউল। এই ফাইলে দুটো একসাথে আছে বলে ভুলে যাবেন না: পে-রোলের কিছুই
 *    ম্যানেজারকে **দেখানো যাবে না** (§ ৪.৩, ADR-023)।
 *
 * ⚠️ `from` ও `to` **বাধ্যতামূলক** (activity-র মতো ঐচ্ছিক নয়)। না দিলে ৪০০।
 *    ডিফল্ট রেঞ্জের জন্য `thisMonthRange()` আছে `lib/format.ts`-এ।
 */

export type ReportFormat = 'json' | 'xlsx';
export type GroupBy = 'week' | 'month';
export type DayType = 'workday' | 'weekly_off' | 'holiday';
export type DayStatus = 'worked' | 'no_activity';

export interface ReportMeta {
  from: string;
  to: string;
  /** যা চাওয়া হয়েছিল — `clampedToToday` হলে `to`-র চেয়ে পরে */
  requestedTo: string;
  /**
   * ⭐ ভবিষ্যতের তারিখ চাইলে সার্ভার চুপচাপ আজ পর্যন্ত ছেঁটে দেয়, কিন্তু
   * সেটা **জানিয়ে** দেয়। সত্যি হলে পেজে বলতে হবে — নইলে "১–৩১ আগস্ট"
   * চেয়ে ১১ তারিখ পর্যন্ত ডেটা দেখে কেউ ভাবত সবাই পিছিয়ে আছে।
   */
  clampedToToday: boolean;
  days: number;
  generatedAt: string;
  /** ⭐ যাদের রাখা যায়নি — চুপচাপ বাদ না দিয়ে নাম ধরে জানানো হয় */
  excludedEmployees: string[];

  /**
   * কর্মীপ্রতি **নীতিতে লেখা** মাসিক টার্গেট ঘণ্টা (`employeeId` → ঘণ্টা),
   * অর্থাৎ "২৬ আদর্শ কর্মদিবসে যত ঘণ্টা" (২০৮)।
   *
   * ⚠️ এটা নিজে হিসাব করা যাবে না — আগে করা হতো, আর ভবিষ্যতের সরকারি
   * ছুটি বাদ পড়ায় ২০৮-এর জায়গায় ২১৬ দেখাত।
   *
   * ⚠️⚠️ **ওই মাসের আসল মোট টার্গেট এটা নয়।** দৈনিক টার্গেট ২০৮ ÷ ২৬ = ৮
   * ঘণ্টা, একটা ধ্রুবক — তাই ২৫ কর্মদিবসের মাসে মোট ২০০ ঘণ্টা। মাসের
   * দিনের টার্গেট যোগ করলে এই সংখ্যাটা ফিরে আসবে না; খোলা প্রশ্ন হিসেবে
   * docs/08-Gap-Analysis.md-এ লেখা আছে।
   */
  monthTargetHours: Record<number, number>;

  /**
   * ⭐⭐ কর্মীপ্রতি **এ পর্যন্ত কত ঘণ্টা হওয়ার কথা ছিল** (`employeeId` → ঘণ্টা)।
   *
   * ⚠️⚠️ **এটাও নিজে হিসাব করা যাবে না, আর কারণটা এই পাতার সবচেয়ে বড় বাগ:**
   * আগে Monthly পাতা দিনের সারিগুলোর `targetHours` যোগ করে নিজেই বানাত —
   * মাসের ১ তারিখ থেকে আজ ধরে। কিন্তু ব্রাউজার দুটো জিনিস জানে না:
   *   ১· **কর্মীকে কবে থেকে ট্র্যাক করা শুরু হয়েছে।** এই ইনস্টলেশনে
   *      এজেন্ট বসেছে ১৩ আগস্ট ২০২৬; তার আগের দিনগুলো নীরবে "০ ঘণ্টা কাজ"
   *      হয়ে যেত আর পাতাটা প্রত্যেককে ~৯৪ ঘণ্টা পিছিয়ে দেখাত।
   *   ২· **আজকের দিনটা প্রত্যাশায় ধরা হয় না** — নইলে ভোরে সবাই "পিছিয়ে"
   *      দেখাত আর সন্ধ্যায় সংখ্যাটা নিজে থেকেই ঠিক হয়ে যেত।
   *
   * ⭐ জানালাটা সার্ভারের `summary.math.ts` → `elapsedWindow()` ঠিক করে,
   * আর tray, Live Board ও দৈনিক ইমেইলও ঠিক ওটাই ব্যবহার করে। ক্লায়েন্টে
   * নিয়মটা আবার লিখলে সেটাই হতো পরের অমিলের জন্ম।
   *
   * ⚠️ **রেঞ্জ-নির্ভর** — `monthTargetHours` উল্টো (রেঞ্জ যাই হোক, পুরো মাস)।
   */
  expectedHours: Record<number, number>;
}

/**
 * ⭐ এখানে "কে কখন বসল" নেই এবং কখনো থাকবে না — লেট ট্র্যাকিং এই পণ্যে
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
  /** ⚠️ ঘণ্টা (দশমিক), সেকেন্ড নয় — `formatHoursAsDuration()` দিয়ে দেখান */
  workedHours: number;
  idleHours: number;
  adjustmentHours: number;
  creditedHours: number;
  /**
   * ওই দিনটার টার্গেট — কর্মদিবসে ২০৮ ÷ ২৬ = ৮ ঘণ্টা, ছুটিতে ০।
   * ⚠️ হর পলিসির ধ্রুবক, ওই মাসের কর্মদিবস নয় — তাই সংখ্যাটা মাসভেদে
   *    বদলায় না আর tray-র সাথে হুবহু মেলে।
   */
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
    /**
     * ⚠️⚠️ **উপরের Target কলামের যোগফল** — "এ পর্যন্ত কত হওয়ার কথা ছিল"
     * নয় (সেটা `meta.expectedHours`)। ট্র্যাকিং শুরুর আগের দিন ও আজকের
     * অসমাপ্ত দিনও এতে আছে, কারণ ওই সারিগুলোও তালিকায় আছে। ফুটারে এটা
     * কলামের নিচেই বসে বলে অন্য কোনো জানালায় নেওয়া যায়নি — মোট আর
     * কলামের যোগফল আলাদা হলে সেটা আরও খারাপ হতো। **এটা দিয়ে ঘাটতি
     * বোঝাবেন না।**
     */
    targetHours: number;
    daysWithWork: number;
  };
}

export interface SummaryRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  /** মাসে `'YYYY-MM'`, সপ্তাহে সপ্তাহ-শুরুর তারিখ */
  bucket: string;
  /** বালতির যতটুকু রেঞ্জে ও কর্মকালে পড়েছে — পুরো মাস/সপ্তাহ নয় */
  bucketStart: string;
  bucketEnd: string;
  workdays: number;
  daysWithWork: number;
  workedHours: number;
  adjustmentHours: number;
  creditedHours: number;
  /**
   * এই বালতির যে দিনগুলো রেঞ্জে ও কর্মকালে পড়েছে, তাদের টার্গেটের যোগফল।
   * ⚠️ **প্রত্যাশা নয়** — ট্র্যাকিং শুরুর আগের দিন ও আজকের দিনও এতে আছে।
   *    `targetHours − creditedHours` দিয়ে ঘাটতি বানাবেন না; সেটাই ছিল
   *    আগের বাগ। নিচের `shortfallHours` ইতিমধ্যেই সঠিক জানালায় হিসাব করা।
   */
  targetHours: number;
  /**
   * ⭐⭐ **max(0, প্রত্যাশা − গোনা ঘণ্টা)** — হর `meta.expectedHours`-এর
   * সেই একই জানালা (ট্র্যাকিং শুরু … গতকাল), শুধু এই বালতিটুকুর জন্য কাটা।
   *
   * ⚠️ টার্গেট ক্যালেন্ডারের তথ্য, ঘাটতি একজন মানুষ সম্পর্কে **রায়** —
   *    রায় কেবল দেখা ও শেষ হওয়া দিনের উপর হতে পারে। তাই এই কলাম আর
   *    Target কলাম বিয়োগ করে মিলবে না, আর সেটাই ঠিক।
   */
  shortfallHours: number;
  /**
   * ⭐ **max(0, গোনা ঘণ্টা − targetHours)** — হর পুরো টার্গেট, প্রত্যাশা নয়।
   * ⚠️ প্রত্যাশা ধরলে আজকের কাজ করা ঘণ্টা সবার নামে "অতিরিক্ত" হয়ে যেত,
   *    অথচ মাসের টার্গেটই ছোঁয়া হয়নি। "এগিয়ে আছি" (pace) আর "বেশি কাজ
   *    করেছি" (overtime) এক কথা নয়।
   */
  overtimeHours: number;
}

export interface SummaryReport {
  meta: ReportMeta;
  groupBy: GroupBy;
  /** ⚠️ O4 — OT-র টাকা এই সিস্টেম হিসাব করে না, শুধু ঘণ্টা। বাক্যটা দেখাতে হবে। */
  overtimeNote: string;
  rows: SummaryRow[];
}

export type UsageCategory =
  | 'productive'
  | 'neutral'
  | 'unproductive'
  | 'uncategorized';

export interface ProductivityItem {
  /** ব্রাউজার হলে ডোমেইন, নইলে প্রসেসের নাম */
  key: string;
  kind: 'app' | 'site';
  category: UsageCategory;
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
  /** ⚠️ হরে uncategorized সময়ও আছে — `daily_summary`-র সংখ্যার সাথে হুবহু মিলবে না */
  productiveSharePct: number;
}

/** F04। ⚠️ `activity.ts`-এর `DailyProductivityReport` (D07) আলাদা জিনিস। */
export interface ProductivityReport {
  meta: ReportMeta;
  totalTrackedHours: number;
  uncategorizedHours: number;
  top: ProductivityItem[];
  byEmployee: ProductivityEmployeeRow[];
}

export interface ReportQuery {
  /** বাধ্যতামূলক, `YYYY-MM-DD` */
  from: string;
  to: string;
  /** একজনের রিপোর্ট চাইলে */
  employeeId?: number;
}

/** F01 — `GET /api/v1/reports/attendance?from=&to=&employeeId=` */
export function getAttendanceReport(
  query: ReportQuery,
  signal?: AbortSignal,
): Promise<AttendanceReport> {
  return api<AttendanceReport>(`/reports/attendance${qs({ ...query })}`, {
    signal,
  });
}

/** F02 — `GET /api/v1/reports/summary?from=&to=&groupBy=week|month` */
export function getSummaryReport(
  query: ReportQuery & { groupBy?: GroupBy },
  signal?: AbortSignal,
): Promise<SummaryReport> {
  return api<SummaryReport>(`/reports/summary${qs({ ...query })}`, { signal });
}

/** F04 — `GET /api/v1/reports/productivity?from=&to=&limit=` (limit সর্বোচ্চ ২০০) */
export function getProductivityReport(
  query: ReportQuery & { limit?: number },
  signal?: AbortSignal,
): Promise<ProductivityReport> {
  return api<ProductivityReport>(`/reports/productivity${qs({ ...query })}`, {
    signal,
  });
}

/**
 * F05 — Excel ডাউনলোডের লিঙ্ক।
 *
 * ⭐ `fetch` দিয়ে নয়, সাধারণ `<a href={...} download>` দিয়ে খুলুন। সার্ভার
 * `Content-Disposition: attachment` পাঠায়, cookie একই origin-এ নিজে থেকেই
 * যায়, আর ব্রাউজারের নিজস্ব ডাউনলোড UI-টাই সবচেয়ে পরিচিত।
 *
 * ⚠️ পথে `/api/v1` প্রিফিক্সটা এখানে হাতে বসানো — `api()` ওটা নিজে যোগ করে,
 *    কিন্তু এই স্ট্রিংটা `api()`-তে যায় না, সরাসরি href-এ বসে।
 */
export function reportXlsxUrl(
  kind: 'attendance' | 'summary' | 'productivity',
  query: ReportQuery & { groupBy?: GroupBy; limit?: number },
): string {
  return `/api/v1/reports/${kind}${qs({ ...query, format: 'xlsx' })}`;
}

// ── F03 · পে-রোল (owner-only) ───────────────────────────────────────────────

export interface PayrollRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  /**
   * ⭐ কাজের ধরন *(২২ আগস্ট)* — আগে এখানে `designation` ছিল।
   *
   * ⚠️ পদবির ঘরটা ফর্ম থেকে তুলে দেওয়া হয়েছে (মালিকের সিদ্ধান্ত), তাই
   * নতুন কর্মীর জন্য ওটা চিরকাল খালি থাকত — অর্থাৎ পর্দায় নীরবে কিছুই
   * দেখাত না।
   */
  staffType: 'designer' | 'researcher' | 'manager' | null;
  /**
   * ⭐ `null` = এই কর্মীর বেতন **বসানো নেই** — শূন্য নয়। দুটোকে এক করে
   * দেখালে শিটে চুপচাপ ভুল সংখ্যা যেত।
   * ⚠️ সব টাকা ও ঘণ্টা **স্ট্রিং** — Decimal, float নয়। `Number()` করে
   *    হিসাব করবেন না, `formatTaka()` / `formatHoursAsDuration()` ব্যবহার করুন।
   */
  monthlySalary: string | null;
  targetHours: string;
  /** ⭐ G37 — তার কর্মদিবস (d) ও মাসের কর্মদিবস (D)। d < D মানে prorated */
  workdays: number;
  monthWorkdays: number;
  creditedHours: string;
  shortfallHours: string;
  overtimeHours: string;
  hourlyRate: string | null;
  deduction: string | null;
  payable: string | null;
}

export interface PayrollSheet {
  /** `YYYY-MM` */
  yearMonth: string;
  rows: PayrollRow[];
  /** ⭐ যাদের বেতন বসানো নেই — নাম ধরে দেখাতে হবে */
  missingSalary: string[];
  /** যাদের ওই মাসের rollup এখনো হয়নি — এঁরা `rows`-এ **নেই** */
  missingSummary: string[];
}

/**
 * F03 — `GET /api/v1/payroll?month=YYYY-MM`
 *
 * ⭐⚠️ **owner-only, এবং প্রতিটা কল audit-এ লেখা হয়** (payroll_view)।
 * ম্যানেজারকে এই পেজের লিঙ্কও দেখানো যাবে না — `user.role === 'owner'`
 * না হলে রুটটাই render করবেন না, শুধু ৪০৩ ধরলে হবে না।
 */
export function getPayroll(
  month: string,
  signal?: AbortSignal,
): Promise<PayrollSheet> {
  return api<PayrollSheet>(`/payroll${qs({ month })}`, { signal });
}
