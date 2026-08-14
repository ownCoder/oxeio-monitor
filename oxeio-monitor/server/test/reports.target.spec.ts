import { describe, expect, it } from 'vitest';

import {
  countWorkdays,
  dailyTargetSec,
  eachDate,
  isWorkday,
  overlapOf,
  secondsToHours,
  targetSecIn,
  type WorkdayRule,
} from '../src/reports/reports.range';
import { prorate } from '../src/summary/proration';

/**
 * ⭐⭐ **এক হার — দুই পথ যেন কখনো দুই সংখ্যা না বলে।**
 *
 * এই ফাইলের সবচেয়ে জরুরি টেস্টটা কোনো একটা সংখ্যার নয়, একটা **সমতার**:
 * একই কর্মী, একই মাস, একই ছুটির ক্যালেন্ডার দিলে —
 *
 *   · `summary/proration.ts` → `prorate().targetSec`  (tray · Live Board ·
 *     `monthly_summary` · পে-রোল এই পথে চলে), আর
 *   · `reports/reports.range.ts` → `targetSecIn()`    (Reports পাতা · Excel ·
 *     PDF · ডাইজেস্ট এই পথে চলে)
 *
 * — দুটোকে **একই ঘণ্টা** দিতে হবে।
 *
 * ⚠️⚠️ **কেন "ঘণ্টা", "কর্মদিবস" নয়:** গত রাউন্ডের টেস্ট শুধু কর্মদিবসের
 * সংখ্যা মেলাত। দুই পথ কর্মদিবস একই গুনত, কিন্তু **হর আলাদা ছিল** —
 * proration ভাগ করত পলিসির ২৬ দিয়ে, reports ভাগ করত ওই মাসের ক্যালেন্ডার
 * কর্মদিবস দিয়ে। ফলে একই কর্মীর দৈনিক টার্গেট এক পর্দায় ৮.০০ ঘণ্টা,
 * আরেক পর্দায় ৭.৭০ — আর টেস্ট সবুজই থাকত। সংখ্যা না মিলিয়ে সংখ্যার
 * **উপাদান** মেলালে ঠিক এভাবেই ফাঁক থেকে যায়।
 */

const HOUR = 3600;
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** O11 — শুক্রবার সাপ্তাহিক ছুটি */
const FRIDAY = 5;

/** পলিসির ঘরে যা লেখা: ২০৮ ঘণ্টা ÷ ২৬ আদর্শ কর্মদিবস = ৮ ঘণ্টা */
const MONTHLY_TARGET_SEC = 208 * HOUR;
const POLICY_WORKDAYS = 26;

interface Month {
  name: string;
  start: Date;
  end: Date;
  /** ছুটি ছাড়া, শুধু শুক্রবার বাদ দিয়ে ক্যালেন্ডার কর্মদিবস */
  workdays: number;
}

/**
 * ⭐ তিনটে মাস ইচ্ছাকৃতভাবে **তিন রকম** কর্মদিবসের: ২৭, ২৬, ২৫। হর যদি
 * ভুল করে ক্যালেন্ডারে ফিরে যায়, দৈনিক টার্গেট তিন মাসে তিন রকম হয়ে
 * যাবে আর নিচের টেস্টগুলো সাথে সাথে লাল হবে।
 */
const MONTHS: Month[] = [
  { name: 'আগস্ট ২০২৬', start: d(2026, 8, 1), end: d(2026, 8, 31), workdays: 27 },
  { name: 'সেপ্টেম্বর ২০২৬', start: d(2026, 9, 1), end: d(2026, 9, 30), workdays: 26 },
  { name: 'ফেব্রুয়ারি ২০২৮', start: d(2028, 2, 1), end: d(2028, 2, 29), workdays: 25 },
];

const ruleOf = (holidays: ReadonlySet<number>): WorkdayRule => ({
  weeklyOffDay: FRIDAY,
  holidays,
});

const holidaysOn = (...dates: Date[]): Set<number> =>
  new Set(dates.map((x) => x.getTime()));

/** দিনে-দিনে যোগ — রিপোর্টের পাতায় যে ঘরগুলো ছাপা হয়, ঠিক সেগুলোর যোগফল */
function sumDayByDay(
  from: Date,
  to: Date,
  rule: WorkdayRule,
  perWorkdaySec: number,
): number {
  let sec = 0;
  for (const date of eachDate(from, to)) {
    if (isWorkday(date, rule)) sec += perWorkdaySec;
  }
  return sec;
}

describe('এক হার — হর সবসময় পলিসির expected_workdays', () => {
  it('মাসে কর্মদিবস যতই হোক, দৈনিক টার্গেট ৮ ঘণ্টাই', () => {
    for (const month of MONTHS) {
      const rule = ruleOf(new Set<number>());

      // মাসগুলো সত্যিই আলাদা — নইলে নিচের দাবিটার কোনো জোর থাকত না
      expect(countWorkdays(month.start, month.end, rule)).toBe(month.workdays);

      expect(
        secondsToHours(dailyTargetSec(MONTHLY_TARGET_SEC, POLICY_WORKDAYS)),
      ).toBe(8);
    }
  });

  /**
   * ⭐⭐ মালিকের ভাষায় প্রশ্নটা: "ছুটি বাড়লে কর্মীর লাভ হবে, না বোঝা
   * বাড়বে?" হর ক্যালেন্ডার হলে ছুটি বাড়লে দৈনিক টার্গেট **বাড়ত** আর মাসের
   * মোট ২০৮-এই আটকে থাকত — অর্থাৎ ছুটি দিয়ে কিছুই মিলত না।
   */
  it('ছুটি বাড়লে দৈনিক টার্গেট বাড়ে না, মাসের মোট কমে', () => {
    const month = MONTHS[0]; // আগস্ট ২০২৬ — ছুটিহীন অবস্থায় ২৭ কর্মদিবস
    const perDay = dailyTargetSec(MONTHLY_TARGET_SEC, POLICY_WORKDAYS);

    const noHoliday = ruleOf(new Set<number>());
    // ২৬ আগস্ট বুধবার (ঈদে মিলাদুন্নবী — এখনো পাকা নয়), ১৭ আগস্ট সোমবার
    const twoHolidays = ruleOf(holidaysOn(d(2026, 8, 26), d(2026, 8, 17)));

    const span = { from: month.start, to: month.end };

    expect(secondsToHours(targetSecIn(span, noHoliday, perDay))).toBe(216);
    expect(secondsToHours(targetSecIn(span, twoHolidays, perDay))).toBe(200);

    // ⚠️ ফারাকটা ঠিক দুই দিনের টার্গেট — এক পয়সাও এদিক-ওদিক নয়
    expect(
      targetSecIn(span, noHoliday, perDay) -
        targetSecIn(span, twoHolidays, perDay),
    ).toBeCloseTo(2 * perDay, 6);
  });

  it('সাপ্তাহিক ছুটির দিনে পড়া ছুটি কর্মদিবস দুবার কমায় না', () => {
    const perDay = dailyTargetSec(MONTHLY_TARGET_SEC, POLICY_WORKDAYS);
    const span = { from: d(2026, 8, 1), to: d(2026, 8, 31) };

    // ৭ আগস্ট ২০২৬ শুক্রবার — এমনিতেই সাপ্তাহিক ছুটি
    const onFriday = ruleOf(holidaysOn(d(2026, 8, 7)));

    expect(secondsToHours(targetSecIn(span, onFriday, perDay))).toBe(216);
  });
});

describe('⭐⭐ দুই পথ এক সংখ্যা — proration বনাম reports', () => {
  /**
   * ⚠️ ইচ্ছাকৃতভাবে **ঘণ্টা** মেলানো হয়: `prorate()` সেকেন্ডে round করে,
   * `targetSecIn()` করে না। দুটোর মধ্যে আধ সেকেন্ডের কম ফারাক থাকতে পারে,
   * কিন্তু কাগজে যা ছাপা হয় সেই দুই দশমিকের ঘণ্টায় কোনো ফারাক থাকতে
   * পারবে না — মানুষ ওই সংখ্যাটাই দেখে।
   */
  const cases: {
    label: string;
    holidays: Set<number>;
    joinedOn: Date | null;
    leftOn: Date | null;
  }[] = [
    { label: 'ছুটিহীন, পুরো মাস', holidays: new Set(), joinedOn: null, leftOn: null },
    {
      label: 'দুটো সরকারি ছুটি',
      holidays: holidaysOn(d(2026, 8, 17), d(2026, 8, 26)),
      joinedOn: null,
      leftOn: null,
    },
    {
      label: 'মাসের মাঝে যোগ দিয়েছেন',
      holidays: holidaysOn(d(2026, 8, 26)),
      joinedOn: d(2026, 8, 13),
      leftOn: null,
    },
    {
      label: 'মাসের মাঝে চলে গেছেন',
      holidays: new Set(),
      joinedOn: null,
      leftOn: d(2026, 8, 20),
    },
  ];

  for (const month of MONTHS) {
    for (const c of cases) {
      it(`${month.name} · ${c.label} — targetSec একই ঘণ্টা দেয়`, () => {
        // ⚠️ কেসগুলোর তারিখ আগস্টের; অন্য মাসে সেগুলো এমনিতেই বাইরে পড়ে,
        //    তাই ছুটি ও কর্মকাল মাস-নিরপেক্ষভাবেই প্রয়োগ হয়
        const rule = ruleOf(c.holidays);

        const p = prorate({
          monthStart: month.start,
          monthEnd: month.end,
          joinedOn: c.joinedOn,
          leftOn: c.leftOn,
          weeklyOffDay: FRIDAY,
          holidays: c.holidays,
          monthlyTargetSec: MONTHLY_TARGET_SEC,
          policyWorkdays: POLICY_WORKDAYS,
        });

        // reports যেভাবে দেখে: কর্মকাল ∩ মাস
        const from =
          c.joinedOn !== null && c.joinedOn.getTime() > month.start.getTime()
            ? c.joinedOn
            : month.start;
        const to =
          c.leftOn !== null && c.leftOn.getTime() < month.end.getTime()
            ? c.leftOn
            : month.end;

        const perDay = dailyTargetSec(MONTHLY_TARGET_SEC, POLICY_WORKDAYS);
        const reportSec = targetSecIn({ from, to }, rule, perDay);

        // ⭐ দুটো হরও এক — ভাগটা দুই ফাইলে দুবার লেখা, তাই এটাও বাঁধা থাক
        expect(p.dailyTargetSec).toBe(perDay);
        expect(countWorkdays(from, to, rule)).toBe(p.employeeWorkdays);

        // ⭐⭐ আসল দাবি
        expect(secondsToHours(reportSec)).toBe(secondsToHours(p.targetSec));
      });
    }
  }

  /**
   * ⚠️ ২০৮ ÷ ২৬ কাকতালীয়ভাবে পূর্ণসংখ্যা (২৮৮০০ সেকেন্ড)। ভাগ না যাওয়া
   * পলিসিতেও দুটো পথ যেন না ছাড়ে — নইলে "আমাদের সংখ্যায় তো মিলছে" বলে
   * ফাঁকটা লুকিয়ে থাকত।
   */
  it('ভাগ না যাওয়া পলিসিতেও (২০০ঘ ÷ ২২ দিন) দুটো এক থাকে', () => {
    const monthlyTargetSec = 200 * HOUR;
    const policyWorkdays = 22;
    const month = MONTHS[0];
    const holidays = holidaysOn(d(2026, 8, 26));
    const rule = ruleOf(holidays);

    const p = prorate({
      monthStart: month.start,
      monthEnd: month.end,
      joinedOn: null,
      leftOn: null,
      weeklyOffDay: FRIDAY,
      holidays,
      monthlyTargetSec,
      policyWorkdays,
    });

    const reportSec = targetSecIn(
      { from: month.start, to: month.end },
      rule,
      dailyTargetSec(monthlyTargetSec, policyWorkdays),
    );

    expect(secondsToHours(reportSec)).toBe(secondsToHours(p.targetSec));
  });
});

describe('গুণফল আর দিনে-দিনে যোগফল — কলামটা যেন যোগ হয়', () => {
  /**
   * ⭐⭐ রিপোর্টের পাতায় টার্গেট ছাপা হয় **প্রতিদিন এক ঘর করে**, আর নিচে
   * একটা মোট বসে। মোটটা `targetSecIn()` (গুণ) থেকে আসে। দুটো আলাদা হলে
   * পাঠক কলামটা যোগ করে দেখতেন মোটের সাথে মিলছে না — যেকোনো ভুল সংখ্যার
   * চেয়ে ওটা খারাপ।
   *
   * ⚠️ এই সমতাটা টিকে আছে **শুধু কারণ হর ধ্রুবক**। হর মাসভেদে বদলালে দুই
   * মাস ছোঁয়া রেঞ্জে গুণ করাটা ভুল হতো — তাই এই টেস্টটা আসলে হরটাকেও
   * পাহারা দেয়।
   */
  it('দুই মাস ছোঁয়া রেঞ্জেও গুণফল = দিনে-দিনে যোগফল', () => {
    const rule = ruleOf(holidaysOn(d(2026, 8, 26), d(2026, 9, 15)));
    const perDay = dailyTargetSec(MONTHLY_TARGET_SEC, POLICY_WORKDAYS);
    const span = { from: d(2026, 8, 10), to: d(2026, 9, 20) };

    expect(secondsToHours(targetSecIn(span, rule, perDay))).toBe(
      secondsToHours(sumDayByDay(span.from, span.to, rule, perDay)),
    );
  });

  it('ভাগ না যাওয়া পলিসিতেও যোগফল মেলে', () => {
    const rule = ruleOf(new Set<number>());
    const perDay = dailyTargetSec(200 * HOUR, 22);
    const span = { from: d(2026, 8, 1), to: d(2026, 8, 31) };

    expect(secondsToHours(targetSecIn(span, rule, perDay))).toBe(
      secondsToHours(sumDayByDay(span.from, span.to, rule, perDay)),
    );
  });
});

describe('overlapOf — প্রত্যাশার জানালা ও রেঞ্জের ছেদ', () => {
  it('ছেদ থাকলে দুই সীমার ভেতরেরটাই ফেরে', () => {
    const seen = overlapOf(
      { from: d(2026, 8, 13), to: d(2026, 8, 20) },
      { from: d(2026, 8, 1), to: d(2026, 8, 31) },
    );

    expect(seen).not.toBeNull();
    expect(seen?.from).toEqual(d(2026, 8, 13));
    expect(seen?.to).toEqual(d(2026, 8, 20));
  });

  it('একটাই দিন মিললেও সেটা ছেদ — খালি নয়', () => {
    const seen = overlapOf(
      { from: d(2026, 8, 1), to: d(2026, 8, 13) },
      { from: d(2026, 8, 13), to: d(2026, 8, 31) },
    );

    expect(seen).toEqual({ from: d(2026, 8, 13), to: d(2026, 8, 13) });
  });

  /** ⭐ `null` মানে "ছেদই নেই" — "০ কর্মদিবস"-এর চেয়ে আলাদা কথা */
  it('না মিললে null, উল্টো রেঞ্জ নয়', () => {
    expect(
      overlapOf(
        { from: d(2026, 8, 1), to: d(2026, 8, 10) },
        { from: d(2026, 8, 11), to: d(2026, 8, 31) },
      ),
    ).toBeNull();
  });
});

describe('প্রত্যাশা বনাম টার্গেট — ঘাটতির হর', () => {
  const perDay = dailyTargetSec(MONTHLY_TARGET_SEC, POLICY_WORKDAYS);
  const rule = ruleOf(new Set<number>());
  const range = { from: d(2026, 8, 1), to: d(2026, 8, 31) };

  /**
   * ⭐⭐ এই ইনস্টলেশনের আসল ঘটনা: এজেন্ট বসেছে ১৩ আগস্ট ২০২৬। ১–১২ আগস্ট
   * কেউ কিছু মাপেনি, তাই ওই দিনগুলো প্রত্যাশায় নেই — অথচ টার্গেটে আছে
   * (দিনগুলো রিপোর্টের সারি হিসেবে ছাপা হয়)।
   */
  it('ট্র্যাকিং শুরুর আগের দিন টার্গেটে থাকে, প্রত্যাশায় নয়', () => {
    const window = { from: d(2026, 8, 13), to: d(2026, 8, 20) }; // গতকাল = ২০
    const seen = overlapOf(window, range);

    const targetHours = secondsToHours(targetSecIn(range, rule, perDay));
    const expectedHours = secondsToHours(
      seen === null ? 0 : targetSecIn(seen, rule, perDay),
    );

    expect(targetHours).toBe(216); // পুরো আগস্টের ২৭ কর্মদিবস
    expect(expectedHours).toBe(56); // ১৩–২০ আগস্ট, ১৪ শুক্রবার বাদে ৭ দিন
    expect(expectedHours).toBeLessThan(targetHours);
  });

  /**
   * ⭐ পর্ব শেষ হয়ে গেলে (গত মাসের রিপোর্ট) জানালা পুরো রেঞ্জ ঢাকে —
   * অর্থাৎ প্রত্যাশা = টার্গেট, আর ঘাটতির হিসাব আগের মতোই থাকে। পুরোনো
   * ছাপা কাগজ তাই এই নিয়মে নড়ে না।
   */
  it('পর্ব শেষ হলে প্রত্যাশা আর টার্গেট এক হয়ে যায়', () => {
    const seen = overlapOf(range, range);

    expect(secondsToHours(targetSecIn(seen!, rule, perDay))).toBe(
      secondsToHours(targetSecIn(range, rule, perDay)),
    );
  });
});
