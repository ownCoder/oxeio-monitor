import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';

import { notesFor } from '../src/reports/reports.pages';
import {
  APPROX_HOLIDAY_SUFFIX,
  approximateHolidayDates,
} from '../src/reports/reports.range';
import { summaryWorkbook } from '../src/reports/reports.sheets';
import {
  approximateHolidayNote,
  type ReportMeta,
  type SummaryReport,
} from '../src/reports/reports.types';

/**
 * G108 — "ছুটির তারিখ এখনো পাকা নয়" কথাটা **যেখানে সিদ্ধান্ত হয় সেখানেই**
 * পৌঁছায় কি না।
 *
 * ⭐⭐ এই ফাইলটাই G108-এর আসল ডেলিভারেবল, তারের কাজটা নয়। কারণ
 * `approximateHolidayDates()` অনেক আগে থেকেই ঠিক সংখ্যা ফেরাত এবং তার
 * নিজের ইউনিট টেস্টও ছিল (`holidays.spec.ts`) — শুধু **কেউ সেটা পড়ত না**।
 * গোটা রেপোতে ওই মানের উপর একটাও assertion ছিল না, তাই Excel বা PDF থেকে
 * সতর্কবার্তাটা উধাও হয়ে গেলেও সব টেস্ট সবুজই থাকত। G117-এ ঠিক এই ফাঁকই
 * ধরা পড়েছিল (09-Build-Log § ৩ঞ)।
 *
 * ⚠️ তাই এখানে "ফাংশনটা ঠিক উত্তর দেয়" পরীক্ষা করা হয় না — পরীক্ষা করা হয়
 * **পথটা**: মান → Excel-এর Info শিট, মান → PDF-এর পাদটীকা, আর দুই পথের
 * লেখা এক কি না।
 */

const APPROX = '2026-08-26';
const APPROX_2 = '2026-09-15';

function meta(over: Partial<ReportMeta> = {}): ReportMeta {
  return {
    from: '2026-08-01',
    to: '2026-08-31',
    requestedTo: '2026-08-31',
    clampedToToday: false,
    days: 31,
    generatedAt: '2026-08-31T12:00:00.000Z',
    excludedEmployees: [],
    targetHoursInRange: {},
    expectedHours: {},
    approximateHolidayDates: [],
    // ⚠️ নমুনায় কেউ 'না-দেখা' নয় — এই ফিক্সচার G110/G111 নিয়ে কোনো দাবি করে না
    observed: {},
    trackedFrom: {},
    ...over,
  };
}

function summary(m: ReportMeta): SummaryReport {
  return {
    meta: m,
    groupBy: 'month',
    overtimeNote: 'x',
    rows: [
      {
        employeeId: 1,
        empCode: 'OX-001',
        fullName: 'Jane Doe',
        bucket: '2026-08',
        bucketStart: '2026-08-01',
        bucketEnd: '2026-08-31',
        workdays: 27,
        daysWithWork: 26,
        workedHours: 210,
        adjustmentHours: 0,
        creditedHours: 210,
        targetHours: 216,
        shortfallHours: 6,
        overtimeHours: 0,
      },
    ],
  };
}

/** তৈরি ওয়ার্কবুক আবার পড়ে "Info" শিটের সারিগুলো ফেরত দেয় */
async function infoSheetRows(m: ReportMeta): Promise<[string, string][]> {
  const buffer = await summaryWorkbook(summary(m));

  // ⚠️ বাফারটা আবার পার্স করা হয় — `infoRows()` সরাসরি ডাকলে "ফাংশনটা
  //    সারি বানায়" প্রমাণ হতো, "সারিটা ফাইলে ওঠে" নয়। শিট যোগ করতে ভুলে
  //    গেলে তখনো টেস্ট সবুজ থাকত।
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = wb.getWorksheet('Info');
  expect(sheet, 'ওয়ার্কবুকে "Info" শিটই নেই').toBeDefined();

  const rows: [string, string][] = [];
  sheet!.eachRow((row) => {
    rows.push([
      String(row.getCell(1).value ?? ''),
      String(row.getCell(2).value ?? ''),
    ]);
  });
  return rows;
}

describe('G108 — সতর্কবার্তার লেখা', () => {
  it('কোনো সম্ভাব্য তারিখ না থাকলে কিছুই বলা হয় না', () => {
    // ⚠️ `''` নয়, `null` — কলাররা `!== null` দেখে সিদ্ধান্ত নেয়; খালি
    //    স্ট্রিং ফেরালে প্রতিটা রিপোর্টে একটা ফাঁকা "Note" সারি বসত।
    expect(approximateHolidayNote([])).toBeNull();
  });

  it('একটা তারিখ হলে একবচন, একাধিক হলে বহুবচন', () => {
    const one = approximateHolidayNote([APPROX])!;
    expect(one).toContain('1 holiday date');
    expect(one).toContain('is not final yet');

    const two = approximateHolidayNote([APPROX, APPROX_2])!;
    expect(two).toContain('2 holiday dates');
    expect(two).toContain('are not final yet');
  });

  it('তারিখগুলো লেখাতেই থাকে — পাঠক কোন দিন নড়তে পারে জানেন', () => {
    const note = approximateHolidayNote([APPROX, APPROX_2])!;
    expect(note).toContain(APPROX);
    expect(note).toContain(APPROX_2);
  });

  it('কী নড়তে পারে সেটাও বলা থাকে — টার্গেট ঘণ্টা ও পে-রোল', () => {
    // ⚠️ শুধু "তারিখ পাকা নয়" বললে পাঠক ভাবতেন এটা কেবল ক্যালেন্ডারের
    //    ব্যাপার। আসল ঝুঁকি হলো ওই মাসের কর্মদিবস বদলালে `d ÷ D` বদলায়,
    //    অর্থাৎ **টাকা** বদলায়।
    const note = approximateHolidayNote([APPROX])!;
    expect(note).toMatch(/working days/i);
    expect(note).toMatch(/target hours/i);
    expect(note).toMatch(/payroll/i);
  });
});

describe('G108 — Excel ফাইলের ভেতরে পৌঁছায়', () => {
  it('সম্ভাব্য তারিখ থাকলে Info শিটে সারিটা ওঠে', async () => {
    const rows = await infoSheetRows(
      meta({ approximateHolidayDates: [APPROX] }),
    );
    const row = rows.find(([label]) => label === 'Holiday dates not final');

    expect(row, 'Info শিটে সতর্কবার্তার সারিই নেই').toBeDefined();
    expect(row![1]).toBe(approximateHolidayNote([APPROX]));
  });

  it('না থাকলে সারিটাও থাকে না', async () => {
    const rows = await infoSheetRows(meta());
    expect(rows.map(([label]) => label)).not.toContain(
      'Holiday dates not final',
    );
  });
});

describe('G108 — PDF-এর পাদটীকায় পৌঁছায়', () => {
  it('সম্ভাব্য তারিখ থাকলে নোটটা যোগ হয়', () => {
    const notes = notesFor(
      meta({ approximateHolidayDates: [APPROX] }),
      false,
      [],
    );
    expect(notes).toContain(approximateHolidayNote([APPROX]));
  });

  it('না থাকলে যোগ হয় না', () => {
    expect(notesFor(meta(), false, [])).toEqual([]);
  });

  it('অন্য সতর্কবার্তার পাশে বাঁচে — একটা আরেকটাকে চাপা দেয় না', () => {
    // ⚠️ ছাঁটাই + বাদ-পড়া কর্মী + অনিশ্চিত ছুটি একসাথে ঘটতেই পারে (ঈদের
    //    মাসের শেষ দিকে)। কোডটা `push` করে বলে এটা তুচ্ছ মনে হয়, কিন্তু
    //    কেউ `notes = [...]` লিখে ফেললে নীরবে একটা হারিয়ে যেত।
    const notes = notesFor(
      meta({
        clampedToToday: true,
        excludedEmployees: ['Ghost Employee'],
        approximateHolidayDates: [APPROX],
      }),
      true,
      ['extra note'],
    );

    expect(notes).toContain(approximateHolidayNote([APPROX]));
    expect(notes.some((n) => n.includes('future dates were dropped'))).toBe(
      true,
    );
    expect(notes.some((n) => n.includes('Ghost Employee'))).toBe(true);
    expect(notes).toContain('extra note');
  });
});

describe('G108 — সব পথে এক লেখা', () => {
  it('Excel আর PDF অক্ষরে অক্ষরে একই কথা বলে', async () => {
    // ⭐⭐ সমতাটাই আসল পাহারা। দুই জায়গায় দুটো আলাদা বাক্য লিখলে আজ
    //    দুটোই ঠিক থাকত, কিন্তু একদিন একটা বদলালে অন্যটা পুরোনো কথা বলত —
    //    আর কাগজ ও শিট মিলিয়ে দেখা কেউ ধরতেই পারতেন না কোনটা সত্যি।
    const m = meta({ approximateHolidayDates: [APPROX, APPROX_2] });

    const excel = (await infoSheetRows(m)).find(
      ([label]) => label === 'Holiday dates not final',
    )![1];
    const pdf = notesFor(m, false, []).find((n) => n.includes(APPROX))!;

    expect(excel).toBe(pdf);
  });

  it('লেখাটা `meta` থেকেই আসে, নতুন করে গোনা হয় না', async () => {
    // ⚠️ কেউ যদি ছাপার সময় আবার ছুটির তালিকা দেখে গুনতেন, তাহলে
    //    অনিশ্চয়তার **দ্বিতীয় একটা সংজ্ঞা** দাঁড়াত। এখানে `meta`-তে এমন
    //    একটা তারিখ বসানো হয়েছে যেটা কোনো ছুটির তালিকাতেই নেই — তবু
    //    সেটাই ছাপা হওয়া চাই।
    const invented = '2031-01-02';
    const rows = await infoSheetRows(
      meta({ approximateHolidayDates: [invented] }),
    );
    const row = rows.find(([label]) => label === 'Holiday dates not final')!;

    expect(row[1]).toContain(invented);
  });
});

describe('G108 — হর আর সতর্কবার্তা এক সারি থেকেই আসে', () => {
  it('যে সারিগুলো দিয়ে কর্মদিবস গোনা, তার নামের চিহ্নই অনিশ্চয়তা ঠিক করে', () => {
    // ⚠️ চিহ্নটা DB-র **নামে** থাকে, আলাদা কোনো কলামে নয় — মালিক
    //    Settings → Holidays-এ চিহ্ন মুছলেই রিপোর্ট চুপ করে যায়।
    //
    // ⚠️ চিহ্নটা এখানে হাতে লেখা হয় না, ধ্রুবক থেকেই আসে: seed ওটা
    //    **লেখে**, রিপোর্ট ওটা **পড়ে**। হাতে লিখলে ধ্রুবক বদলানোর দিন
    //    seed আর রিপোর্ট আলাদা হয়ে যেত, অথচ টেস্ট সবুজ থাকত।
    const dates = approximateHolidayDates([
      {
        date: new Date('2026-08-26T00:00:00.000Z'),
        name: `Eid-e-Miladunnabi${APPROX_HOLIDAY_SUFFIX}`,
      },
      {
        date: new Date('2026-08-15T00:00:00.000Z'),
        name: 'National Mourning Day',
      },
    ]);

    expect(dates).toEqual([APPROX]);
    expect(approximateHolidayNote(dates)).toContain(APPROX);
  });
});
