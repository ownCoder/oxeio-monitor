import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';

import { attendanceLines } from '../src/reports/reports.pages';
import { attendanceWorkbook } from '../src/reports/reports.sheets';
import type {
  AttendanceReport,
  AttendanceRow,
  ReportMeta,
} from '../src/reports/reports.types';

/**
 * ⭐⭐ **G130 (R2) — ছুটি সংখ্যায় পৌঁছেছিল, লেবেলে নয়।**
 *
 * ⚠️⚠️ ছুটি ইতিমধ্যেই পাঁচ জায়গায় ঢুকেছে — টার্গেট, প্রত্যাশা, tray, Live
 * Board, রিপোর্ট — অর্থাৎ কেউ আর ছুটির জন্য "পিছিয়ে" দেখায় না। কিন্তু
 * কাগজে **"On leave" বলে কিছু লেখা ছিল না**, তাই ছুটির দিনটা দেখতে হুবহু
 * একটা শূন্য-ঘণ্টার কর্মদিবসের মতো: `Workday` · `No activity` · ০ ঘণ্টা।
 * **সংখ্যা মিথ্যা বলছিল না, কিন্তু কারণটাও বলছিল না** — আর "ও ওই দিন কেন
 * কাজ করেনি" প্রশ্নের উত্তর খুঁজতে Settings → Leave-এ যেতে হতো।
 *
 * ⚠️ এই ফাইলটার দাবি **ছাপার**, হিসাবের নয়। হিসাবটা `leave.spec.ts`
 * পাহারা দেয়; এখানে কেবল দেখা হয় সত্যিটা কাগজ পর্যন্ত **পৌঁছায় কি না** —
 * ঠিক সেই ফাঁক যেটার নাম এই রেপোতে "চুক্তি লেখা আছে, কলার লেখা হয়নি"।
 */

const meta: ReportMeta = {
  from: '2026-08-01',
  to: '2026-08-02',
  requestedTo: '2026-08-02',
  clampedToToday: false,
  days: 2,
  generatedAt: '2026-08-02T12:00:00.000Z',
  excludedEmployees: [],
  targetHoursInRange: {},
  expectedHours: {},
  approximateHolidayDates: [],
  observed: {},
  trackedFrom: {},
};

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employeeId: 1,
    empCode: 'OX-001',
    fullName: 'Jane Doe',
    staffType: null,
    department: null,
    date: '2026-08-03',
    dayType: 'workday',
    status: 'no_activity',
    onLeave: false,
    workedHours: 0,
    idleHours: 0,
    adjustmentHours: 0,
    creditedHours: 0,
    designsDone: null,
    targetHours: 0,
    ...over,
  };
}

function report(rows: AttendanceRow[]): AttendanceReport {
  return {
    meta,
    rows,
    totals: {
      employees: 1,
      rows: rows.length,
      workedHours: 0,
      creditedHours: 0,
      targetHours: 0,
      daysWithWork: 0,
    },
  };
}

/** তৈরি ওয়ার্কবুক আবার পড়ে Attendance শিটের শিরোনাম ও একটা সারি ফেরায় */
async function sheetRows(
  rows: AttendanceRow[],
): Promise<{ headers: string[]; cells: string[][] }> {
  // ⚠️ বাফারটা আবার পার্স করা হয় — কলামের সংজ্ঞা দেখলে "ফাইলে ওঠে" প্রমাণ হতো না
  const wb = new Workbook();
  await wb.xlsx.load((await attendanceWorkbook(report(rows))) as unknown as ArrayBuffer);

  const sheet = wb.getWorksheet('Attendance');
  expect(sheet, 'ওয়ার্কবুকে "Attendance" শিটই নেই').toBeDefined();

  const all: string[][] = [];
  sheet!.eachRow((r) => {
    const line: string[] = [];
    r.eachCell({ includeEmpty: true }, (cell) => {
      line.push(String(cell.value ?? ''));
    });
    all.push(line);
  });

  return { headers: all[0], cells: all.slice(1) };
}

describe('G130 — PDF-এর সারিতে কারণটা লেখা থাকে', () => {
  it('ছুটির দিনে Day type ঘরে "On leave"', () => {
    const { lines } = attendanceLines(report([row({ onLeave: true })]));
    expect(lines[0].dayType).toBe('On leave');
  });

  it('ছুটি না হলে আগের মতোই "Workday"', () => {
    const { lines } = attendanceLines(report([row()]));
    expect(lines[0].dayType).toBe('Workday');
  });

  /**
   * ⭐⭐ **এটাই সবচেয়ে সহজে ভুল হওয়া ধারটা।**
   *
   * ⚠️⚠️ কথাটা `status` ঘরে বসানোর লোভ হয় — ওখানেই তো "No activity"
   * লেখা থাকে। কিন্তু কেউ ছুটির দিনেও কাজ করতে পারেন (§ ৪ — যেকোনো দিনের
   * কাজ গোনা হয়), আর `status`-এ বসালে ওই ঘণ্টাগুলো **কাগজ থেকে উধাও**
   * হতো। দুটো আলাদা ঘরে দুটো আলাদা সত্যি।
   */
  it('⭐ ছুটির দিনে কাজ করলে দুটো তথ্যই থাকে — একটা অন্যটাকে ঢাকে না', () => {
    const { lines } = attendanceLines(
      report([
        row({
          onLeave: true,
          status: 'worked',
          workedHours: 3,
          creditedHours: 3,
        }),
      ]),
    );

    expect(lines[0].dayType).toBe('On leave');
    expect(lines[0].status).toBe('Worked');
    expect(lines[0].worked).toContain('3');
  });

  /**
   * ⚠️ সাপ্তাহিক ছুটি আর ব্যক্তিগত ছুটি — দুটো আলাদা কথা। এক করে দিলে
   *    কাগজ পড়ে বোঝা যেত না অফিস বন্ধ ছিল নাকি একজন ছুটিতে ছিলেন।
   */
  it('সাপ্তাহিক ছুটি নিজের কথাই বলে', () => {
    const { lines } = attendanceLines(
      report([row({ dayType: 'weekly_off', onLeave: false })]),
    );
    expect(lines[0].dayType).toBe('Weekly off');
  });
});

describe('G130 — Excel-এ আলাদা কলাম', () => {
  it('"On leave" কলামটা শিটে আছে', async () => {
    const { headers } = await sheetRows([row()]);
    expect(headers).toContain('On leave');
  });

  it('ছুটির সারিতে "Yes", অন্য সারিতে খালি', async () => {
    const { headers, cells } = await sheetRows([
      row({ date: '2026-08-03', onLeave: true }),
      row({ date: '2026-08-04', onLeave: false }),
    ]);

    const at = headers.indexOf('On leave');
    expect(at).toBeGreaterThanOrEqual(0);

    expect(cells[0][at]).toBe('Yes');
    /**
     * ⚠️⚠️ **"No" নয়, খালি** — আর এটা সাজসজ্জার সিদ্ধান্ত নয়। ৩১ সারির
     * কলামজুড়ে "No" লিখলে চোখ ওটা পড়াই বন্ধ করে দিত, আর তখন যে দু-একটা
     * "Yes" আছে সেগুলোই হারিয়ে যেত — অর্থাৎ কলামটা যোগ করেও কিছু অর্জন
     * হতো না।
     */
    expect(cells[1][at]).toBe('');
  });

  /**
   * ⭐⭐ **Day type ঘরটা Excel-এ ছোঁয়া হয়নি, আর সেটা ইচ্ছাকৃত।**
   *
   * ⚠️ PDF-এ কলাম যোগ করার জায়গা নেই (A4-এ ইতিমধ্যেই নয়টা), তাই সেখানে
   * তথ্যটা Day type ঘরে বসেছে। Excel-এ জায়গার সমস্যা নেই, তাই সেখানে
   * **দুটো ঘর দুটোই অক্ষত** — শিট ফিল্টার করে "কজন কর্মদিবসে ছুটি নিলেন"
   * গোনা যায়, যেটা জোড়া লাগালে আর যেত না।
   */
  it('⭐ Excel-এ Day type অক্ষত — শিটে ছাঁকা যায়', async () => {
    const { headers, cells } = await sheetRows([row({ onLeave: true })]);

    const dayType = headers.indexOf('Day type');
    expect(cells[0][dayType]).toBe('Workday');
  });
});
