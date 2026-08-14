import { describe, expect, it } from 'vitest';

import {
  trendDayExpectation,
  type TrendStaff,
} from '../src/dashboard/dashboard.service';
import { elapsedWorkdays } from '../src/summary/summary.math';

/**
 * ⭐⭐ **E01 — সাত দিনের ফিতের প্রত্যাশা।**
 *
 * ⚠️⚠️ যে বাগটা এই ফাইল ঠেকায়: ফিতের টার্গেট গোনা হতো `daily_summary`
 * **সারি দেখে** (`day_type !== 'holiday'`)। কিন্তু ছুটির দিনে কেউ এক ঘণ্টা
 * কাজ করলে `dayTypeOf()` দিনটাকে `worked` লেখে — তাই ওই ছুটির দিনটাই একটা
 * পুরো কর্মদিবসের প্রত্যাশা হয়ে যেত। কেউ শুক্রবার দু-ঘণ্টা কাজ করলে ওই
 * দিনের চার্টে তাঁর নামে পুরো দিনের টার্গেট-বার আঁকা হতো: **ছুটির দিনে
 * কাজ করার শাস্তি।** মাসের কার্ডে এটা আগেই সারানো হয়েছিল, ফিতেয় হয়নি।
 *
 * ⭐ শেষ describe-টা সবচেয়ে জরুরি: ফিতে আর মাসের কার্ড **একই সংজ্ঞা**
 * ব্যবহার করছে কি না, সেটা `elapsedWorkdays()`-এর সাথে মিলিয়ে দেখা হয়।
 *
 * **পরীক্ষার সপ্তাহ — ৮ থেকে ১৪ আগস্ট ২০২৬:** ৮ শনি … ১৪ শুক্র।
 * সাপ্তাহিক ছুটি শুক্রবার (ISO ৫) হলে ওই সপ্তাহে ছুটির দিন কেবল ১৪ তারিখ।
 */

/** UTC-মধ্যরাত — Prisma-র `@db.Date` ও `workDateOf()` দুটোই এই ছাঁদে */
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** ৮ ঘণ্টার দৈনিক টার্গেট, শুক্রবার ছুটি, জুলাই থেকে দেখা হচ্ছে */
function staff(over: Partial<TrendStaff> = {}): TrendStaff {
  return {
    employeeId: 1,
    weeklyOffDay: 5,
    joinedOn: null,
    leftOn: null,
    trackedFrom: day('2026-07-01'),
    dailyTargetSec: 8 * 3600,
    ...over,
  };
}

const NO_HOLIDAYS: ReadonlySet<number> = new Set<number>();

describe('trendDayExpectation — ⚠️⚠️ ছুটির দিনে কাজ করলে শাস্তি নয়', () => {
  it('⭐⭐ সাপ্তাহিক ছুটির দিনে কোনো টার্গেট নেই — কাজ হয়ে থাকলেও', () => {
    // শুক্রবার ১৪ আগস্ট। পুরোনো কোড `day_type` দেখত, আর কাজ হয়ে থাকলে
    // ওটা `worked` — তাই পুরো ৮ ঘণ্টার টার্গেট বসে যেত।
    expect(trendDayExpectation(day('2026-08-14'), [staff()], NO_HOLIDAYS)).toEqual(
      { expectedStaff: 0, targetSec: 0 },
    );
  });

  it('⭐⭐ সরকারি ছুটির দিনেও একই — ক্যালেন্ডারই শেষ কথা', () => {
    const holidays = new Set([day('2026-08-12').getTime()]);

    expect(
      trendDayExpectation(day('2026-08-12'), [staff()], holidays),
    ).toEqual({ expectedStaff: 0, targetSec: 0 });
  });

  it('সাধারণ কর্মদিবসে পুরো টার্গেট', () => {
    expect(trendDayExpectation(day('2026-08-13'), [staff()], NO_HOLIDAYS)).toEqual(
      { expectedStaff: 1, targetSec: 8 * 3600 },
    );
  });

  it('⚠️ `weeklyOffDay: null` মানে প্রতিটি দিনই কর্মদিবস (schema-র নিয়ম)', () => {
    const everyDay = staff({ weeklyOffDay: null });

    expect(
      trendDayExpectation(day('2026-08-14'), [everyDay], NO_HOLIDAYS)
        .expectedStaff,
    ).toBe(1);
  });
});

describe('trendDayExpectation — ⭐ না-দেখা দিন কারো ঘাটতি নয়', () => {
  it('⚠️⚠️ কর্মীর নিজের ট্র্যাকিং-শুরুর আগের দিনে প্রত্যাশা নেই', () => {
    const late = staff({ trackedFrom: day('2026-08-13') });

    expect(
      trendDayExpectation(day('2026-08-12'), [late], NO_HOLIDAYS),
    ).toEqual({ expectedStaff: 0, targetSec: 0 });
  });

  it('ট্র্যাকিং-শুরুর দিনটা নিজেই ধরা হয়', () => {
    const late = staff({ trackedFrom: day('2026-08-13') });

    expect(
      trendDayExpectation(day('2026-08-13'), [late], NO_HOLIDAYS).expectedStaff,
    ).toBe(1);
  });

  it('⚠️ কখনো দেখাই হয়নি (`trackedFrom: null`) — কোনো দিনেরই প্রত্যাশা নেই', () => {
    const unseen = staff({ trackedFrom: null });

    expect(
      trendDayExpectation(day('2026-08-13'), [unseen], NO_HOLIDAYS),
    ).toEqual({ expectedStaff: 0, targetSec: 0 });
  });
});

describe('trendDayExpectation — কর্মকালের বাইরে প্রত্যাশা নেই', () => {
  it('যোগ দেওয়ার আগের দিন গোনা হয় না', () => {
    const fresh = staff({ joinedOn: day('2026-08-13') });

    expect(
      trendDayExpectation(day('2026-08-12'), [fresh], NO_HOLIDAYS).expectedStaff,
    ).toBe(0);
    expect(
      trendDayExpectation(day('2026-08-13'), [fresh], NO_HOLIDAYS).expectedStaff,
    ).toBe(1);
  });

  it('চলে যাওয়ার পরের দিন গোনা হয় না', () => {
    const gone = staff({ leftOn: day('2026-08-12') });

    expect(
      trendDayExpectation(day('2026-08-12'), [gone], NO_HOLIDAYS).expectedStaff,
    ).toBe(1);
    expect(
      trendDayExpectation(day('2026-08-13'), [gone], NO_HOLIDAYS).expectedStaff,
    ).toBe(0);
  });
});

describe('trendDayExpectation — দল', () => {
  it('⭐ কর্মীভেদে ছুটির বার আলাদা — যোগফলটাই দলের টার্গেট', () => {
    // শুক্রবার ১৪ আগস্ট: প্রথমজনের ছুটি, দ্বিতীয়জনের নয়
    const friday = staff({ employeeId: 1, weeklyOffDay: 5 });
    const sunday = staff({
      employeeId: 2,
      weeklyOffDay: 7,
      dailyTargetSec: 6 * 3600,
    });

    expect(
      trendDayExpectation(day('2026-08-14'), [friday, sunday], NO_HOLIDAYS),
    ).toEqual({ expectedStaff: 1, targetSec: 6 * 3600 });
  });

  it('⚠️ কেউ না থাকলে শূন্য — আর সেটা সত্যিই "সবার ছুটি"', () => {
    expect(trendDayExpectation(day('2026-08-14'), [], NO_HOLIDAYS)).toEqual({
      expectedStaff: 0,
      targetSec: 0,
    });
  });

  it('⚠️ ভগ্নাংশ এখানে round হয় না — যোগফল কলারে গিয়ে একবারই round হয়', () => {
    const odd = staff({ dailyTargetSec: 208 * 3600 / 27 });

    expect(
      trendDayExpectation(day('2026-08-13'), [odd, odd], NO_HOLIDAYS).targetSec,
    ).toBe((208 * 3600 / 27) * 2);
  });
});

/**
 * ⭐⭐ **ফিতে আর মাসের কার্ড — এক সংজ্ঞা।**
 *
 * `elapsedWorkdays()` (মাসের `expected_sec`-এর উৎস) আর
 * `trendDayExpectation()` দুটোই একই প্রশ্নের উত্তর দেয়: "ওই দিনটা তার
 * প্রত্যাশায় গোনা হবে কি?" ⚠️ **দুটো ইচ্ছাকৃত পার্থক্য বাকি**, আর নিচের
 * শেষ দুটো টেস্ট ঠিক সেগুলোই লিখে রাখে — যাতে কেউ ভুল করে "সমান করতে"
 * গিয়ে বোর্ডে "আজ সবার ছুটি" লিখে না ফেলে।
 */
describe('⭐⭐ ফিতে ও মাসের কার্ড এক নিয়মে', () => {
  /** ওই এক দিনের জানালা — `elapsedWorkdays()`-কে এক দিনের প্রশ্ন করা */
  const monthlySaysExpected = (
    date: Date,
    s: TrendStaff,
    today: Date,
    holidays: ReadonlySet<number> = NO_HOLIDAYS,
  ): boolean =>
    elapsedWorkdays({
      periodStart: date,
      periodEnd: date,
      today,
      joinedOn: s.joinedOn,
      leftOn: s.leftOn,
      trackingStartedOn: s.trackedFrom,
      weeklyOffDay: s.weeklyOffDay,
      holidays,
    }) === 1;

  const TOMORROW = day('2026-08-15');

  it('শেষ হয়ে যাওয়া প্রতিটা দিনে দুটো এক কথা বলে', () => {
    const cases: Array<[string, TrendStaff, ReadonlySet<number>]> = [
      ['2026-08-13', staff(), NO_HOLIDAYS],
      ['2026-08-14', staff(), NO_HOLIDAYS],
      ['2026-08-12', staff(), new Set([day('2026-08-12').getTime()])],
      ['2026-08-12', staff({ trackedFrom: day('2026-08-13') }), NO_HOLIDAYS],
      ['2026-08-12', staff({ joinedOn: day('2026-08-13') }), NO_HOLIDAYS],
      ['2026-08-13', staff({ leftOn: day('2026-08-12') }), NO_HOLIDAYS],
    ];

    for (const [iso, s, holidays] of cases) {
      const ribbon =
        trendDayExpectation(day(iso), [s], holidays).expectedStaff === 1;

      expect(
        [iso, ribbon],
        // ⚠️ ব্যর্থ হলে কোন দিনটা তা দেখা যাওয়া চাই — নইলে সাতটা কেস
        //    একই বার্তায় মিশে যেত
        `${iso} — ফিতে ও কার্ড আলাদা কথা বলছে`,
      ).toEqual([iso, monthlySaysExpected(day(iso), s, TOMORROW, holidays)]);
    }
  });

  /**
   * ⚠️⚠️ দ্বিতীয় (ও শেষ) অমিলটা এখানে লিখে রাখা — কারণ পাওয়া যাওয়ার
   * চেয়ে না-লেখা অমিল ভবিষ্যতে বেশি ক্ষতি করে।
   *
   * ⭐ পর্দায় এটা কখনো দেখা যায় না: `teamTrend()` কেবল সেই কর্মীদেরই
   * পাঠায় যাঁদের চলতি মাসের `monthly_summary` সারি আছে, আর `refreshDate()`
   * দৈনিক ও মাসিক সারি একসাথে লেখে — তাই "মাসিক সারি আছে কিন্তু একটাও
   * দৈনিক সারি নেই" অবস্থাটাই তৈরি হয় না।
   */
  it('⚠️ কখনো না-দেখা কর্মী — এখানে প্রত্যাশা নেই, `elapsedWorkdays()`-এ আছে', () => {
    const unseen = staff({ trackedFrom: null });
    const date = day('2026-08-13');

    expect(trendDayExpectation(date, [unseen], NO_HOLIDAYS).expectedStaff).toBe(0);
    // ⚠️ ওখানে `null` মানে "সীমাটা জানা নেই", তাই জানালা সংকুচিত হয় না
    expect(monthlySaysExpected(date, unseen, TOMORROW)).toBe(true);
  });

  it('⚠️⚠️ **আজ** — কর্মকাল-সীমার বাইরে দ্বিতীয় ইচ্ছাকৃত পার্থক্য', () => {
    const today = day('2026-08-13');
    const s = staff();

    // মাসের কার্ড: আজ শেষ হয়নি, তাই "এ পর্যন্ত কত হওয়ার কথা ছিল"-তে নেই
    expect(monthlySaysExpected(today, s, today)).toBe(false);

    // ফিতে: ওই দিনটার টার্গেট আছেই — দিনটা কেবল এখনো চলছে।
    // ⚠️ এটাকে ০ করলে `WeekAndMonth.tsx` আজকের বারটাকে "day off" লিখত।
    expect(
      trendDayExpectation(today, [s], NO_HOLIDAYS).expectedStaff,
    ).toBe(1);
  });
});
