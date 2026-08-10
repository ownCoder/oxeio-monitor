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
 * F05 — কোন রিপোর্টের শিট দেখতে কেমন হবে (কলাম, চওড়া, বাংলা লেবেল)।
 *
 * সার্ভিস থেকে আলাদা রাখার কারণ: কলামের ক্রম বা নাম বদলানো একটা **ছাপার**
 * সিদ্ধান্ত, কোয়েরির নয়। একই ফাইলে থাকলে "একটা কলাম যোগ করো" বলতেই
 * ডাটাবেস-কোডের মাঝখানে হাত পড়ত।
 *
 * ⚠️ এখানে বাংলা লেবেল শুধু **দেখানোর জন্য**; JSON API-তে যায় মেশিন-পাঠ্য
 *    মান (`worked`, `weekly_off`)। উল্টোটা করলে ফ্রন্টএন্ডকে বাংলা স্ট্রিং
 *    মিলিয়ে শর্ত লিখতে হতো।
 */

const DAY_TYPE_BN: Record<DayType, string> = {
  workday: 'কর্মদিবস',
  weekly_off: 'সাপ্তাহিক ছুটি',
  holiday: 'ছুটির দিন',
};

const DAY_STATUS_BN: Record<DayStatus, string> = {
  worked: 'কাজ হয়েছে',
  no_activity: 'কোনো কাজ নেই',
};

const CATEGORY_BN: Record<UsageCategory, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  unproductive: 'Unproductive',
  uncategorized: 'অচিহ্নিত',
};

/** F01 */
export function attendanceWorkbook(report: AttendanceReport): Promise<Buffer> {
  const columns: ExcelColumn<AttendanceRow>[] = [
    { header: 'এমপ কোড', width: 14, value: (r) => r.empCode },
    { header: 'নাম', width: 26, value: (r) => r.fullName },
    { header: 'বিভাগ', width: 18, value: (r) => r.department },
    { header: 'তারিখ', width: 13, value: (r) => r.date },
    { header: 'দিনের ধরন', width: 16, value: (r) => DAY_TYPE_BN[r.dayType] },
    { header: 'অবস্থা', width: 16, value: (r) => DAY_STATUS_BN[r.status] },
    hours('কাজ (ঘণ্টা)', (r: AttendanceRow) => r.workedHours),
    hours('সমন্বয় (ঘণ্টা)', (r: AttendanceRow) => r.adjustmentHours),
    hours('গোনা (ঘণ্টা)', (r: AttendanceRow) => r.creditedHours),
    hours('টার্গেট (ঘণ্টা)', (r: AttendanceRow) => r.targetHours),
    hours('অলস (ঘণ্টা)', (r: AttendanceRow) => r.idleHours),
  ];

  return buildWorkbook(
    [sheetOf('Attendance', columns, report.rows)],
    [
      ...infoRows('অ্যাটেনডেন্স (F01)', report.meta),
      ['মোট কাজ (ঘণ্টা)', String(report.totals.workedHours)],
      ['মোট টার্গেট (ঘণ্টা)', String(report.totals.targetHours)],
    ],
  );
}

/** F02 */
export function summaryWorkbook(report: SummaryReport): Promise<Buffer> {
  const monthly = report.groupBy === 'month';

  const columns: ExcelColumn<SummaryRow>[] = [
    { header: 'এমপ কোড', width: 14, value: (r) => r.empCode },
    { header: 'নাম', width: 26, value: (r) => r.fullName },
    { header: monthly ? 'মাস' : 'সপ্তাহ', width: 14, value: (r) => r.bucket },
    { header: 'শুরু', width: 13, value: (r) => r.bucketStart },
    { header: 'শেষ', width: 13, value: (r) => r.bucketEnd },
    { header: 'কর্মদিবস', width: 12, value: (r) => r.workdays },
    { header: 'কাজের দিন', width: 12, value: (r) => r.daysWithWork },
    hours('কাজ (ঘণ্টা)', (r: SummaryRow) => r.workedHours),
    hours('সমন্বয় (ঘণ্টা)', (r: SummaryRow) => r.adjustmentHours),
    hours('গোনা (ঘণ্টা)', (r: SummaryRow) => r.creditedHours),
    hours('টার্গেট (ঘণ্টা)', (r: SummaryRow) => r.targetHours),
    hours('ঘাটতি (ঘণ্টা)', (r: SummaryRow) => r.shortfallHours),
    hours('অতিরিক্ত (ঘণ্টা)', (r: SummaryRow) => r.overtimeHours),
  ];

  return buildWorkbook(
    [sheetOf('Summary', columns, report.rows)],
    [
      ...infoRows(
        `সারাংশ (F02) · ${monthly ? 'মাসিক' : 'সাপ্তাহিক'}`,
        report.meta,
      ),
      // ⭐ নোটটা ফাইলের ভেতরেই থাকে। শুধু JSON-এ রাখলে যিনি শিটটা খোলেন
      //    তিনি জানতেনই না, আর নিজের মতো একটা হার বসিয়ে ফেলতেন।
      ['অতিরিক্ত ঘণ্টা', OVERTIME_NOTE],
    ],
  );
}

/** F04 */
export function productivityWorkbook(
  report: ProductivityReport,
): Promise<Buffer> {
  const appColumns: ExcelColumn<ProductivityItem>[] = [
    { header: 'অ্যাপ / সাইট', width: 34, value: (r) => r.key },
    {
      header: 'ধরন',
      width: 10,
      value: (r) => (r.kind === 'site' ? 'সাইট' : 'অ্যাপ'),
    },
    { header: 'নাম', width: 24, value: (r) => r.displayName },
    { header: 'ক্যাটাগরি', width: 16, value: (r) => CATEGORY_BN[r.category] },
    {
      // ⚠️ পাশের ক্যাটাগরিটা তখন শুধু **সবচেয়ে বড় ভাগ**, একক সত্য নয় —
      //    chrome.exe-এ github.com আর youtube.com দুটোই থাকে। কলামটা না
      //    থাকলে "chrome.exe — Productive" পড়ে কেউ নিশ্চিন্ত হয়ে যেতেন।
      header: 'মিশ্র ক্যাটাগরি',
      width: 16,
      value: (r) => (r.mixed ? 'হ্যাঁ' : '—'),
    },
    hours('সময় (ঘণ্টা)', (r: ProductivityItem) => r.hours),
    {
      header: 'অংশ (%)',
      width: 12,
      numFmt: NUM_FMT_2,
      value: (r) => r.sharePct,
    },
  ];

  const employeeColumns: ExcelColumn<ProductivityEmployeeRow>[] = [
    { header: 'এমপ কোড', width: 14, value: (r) => r.empCode },
    { header: 'নাম', width: 26, value: (r) => r.fullName },
    hours(
      'Productive (ঘণ্টা)',
      (r: ProductivityEmployeeRow) => r.productiveHours,
    ),
    hours('Neutral (ঘণ্টা)', (r: ProductivityEmployeeRow) => r.neutralHours),
    hours(
      'Unproductive (ঘণ্টা)',
      (r: ProductivityEmployeeRow) => r.unproductiveHours,
    ),
    hours(
      'অচিহ্নিত (ঘণ্টা)',
      (r: ProductivityEmployeeRow) => r.uncategorizedHours,
    ),
    hours(
      'মোট ট্র্যাক (ঘণ্টা)',
      (r: ProductivityEmployeeRow) => r.trackedHours,
    ),
    {
      header: 'Productive অংশ (%)',
      width: 18,
      numFmt: NUM_FMT_2,
      value: (r) => r.productiveSharePct,
    },
    {
      // ⭐ স্কোর ও অচিহ্নিত শতাংশ **পাশাপাশি** — ৯০% সময় অচেনা হলে ১০০%
      //    স্কোরও অর্থহীন, কিন্তু একা স্কোরটা দেখলে সেটা দারুণ দেখাত
      header: 'Productivity স্কোর (%)',
      width: 20,
      numFmt: NUM_FMT_2,
      // ⚠️ চিহ্নিত সময় শূন্য হলে `null` — শূন্য নয়। Excel-এ ঘরটা **খালি**
      //    থাকে, আর সেটাই ঠিক: "০%" বলত কেউ কিছুই productive করেনি, অথচ
      //    সত্যিটা হলো বলার মতো কোনো তথ্যই নেই।
      value: (r) => r.productivityScorePct,
    },
    {
      header: 'অচিহ্নিত অংশ (%)',
      width: 18,
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
      ['মোট ট্র্যাক করা সময় (ঘণ্টা)', String(report.totalTrackedHours)],
      ['অচিহ্নিত সময় (ঘণ্টা)', String(report.uncategorizedHours)],
      // ⭐ পণ্যের কঠিন নিয়মটা শিটেই লেখা থাকে — কেউ যেন "unproductive ঘণ্টা
      //    কেটে নাও" বলার সময় ভাবতে বাধ্য হন যে সংখ্যাটা বেতনের জন্য নয়।
      [
        'সতর্কতা',
        'ক্যাটাগরি কেবল দেখার জন্য — বেতন বা টার্গেটের হিসাবে এর কোনো প্রভাব নেই',
      ],
    ],
  );
}

/** ঘণ্টার কলাম — সবসময় সংখ্যা, দুই দশমিকে দেখানো (F05-এর মূল নিয়ম) */
function hours<T>(header: string, value: (row: T) => number): ExcelColumn<T> {
  return { header, width: 16, numFmt: NUM_FMT_2, value };
}

/** প্রতিটি ওয়ার্কবুকের "Info" শিট — রেঞ্জ, ছাঁটাই, বাদ পড়া কর্মী */
function infoRows(title: string, meta: ReportMeta): [string, string][] {
  const rows: [string, string][] = [
    ['রিপোর্ট', title],
    ['রেঞ্জ', `${meta.from} — ${meta.to}`],
    ['দিন', String(meta.days)],
    ['তৈরি', meta.generatedAt],
  ];

  if (meta.clampedToToday) {
    // ⚠️ ছাঁটাইটা ফাইলেই লেখা থাকে — নইলে কেউ "৩১ আগস্ট পর্যন্ত" ভেবে
    //    ১১ তারিখের ডেটা নিয়ে সিদ্ধান্ত নিত
    rows.push([
      'সতর্কতা',
      `চাওয়া হয়েছিল ${meta.requestedTo} পর্যন্ত; ভবিষ্যতের দিন বাদ দিয়ে ${meta.to} পর্যন্ত দেখানো হয়েছে`,
    ]);
  }

  if (meta.excludedEmployees.length > 0) {
    rows.push(['বাদ পড়া কর্মী', meta.excludedEmployees.join(', ')]);
  }

  return rows;
}
