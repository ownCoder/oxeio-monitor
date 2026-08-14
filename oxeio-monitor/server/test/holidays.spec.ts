import { describe, expect, it } from 'vitest';

import {
  APPROX_SUFFIX,
  BD_HOLIDAYS,
  HOLIDAY_YEARS,
  PENDING_GAZETTES,
  baseName,
  dhakaToday,
  gazetteNotes,
  hasApproxSuffix,
  holidayRowName,
  isRealDate,
  isSettledMonth,
  monthKey,
  planHolidaySeed,
  planHolidaySeedRun,
  validateHolidays,
  yearOf,
  yearsSettled,
  yearsToSeed,
  type ExistingHoliday,
  type HolidayEntry,
} from '../prisma/holidays.data';
/**
 * ⚠️ রিপোর্টের দিকটাও এখান থেকেই পরীক্ষা করা হয়, `reports.range.spec.ts`
 *    থেকে নয় — কারণ চিহ্নটার **দুটো কপি** (seed লেখে, রিপোর্ট পড়ে) এক
 *    আছে কি না, সেটা মেলাতে দুই ফাইলই একসাথে লাগে। আলাদা করলে ঠিক ওই
 *    জোড়টাই অপরীক্ষিত থেকে যেত, অথচ ওটাই ভাঙার জায়গা।
 */
import {
  APPROX_HOLIDAY_SUFFIX,
  approximateHolidayDates,
  isApproximateHoliday,
} from '../src/reports/reports.range';

/**
 * সরকারি ছুটির তালিকা (R7 · O2)।
 *
 * ⭐ এই ফাইলের সবচেয়ে জরুরি টেস্টগুলো কোনো নির্দিষ্ট তারিখের নয় — তারিখ তো
 * সরকার বদলাবেই। জরুরি হলো দুটো নিয়ম:
 *   ১· **আনুমানিক তারিখ আনুমানিক বলেই DB-তে যায়** (`(সম্ভাব্য)` চিহ্ন)।
 *      ওটা খসে গেলে অনুমানটা নিশ্চিত সংখ্যার ছদ্মবেশে ঢুকে পড়ত।
 *   ২· **seed কারো হাতের কাজ মোছে না** — ঘোষণা দেখে ঠিক করা তারিখ পরের
 *      `db seed`-এ ফিরে যাবে না, আর সরানো ছুটি পুরোনো তারিখে ফিরে আসবে না।
 */

const entry = (over: Partial<HolidayEntry> = {}): HolidayEntry => ({
  date: '2026-03-21',
  name: 'ঈদুল ফিতর',
  nameEn: 'Eid-ul-Fitr',
  approximate: true,
  ...over,
});

const row = (date: string, name: string): ExistingHoliday => ({ date, name });

/**
 * ⚠️ নিচের বেশিরভাগ `planHolidaySeedRun` টেস্ট **বছর-গেটের** কথা বলে,
 *    **মাস-গেটের** নয়। তাই "আজ" এমন একটা দিন বেছে নেওয়া হয়েছে যেদিন
 *    তালিকার প্রতিটা তারিখই ভবিষ্যতে — মাস-গেটটা তখন নিষ্ক্রিয়, আর
 *    টেস্টগুলো যা মাপতে চায় ঠিক সেটাই মাপে।
 *
 * ⚠️ `allowPast: true` দিয়ে এটা করা হয়নি ইচ্ছাকৃতভাবে: তাতে প্রতিটা
 *    টেস্ট নীরবে সম্মতি-পথটাই পরীক্ষা করত, আর ডিফল্ট পথটা (সম্মতি নেই)
 *    কার্যত অপরীক্ষিত থেকে যেত।
 */
const early = { today: '2026-01-01', allowPast: false };

// ── তারিখ বৈধতা ─────────────────────────────────────────────────────────────

describe('isRealDate', () => {
  it('স্বাভাবিক তারিখ মেনে নেয়', () => {
    expect(isRealDate('2026-03-21')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true); // অধিবর্ষ
  });

  /** ⚠️ `new Date('2026-02-30')` চুপচাপ ২ মার্চ বানায় — থামে না */
  it('২০২৬-০২-৩০ ধরা পড়ে', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
  });

  it('২০২৬-০২-২৯ ধরা পড়ে — ২০২৬ অধিবর্ষ নয়', () => {
    expect(isRealDate('2026-02-29')).toBe(false);
  });

  it('মাস/দিনের সীমা ও ধাঁচ', () => {
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-00-10')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
    expect(isRealDate('2026-3-21')).toBe(false);
    expect(isRealDate('21-03-2026')).toBe(false);
    expect(isRealDate('')).toBe(false);
  });
});

// ── তালিকা যাচাই ────────────────────────────────────────────────────────────

describe('validateHolidays', () => {
  it('অবৈধ তারিখ ধরে', () => {
    const problems = validateHolidays([entry({ date: '2026-02-30' })]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('2026-02-30');
  });

  /**
   * ⚠️⚠️ `holiday_date` unique — একই তারিখ দুবার থাকলে seed নিঃশব্দে
   *    একটাকে আরেকটা দিয়ে চাপা দিত, আর একটা ছুটি উধাও হতো।
   */
  it('একই তারিখ দুবার থাকলে ধরে, আগেরটার নামসহ', () => {
    const problems = validateHolidays([
      entry({ date: '2026-03-21', name: 'ঈদুল ফিতর' }),
      entry({ date: '2026-03-21', name: 'অন্য কিছু' }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ঈদুল ফিতর');
  });

  it('খালি নাম ধরে — বাংলা ও ইংরেজি দুটোই', () => {
    expect(validateHolidays([entry({ name: '   ' })])).toHaveLength(1);
    expect(validateHolidays([entry({ nameEn: '' })])).toHaveLength(1);
  });

  /** ⚠️ API-র সীমা ১২০ অক্ষর (`CreateHolidayDto`) — চিহ্নসহ মাপা হয় */
  it('১২০ অক্ষরের বেশি নাম ধরে', () => {
    expect(validateHolidays([entry({ name: 'ছ'.repeat(121) })])).toHaveLength(1);
  });

  /** ⚠️ চিহ্নটা `approximate` থেকে আসে; হাতে লিখলে দুবার জুড়ত */
  it('নামে হাতে লেখা "(সম্ভাব্য)" ধরে', () => {
    const problems = validateHolidays([
      entry({ name: 'ঈদুল ফিতর (সম্ভাব্য)' }),
    ]);

    expect(problems).toHaveLength(1);
  });

  it('একবারে সব ভুল ফেরত দেয়, প্রথমটাতেই থামে না', () => {
    const problems = validateHolidays([
      entry({ date: '2026-02-30' }),
      entry({ date: '2026-04-31' }),
      entry({ date: '2026-06-01', name: '' }),
    ]);

    expect(problems).toHaveLength(3);
  });

  it('ঠিক তালিকায় কিছু বলে না', () => {
    expect(validateHolidays([entry(), entry({ date: '2026-03-22' })])).toEqual(
      [],
    );
  });
});

// ── আসল তালিকাটাই ───────────────────────────────────────────────────────────

describe('BD_HOLIDAYS — রিপোতে থাকা তালিকা', () => {
  it('কোনো ভুল নেই', () => {
    expect(validateHolidays(BD_HOLIDAYS)).toEqual([]);
  });

  it('শুধু ২০২৬ ও ২০২৭ — অন্য বছর ঢুকে পড়েনি', () => {
    expect([...HOLIDAY_YEARS].sort((a, b) => a - b)).toEqual([2026, 2027]);
    for (const holiday of BD_HOLIDAYS) {
      expect(HOLIDAY_YEARS).toContain(yearOf(holiday.date));
    }
  });

  it('তারিখ অনুসারে সাজানো — চোখে খুঁজতে সুবিধা, আর ফাঁক ধরা পড়ে', () => {
    const dates = BD_HOLIDAYS.map((h) => h.date);
    expect(dates).toEqual([...dates].sort());
  });

  /**
   * ⭐⭐ **এই টেস্টটাই এই কাজের মূল কথা।** চান্দ্র/তিথি-নির্ভর ছুটির তারিখ
   * চাঁদ দেখার পর বদলায়; পতাকাটা খসে গেলে অনুমান নিশ্চিত হিসেবে ঢুকে পড়ত,
   * আর কেউ যাচাই করার কথাই ভাবত না।
   */
  it('চান্দ্র ও পঞ্জিকার ছুটিগুলো approximate', () => {
    const moonBound = [
      'শবে বরাত',
      'শবে কদর',
      'জুমাতুল বিদা',
      'ঈদুল ফিতর',
      'ঈদুল আজহা',
      'আশুরা',
      'মিলাদুন্নবী',
      'জন্মাষ্টমী',
      'দুর্গাপূজা',
      'দশমী',
    ];

    for (const holiday of BD_HOLIDAYS) {
      if (moonBound.some((needle) => holiday.name.includes(needle))) {
        expect(
          holiday.approximate,
          `${holiday.date} "${holiday.name}" — approximate হওয়ার কথা`,
        ).toBe(true);
      }
    }
  });

  /**
   * ⚠️ উল্টো দিকটাও: গ্রেগরিয়ান তারিখের জাতীয় দিবস কখনো "সম্ভাব্য" নয়।
   *    সবাইকে approximate বানিয়ে দিলে চিহ্নটার আর কোনো মানে থাকত না।
   */
  it('নির্দিষ্ট তারিখের জাতীয় দিবসগুলো approximate নয়', () => {
    const fixed = ['02-21', '03-26', '05-01', '08-05', '11-07', '12-16', '12-25'];

    for (const holiday of BD_HOLIDAYS) {
      if (fixed.includes(holiday.date.slice(5))) {
        expect(
          holiday.approximate,
          `${holiday.date} "${holiday.name}" — নির্দিষ্ট তারিখ`,
        ).toBe(false);
      }
    }
  });

  /** ⚠️ যে ভুলটা এই কাজ ঠেকাচ্ছে: ঈদের দিনগুলো তালিকাতেই না থাকা */
  it('২০২৬ ও ২০২৭ — দুই বছরেই দুটো ঈদ আছে', () => {
    for (const year of [2026, 2027]) {
      const ofYear = BD_HOLIDAYS.filter((h) => yearOf(h.date) === year);
      expect(ofYear.some((h) => h.name.includes('ঈদুল ফিতর'))).toBe(true);
      expect(ofYear.some((h) => h.name.includes('ঈদুল আজহা'))).toBe(true);
    }
  });

  /**
   * ⚠️ ২০২৪-এ তালিকা থেকে বাদ পড়া দিন দুটো — আগের seed ওগুলো বসাত।
   *    ফিরে এলে আবার দুটো কর্মদিবস নিঃশব্দে ছুটি হয়ে যেত।
   */
  it('বাতিল হওয়া ছুটি (জাতির পিতার জন্মদিন · জাতীয় শোক দিবস) ফিরে আসেনি', () => {
    const names = BD_HOLIDAYS.map((h) => h.name);
    expect(names).not.toContain('জাতির পিতার জন্মদিন');
    expect(names).not.toContain('জাতীয় শোক দিবস');

    /**
     * ⚠️ তারিখ দেখে পরীক্ষা করা যেত না — এই টেস্টটা প্রথমে তা-ই করত আর
     *    ভুল করে ধরা পড়ত: ১৫ আগস্ট ২০২৭-এ ঈদে মিলাদুন্নবী পড়েছে। বাতিল
     *    হওয়া দিবস আর ওই দিনের অন্য একটা ছুটি এক জিনিস নয়।
     */
    expect(BD_HOLIDAYS.find((h) => h.date === '2026-03-17')?.name).toBe(
      'শবে কদর',
    );
    expect(BD_HOLIDAYS.find((h) => h.date === '2026-08-15')).toBeUndefined();
  });
});

// ── DB-তে যাওয়া নাম ─────────────────────────────────────────────────────────

describe('holidayRowName ও baseName', () => {
  it('আনুমানিক হলে চিহ্ন জোড়ে, নাহলে জোড়ে না', () => {
    expect(holidayRowName(entry({ approximate: true }))).toBe(
      `ঈদুল ফিতর${APPROX_SUFFIX}`,
    );
    expect(holidayRowName(entry({ approximate: false }))).toBe('ঈদুল ফিতর');
  });

  /** ⚠️ মালিক ঘোষণা এলে চিহ্নটা মুছে দেবেন — তবু সারিটা চেনা যেতে হবে */
  it('চিহ্ন থাকুক বা না থাকুক, baseName এক', () => {
    expect(baseName(`ঈদুল ফিতর${APPROX_SUFFIX}`)).toBe('ঈদুল ফিতর');
    expect(baseName('ঈদুল ফিতর')).toBe('ঈদুল ফিতর');
    expect(baseName('  ঈদুল ফিতর  ')).toBe('ঈদুল ফিতর');
  });

  /** ⚠️ লেজেই দেখা হয় — নামের মাঝে বন্ধনী থাকা মানে চিহ্ন নয় */
  it('hasApproxSuffix শুধু লেজ দেখে', () => {
    expect(hasApproxSuffix(`ঈদুল ফিতর${APPROX_SUFFIX}`)).toBe(true);
    expect(hasApproxSuffix(`ঈদুল ফিতর${APPROX_SUFFIX}   `)).toBe(true);
    expect(hasApproxSuffix('ঈদুল ফিতর')).toBe(false);
    expect(hasApproxSuffix('ঈদ (সম্ভাব্য) — সংশোধিত')).toBe(false);
  });
});

// ── ⭐⭐ কোন মাসের হিসাব বেরিয়ে গেছে ─────────────────────────────────────────

/**
 * ⭐⭐ **এই অংশটাই এই রাউন্ডের মূল কথা।** চলতি বা অতীত মাসে একটা ছুটি বসলে
 * ওই মাসের কর্মদিবস কমে, `dailyTargetSec` বাড়ে, `monthly_summary`-র তিনটে
 * ঘর নড়ে, আর পে-রোলের `d ÷ D` ভগ্নাংশ সরাসরি টাকায় গিয়ে পড়ে। তাই "মাসটা
 * কি ইতিমধ্যে চলে গেছে" — এই একটা প্রশ্নের উত্তরের উপরেই সবটা দাঁড়ানো।
 */
describe('dhakaToday', () => {
  it('UTC ঘড়িকে ঢাকার তারিখে বদলায়', () => {
    expect(dhakaToday(new Date('2026-08-14T05:00:00.000Z'))).toBe('2026-08-14');
  });

  /**
   * ⚠️⚠️ **আসল ফাঁদটা এটাই।** ঢাকায় ১ সেপ্টেম্বর রাত ২টা মানে UTC-তে
   *    ৩১ আগস্ট রাত ৮টা। UTC ধরলে seed তখন আগস্টকে "চলতি মাস" ভাবত, আর
   *    সদ্য শেষ হওয়া আগস্টের ছুটি নীরবে বসিয়ে ওই মাসের পে-রোল নাড়াত।
   */
  it('ঢাকার ভোররাত UTC-তে আগের দিন — তবু ঢাকার তারিখই ফেরে', () => {
    expect(dhakaToday(new Date('2026-08-31T20:00:00.000Z'))).toBe('2026-09-01');
  });

  it('ঢাকার মধ্যরাতের ঠিক আগে-পরে', () => {
    expect(dhakaToday(new Date('2026-08-14T17:59:59.000Z'))).toBe('2026-08-14');
    expect(dhakaToday(new Date('2026-08-14T18:00:00.000Z'))).toBe('2026-08-15');
  });
});

describe('monthKey ও isSettledMonth', () => {
  it('মাসের চাবি', () => {
    expect(monthKey('2026-08-26')).toBe('2026-08');
  });

  /** ⭐ চলতি মাসও "চলে গেছে" — মাসের মাঝপথেই সংখ্যাগুলো লেখা হয়ে গেছে */
  it('চলতি মাস settled ধরা হয়', () => {
    expect(isSettledMonth('2026-08-05', '2026-08-14')).toBe(true);
    expect(isSettledMonth('2026-08-26', '2026-08-14')).toBe(true);
    expect(isSettledMonth('2026-08-31', '2026-08-01')).toBe(true);
  });

  it('অতীত মাস settled', () => {
    expect(isSettledMonth('2026-03-21', '2026-08-14')).toBe(true);
    expect(isSettledMonth('2025-12-25', '2026-08-14')).toBe(true);
  });

  /** ⚠️ ভবিষ্যতের মাস নিরাপদ — ওখানে কোনো monthly_summary সারিই নেই */
  it('ভবিষ্যতের মাস settled নয়', () => {
    expect(isSettledMonth('2026-09-01', '2026-08-31')).toBe(false);
    expect(isSettledMonth('2027-01-24', '2026-08-14')).toBe(false);
  });
});

// ── ⚠️⚠️ প্রজ্ঞাপনহীন বছর ───────────────────────────────────────────────────

describe('gazetteNotes', () => {
  /**
   * ⭐⭐ শুধু `approximate` সারি গোনা হয়। ২৬ মার্চ কবে সেটা প্রজ্ঞাপনের উপর
   *    নির্ভর করে না — মিশিয়ে ফেললে **এক সংখ্যা, দুই সংজ্ঞা** হয়ে যেত।
   */
  it('শুধু আনুমানিক তারিখগুলো গোনে', () => {
    const notes = gazetteNotes(
      [
        entry({ date: '2027-03-09', approximate: true }),
        entry({ date: '2027-03-10', approximate: true }),
        entry({ date: '2027-03-26', name: 'স্বাধীনতা দিবস', approximate: false }),
      ],
      [{ year: 2027, dueBy: 'নভেম্বর ২০২৬' }],
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('2টি');
    expect(notes[0]).toContain('নভেম্বর ২০২৬');
  });

  /** ⚠️ না-থাকা অনিশ্চয়তা নিয়ে কথা বলার মানে নেই */
  it('ওই বছরে আনুমানিক কিছু না থাকলে চুপ', () => {
    expect(
      gazetteNotes(
        [entry({ date: '2027-12-16', approximate: false })],
        [{ year: 2027, dueBy: 'নভেম্বর ২০২৬' }],
      ),
    ).toEqual([]);
    expect(
      gazetteNotes([entry({ date: '2026-03-21' })], [
        { year: 2027, dueBy: 'নভেম্বর ২০২৬' },
      ]),
    ).toEqual([]);
  });

  /**
   * ⭐⭐ আসল তালিকা — seed চালালে মালিক সত্যিই এই বার্তাটা দেখবেন, আর
   *    সংখ্যাটা তালিকার সাথে মিলবে। হাতে লেখা কোনো সংখ্যা নয়।
   */
  it('আসল তালিকায় ২০২৭-এর অনিশ্চয়তা গোনা হয়, আর সংখ্যাটা তালিকা থেকেই আসে', () => {
    const notes = gazetteNotes(BD_HOLIDAYS);
    const unsure2027 = BD_HOLIDAYS.filter(
      (h) => yearOf(h.date) === 2027 && h.approximate,
    ).length;

    expect(unsure2027).toBeGreaterThan(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(`${unsure2027}টি`);
    expect(notes[0]).toContain('2027');
  });

  /**
   * ⚠️ ২০২৬-এর প্রজ্ঞাপন বেরিয়ে গেছে (নভেম্বর ২০২৫) — তাই বছরটা তালিকায়
   *    থাকা চলবে না, নইলে সতর্কবার্তাটা মিথ্যে হয়ে বাজত।
   */
  it('২০২৬ প্রজ্ঞাপনহীন বছরের তালিকায় নেই', () => {
    expect(PENDING_GAZETTES.map((g) => g.year)).not.toContain(2026);
  });
});

// ── অনিশ্চয়তা সংখ্যা পর্যন্ত পৌঁছায় কি না ───────────────────────────────────

/**
 * ⭐⭐ চিহ্নটা এতদিন কেবল **নামে** ছিল। কিন্তু যেসব **সংখ্যা** ওই তারিখের উপর
 * দাঁড়ানো — মাসের কর্মদিবস → দৈনিক টার্গেটের হর → `target_sec`, আর
 * পে-রোলের `d ÷ D` ভগ্নাংশ (সরাসরি টাকা) — সেখানে অনিশ্চয়তার কোনো ছাপ ছিল
 * না। এই টেস্টগুলো সেই সেতুটা পাহারা দেয়।
 */
describe('আনুমানিক ছুটির চিহ্ন — লেখা ও পড়া', () => {
  /**
   * ⚠️⚠️ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।** স্ট্রিংটা দু'জায়গায় লেখা
   *    (`prisma/holidays.data.ts` লেখে, `src/reports/reports.range.ts`
   *    পড়ে), কারণ import দুই দিকেই ভাঙে — `src/` → `prisma/` করলে
   *    `nest build`-এর আউটপুট `dist/src/main.js`-এ সরে যায়, আর
   *    `prisma/` → `src/` করলে seed runtime ইমেজে ভাঙে (সেখানে `src/` নেই)।
   *    কপি দুটো সরে গেলে seed চিহ্ন বসাত ঠিকই, কিন্তু রিপোর্ট সেটা চিনত না
   *    আর চিরকাল "কোনো সম্ভাব্য তারিখ নেই" বলত — অনিশ্চয়তাটা নিঃশব্দে উবে
   *    যেত, অথচ কোনো টেস্ট লাল হতো না।
   */
  it('seed যা লেখে, রিপোর্ট ঠিক সেটাই পড়ে', () => {
    expect(APPROX_HOLIDAY_SUFFIX).toBe(APPROX_SUFFIX);
  });

  it('seed-এর বানানো নাম রিপোর্ট আনুমানিক বলেই চেনে', () => {
    expect(isApproximateHoliday(holidayRowName(entry({ approximate: true })))).toBe(
      true,
    );
    expect(
      isApproximateHoliday(holidayRowName(entry({ approximate: false }))),
    ).toBe(false);
  });

  /**
   * ⭐ ঘোষণা এলে মালিক Settings → Holidays-এ চিহ্নটা মুছে দেন। তখনই রিপোর্টের
   *    সতর্কবার্তাও থেমে যাওয়া উচিত — নইলে পাকা তারিখকে চিরকাল "সম্ভাব্য"
   *    বলে যেত, আর কিছুদিন পর কেউ আর সতর্কবার্তাটা পড়তই না।
   */
  it('মালিক চিহ্ন মুছলে সাথে সাথেই আর আনুমানিক নয়', () => {
    expect(isApproximateHoliday('ঈদে মিলাদুন্নবী (সা.)')).toBe(false);
    expect(isApproximateHoliday(`ঈদে মিলাদুন্নবী (সা.)${APPROX_SUFFIX}  `)).toBe(
      true,
    );
  });

  /** ⚠️ নামের **মাঝে** চিহ্নটা থাকলে সেটা লেজ নয় — গোনা যাবে না */
  it('নামের মাঝে থাকলে গোনে না', () => {
    expect(isApproximateHoliday('ঈদ (সম্ভাব্য) — সংশোধিত')).toBe(false);
  });

  const at = (date: string, name: string) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    name,
  });

  it('শুধু আনুমানিকগুলোর তারিখ ফেরে, সাজানো', () => {
    expect(
      approximateHolidayDates([
        at('2026-08-26', `ঈদে মিলাদুন্নবী (সা.)${APPROX_SUFFIX}`),
        at('2026-08-05', 'জুলাই গণঅভ্যুত্থান দিবস'),
        at('2026-09-04', `শুভ জন্মাষ্টমী${APPROX_SUFFIX}`),
      ]),
    ).toEqual(['2026-08-26', '2026-09-04']);
  });

  /**
   * ⭐⭐ **"একটাও সম্ভাব্য নেই" আর "ছুটিই নেই" এক কথা নয়।** দুটোতেই খালি
   *    তালিকা ফেরে, আর সেটাই ঠিক — এই ফাংশন শুধু অনিশ্চয়তার কথা বলে,
   *    ছুটি আছে কি নেই তা বলার দায়িত্ব ওর নয় (সেটা কর্মদিবসের হিসাবের)।
   */
  it('সব তারিখ পাকা হলে খালি', () => {
    expect(approximateHolidayDates([at('2026-12-16', 'বিজয় দিবস')])).toEqual([]);
    expect(approximateHolidayDates([])).toEqual([]);
  });

  /** ⚠️ একাধিক মাসের রেঞ্জ জোড়া দিলে কলার একই সারি দুবার পাঠাতে পারে */
  it('একই তারিখ দুবার এলে একবারই গোনে', () => {
    const row = at('2026-08-26', `ঈদে মিলাদুন্নবী (সা.)${APPROX_SUFFIX}`);

    expect(approximateHolidayDates([row, row])).toEqual(['2026-08-26']);
  });

  /**
   * ⭐⭐ চলতি মাসের আসল কেসটা: ২৬ আগস্ট ২০২৬-এ ঈদে মিলাদুন্নবী, আর ওটা
   *    চাঁদ-নির্ভর। তারিখটা নড়লে আগস্টের কর্মদিবস বদলায় → প্রত্যেকের
   *    `target_sec` বদলায় → পে-রোলের হরও বদলায়। তালিকা আর রিপোর্ট এখানে
   *    একমত না হলে সংখ্যাটা নীরবে একটা অনুমানের উপর দাঁড়িয়ে থাকত।
   */
  it('আগস্ট ২০২৬-এর মিলাদুন্নবী তালিকা থেকে রিপোর্ট পর্যন্ত আনুমানিক থাকে', () => {
    const eidMilad = BD_HOLIDAYS.find((h) => h.date === '2026-08-26');

    expect(eidMilad?.approximate).toBe(true);
    expect(
      approximateHolidayDates([
        at('2026-08-26', holidayRowName(eidMilad as HolidayEntry)),
      ]),
    ).toEqual(['2026-08-26']);
  });
});

// ── seed-এর পরিকল্পনা ───────────────────────────────────────────────────────

describe('planHolidaySeed', () => {
  const list: HolidayEntry[] = [
    entry({ date: '2026-03-21', name: 'ঈদুল ফিতর', cluster: 'eid' }),
    entry({
      date: '2026-03-22',
      name: 'ঈদুল ফিতরের ছুটি (২য় দিন)',
      cluster: 'eid',
    }),
    entry({
      date: '2026-12-16',
      name: 'বিজয় দিবস',
      nameEn: 'Victory Day',
      approximate: false,
    }),
  ];

  it('খালি DB-তে সব বসে', () => {
    const plan = planHolidaySeed(list, []);

    expect(plan.create).toHaveLength(3);
    expect(plan.keptByDate).toEqual([]);
    expect(plan.unlisted).toEqual([]);
  });

  it('ঐ তারিখে সারি থাকলে হাত দেয় না', () => {
    const plan = planHolidaySeed(list, [row('2026-12-16', 'বিজয় দিবস')]);

    expect(plan.create.map((h) => h.date)).toEqual([
      '2026-03-21',
      '2026-03-22',
    ]);
    expect(plan.keptByDate.map((h) => h.date)).toEqual(['2026-12-16']);
  });

  /** ⭐ মালিক নাম বদলেছেন — seed সেটা ফিরিয়ে দেয় না, শুধু জানায় */
  it('একই তারিখে অন্য নাম থাকলে বদলায় না, রিপোর্ট করে', () => {
    const plan = planHolidaySeed(list, [
      row('2026-12-16', 'বিজয় দিবস (সরকারি)'),
    ]);

    expect(plan.create.map((h) => h.date)).not.toContain('2026-12-16');
    expect(plan.renamed).toEqual([
      {
        date: '2026-12-16',
        inDb: 'বিজয় দিবস (সরকারি)',
        inList: 'বিজয় দিবস',
      },
    ]);
  });

  /**
   * ⚠️⚠️ **এই কেসটাই সবচেয়ে বিপজ্জনক ছিল।** মালিক ঘোষণা দেখে ঈদের গুচ্ছটা
   *    একদিন এগিয়ে দিলেন। শুধু তারিখ দেখলে seed পুরোনো তারিখগুলো খালি পেত,
   *    আর ওখানে আবার ছুটি বানাত — ঈদ তখন **দ্বিগুণ দিন** জুড়ে বসে থাকত,
   *    আর মাসের কর্মদিবস নিঃশব্দে কমে যেত।
   */
  it('গুচ্ছের একটা দিন সরানো থাকলে গোটা গুচ্ছে হাত দেয় না', () => {
    const plan = planHolidaySeed(list, [
      row('2026-03-20', 'ঈদুল ফিতর'), // মালিক ২১ → ২০ করেছেন
    ]);

    expect(plan.create.map((h) => h.date)).toEqual(['2026-12-16']);
    expect(plan.keptByCluster.map((h) => h.date)).toEqual([
      '2026-03-21',
      '2026-03-22',
    ]);
  });

  it('চিহ্ন মুছে দিলেও সরানো সারিটা চেনা যায়', () => {
    const plan = planHolidaySeed(list, [
      row('2026-03-20', `ঈদুল ফিতর${APPROX_SUFFIX}`),
    ]);

    expect(plan.create.map((h) => h.date)).toEqual(['2026-12-16']);
  });

  it('গুচ্ছ ছাড়া ছুটি সরানো থাকলে শুধু সেটাই ছাড়ে', () => {
    const plan = planHolidaySeed(list, [row('2026-12-15', 'বিজয় দিবস')]);

    expect(plan.keptByName).toEqual([
      { entry: list[2], foundAt: '2026-12-15' },
    ]);
    expect(plan.create.map((h) => h.date)).toEqual([
      '2026-03-21',
      '2026-03-22',
    ]);
  });

  /**
   * ⚠️⚠️ **এক জিনিস নিয়ে দুটো উল্টো কথা** — এটাই বাগটা ছিল। মালিক বিজয়
   *    দিবস ১৬ → ১৫ ডিসেম্বরে সরালে সারিটা `keptByName`-এ উঠত ("মালিক
   *    সরিয়েছেন, ছোঁয়া হয়নি") আর একই সাথে `unlisted`-এও ("তালিকায় নেই —
   *    এখনো ছুটি কি?")। দুটো নোট পাশাপাশি ছাপা হতো, আর পাঠক আর কোনোটাই
   *    বিশ্বাস করতেন না।
   */
  it('নামে চেনা সারি আর "তালিকায় নেই" বলে না', () => {
    const plan = planHolidaySeed(list, [row('2026-12-15', 'বিজয় দিবস')]);

    expect(plan.keptByName).toHaveLength(1);
    expect(plan.unlisted).toEqual([]);
  });

  /** ⚠️ সরানো গুচ্ছের বেলায়ও একই কথা — ঈদ একসাথে "সরানো" ও "অচেনা" নয় */
  it('সরানো গুচ্ছের সারিও "তালিকায় নেই" বলে না', () => {
    const plan = planHolidaySeed(list, [
      row('2026-03-20', 'ঈদুল ফিতর'), // মালিক ২১ → ২০ করেছেন
      row('2026-03-22', 'ঈদুল ফিতরের ছুটি (২য় দিন)'), // এটা নড়েনি
    ]);

    expect(plan.keptByCluster).toHaveLength(2);
    expect(plan.unlisted).toEqual([]);
  });

  /** ⚠️ একই নাম অন্য **বছরে** থাকলে সেটা ভিন্ন ছুটি — আটকানো চলবে না */
  it('আগের বছরের একই নামের সারি এবারেরটা আটকায় না', () => {
    const plan = planHolidaySeed(
      [entry({ date: '2027-03-10', name: 'ঈদুল ফিতর' })],
      [row('2026-03-21', 'ঈদুল ফিতর')],
    );

    expect(plan.create.map((h) => h.date)).toEqual(['2027-03-10']);
  });

  /**
   * ⚠️ বাতিল হওয়া বা মালিকের নিজের যোগ করা ছুটি — দুটোর তফাত এখান থেকে বোঝা
   *    যায় না, তাই মোছা হয় না, শুধু দেখানো হয়।
   */
  it('তালিকায় নেই এমন সারি দেখায়, কিন্তু মোছার তালিকায় ফেলে না', () => {
    const plan = planHolidaySeed(list, [row('2026-08-15', 'জাতীয় শোক দিবস')]);

    expect(plan.unlisted).toEqual([
      { date: '2026-08-15', name: 'জাতীয় শোক দিবস' },
    ]);
    expect(plan.create).toHaveLength(3);
  });

  /** ⚠️ যে বছর এবার বসছে না, সেই বছরের সারি নিয়ে কোনো মন্তব্য নয় */
  it('তালিকার বাইরের বছরের সারি একেবারেই ছোঁয় না', () => {
    const plan = planHolidaySeed(list, [row('2025-12-25', 'বড়দিন')]);

    expect(plan.unlisted).toEqual([]);
  });

  it('আসল তালিকা খালি DB-তে বসলে সংখ্যাটা মেলে', () => {
    const plan = planHolidaySeed(BD_HOLIDAYS, []);

    expect(plan.create).toHaveLength(BD_HOLIDAYS.length);
    // ⭐ দুবার চালালে দ্বিতীয়বারে আর কিছু বসে না
    const again = planHolidaySeed(
      BD_HOLIDAYS,
      plan.create.map((h) => row(h.date, holidayRowName(h))),
    );
    expect(again.create).toEqual([]);
    expect(again.renamed).toEqual([]);
    expect(again.unlisted).toEqual([]);
  });
});

// ── কোন বছর বসবে ────────────────────────────────────────────────────────────

describe('yearsToSeed', () => {
  it('নতুন DB-তে সব বছর', () => {
    expect(yearsToSeed([2026, 2027], [])).toEqual([2026, 2027]);
  });

  /**
   * ⭐⭐ বসানো হয়ে যাওয়া বছরে seed আর ফিরে তাকায় না। কারণ মালিক ঘোষণা দেখে
   * একটা দিন **মুছে** দিলে DB-তে তার কোনো চিহ্ন থাকে না — ফিরে তাকালে
   * দিনটা "নেই" দেখে আবার বসত, আর ছুটি একদিন বেশি গোনা হতো।
   */
  it('আগে বসানো বছর বাদ যায়', () => {
    expect(yearsToSeed([2026, 2027], [2026])).toEqual([2027]);
    expect(yearsToSeed([2026, 2027], [2026, 2027])).toEqual([]);
  });

  it('নতুন বছর যোগ করলে সেটা আপনাআপনি বসে', () => {
    expect(yearsToSeed([2026, 2027, 2028], [2026, 2027])).toEqual([2028]);
  });

  it('অচেনা বছর `seeded`-এ থাকলেও ঝামেলা করে না', () => {
    expect(yearsToSeed([2026], [2019, 2026])).toEqual([]);
  });
});

// ── একটা seed-রান ───────────────────────────────────────────────────────────

/**
 * ⭐⭐ **নোট প্রতিবারই ছাপে।** আগে বছর একবার বসে গেলে `seedHolidays()`
 * early-return করত, তাই `unlisted`/`renamed` নোট প্রথম রানের পর চিরতরে
 * নীরব হয়ে যেত — চলতি DB-তে `2026-08-15 জাতীয় শোক দিবস` (২০২৪-এ বাতিল)
 * বসে থেকে আগস্টের একটা কর্মদিবস কমিয়ে রাখছে, অথচ seed তা আর বলত না।
 * ⚠️ "না বলা সিদ্ধান্ত নয়, চেপে যাওয়া" — নিয়মটা seed নিজেই ভাঙছিল।
 */
describe('planHolidaySeedRun', () => {
  const list: HolidayEntry[] = [
    entry({ date: '2026-03-21', name: 'ঈদুল ফিতর' }),
    entry({
      date: '2026-12-16',
      name: 'বিজয় দিবস',
      nameEn: 'Victory Day',
      approximate: false,
    }),
    entry({
      date: '2027-12-16',
      name: 'বিজয় দিবস',
      nameEn: 'Victory Day',
      approximate: false,
    }),
  ];

  const cancelled = row('2026-08-15', 'জাতীয় শোক দিবস');

  it('বছর খোলা থাকলে ওই বছরের সারিগুলোই বসে', () => {
    const run = planHolidaySeedRun(list, [], [2026], early);

    expect(run.create.map((h) => h.date)).toEqual([
      '2026-03-21',
      '2026-12-16',
    ]);
    expect(run.heldBack.map((h) => h.date)).toEqual(['2027-12-16']);
  });

  /**
   * ⭐⭐ **এই টেস্টটাই এই কাজের মূল কথা।** দুই বছরই বসানো, তাই একটাও সারি
   * বসছে না — তবু বাতিল হওয়া ছুটিটার কথা এখনো বলা হচ্ছে।
   */
  it('সব বছর বসানো হয়ে গেলেও বাতিল ছুটির কথা বলে', () => {
    const run = planHolidaySeedRun(list, [cancelled], [], early);

    expect(run.create).toEqual([]);
    expect(run.notes.some((n) => n.includes('2026-08-15'))).toBe(true);
    expect(run.notes.some((n) => n.includes('জাতীয় শোক দিবস'))).toBe(true);
  });

  /** ⭐ নাম বদলের কথাও প্রতিবার — একবার বলে চুপ করে যাওয়া নয় */
  it('সব বছর বসানো হয়ে গেলেও নাম-বদলের কথা বলে', () => {
    const run = planHolidaySeedRun(
      list,
      [
        row('2026-03-21', 'ঈদুল ফিতর (সংশোধিত)'),
        row('2026-12-16', 'বিজয় দিবস'),
        row('2027-12-16', 'বিজয় দিবস'),
      ],
      [],
      early,
    );

    expect(run.create).toEqual([]);
    expect(run.notes.some((n) => n.includes('ঈদুল ফিতর (সংশোধিত)'))).toBe(true);
  });

  /**
   * ⚠️⚠️ **চলতি VPS-এর আসল অবস্থা, আর এটাই ৪ নম্বর করণীয়।** পুরোনো seed
   *    ২০২৬-০৩-১৭-তে `জাতির পিতার জন্মদিন` বসিয়ে গেছে; নতুন তালিকায় ওই
   *    তারিখে `শবে কদর (সম্ভাব্য)`। `planHolidaySeed()` তারিখে মিল পেয়ে
   *    নাম বদলায় না (ইচ্ছাকৃত — মালিকের হাতের কাজ যাতে না মুছে যায়), তাই
   *    ওই সারিটা **কোনোদিনই** "(সম্ভাব্য)" চিহ্ন পাবে না। ⭐ সারানো
   *    বাধ্যতামূলক নয়, কিন্তু **না বলাটা** চেপে যাওয়া — নোটে স্পষ্ট থাকতে
   *    হবে, যাতে মালিক হাতে ঠিক করতে পারেন।
   */
  it('চিহ্নটা হারিয়ে যাচ্ছে — নোট সেটা স্পষ্ট করে বলে', () => {
    const run = planHolidaySeedRun(
      [entry({ date: '2026-03-17', name: 'শবে কদর', nameEn: 'Laylat al-Qadr' })],
      [row('2026-03-17', 'জাতির পিতার জন্মদিন')],
      [2026],
      early,
    );
    const note = run.notes.find((n) => n.includes('2026-03-17'));

    expect(note).toContain('জাতির পিতার জন্মদিন');
    expect(note).toContain(`শবে কদর${APPROX_SUFFIX}`);
    expect(note).toContain('seed নাম বদলায় না');
    expect(note).toContain('কোনোদিন');
    expect(note).toContain('Settings → Holidays');
  });

  /**
   * ⚠️ উল্টো দিকটা: DB-র নামেও চিহ্ন থাকলে কিছু হারাচ্ছে না — তখন
   *    "চিহ্ন পাবে না" বলাটা **মিথ্যা** হতো, আর ঠিক ওই মিথ্যাটাই এই
   *    রাউন্ডে ঠেকানোর কথা।
   */
  it('চিহ্ন হারাচ্ছে না এমন নাম-বদলে "চিহ্ন পাবে না" বলে না', () => {
    const run = planHolidaySeedRun(
      [entry({ date: '2026-03-17', name: 'শবে কদর', nameEn: 'Laylat al-Qadr' })],
      [row('2026-03-17', `লাইলাতুল কদর${APPROX_SUFFIX}`)],
      [2026],
      early,
    );
    const note = run.notes.find((n) => n.includes('2026-03-17'));

    expect(note).toContain('seed নাম বদলায় না');
    expect(note).not.toContain('কোনোদিন');
  });

  /**
   * ⭐ মালিক ঘোষণা দেখে সারিটা মুছে দিয়েছেন — seed সেটা **ফিরিয়ে আনে না**
   *    (বছরটা বন্ধ), কিন্তু চুপও থাকে না। চুপ থাকলে "তালিকা আর DB এক" বলে
   *    ভুল ধারণা হতো।
   */
  it('বন্ধ বছরের অনুপস্থিত সারি বসায় না, কিন্তু নাম ধরে জানায়', () => {
    const run = planHolidaySeedRun(
      list,
      [row('2026-12-16', 'বিজয় দিবস')],
      [],
      early,
    );

    expect(run.create).toEqual([]);
    expect(run.heldBack.map((h) => h.date)).toEqual([
      '2026-03-21',
      '2027-12-16',
    ]);
    expect(run.notes.some((n) => n.includes('2026-03-21'))).toBe(true);
  });

  it('সব মিলে গেলে কোনো নোট নেই — চুপ থাকাটাও তখন সত্যি', () => {
    const run = planHolidaySeedRun(
      list,
      list.map((h) => row(h.date, holidayRowName(h))),
      [],
      early,
    );

    expect(run.notes).toEqual([]);
    expect(run.create).toEqual([]);
    expect(run.heldBack).toEqual([]);
    expect(run.kept).toBe(3);
  });

  /** ⚠️ যা মালিকের নজর দাবি করে (⚠️) তা আগে, যা কেবল জানানো (·) তা পরে */
  it('নজর-দাবি করা নোটগুলো আগে আসে', () => {
    const run = planHolidaySeedRun(
      list,
      [cancelled, row('2026-12-15', 'বিজয় দিবস')],
      [2026, 2027],
      early,
    );

    const firstPlain = run.notes.findIndex((n) => n.startsWith('·'));
    const lastWarn = run.notes.map((n) => n.startsWith('⚠️')).lastIndexOf(true);

    expect(firstPlain).toBeGreaterThan(lastWarn);
  });

  /** ⭐ আসল তালিকা খালি DB-তে — প্রথম রানে কোনো অভিযোগ থাকার কথা নয় */
  it('আসল তালিকা খালি DB-তে বসলে কোনো নোট নেই', () => {
    const run = planHolidaySeedRun(
      BD_HOLIDAYS,
      [],
      [...HOLIDAY_YEARS],
      early,
    );

    expect(run.notes).toEqual([]);
    expect(run.create).toHaveLength(BD_HOLIDAYS.length);
  });

  /**
   * ⭐⭐ দ্বিতীয় রান: সব বছর বসানো, DB-তে সব সারি আছে — তবু একটা বাতিল
   * ছুটি বসে থাকলে seed **এখনো** সেটা বলে। ঠিক এই আচরণটাই আগে ছিল না।
   */
  it('আসল তালিকার দ্বিতীয় রানেও বাতিল ছুটি নিয়ে চুপ থাকে না', () => {
    const inDb = BD_HOLIDAYS.map((h) => row(h.date, holidayRowName(h)));
    const run = planHolidaySeedRun(
      BD_HOLIDAYS,
      [...inDb, cancelled],
      [],
      early,
    );

    expect(run.create).toEqual([]);
    expect(run.notes).toHaveLength(1);
    expect(run.notes[0]).toContain('2026-08-15');
  });
});

// ── ⭐⭐ চলতি ও অতীত মাসের পাহারা ────────────────────────────────────────────

/**
 * ⭐⭐ **যে বাগটা এই অংশ ঠেকায়:** ১৪ আগস্ট ২০২৬-এ VPS-এ `npm run seed`
 * চালালে আগস্টে দুটো নতুন ছুটি বসত (`2026-08-05`, `2026-08-26`)। আগস্টের
 * কর্মদিবস ২৬ → ২৪, `dailyTargetSec` ৮.০০ঘ → ৮.৬৭ঘ, `monthly_summary`-র
 * `target_sec`·`expected_sec`·`pace_sec` তিনটেই নতুন, আর G37-এর `d ÷ D`
 * ভগ্নাংশ (`src/payroll/payroll.service.ts`) সরাসরি টাকা। ⚠️ একটা রুটিন
 * কমান্ড, কোনো প্রশ্ন নয়, কোনো এরর নয় — মাসের মাঝপথে বেতন বদলে যেত।
 */
describe('planHolidaySeedRun — চলতি/অতীত মাস', () => {
  const august = { today: '2026-08-14', allowPast: false };

  const list: HolidayEntry[] = [
    entry({ date: '2026-03-21', name: 'ঈদুল ফিতর' }), // অতীত মাস
    entry({
      date: '2026-08-05',
      name: 'জুলাই গণঅভ্যুত্থান দিবস',
      nameEn: 'July Mass Uprising Day',
      approximate: false,
    }), // চলতি মাস, আজকের আগে
    entry({
      date: '2026-08-26',
      name: 'ঈদে মিলাদুন্নবী (সা.)',
      nameEn: 'Eid-e-Miladunnabi',
    }), // চলতি মাস, আজকের পরে
    entry({
      date: '2026-12-16',
      name: 'বিজয় দিবস',
      nameEn: 'Victory Day',
      approximate: false,
    }), // ভবিষ্যতের মাস
  ];

  it('ভবিষ্যতের মাসেরটাই শুধু বসে', () => {
    const run = planHolidaySeedRun(list, [], [2026], august);

    expect(run.create.map((h) => h.date)).toEqual(['2026-12-16']);
  });

  /**
   * ⚠️⚠️ চলতি মাসের **বাকি থাকা** দিনটাও (২৬ আগস্ট, আজ ১৪) আটকে যায় —
   *    ইচ্ছাকৃত। মাসের কর্মদিবস D গোটা মাসের হিসাব; মাসের শেষ দিকের একটা
   *    ছুটিও **গত দিনগুলোর** `target_sec` আর `pace_sec` পিছন ফিরে বদলায়।
   */
  it('চলতি মাসের ভবিষ্যৎ তারিখও আটকায় — D গোটা মাসের হিসাব', () => {
    const run = planHolidaySeedRun(list, [], [2026], august);

    expect(run.needsConsent.map((h) => h.date)).toEqual([
      '2026-03-21',
      '2026-08-05',
      '2026-08-26',
    ]);
  });

  /** ⚠️ চুপ করে বাদ নয় — প্রতিটার নাম ও তারিখ নোটে ওঠে */
  it('আটকে যাওয়া প্রতিটা তারিখ নাম ধরে নোটে ওঠে', () => {
    const run = planHolidaySeedRun(list, [], [2026], august);

    for (const date of ['2026-03-21', '2026-08-05', '2026-08-26']) {
      expect(run.notes.some((n) => n.includes(date))).toBe(true);
    }
    expect(run.notes.some((n) => n.includes('ঈদে মিলাদুন্নবী (সা.)'))).toBe(
      true,
    );
  });

  /**
   * ⭐ কেবল "বসানো হয়নি" নয় — **কী করে বসাতে হয় আর তারপর কী হয়**, দুটোই।
   *
   * ⚠️ অতীত মাসের কথাটা আলাদা করে থাকতে হবে, কারণ চলতি মাস নিজে থেকে
   *    মিলে যায় আর অতীত মাস যায় না — দুটোকে এক করে বললে মালিক ভাবতেন
   *    সবটাই আপনাআপনি ঠিক হয়ে যাবে।
   */
  it('নোটে সম্মতির পথ, টাকার কথা আর অতীত মাসের ফলাফল থাকে', () => {
    const run = planHolidaySeedRun(list, [], [2026], august);
    const howTo = run.notes.find((n) => n.includes('SEED_HOLIDAYS_PAST=true'));

    expect(howTo).toBeDefined();
    expect(howTo).toContain('d÷D');
    expect(howTo).toContain('অতীত মাস');
    expect(howTo).toContain('§ ২.১গ');
  });

  it('সম্মতি দিলে সবগুলোই বসে, আর অভিযোগও থাকে না', () => {
    const run = planHolidaySeedRun(list, [], [2026], {
      today: '2026-08-14',
      allowPast: true,
    });

    expect(run.create).toHaveLength(4);
    expect(run.needsConsent).toEqual([]);
    expect(run.notes).toEqual([]);
  });

  /**
   * ⚠️⚠️ একটা সারি একই সাথে "বছর বন্ধ" আর "মাস চলে গেছে" — দুটোতেই পড়তে
   *    পারে। তখন শুধু `heldBack`, কারণ সম্মতি দিলেও বছরটা বন্ধ থাকায় ওটা
   *    বসত না — সম্মতি চাওয়া মানে মিথ্যে আশা দেওয়া। ⭐ এক সারি, এক কথা।
   */
  it('বছর বন্ধ থাকলে সম্মতি চাওয়া হয় না', () => {
    const run = planHolidaySeedRun(list, [], [], august);

    expect(run.needsConsent).toEqual([]);
    expect(run.heldBack).toHaveLength(4);
  });

  /** ⚠️ DB-তে আগে থেকেই থাকা সারি এই গেটের বিষয় নয় — কিছু বসছেই না */
  it('আগে থেকেই বসানো সারি নিয়ে সম্মতি চাওয়া হয় না', () => {
    const run = planHolidaySeedRun(
      list,
      list.map((h) => row(h.date, holidayRowName(h))),
      [2026],
      august,
    );

    expect(run.create).toEqual([]);
    expect(run.needsConsent).toEqual([]);
    expect(run.notes).toEqual([]);
  });
});

// ── কোন বছর "সম্পূর্ণ বসানো" হলো ────────────────────────────────────────────

describe('yearsSettled', () => {
  const pending = (date: string) => entry({ date });

  it('কিছু আটকে না থাকলে খোলা বছরগুলোই সম্পূর্ণ', () => {
    expect(yearsSettled([2026, 2027], [])).toEqual([2026, 2027]);
  });

  /**
   * ⭐⭐ **কেন এটা দরকার:** সম্মতির অপেক্ষায় সারি রেখে বছরটা বন্ধ করে দিলে
   *    পরের রানে `SEED_HOLIDAYS_PAST=true` দিয়েও কিছুই বসত না —
   *    `yearsToSeed` বছরটাকেই বাদ দিয়ে দিত। ⚠️ পতাকাটা থাকত, কাজ করত না,
   *    আর কমেন্ট বলত "সম্মতি দিলে বসবে"। কোডের মিথ্যা মন্তব্য বাগের চেয়েও
   *    খারাপ, তাই বছরটা খোলা রাখা হয়।
   */
  it('সম্মতির অপেক্ষায় সারি থাকলে ওই বছর সম্পূর্ণ হয় না', () => {
    expect(yearsSettled([2026, 2027], [pending('2026-08-05')])).toEqual([2027]);
  });

  it('অন্য বছরের আটকানো সারি এই বছরকে আটকায় না', () => {
    expect(yearsSettled([2026], [pending('2027-01-24')])).toEqual([2026]);
  });

  it('কোনো বছর খোলা না থাকলে খালি', () => {
    expect(yearsSettled([], [pending('2026-08-05')])).toEqual([]);
  });
});
