import {
  buildWorkbook,
  NUM_FMT_2,
  sheetOf,
  type ExcelColumn,
} from './reports.excel';
import {
  OVERTIME_NOTE,
  type AttendanceReport,
  type AttendanceRow,
  type DayStatus,
  type DayType,
  type ProductivityEmployeeRow,
  type ProductivityItem,
  type ProductivityReport,
  type ReportMeta,
  type SummaryReport,
  type SummaryRow,
  type UsageCategory,
} from './reports.types';

/**
 * F05 — কোন রিপোর্টের শিট দেখতে কেমন হবে (কলাম, চওড়া, লেবেল)।
 *
 * সার্ভিস থেকে আলাদা রাখার কারণ: কলামের ক্রম বা নাম বদলানো একটা **ছাপার**
 * সিদ্ধান্ত, কোয়েরির নয়। একই ফাইলে থাকলে "একটা কলাম যোগ করো" বলতেই
 * ডাটাবেস-কোডের মাঝখানে হাত পড়ত।
 *
 * ⚠️ এখানকার লেবেল শুধু **দেখানোর জন্য**; JSON API-তে যায় মেশিন-পাঠ্য
 *    মান (`worked`, `weekly_off`)। উল্টোটা করলে ফ্রন্টএন্ডকে দেখানোর
 *    স্ট্রিং মিলিয়ে শর্ত লিখতে হতো।
 */

const DAY_TYPE_LABEL: Record<DayType, string> = {
  workday: 'Workday',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  worked: 'Worked',
  no_activity: 'No activity',
};

const CATEGORY_LABEL: Record<UsageCategory, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  unproductive: 'Unproductive',
  uncategorized: 'Uncategorized',
};

/** F01 */
export function attendanceWorkbook(report: AttendanceReport): Promise<Buffer> {
  const columns: ExcelColumn<AttendanceRow>[] = [
    { header: 'Emp code', width: 14, value: (r) => r.empCode },
    { header: 'Name', width: 26, value: (r) => r.fullName },
    { header: 'Department', width: 18, value: (r) => r.department },
    { header: 'Date', width: 13, value: (r) => r.date },
    { header: 'Day type', width: 16, value: (r) => DAY_TYPE_LABEL[r.dayType] },
    { header: 'Status', width: 16, value: (r) => DAY_STATUS_LABEL[r.status] },
    hours('Worked (hours)', (r: AttendanceRow) => r.workedHours),
    hours('Adjustment (hours)', (r: AttendanceRow) => r.adjustmentHours),
    hours('Credited (hours)', (r: AttendanceRow) => r.creditedHours),
    hours('Target (hours)', (r: AttendanceRow) => r.targetHours),
    hours('Idle (hours)', (r: AttendanceRow) => r.idleHours),
  ];

  return buildWorkbook(
    [sheetOf('Attendance', columns, report.rows)],
    [
      ...infoRows('Attendance (F01)', report.meta),
      ['Total worked (hours)', String(report.totals.workedHours)],
      // ⚠️ লেবেলে "days listed" — সংখ্যাটা উপরের Target কলামের যোগফল,
      //    "এ পর্যন্ত কত হওয়ার কথা ছিল" নয়। শুধু "Total target" লেখা
      //    থাকলে পাঠক ওটাকেই ঘাটতির ভিত্তি ধরে নিতেন, অথচ এতে এজেন্ট
      //    বসার আগের দিনগুলোও আছে (`AttendanceReport.totals`-এর নোট)।
      ['Total target · days listed (hours)', String(report.totals.targetHours)],
    ],
  );
}

/** F02 */
export function summaryWorkbook(report: SummaryReport): Promise<Buffer> {
  const monthly = report.groupBy === 'month';

  const columns: ExcelColumn<SummaryRow>[] = [
    { header: 'Emp code', width: 14, value: (r) => r.empCode },
    { header: 'Name', width: 26, value: (r) => r.fullName },
    { header: monthly ? 'Month' : 'Week', width: 14, value: (r) => r.bucket },
    { header: 'Start', width: 13, value: (r) => r.bucketStart },
    { header: 'End', width: 13, value: (r) => r.bucketEnd },
    { header: 'Workdays', width: 12, value: (r) => r.workdays },
    { header: 'Days with work', width: 16, value: (r) => r.daysWithWork },
    hours('Worked (hours)', (r: SummaryRow) => r.workedHours),
    hours('Adjustment (hours)', (r: SummaryRow) => r.adjustmentHours),
    hours('Credited (hours)', (r: SummaryRow) => r.creditedHours),
    // ⚠️⚠️ তিনটে হেডারই স্পষ্ট করে বলে **কোন সংখ্যার বিপরীতে** মাপা:
    //    টার্গেট এই দিনগুলোর, কিন্তু ঘাটতি কেবল সেই দিনগুলোর যেগুলো দেখা
    //    হয়েছে ও শেষ হয়েছে। শুধু "Target/Shortfall" লেখা থাকলে পাঠক
    //    বিয়োগ করে মেলাতে গিয়ে ভাবতেন হিসাবে ভুল আছে — অথচ দুটো দুই
    //    প্রশ্নের উত্তর (`SummaryRow`-এর নোট)।
    hours('Target · days shown (hours)', (r: SummaryRow) => r.targetHours),
    hours(
      'Shortfall vs expected so far (hours)',
      (r: SummaryRow) => r.shortfallHours,
    ),
    hours(
      'Overtime beyond target (hours)',
      (r: SummaryRow) => r.overtimeHours,
    ),
  ];

  return buildWorkbook(
    [sheetOf('Summary', columns, report.rows)],
    [
      ...infoRows(
        `Summary (F02) · ${monthly ? 'Monthly' : 'Weekly'}`,
        report.meta,
      ),
      // ⭐ নোটটা ফাইলের ভেতরেই থাকে। শুধু JSON-এ রাখলে যিনি শিটটা খোলেন
      //    তিনি জানতেনই না, আর নিজের মতো একটা হার বসিয়ে ফেলতেন।
      ['Overtime hours', OVERTIME_NOTE],
    ],
  );
}

/** F04 */
export function productivityWorkbook(
  report: ProductivityReport,
): Promise<Buffer> {
  const appColumns: ExcelColumn<ProductivityItem>[] = [
    { header: 'App / site', width: 34, value: (r) => r.key },
    {
      header: 'Kind',
      width: 10,
      value: (r) => (r.kind === 'site' ? 'Site' : 'App'),
    },
    { header: 'Name', width: 24, value: (r) => r.displayName },
    { header: 'Category', width: 16, value: (r) => CATEGORY_LABEL[r.category] },
    {
      // ⚠️ পাশের ক্যাটাগরিটা তখন শুধু **সবচেয়ে বড় ভাগ**, একক সত্য নয় —
      //    chrome.exe-এ github.com আর youtube.com দুটোই থাকে। কলামটা না
      //    থাকলে "chrome.exe — Productive" পড়ে কেউ নিশ্চিন্ত হয়ে যেতেন।
      header: 'Mixed category',
      width: 16,
      value: (r) => (r.mixed ? 'Yes' : '—'),
    },
    hours('Time (hours)', (r: ProductivityItem) => r.hours),
    {
      header: 'Share (%)',
      width: 12,
      numFmt: NUM_FMT_2,
      value: (r) => r.sharePct,
    },
  ];

  const employeeColumns: ExcelColumn<ProductivityEmployeeRow>[] = [
    { header: 'Emp code', width: 14, value: (r) => r.empCode },
    { header: 'Name', width: 26, value: (r) => r.fullName },
    hours(
      'Productive (hours)',
      (r: ProductivityEmployeeRow) => r.productiveHours,
    ),
    hours('Neutral (hours)', (r: ProductivityEmployeeRow) => r.neutralHours),
    hours(
      'Unproductive (hours)',
      (r: ProductivityEmployeeRow) => r.unproductiveHours,
    ),
    hours(
      'Uncategorized (hours)',
      (r: ProductivityEmployeeRow) => r.uncategorizedHours,
    ),
    hours(
      'Total tracked (hours)',
      (r: ProductivityEmployeeRow) => r.trackedHours,
    ),
    {
      header: 'Productive share (%)',
      width: 22,
      numFmt: NUM_FMT_2,
      value: (r) => r.productiveSharePct,
    },
    {
      // ⭐ স্কোর ও অচিহ্নিত শতাংশ **পাশাপাশি** — ৯০% সময় অচেনা হলে ১০০%
      //    স্কোরও অর্থহীন, কিন্তু একা স্কোরটা দেখলে সেটা দারুণ দেখাত
      header: 'Productivity score (%)',
      width: 22,
      numFmt: NUM_FMT_2,
      // ⚠️ চিহ্নিত সময় শূন্য হলে `null` — শূন্য নয়। Excel-এ ঘরটা **খালি**
      //    থাকে, আর সেটাই ঠিক: "০%" বলত কেউ কিছুই productive করেনি, অথচ
      //    সত্যিটা হলো বলার মতো কোনো তথ্যই নেই।
      value: (r) => r.productivityScorePct,
    },
    {
      header: 'Uncategorized share (%)',
      width: 24,
      numFmt: NUM_FMT_2,
      value: (r) => r.uncategorizedSharePct,
    },
  ];

  return buildWorkbook(
    [
      sheetOf('Top apps and sites', appColumns, report.top),
      sheetOf('By employee', employeeColumns, report.byEmployee),
    ],
    [
      ...infoRows('Productivity (F04)', report.meta),
      ['Total tracked time (hours)', String(report.totalTrackedHours)],
      ['Uncategorized time (hours)', String(report.uncategorizedHours)],
      // ⭐ পণ্যের কঠিন নিয়মটা শিটেই লেখা থাকে — কেউ যেন "unproductive ঘণ্টা
      //    কেটে নাও" বলার সময় ভাবতে বাধ্য হন যে সংখ্যাটা বেতনের জন্য নয়।
      [
        'Note',
        'Categories are for viewing only — they have no effect on salary or target calculations',
      ],
    ],
  );
}

/** ঘণ্টার কলাম — সবসময় সংখ্যা, দুই দশমিকে দেখানো (F05-এর মূল নিয়ম) */
function hours<T>(header: string, value: (row: T) => number): ExcelColumn<T> {
  return { header, width: 22, numFmt: NUM_FMT_2, value };
}

/** প্রতিটি ওয়ার্কবুকের "Info" শিট — রেঞ্জ, ছাঁটাই, বাদ পড়া কর্মী */
function infoRows(title: string, meta: ReportMeta): [string, string][] {
  const rows: [string, string][] = [
    ['Report', title],
    ['Range', `${meta.from} — ${meta.to}`],
    ['Days', String(meta.days)],
    ['Generated', meta.generatedAt],
  ];

  if (meta.clampedToToday) {
    // ⚠️ ছাঁটাইটা ফাইলেই লেখা থাকে — নইলে কেউ "৩১ আগস্ট পর্যন্ত" ভেবে
    //    ১১ তারিখের ডেটা নিয়ে সিদ্ধান্ত নিত
    rows.push([
      'Note',
      `Requested through ${meta.requestedTo}; future days were excluded, so this shows up to ${meta.to}`,
    ]);
  }

  if (meta.excludedEmployees.length > 0) {
    rows.push(['Excluded staff', meta.excludedEmployees.join(', ')]);
  }

  return rows;
}
