import { describe, expect, it } from 'vitest';

import {
  attendanceLines,
  attendancePdf,
  summaryLines,
  summaryPdf,
} from '../src/reports/reports.pages';
import {
  MIME_OF,
  PDF_MIME,
  reportFilename,
} from '../src/reports/reports.download';
import {
  dhakaStamp,
  EMPTY_CELL,
  hoursText,
  personLabel,
  toPdfText,
  truncateToWidth,
  truncationNote,
  UNPRINTABLE,
} from '../src/reports/reports.pdf.text';
import type {
  AttendanceReport,
  ReportMeta,
  SummaryReport,
} from '../src/reports/reports.types';

/**
 * F06 — PDF এক্সপোর্ট।
 *
 * ⭐ এখানে যা পরীক্ষা করা হয়, তার প্রায় প্রতিটাই এমন ভুল যেটা হলে **কোনো
 * এরর উঠত না** — শুধু ছাপা কাগজে একটা ঘর ফাঁকা থাকত, বা একটা সতর্কবার্তা
 * উধাও হয়ে যেত। ডাটাবেস লাগে না, তাই এগুলো নিরিবিলি চলে।
 */

const meta: ReportMeta = {
  from: '2026-08-01',
  to: '2026-08-11',
  requestedTo: '2026-08-11',
  clampedToToday: false,
  days: 11,
  generatedAt: '2026-08-11T12:34:56.000Z',
  excludedEmployees: [],
  monthTargetHours: {},
  expectedHours: {},
  // ⚠️ এই নমুনা জগতে কোনো ছুটিই নেই, তাই খালি — "কোনো সম্ভাব্য তারিখ নেই"
  approximateHolidayDates: [],
};

function attendance(over: Partial<AttendanceReport> = {}): AttendanceReport {
  return {
    meta,
    rows: [
      {
        employeeId: 1,
        empCode: 'OX-001',
        fullName: 'Jane Doe',
        department: 'Support',
        date: '2026-08-11',
        dayType: 'workday',
        status: 'worked',
        workedHours: 7.5,
        idleHours: 0.5,
        adjustmentHours: 0,
        creditedHours: 7.5,
        targetHours: 8,
      },
    ],
    totals: {
      employees: 1,
      rows: 1,
      workedHours: 7.5,
      creditedHours: 7.5,
      targetHours: 8,
      daysWithWork: 1,
    },
    ...over,
  };
}

function summary(over: Partial<SummaryReport> = {}): SummaryReport {
  return {
    meta,
    groupBy: 'month',
    overtimeNote: 'x',
    rows: [
      {
        employeeId: 1,
        empCode: 'OX-001',
        fullName: 'Jane Doe',
        bucket: '2026-08',
        bucketStart: '2026-08-01',
        bucketEnd: '2026-08-11',
        workdays: 9,
        daysWithWork: 8,
        workedHours: 62.5,
        adjustmentHours: 1,
        creditedHours: 63.5,
        targetHours: 72,
        shortfallHours: 8.5,
        overtimeHours: 0,
      },
    ],
    ...over,
  };
}

describe('toPdfText — কোন লেখা আদৌ ছাপা যাবে', () => {
  it('ASCII অক্ষর অক্ষত থাকে', () => {
    expect(toPdfText('OX-001 Jane Doe')).toEqual({
      text: 'OX-001 Jane Doe',
      lossy: false,
    });
  });

  it('Latin-1 উচ্চারণচিহ্ন ছাপা যায় — ইউরোপীয় নাম বাদ পড়ে না', () => {
    expect(toPdfText('Ábel Kovács')).toEqual({
      text: 'Ábel Kovács',
      lossy: false,
    });
  });

  it('বাংলা অক্ষর ? হয় এবং lossy বলে জানায়', () => {
    const out = toPdfText('মামুন');
    expect(out.lossy).toBe(true);
    // ⚠️ মুছে ফেলা হয় না — খালি স্ট্রিং "নাম নেই"-এর সমান দেখাত
    expect(out.text).toBe(UNPRINTABLE.repeat('মামুন'.length));
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('null ও খালি স্ট্রিং খালি ঘর হয়, lossy নয়', () => {
    expect(toPdfText(null)).toEqual({ text: EMPTY_CELL, lossy: false });
    expect(toPdfText('')).toEqual({ text: EMPTY_CELL, lossy: false });
    expect(toPdfText(undefined)).toEqual({ text: EMPTY_CELL, lossy: false });
  });

  it('ইউনিকোড যতিচিহ্ন ASCII হয়, কিন্তু lossy নয়', () => {
    // ⚠️ এগুলো WinAnsi-তে আছে, তবু বদলানো হয় — একই ড্যাশের দু-রকম বাইট
    //    থাকলে প্রস্থ মাপা অনির্দেশ্য হতো
    expect(toPdfText('“a” – b… ‘c’')).toEqual({
      text: '"a" - b... \'c\'',
      lossy: false,
    });
  });

  it('NBSP সাধারণ স্পেস হয় — নইলে ছাপায় দেখতে এক, মাপে আলাদা', () => {
    expect(toPdfText('a b').text).toBe('a b');
  });
});

describe('personLabel — বাংলা নামের ঘরে কী বসবে', () => {
  it('ছাপা-যোগ্য নাম যেমন আছে তেমনই থাকে', () => {
    expect(personLabel('Jane Doe', 'OX-001')).toEqual({
      text: 'Jane Doe',
      lossy: false,
    });
  });

  it('⭐ বাংলা নামের বদলে এমপ কোড বসে, প্রশ্নচিহ্নের সারি নয়', () => {
    // ??????? দেখে কেউ কর্মীকে চিনতে পারতেন না; কোডটা পাশের কলামেই আছে
    // আর সবাই সেটা চেনে
    expect(personLabel('মামুনুর রশিদ', 'OX-004')).toEqual({
      text: 'OX-004',
      lossy: true,
    });
  });

  it('কোডও ছাপা না গেলে ফাঁকা নয়, চিহ্ন বসে', () => {
    const out = personLabel('মামুন', 'কোড');
    expect(out.lossy).toBe(true);
    expect(out.text).toContain(UNPRINTABLE);
  });
});

describe('truncateToWidth — ঘরের বাইরে লেখা গড়িয়ে না পড়া', () => {
  // এক অক্ষর = ১০pt, এমন সরল মাপক
  const measure = (s: string): number => s.length * 10;

  it('আঁটলে অক্ষত', () => {
    expect(truncateToWidth('abc', 100, measure)).toBe('abc');
  });

  it('না আঁটলে ... সহ কাটা — কাটা পড়েছে সেটা দেখা যায়', () => {
    expect(truncateToWidth('abcdefgh', 60, measure)).toBe('abc...');
  });

  it('... নিজেও না আঁটলে যতটুকু আঁটে ততটুকু কাঁচা লেখা', () => {
    expect(truncateToWidth('abcdefgh', 25, measure)).toBe('ab');
  });

  it('প্রস্থ শূন্য বা ঋণাত্মক হলে খালি — অসীম লুপ নয়', () => {
    expect(truncateToWidth('abc', 0, measure)).toBe('');
    expect(truncateToWidth('abc', -5, measure)).toBe('');
  });
});

describe('hoursText ও dhakaStamp', () => {
  it('ঘণ্টা সবসময় দুই দশমিক — কলামে দশমিক বিন্দু এক লাইনে দাঁড়ায়', () => {
    expect(hoursText(7)).toBe('7.00');
    expect(hoursText(7.5)).toBe('7.50');
    expect(hoursText(-0.25)).toBe('-0.25');
  });

  it('অসীম/NaN ফাঁকা ঘর — "NaN" ছাপা হয় না', () => {
    expect(hoursText(Number.NaN)).toBe(EMPTY_CELL);
    expect(hoursText(Number.POSITIVE_INFINITY)).toBe(EMPTY_CELL);
  });

  it('⚠️ তৈরির সময় ঢাকার ঘড়িতে, সার্ভারের টাইমজোনে নয়', () => {
    // UTC ১২:৩৪ = ঢাকার ১৮:৩৪
    expect(dhakaStamp(new Date('2026-08-11T12:34:56.000Z'))).toBe(
      '2026-08-11 18:34 (Asia/Dhaka)',
    );
  });

  it('UTC-র তারিখ বদলের আগে-পরে ঢাকার তারিখ এক দিন এগিয়ে থাকে', () => {
    // UTC ১১ আগস্ট ২০:০০ = ঢাকার ১২ আগস্ট ০২:০০
    expect(dhakaStamp(new Date('2026-08-11T20:00:00.000Z'))).toBe(
      '2026-08-12 02:00 (Asia/Dhaka)',
    );
  });
});

describe('truncationNote — বাদ পড়া সারি চুপচাপ হারায় না', () => {
  it('সব সারি দেখানো হলে কোনো নোট নেই', () => {
    expect(truncationNote(50, 50)).toBeNull();
    expect(truncationNote(10, 50)).toBeNull();
  });

  it('কাটা পড়লে দুটো সংখ্যাই লেখা থাকে ও Excel-এর কথা বলা হয়', () => {
    const note = truncationNote(5000, 2000);
    expect(note).toContain('2000');
    expect(note).toContain('5000');
    expect(note).toMatch(/xlsx/i);
  });
});

describe('attendanceLines — রিপোর্ট → ছাপার লাইন', () => {
  it('সংখ্যা দুই দশমিকে, লেবেল ইংরেজিতে', () => {
    const { lines, lossy } = attendanceLines(attendance());

    expect(lossy).toBe(false);
    expect(lines[0]).toMatchObject({
      empCode: 'OX-001',
      name: 'Jane Doe',
      department: 'Support',
      dayType: 'Workday',
      status: 'Worked',
      worked: '7.50',
      target: '8.00',
    });
  });

  it('⭐ বাংলা নাম থাকলে lossy ওঠে — নইলে পাদটীকাটা কখনো বসত না', () => {
    const report = attendance();
    report.rows[0].fullName = 'মামুনুর রশিদ';

    const { lines, lossy } = attendanceLines(report);
    expect(lossy).toBe(true);
    expect(lines[0].name).toBe('OX-001');
  });

  it('⚠️ শুধু বিভাগ বাংলা হলেও lossy ওঠে', () => {
    const report = attendance();
    report.rows[0].department = 'প্রকৌশল';

    const { lines, lossy } = attendanceLines(report);
    expect(lossy).toBe(true);
    // নাম ঠিকই থাকে — কেবল বিভাগের ঘরে চিহ্ন
    expect(lines[0].name).toBe('Jane Doe');
    expect(lines[0].department).toContain(UNPRINTABLE);
  });

  it('বিভাগ না থাকলে খালি ঘর, lossy নয়', () => {
    const report = attendance();
    report.rows[0].department = null;

    const { lines, lossy } = attendanceLines(report);
    expect(lossy).toBe(false);
    expect(lines[0].department).toBe(EMPTY_CELL);
  });
});

describe('summaryLines', () => {
  it('দিনসংখ্যা পূর্ণসংখ্যা, ঘণ্টা দুই দশমিক', () => {
    const { lines } = summaryLines(summary());

    expect(lines[0]).toMatchObject({
      bucket: '2026-08',
      // ⚠️ "৯.০০ কর্মদিবস" পড়তে অদ্ভুত, আর ঘণ্টার সাথে গুলিয়ে যেত
      workdays: '9',
      daysWithWork: '8',
      credited: '63.50',
      shortfall: '8.50',
      overtime: '0.00',
    });
  });
});

describe('ফাইলের নাম ও MIME', () => {
  it('⚠️ এক্সটেনশন ফরম্যাট অনুযায়ী — PDF কখনো .xlsx নামে সেভ হয় না', () => {
    expect(reportFilename('attendance', '2026-08-01', '2026-08-11', 'pdf')).toBe(
      'oxeio-attendance-2026-08-01_2026-08-11.pdf',
    );
    expect(reportFilename('summary', '2026-08-01', '2026-08-11', 'xlsx')).toBe(
      'oxeio-summary-2026-08-01_2026-08-11.xlsx',
    );
  });

  it('নাম পুরোটাই ASCII — Content-Disposition ভাঙে না', () => {
    const name = reportFilename('attendance', '2026-08-01', '2026-08-11', 'pdf');
    expect(/^[\x20-\x7E]+$/.test(name)).toBe(true);
  });

  it('MIME ম্যাপে দুটোই আছে', () => {
    expect(MIME_OF.pdf).toBe(PDF_MIME);
    expect(MIME_OF.xlsx).toContain('spreadsheetml');
  });
});

describe('PDF তৈরি (pdfkit)', () => {
  it('আসল PDF বাইট বেরোয়', async () => {
    const buffer = await attendancePdf(attendance(), 'oXeio Office');

    expect(buffer.byteLength).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('সারাংশেরও', async () => {
    const buffer = await summaryPdf(summary(), 'oXeio Office');
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('⭐ শূন্য সারিতেও ভাঙে না — খালি রেঞ্জ একটা বৈধ ফল', async () => {
    const empty = attendance({
      rows: [],
      totals: {
        employees: 0,
        rows: 0,
        workedHours: 0,
        creditedHours: 0,
        targetHours: 0,
        daysWithWork: 0,
      },
    });

    const buffer = await attendancePdf(empty, 'oXeio Office');
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('অনেক সারিতে একাধিক পাতা হয়, তবু একটাই ফাইল', async () => {
    const base = attendance();
    const many = attendance({
      rows: Array.from({ length: 300 }, () => ({ ...base.rows[0] })),
    });

    const buffer = await attendancePdf(many, 'oXeio Office');
    expect(buffer.byteLength).toBeGreaterThan(2000);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
