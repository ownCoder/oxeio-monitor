import { describe, expect, it } from 'vitest';

import type {
  AttendanceReport,
  AttendanceRow,
  ReportMeta,
} from '../src/api/reports';
import { buildMonthGrid } from '../src/pages/monthly/heatmap';

/**
 * **G110 · G111** — Monthly পাতার ছবিটা আর সংখ্যাটা এক কথা বলে কি না।
 *
 * ⭐⭐ দুটো ত্রুটিই এক জাতের, আর সেটাই এদের এক ফাইলে রাখার কারণ: **কোনো
 * এরর ওঠে না, কোনো সংখ্যা ভুল হয় না** — শুধু একটা অবস্থা অন্য একটার ছদ্মবেশে
 * দেখা যায়, আর মানুষ ছদ্মবেশটাই বিশ্বাস করেন।
 *
 *   · G110 — ট্র্যাকিং শুরুর **আগের** দিন দেখতে "কর্মদিবসে কিছুই করেনি"-র
 *     মতো (লালচে ছোঁয়া)। একই পাতায় সংখ্যাটা বলে "কোনো দাবি নেই", ছবিটা বলে
 *     "ফাঁকি" — আর মানুষ আগে ছবিটা দেখে।
 *   · G111 — যাঁকে এখনো একটা শেষ-হওয়া কর্মদিবসেও দেখা হয়নি, তাঁর ঘাটতি ০,
 *     তাই সারিতে লেখা ওঠে **"On track"**।
 *
 * ⚠️ এই ফাইলটার আগে `heatmap.ts`-এ **একটাও টেস্ট ছিল না**, যদিও এখানেই
 * পাতাটার প্রায় সব নিয়ম বসে।
 */

/** আগস্ট ২০২৬ — শুক্রবার ৭, ১৪, ২১, ২৮ */
const MONTH = '2026-08';
const TRACKED_FROM = '2026-08-13';

function meta(over: Partial<ReportMeta> = {}): ReportMeta {
  return {
    from: '2026-08-01',
    to: '2026-08-20',
    requestedTo: '2026-08-20',
    clampedToToday: true,
    days: 20,
    generatedAt: '2026-08-20T12:00:00.000Z',
    excludedEmployees: [],
    targetHoursInRange: { 1: 168 },
    expectedHours: { 1: 40 },
    approximateHolidayDates: [],
    observed: { 1: true },
    trackedFrom: { 1: TRACKED_FROM },
    ...over,
  };
}

function row(over: Partial<AttendanceRow> & { date: string }): AttendanceRow {
  return {
    employeeId: 1,
    empCode: 'OX-01',
    fullName: 'Rakib Hasan',
    department: 'Design',
    dayType: 'workday',
    status: 'no_activity',
    // ⚠️ নমুনায় কেউ ছুটিতে নেই — এই ফিক্সচার G130 নিয়ে দাবি করে না
    onLeave: false,
    designsDone: null,
    workedHours: 0,
    idleHours: 0,
    adjustmentHours: 0,
    creditedHours: 0,
    targetHours: 8,
    ...over,
  };
}

function report(
  rows: AttendanceRow[],
  metaOver: Partial<ReportMeta> = {},
): AttendanceReport {
  return {
    meta: meta(metaOver),
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

/** ১–২০ আগস্টের প্রতিটা দিনের সারি — শুক্রবারগুলো সাপ্তাহিক ছুটি */
function wholeRange(): AttendanceRow[] {
  const rows: AttendanceRow[] = [];
  for (let d = 1; d <= 20; d += 1) {
    const date = `2026-08-${String(d).padStart(2, '0')}`;
    const friday = d === 7 || d === 14;
    rows.push(
      row({
        date,
        dayType: friday ? 'weekly_off' : 'workday',
        targetHours: friday ? 0 : 8,
      }),
    );
  }
  return rows;
}

const cellOn = (grid: ReturnType<typeof buildMonthGrid>, date: string) =>
  grid.rows[0].cells.find((c) => c.date === date)!;

describe('G110 — ট্র্যাকিং শুরুর আগের দিন', () => {
  it('আগের কর্মদিবস `untracked`, পরেরটা সাধারণ `day`', () => {
    const grid = buildMonthGrid(report(wholeRange()), MONTH);

    // ১২ আগস্ট — ট্র্যাকিং শুরুর আগের দিন
    expect(cellOn(grid, '2026-08-12').kind).toBe('untracked');
    // ১৩ আগস্ট — ঠিক শুরুর দিন, এটা আর না-দেখা নয়
    expect(cellOn(grid, '2026-08-13').kind).toBe('day');
  });

  it('ছুটির দিন ছুটির দিনই থাকে — তার চেহারা আগে থেকেই ঠিক ছিল', () => {
    // ⚠️ ৭ আগস্ট শুক্রবার, আর ট্র্যাকিং শুরুরও আগে। তবু `untracked` নয়:
    //    ছুটির দিনের নিজস্ব চেহারা কাউকে ফাঁকিবাজ দেখায় না, তাই ওটা
    //    বদলানোর কোনো কারণ নেই। বদলালে উল্টো তথ্য হারাত।
    const grid = buildMonthGrid(report(wholeRange()), MONTH);
    expect(cellOn(grid, '2026-08-07').kind).toBe('day');
    expect(cellOn(grid, '2026-08-07').dayType).toBe('weekly_off');
  });

  it('⭐ না-দেখা দিনে owner ঘণ্টা বসালে দিনটা আর না-দেখা নয়', () => {
    // ⚠️⚠️ এটাই এই নিয়মের সবচেয়ে সহজে ভুল হওয়া ধারটা। সংশোধনে বসানো
    //    ঘণ্টা সত্যিকারের গোনা ঘণ্টা; ডটেড ফাঁকা ঘরে ঢেকে দিলে ওগুলো
    //    পর্দা থেকেই উধাও হতো, অথচ মোট ঘণ্টায় থাকত — ছবি আর সংখ্যা আবার
    //    দুই কথা বলত, কেবল উল্টো দিকে।
    const rows = wholeRange().map((r) =>
      r.date === '2026-08-10'
        ? { ...r, adjustmentHours: 8, creditedHours: 8 }
        : r,
    );

    expect(cellOn(buildMonthGrid(report(rows), MONTH), '2026-08-10').kind).toBe(
      'day',
    );
  });

  it('কখনোই দেখা হয়নি (`trackedFrom` null) — মাসের সব কর্মদিবসই না-দেখা', () => {
    const grid = buildMonthGrid(
      report(wholeRange(), { trackedFrom: { 1: null } }),
      MONTH,
    );

    const workdayCells = grid.rows[0].cells.filter(
      (c) => c.dayType === 'workday',
    );
    expect(workdayCells.length).toBeGreaterThan(0);
    expect(workdayCells.every((c) => c.kind === 'untracked')).toBe(true);
  });

  it('না-দেখা ঘর মোট ঘণ্টা বা প্রত্যাশা কিছুই বদলায় না', () => {
    // ⚠️ এটা নিছক আঁকার বদল — একটা সংখ্যাও নড়লে সেটা G110 নয়, নতুন একটা বাগ।
    const drawn = buildMonthGrid(report(wholeRange()), MONTH);
    const blind = buildMonthGrid(
      report(wholeRange(), { trackedFrom: {} }),
      MONTH,
    );

    expect(drawn.rows[0].creditedHours).toBe(blind.rows[0].creditedHours);
    expect(drawn.rows[0].expectedHours).toBe(blind.rows[0].expectedHours);
    expect(drawn.rows[0].paceHours).toBe(blind.rows[0].paceHours);
  });

  it('প্রত্যাশা এখনো সার্ভারের সংখ্যা — `trackedFrom` থেকে গোনা হয় না', () => {
    // ⭐⭐ এই টেস্টটাই G110-র আসল পাহারা। তারিখটা পাঠানোর **উদ্দেশ্যই**
    //    ছিল আঁকা, আর সবচেয়ে সহজ ভুলটা হলো ওটা দিয়ে আবার প্রত্যাশা গোনা —
    //    ঠিক ওভাবেই আগের বাগটা জন্মেছিল। এখানে `expectedHours` এমন একটা
    //    সংখ্যা যেটা তারিখ দিয়ে গুনলে কখনোই বেরোত না।
    const grid = buildMonthGrid(
      report(wholeRange(), { expectedHours: { 1: 3.5 } }),
      MONTH,
    );

    expect(grid.rows[0].expectedHours).toBe(3.5);
  });
});

describe('G111 — যাঁকে এখনো দেখাই হয়নি', () => {
  it('`observed` সার্ভারের meta থেকেই আসে', () => {
    const seen = buildMonthGrid(report(wholeRange()), MONTH);
    expect(seen.rows[0].observed).toBe(true);

    const unseen = buildMonthGrid(
      report(wholeRange(), { observed: { 1: false } }),
      MONTH,
    );
    expect(unseen.rows[0].observed).toBe(false);
  });

  it('meta চুপ থাকলে "দেখা হয়েছে" ধরা হয়', () => {
    // ⚠️ উল্টোটা করলে পুরোনো একটা সার্ভারের সাথে গোটা পাতা "কারো হিসাব
    //    নেই" দেখাত — সংখ্যাগুলো ঠিকই থাকত, শুধু ব্যাখ্যাটা মিথ্যা হতো।
    const grid = buildMonthGrid(report(wholeRange(), { observed: {} }), MONTH);
    expect(grid.rows[0].observed).toBe(true);
  });

  it('⭐ না-দেখা মানুষ "পিছিয়ে"-তেও গোনা হয় না, আলাদা করে গোনা হয়', () => {
    // ⚠️⚠️ তাঁর `paceHours` ঠিক ০, তাই তিনি "পিছিয়ে" তালিকায় পড়েন না —
    //    আর সেটাই ছিল ফাঁদ: তাতে তিনি নীরবে "ঠিক আছেন"-দের দলে চলে যেতেন।
    //    দুই তালিকার কোনোটাতেই না রেখে তৃতীয় একটা ঘরে গোনা হয়।
    const grid = buildMonthGrid(
      report(wholeRange(), { observed: { 1: false }, expectedHours: { 1: 0 } }),
      MONTH,
    );

    expect(grid.totals.behind).toBe(0);
    expect(grid.totals.notObserved).toBe(1);
  });

  it('দেখা-হওয়া পিছিয়ে-থাকা মানুষ আগের মতোই "পিছিয়ে"', () => {
    const grid = buildMonthGrid(
      report(wholeRange(), { observed: { 1: true }, expectedHours: { 1: 40 } }),
      MONTH,
    );

    expect(grid.totals.behind).toBe(1);
    expect(grid.totals.notObserved).toBe(0);
  });

  it('⭐ ০ ঘাটতি আর না-দেখা — সংখ্যায় এক, অবস্থায় আলাদা', () => {
    // ⭐⭐ এই সমতাটাই G111-এর গোটা কারণ। দুটো গ্রিডের `paceHours` হুবহু
    //    এক (০), অথচ একজনকে দেখা হয়েছে আর অন্যজনকে হয়নি। পতাকাটা না
    //    থাকলে পর্দার কাছে এই দুটো অবস্থা **সম্পূর্ণ অভিন্ন** — আর তখন
    //    দুজনেই "On track" পড়তেন।
    const met = buildMonthGrid(
      report(
        wholeRange().map((r) =>
          r.dayType === 'workday' ? { ...r, creditedHours: 8, workedHours: 8 } : r,
        ),
        // ১–২০ আগস্টে ১৮ কর্মদিবস (৭ ও ১৪ শুক্রবার) × ৮ঘ = ১৪৪ — ঠিক পূরণ
        { observed: { 1: true }, expectedHours: { 1: 144 } },
      ),
      MONTH,
    );
    const unseen = buildMonthGrid(
      report(wholeRange(), { observed: { 1: false }, expectedHours: { 1: 0 } }),
      MONTH,
    );

    expect(met.rows[0].paceHours).toBe(0);
    expect(unseen.rows[0].paceHours).toBe(0);
    expect(met.rows[0].observed).not.toBe(unseen.rows[0].observed);
  });
});
