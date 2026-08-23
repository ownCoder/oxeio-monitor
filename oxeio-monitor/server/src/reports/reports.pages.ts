import { buildPdf, tableOf, type PdfColumn, type PdfSpec } from './reports.pdf';
import { hoursText, personLabel, toPdfText } from './reports.pdf.text';
import type {
  AttendanceReport,
  DayStatus,
  DayType,
  ReportMeta,
  SummaryReport,
} from './reports.types';

/**
 * F06 — কোন PDF দেখতে কেমন (কলাম, প্রস্থ, লেবেল)। ঠিক যে কারণে
 * `reports.sheets.ts` `reports.excel.ts` থেকে আলাদা: "একটা কলাম যোগ করো"
 * বলতে যেন কোয়েরির কোডে হাত না পড়ে।
 *
 * ⭐ **লেবেল ইংরেজিতে** (Excel-এ বাংলা)। কারণটা এক জায়গায় লেখা —
 * [reports.pdf.text.ts](./reports.pdf.text.ts)-এর মাথার নোট। এখানে শুধু
 * ফলটা: pdfkit-এর বিল্ট-ইন ফন্টে বাংলা **নীরবে ফাঁকা** ছাপে, তাই বাংলা
 * লেবেল মানে খালি হেডার।
 *
 * ⭐ রিপোর্ট → **ছাপার লাইন** রূপান্তরটা খাঁটি (`attendanceLines`,
 * `summaryLines`) আর pdfkit থেকে সম্পূর্ণ আলাদা। দুটো কারণে:
 *
 * ১· বাংলা অক্ষর কোথায় বদলে গেল সেটা এখানেই ঠিক হয়, আর সেটা DB বা
 *    PDF ইঞ্জিন ছাড়াই পরীক্ষা করা যায় — অথচ ভুল হলে ফল হতো একটা নীরব
 *    ফাঁকা ঘর, কোনো এরর নয়।
 * ২· `lossy` পতাকা **ছাপা শুরুর আগেই** জানা দরকার, কারণ তার উপরেই
 *    নির্ভর করে পাদটীকাটা বসবে কি না। কলামের `value()` ফাংশন থেকে জানতে
 *    গেলে দেরি হয়ে যেত — নোট তখন লেখা হয়ে গেছে।
 */

const DAY_TYPE_EN: Record<DayType, string> = {
  workday: 'Workday',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

const DAY_STATUS_EN: Record<DayStatus, string> = {
  worked: 'Worked',
  no_activity: 'No activity',
};

/**
 * ⚠️ শুধু তখনই ছাপা হয় যখন সত্যিই কিছু বদলাতে হয়েছে। সবসময় বসালে
 * ইংরেজি নামের অফিসে এটা অর্থহীন গোলমাল হতো, আর গোলমাল পড়া বন্ধ হলে
 * যেদিন সত্যিই দরকার সেদিনও কেউ পড়ত না।
 */
const LOSSY_NOTE =
  'Some Bangla text (names, departments) cannot be rendered with this PDF ' +
  'font. Names are shown as employee codes and other characters as "?". ' +
  'The Excel (xlsx) export carries the original text.';

/** ⭐ ক্যাটাগরি-বিহীন রিপোর্টেও নিয়মটা লেখা থাকে — শিটে যেমন থাকে */
const CATEGORY_NOTE =
  'Hours here are attendance figures only. App/site categories never affect ' +
  'worked, credited or target hours.';

/**
 * ⚠️ `reports.types.ts`-এর `OVERTIME_NOTE`-এর **ছাপার উপযোগী রূপ**: em
 * ড্যাশ (—) WinAnsi-তে থাকলেও এখানে সাধারণ হাইফেন, যাতে ছাপা লেখায়
 * বাইটের রকম যত কম থাকে (reports.pdf.text.ts-এর নিয়ম)। দুটো এক কথা বলে —
 * একটা বদলালে অন্যটাও বদলাতে হবে, নইলে একদিন xlsx আর PDF দুই রকম নীতি
 * বলত (O4)।
 *
 * ⭐⭐ **O4 নিষ্পত্তি ২৩ আগস্ট ২০২৬** — আলাদা রেট **নেই**। তাই "এখনো ঠিক
 * হয়নি" নয়, লেখা হয় "আলাদা রেট নেই" ([reports.types.ts](reports.types.ts))।
 */
const OVERTIME_NOTE_EN =
  'Overtime hours are not converted to money - there is no separate ' +
  'overtime rate.';

/**
 * ⭐⭐ ছাপা কাগজে **তিনটে সংখ্যা তিনটে আলাদা প্রশ্নের উত্তর** — বাক্যটা
 * ছাড়া পাঠক বিয়োগ করে মেলাতে গিয়ে ভাবতেন হিসাবে ভুল আছে।
 *
 * ⚠️ কলামের হেডারে এটা লেখা যায় না: PDF-এর কলামপ্রস্থ পিক্সেলে বাঁধা,
 *    লম্বা হেডার কেটে যেত। তাই পাদটীকা — কিন্তু **থাকতেই হবে**, কারণ
 *    মানুষ কাগজটাকেই বিশ্বাস করে, আর গত রাউন্ডে কাগজটাই এমন ঘাটতির
 *    অভিযোগ করত যা এজেন্ট বসার আগের দিনগুলোর।
 */
const SHORTFALL_NOTE_EN =
  'Target (h) covers every day shown. Shortfall (h) is measured only against ' +
  'what was expected by yesterday - days before tracking started, and today, ' +
  'are never counted as a shortfall. Overtime (h) is hours beyond the full ' +
  'target for the days shown.';

// ── ছাপার লাইন (খাঁটি) ───────────────────────────────────────────────────────

/**
 * এক জায়গায় সব `toPdfText` ডাক, যাতে "কিছু বদলেছে কি না" প্রশ্নের উত্তর
 * একটাই জায়গা থেকে আসে। প্রতিটা কল সাইটে আলাদা করে `lossy` মেলালে একটা
 * ভুলে যাওয়া কল মানেই নীরবে হারিয়ে যাওয়া পাদটীকা।
 */
class Printable {
  lossy = false;

  text(value: string | null | undefined): string {
    const out = toPdfText(value);
    if (out.lossy) this.lossy = true;
    return out.text;
  }

  person(fullName: string, empCode: string): string {
    const out = personLabel(fullName, empCode);
    if (out.lossy) this.lossy = true;
    return out.text;
  }
}

export interface AttendanceLine {
  empCode: string;
  name: string;
  department: string;
  date: string;
  dayType: string;
  status: string;
  worked: string;
  adjust: string;
  credited: string;
  target: string;
}

export interface Lines<T> {
  lines: T[];
  /** অন্তত একটা ঘরের লেখা বদলাতে হয়েছে — পাদটীকা দরকার */
  lossy: boolean;
}

export function attendanceLines(
  report: AttendanceReport,
): Lines<AttendanceLine> {
  const p = new Printable();

  const lines = report.rows.map((r) => ({
    empCode: p.text(r.empCode),
    name: p.person(r.fullName, r.empCode),
    department: p.text(r.department),
    date: r.date,
    dayType: DAY_TYPE_EN[r.dayType],
    status: DAY_STATUS_EN[r.status],
    worked: hoursText(r.workedHours),
    adjust: hoursText(r.adjustmentHours),
    credited: hoursText(r.creditedHours),
    target: hoursText(r.targetHours),
  }));

  return { lines, lossy: p.lossy };
}

export interface SummaryLine {
  empCode: string;
  name: string;
  bucket: string;
  from: string;
  to: string;
  workdays: string;
  daysWithWork: string;
  worked: string;
  credited: string;
  target: string;
  shortfall: string;
  overtime: string;
}

export function summaryLines(report: SummaryReport): Lines<SummaryLine> {
  const p = new Printable();

  const lines = report.rows.map((r) => ({
    empCode: p.text(r.empCode),
    name: p.person(r.fullName, r.empCode),
    bucket: r.bucket,
    from: r.bucketStart,
    to: r.bucketEnd,
    // ⚠️ দিনসংখ্যা `hoursText` দিয়ে নয় — "৯.০০ কর্মদিবস" পড়তে অদ্ভুত,
    //    আর ঘণ্টার কলামের সাথে গুলিয়ে যেত
    workdays: String(r.workdays),
    daysWithWork: String(r.daysWithWork),
    worked: hoursText(r.workedHours),
    credited: hoursText(r.creditedHours),
    target: hoursText(r.targetHours),
    shortfall: hoursText(r.shortfallHours),
    overtime: hoursText(r.overtimeHours),
  }));

  return { lines, lossy: p.lossy };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/** F01 — অ্যাটেনডেন্স PDF */
export function attendancePdf(
  report: AttendanceReport,
  orgName: string,
): Promise<Buffer> {
  const { lines, lossy } = attendanceLines(report);

  const columns: PdfColumn<AttendanceLine>[] = [
    { header: 'Emp code', width: 60, value: (r) => r.empCode },
    { header: 'Name', width: 170, value: (r) => r.name },
    { header: 'Department', width: 100, value: (r) => r.department },
    { header: 'Date', width: 62, value: (r) => r.date },
    { header: 'Day type', width: 70, value: (r) => r.dayType },
    { header: 'Status', width: 68, value: (r) => r.status },
    right('Worked (h)', 60, (r) => r.worked),
    right('Adjust (h)', 62, (r) => r.adjust),
    right('Credited (h)', 62, (r) => r.credited),
    right('Target (h)', 56, (r) => r.target),
  ];

  return buildPdf({
    letterhead: letterhead(orgName, 'Attendance report (F01)', report.meta),
    table: tableOf(columns, lines),
    totals: [
      ['Employees', String(report.totals.employees)],
      ['Days with work', String(report.totals.daysWithWork)],
      ['Total worked (h)', hoursText(report.totals.workedHours)],
      ['Total credited (h)', hoursText(report.totals.creditedHours)],
      // ⚠️ "days listed" — সংখ্যাটা উপরের Target কলামের যোগফল, "এ পর্যন্ত
      //    কত হওয়ার কথা ছিল" নয় (`AttendanceReport.totals`-এর নোট)
      ['Total target - days listed (h)', hoursText(report.totals.targetHours)],
    ],
    notes: notesFor(report.meta, lossy, [CATEGORY_NOTE]),
  });
}

/** F02 — সাপ্তাহিক / মাসিক সারাংশ PDF */
export function summaryPdf(
  report: SummaryReport,
  orgName: string,
): Promise<Buffer> {
  const { lines, lossy } = summaryLines(report);
  const monthly = report.groupBy === 'month';

  const columns: PdfColumn<SummaryLine>[] = [
    { header: 'Emp code', width: 58, value: (r) => r.empCode },
    { header: 'Name', width: 140, value: (r) => r.name },
    { header: monthly ? 'Month' : 'Week', width: 62, value: (r) => r.bucket },
    { header: 'From', width: 60, value: (r) => r.from },
    { header: 'To', width: 60, value: (r) => r.to },
    right('Workdays', 52, (r) => r.workdays),
    right('Days worked', 56, (r) => r.daysWithWork),
    right('Worked (h)', 52, (r) => r.worked),
    right('Credited (h)', 56, (r) => r.credited),
    right('Target (h)', 52, (r) => r.target),
    right('Shortfall (h)', 60, (r) => r.shortfall),
    right('Overtime (h)', 62, (r) => r.overtime),
  ];

  return buildPdf({
    letterhead: letterhead(
      orgName,
      `Work summary (F02) - ${monthly ? 'monthly' : 'weekly'}`,
      report.meta,
    ),
    table: tableOf(columns, lines),
    notes: notesFor(report.meta, lossy, [
      // ⚠️ ঘাটতির বাক্যটা **আগে**, কারণ কাগজ দেখে মানুষ প্রথমেই ওই
      //    কলামটা নিয়ে প্রশ্ন করেন
      SHORTFALL_NOTE_EN,
      // ⭐ নোটটা ফাইলের ভেতরেই থাকে — শুধু JSON-এ থাকলে যিনি PDF ছাপিয়ে
      //    মিটিংয়ে নিয়ে যান তিনি জানতেনই না, আর নিজের মতো একটা হার
      //    বসিয়ে ফেলতেন (O4)
      OVERTIME_NOTE_EN,
      CATEGORY_NOTE,
    ]),
  });
}

function right<T>(
  header: string,
  width: number,
  value: (row: T) => string,
): PdfColumn<T> {
  return { header, width, align: 'right', value };
}

function letterhead(
  orgName: string,
  reportTitle: string,
  meta: ReportMeta,
): PdfSpec['letterhead'] {
  return {
    orgName: toPdfText(orgName).text,
    reportTitle,
    rangeFrom: meta.from,
    rangeTo: meta.to,
    generatedAt: meta.generatedAt,
  };
}

/**
 * প্রতিটি PDF-এর পাদটীকা।
 *
 * ⚠️ ছাঁটাই (`clampedToToday`) আর বাদ পড়া কর্মী — দুটোই **ফাইলের ভেতরে**
 * থাকতে হয়। Excel-এ ওগুলো "Info" শিটে আছে, কিন্তু PDF-এ আলাদা শিট নেই;
 * বাদ দিলে কেউ "৩১ আগস্ট পর্যন্ত" ভেবে ১১ তারিখের ডেটা নিয়ে সিদ্ধান্ত নিতেন।
 */
function notesFor(meta: ReportMeta, lossy: boolean, extra: string[]): string[] {
  const notes: string[] = [];

  if (meta.clampedToToday) {
    notes.push(
      `Requested up to ${meta.requestedTo}; future dates were dropped and the ` +
        `report ends at ${meta.to}.`,
    );
  }

  if (meta.excludedEmployees.length > 0) {
    const names = meta.excludedEmployees.map((n) => toPdfText(n).text).join(', ');
    notes.push(
      `Excluded (marked inactive with no leaving date): ${names}. ` +
        'These employees have no rows in this report.',
    );
  }

  if (lossy) notes.push(LOSSY_NOTE);

  return [...notes, ...extra];
}
