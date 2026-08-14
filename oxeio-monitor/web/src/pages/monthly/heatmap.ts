import type {
  AttendanceReport,
  AttendanceRow,
  DayType,
} from '../../api/reports';
import { monthEndOf, parseWorkDate } from '../../lib/format';

/**
 * E07 — `GET /reports/attendance`-এর সমতল সারিগুলোকে স্টাফ × তারিখ গ্রিডে
 * সাজানো। এখানে **কোনো JSX নেই** ইচ্ছাকৃতভাবে: হিসাবটা যথেষ্ট সূক্ষ্ম
 * (ছুটি, কর্মকালের বাইরের দিন, ভবিষ্যৎ, মাসের টার্গেট) যে রেন্ডারের সাথে
 * মিশিয়ে ফেললে পরে কেউ আর ধরতেই পারত না কোন নিয়মটা কোথায় বসেছে।
 *
 * ⚠️ সার্ভার একটা দিনে একটাই সারি দেয়, আর **কর্মকালের বাইরের দিনে কোনো
 *    সারিই দেয় না** (reports.service.ts-এর `employedOn`)। তাই "সারি নেই"
 *    মানে তিনটে আলাদা জিনিস হতে পারে — ভবিষ্যৎ, কর্মকালের বাইরে, নাকি
 *    সত্যিই শূন্য দিন। তিনটেকে এক দেখালে ২০ তারিখে যোগ দেওয়া কর্মীকে
 *    ১৯ দিন ফাঁকিবাজ মনে হতো।
 */

export type CellKind =
  /** সারি আছে — ঘণ্টা শূন্যও হতে পারে */
  | 'day'
  /** `meta.to`-র পরের দিন — এখনো আসেনি */
  | 'future'
  /** ওই দিনে কর্মী এই অফিসে ছিলেন না (যোগ দেওয়ার আগে / ছেড়ে যাওয়ার পরে) */
  | 'outside';

export interface DayCell {
  /** `YYYY-MM-DD` */
  date: string;
  /** মাসের কত তারিখ (1…31) */
  day: number;
  kind: CellKind;
  /** `kind === 'day'` না হলে `null` */
  dayType: DayType | null;
  workedHours: number;
  adjustmentHours: number;
  creditedHours: number;
  targetHours: number;
  /**
   * ০–৪ — ধূসর → কালো র‍্যাম্পের ধাপ।
   * ⭐ ধাপগুলো **ওই কর্মীর দৈনিক টার্গেটের অনুপাতে**, পরম ঘণ্টায় নয়। নীতি
   *   বদলে ২০৮ থেকে ১৮০ হলে র‍্যাম্পও সাথে সাথে ঠিক হয়ে যায়; পরম সংখ্যা
   *   বসিয়ে রাখলে "কালো = পূর্ণ দিন" কথাটা নীরবে মিথ্যা হয়ে যেত।
   */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface EmployeeGridRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  department: string | null;
  /** মাসের প্রতিটি তারিখের জন্য একটা করে — দৈর্ঘ্য সবসময় `days.length` */
  cells: DayCell[];

  /** এ পর্যন্ত গোনা হয়েছে (worked + owner-এর সংশোধন) */
  creditedHours: number;
  /** এ পর্যন্ত নিখাদ কাজ — সংশোধন ছাড়া */
  workedHours: number;
  /**
   * এ পর্যন্ত যতটুকু হওয়ার কথা ছিল (§ ২.১-খ-র `expected_sec`)।
   * ⚠️ **সার্ভার থেকে আসা সংখ্যা** (`meta.expectedHours`) — এখানে যোগ করে
   *    বানানো হয় না। কেন, `buildMonthGrid()`-এর ভেতরের নোট দেখুন।
   */
  expectedHours: number;
  /** `credited − expected`. ঋণাত্মক = পিছিয়ে আছেন */
  paceHours: number;
  daysWithWork: number;

  /** এক কর্মদিবসের টার্গেট — মাসজুড়ে ধ্রুব। জানা না গেলে `null` */
  dailyTargetHours: number | null;
  /** পুরো মাসের টার্গেট (সাধারণত ২০৮)। বের করা না গেলে `null` */
  monthTargetHours: number | null;
  /** ⚠️ সত্যি হলে সংখ্যাটা আন্দাজ — পর্দায় `≈` দিয়ে দেখাতে হবে */
  monthTargetEstimated: boolean;

  /** কর্মকাল মাসের একাংশ হলে প্রথম ও শেষ কার্যকর দিন, নইলে `null` */
  partial: { from: string; to: string } | null;
}

export interface MonthGrid {
  /** মাসের সব তারিখ, ১ থেকে শেষ দিন */
  days: string[];
  rows: EmployeeGridRow[];
  /** যে তারিখগুলোয় **সবারই** ছুটি — কলামের শিরোনাম ধূসর করার জন্য */
  officeOffDays: Set<string>;
  /** `meta.to`-র পরের দিনগুলো */
  futureDays: Set<string>;
  totals: {
    employees: number;
    creditedHours: number;
    expectedHours: number;
    monthTargetHours: number | null;
    monthTargetEstimated: boolean;
    /** যাঁরা `expected`-এর চেয়ে পিছিয়ে */
    behind: number;
  };
}

/** ঋণাত্মক/ধনাত্মক নয় — এত ছোট ব্যবধানকে "সমান" ধরা হয় (≈ ৩ মিনিট) */
export const PACE_EPSILON = 0.05;

/**
 * সাজানোর ক্রম।
 * ⭐ ডিফল্ট `pace` — এই পর্দার একটাই প্রশ্ন, "কে পিছিয়ে আছে"। উত্তরটা
 *   সবার উপরের সারিতেই থাকা দরকার, স্ক্রল করে খুঁজে বের করার জিনিস নয়।
 */
export type GridSort = 'pace' | 'name';

export function buildMonthGrid(
  report: AttendanceReport,
  monthKey: string,
  sort: GridSort = 'pace',
): MonthGrid {
  const days = daysOfMonth(monthKey);
  const lastCovered = report.meta.to;
  const futureDays = new Set(days.filter((d) => d > lastCovered));

  // employeeId → (date → সারি)
  const byEmployee = new Map<number, Map<string, AttendanceRow>>();
  const identity = new Map<number, AttendanceRow>();

  for (const row of report.rows) {
    let dates = byEmployee.get(row.employeeId);
    if (!dates) {
      dates = new Map();
      byEmployee.set(row.employeeId, dates);
      identity.set(row.employeeId, row);
    }
    dates.set(row.date, row);
  }

  const rows: EmployeeGridRow[] = [];

  for (const [employeeId, dates] of byEmployee) {
    const who = identity.get(employeeId)!;

    // ⚠️ র‍্যাম্প বসানোর **আগে** দৈনিক টার্গেট জানা দরকার, তাই দুই পাশ।
    //    ছুটির দিনের টার্গেট ০, তাই সবচেয়ে বড় মানটাই কর্মদিবসের টার্গেট।
    let dailyTargetHours = 0;
    for (const row of dates.values()) {
      if (row.targetHours > dailyTargetHours) dailyTargetHours = row.targetHours;
    }
    const dailyTarget = dailyTargetHours > 0 ? dailyTargetHours : null;

    const cells: DayCell[] = [];
    let creditedHours = 0;
    let workedHours = 0;
    let daysWithWork = 0;
    let weeklyOffWeekday: number | null = null;
    let firstDay: string | null = null;
    let lastDay: string | null = null;

    for (const date of days) {
      const row = dates.get(date);

      if (!row) {
        // সারি নেই — হয় দিনটা এখনো আসেনি, নয়তো ওই দিনে কর্মী ছিলেন না
        cells.push(blankCell(date, date > lastCovered ? 'future' : 'outside'));
        continue;
      }

      firstDay ??= date;
      lastDay = date;

      creditedHours += row.creditedHours;
      workedHours += row.workedHours;
      if (row.workedHours > 0) daysWithWork += 1;
      if (row.dayType === 'weekly_off') weeklyOffWeekday ??= weekdayIndexOf(date);

      cells.push({
        date,
        day: dayNumber(date),
        kind: 'day',
        dayType: row.dayType,
        workedHours: row.workedHours,
        adjustmentHours: row.adjustmentHours,
        creditedHours: row.creditedHours,
        targetHours: row.targetHours,
        level: levelOf(row.creditedHours, dailyTarget),
      });
    }

    // ⭐ সার্ভার পুরো মাসের টার্গেট **জানে** — নীতিতে লেখা সংখ্যা (২০৮)।
    //    আগে এটা এখানে অনুমান করা হতো: হয়ে যাওয়া দিনের যোগফল + বাকি
    //    দিনের দৈনিক টার্গেট। ⚠️ বাকি দিন গোনার সময় শুধু সাপ্তাহিক ছুটি
    //    বাদ যেত, **সরকারি ছুটি নয়** — আগস্ট ২০২৬-এ তাই ২০৮ নয় ২১৬
    //    দেখাত, অর্থাৎ প্রত্যেকে ৮ ঘণ্টা বেশি পিছিয়ে আছেন মনে হতো।
    //    অথচ পে-রোল হিসাব করত ২০৮ ধরে — ড্যাশবোর্ড আর বেতন দুটো আলাদা
    //    সংখ্যা বললে কোনোটাই বিশ্বাসযোগ্য থাকে না।
    const monthTarget = report.meta.monthTargetHours[employeeId] ?? null;

    /**
     * ⭐⭐ **প্রত্যাশা সার্ভার থেকে আসে — এখানে যোগ করা হয় না।**
     *
     * ⚠️⚠️ আগে এখানে লেখা ছিল `expectedHours += row.targetHours`, অর্থাৎ
     *    মাসের ১ তারিখ থেকে আজ পর্যন্ত প্রতিটি দিনের টার্গেটের যোগফল।
     *    দুটো জিনিস ব্রাউজার জানে না, আর দুটোতেই ভুল হতো:
     *
     *      ১· **কর্মীকে কবে থেকে দেখা শুরু হয়েছে।** এই ইনস্টলেশনে এজেন্ট
     *         বসেছে ১৩ আগস্ট ২০২৬ — তার আগে কে কত কাজ করেছে আমরা জানি না।
     *         মাসের ১ থেকে গুনলে ওই না-দেখা দিনগুলো নীরবে "০ ঘণ্টা কাজ"
     *         হয়ে যেত, আর পাতাটা প্রত্যেককে ~৯৪ ঘণ্টা পিছিয়ে দেখাত —
     *         এমন এক সময়ের জন্য যখন মাপার যন্ত্রটাই বসেনি।
     *         **অনুপস্থিত পর্যবেক্ষণ ব্যর্থতা নয়।**
     *
     *      ২· **আজকের দিনটা প্রত্যাশায় ধরা হয় না।** ধরলে ভোর ৬টায় গোটা
     *         দল "১১৪ ঘণ্টা পিছিয়ে" দেখাত আর সন্ধ্যা নাগাদ সংখ্যাটা নিজে
     *         থেকেই ঠিক হয়ে যেত — একই দল দিনে দুবার দুই রায় পেত, কেবল
     *         ঘড়ির কাঁটার কারণে।
     *
     * ⭐ জানালার সংজ্ঞা একটাই, আর সেটা সার্ভারে (`summary.math.ts` →
     *    `elapsedWindow()`)। Live Board, tray/`/me` আর দৈনিক ইমেইলও ওটাই
     *    ব্যবহার করে। শুধু "ট্র্যাকিং কবে শুরু" তারিখটা পাঠিয়ে এখানে যোগ
     *    করানো যেত, কিন্তু তাহলে "আজকের দিন বাদ" নিয়মটা **আবার** এই
     *    ফাইলে লেখা থাকত — আর ঠিক সেভাবেই বাগটা জন্মেছিল। ক্লায়েন্টে
     *    এখন কোনো নিয়ম নেই, শুধু পড়া আছে।
     *
     * ⚠️ `?? 0` — সারি আছে অথচ meta-তে নেই, এমন হওয়ার কথা নয় (দুটোই একই
     *    কর্মী-তালিকা থেকে)। তবু হলে "কোনো দাবি নেই" ধরা হয়, "পিছিয়ে" নয়:
     *    অজানাকে ঘাটতি বলা মানে একজন মানুষ সম্পর্কে একটা অভিযোগ।
     */
    const expectedHours = report.meta.expectedHours[employeeId] ?? 0;

    rows.push({
      employeeId,
      empCode: who.empCode,
      fullName: who.fullName,
      department: who.department,
      cells,
      creditedHours,
      workedHours,
      expectedHours,
      paceHours: creditedHours - expectedHours,
      daysWithWork,
      dailyTargetHours: dailyTarget,
      monthTargetHours: monthTarget,
      // সার্ভার থেকে আসা সংখ্যা — আর অনুমান নয়
      monthTargetEstimated: false,
      // ⭐ মাসের মাঝে যোগ দিলে/ছেড়ে গেলে তাঁর টার্গেট এমনিতেই কম — সেটা
      //   না বললে "ইনি তো মাত্র ১০৪ ঘণ্টা" দেখে ভুল সিদ্ধান্ত হতো
      partial:
        firstDay && lastDay && (firstDay !== days[0] || lastDay < lastCovered)
          ? { from: firstDay, to: lastDay }
          : null,
    });
  }

  rows.sort(
    sort === 'name'
      ? (a, b) => a.fullName.localeCompare(b.fullName, 'bn')
      : (a, b) => a.paceHours - b.paceHours,
  );

  return {
    days,
    rows,
    officeOffDays: officeOffDaysOf(days, rows),
    futureDays,
    totals: totalsOf(rows),
  };
}

// ── ভেতরের অংশ ──────────────────────────────────────────────────────────────

/**
 * ⚠️ পরম ঘণ্টা নয়, **অনুপাত**। fallback-টা তখনই লাগে যখন কর্মীর দৈনিক
 *    টার্গেটই জানা যায়নি (যেমন এলাকা জুড়ে ছুটি ছিল) — তখন মকআপের ধাপগুলোই
 *    ব্যবহার হয়, নইলে সব ঘর একই রঙের হয়ে যেত।
 */
function levelOf(hours: number, dailyTarget: number | null): 0 | 1 | 2 | 3 | 4 {
  if (!(hours > 0)) return 0;

  if (dailyTarget === null || dailyTarget <= 0) {
    if (hours < 4) return 1;
    if (hours < 6.5) return 2;
    if (hours < 8.5) return 3;
    return 4;
  }

  const ratio = hours / dailyTarget;
  if (ratio < 0.4) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 1) return 3;
  return 4;
}

function blankCell(date: string, kind: CellKind): DayCell {
  return {
    date,
    day: dayNumber(date),
    kind,
    dayType: null,
    workedHours: 0,
    adjustmentHours: 0,
    creditedHours: 0,
    targetHours: 0,
    level: 0,
  };
}

/**
 * যে তারিখে **সব** কর্মীরই ছুটি — কলামের শিরোনাম ধূসর করার জন্য।
 * ⚠️ কারো কারো ছুটি হলে কলামটা ধূসর করা যাবে না: নীতি আলাদা হলে একজনের
 *    শুক্রবার আরেকজনের কর্মদিবস, আর তখন কলাম ধূসর দেখে ভুল বোঝা যেত।
 */
function officeOffDaysOf(
  days: string[],
  rows: EmployeeGridRow[],
): Set<string> {
  const off = new Set<string>();
  if (rows.length === 0) return off;

  days.forEach((date, index) => {
    let sawDay = false;
    for (const row of rows) {
      const cell = row.cells[index];
      if (cell.kind !== 'day') continue;
      sawDay = true;
      if (cell.dayType === 'workday') return;
    }
    if (sawDay) off.add(date);
  });

  return off;
}

function totalsOf(rows: EmployeeGridRow[]): MonthGrid['totals'] {
  let creditedHours = 0;
  let expectedHours = 0;
  let monthTargetHours = 0;
  let monthTargetKnown = false;
  let monthTargetEstimated = false;
  let behind = 0;

  for (const row of rows) {
    creditedHours += row.creditedHours;
    expectedHours += row.expectedHours;
    if (row.monthTargetHours !== null) {
      monthTargetHours += row.monthTargetHours;
      monthTargetKnown = true;
      if (row.monthTargetEstimated) monthTargetEstimated = true;
    }
    if (row.paceHours < -PACE_EPSILON) behind += 1;
  }

  return {
    employees: rows.length,
    creditedHours,
    expectedHours,
    monthTargetHours: monthTargetKnown ? monthTargetHours : null,
    monthTargetEstimated,
    behind,
  };
}

// ── তারিখের ছোট সহায়ক ───────────────────────────────────────────────────────

/** `'2026-08'` → `['2026-08-01', … '2026-08-31']` */
export function daysOfMonth(monthKey: string): string[] {
  const total = dayNumber(monthEndOf(`${monthKey}-01`));
  const days: string[] = [];
  for (let d = 1; d <= total; d += 1) {
    days.push(`${monthKey}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * রবি = 0 … শনি = 6।
 * ⚠️ `parseWorkDate()` UTC-midnight দেয়, তাই `getUTCDay()` — `getDay()`
 *    লিখলে ব্রাউজারের টাইমজোনে বার এক ঘর সরে যেত।
 */
function weekdayIndexOf(date: string): number {
  return parseWorkDate(date)?.getUTCDay() ?? -1;
}
