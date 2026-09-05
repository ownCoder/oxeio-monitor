import { AlertMailer } from '../src/alerts/alerts.mailer';
import { TeamsChannel } from '../src/alerts/teams.channel';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type {
  TelegramChannel,
  TelegramOutcome,
} from '../src/alerts/telegram.channel';
import { WeeklyDigestJob } from '../src/digest/weekly.job';
import {
  TELEGRAM_TEXT_LIMIT,
  buildWeekly,
  isPrivateChatId,
  weeklyGateOf,
  weeklyMessage,
  weeklyScheduleOf,
  weeklyWindow,
  type ObservedDay,
  type WeeklySource,
} from '../src/digest/weekly.rules';
import { WeeklyDigestService } from '../src/digest/weekly.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ReportsService } from '../src/reports/reports.service';
import type {
  AttendanceReport,
  AttendanceRow,
  ReportMeta,
  SummaryReport,
  SummaryRow,
} from '../src/reports/reports.types';

/**
 * R3 — সাপ্তাহিক সারাংশ (owner-এর টেলিগ্রামে)।
 *
 * ⭐ এখানকার ভুলগুলো সব **নীরব**: বার্তাটা ঠিকই যেত, শুধু ভেতরের কথাটা
 * ভুল হতো। সবচেয়ে বড়গুলো —
 *   ১· ⭐⭐ ট্র্যাকিং বসার **আগের** দিনগুলোর টার্গেট প্রত্যাশায় ধরা, অর্থাৎ
 *      প্রথম বার্তাতেই নাম ধরে ধরে "৩২ ঘণ্টা পিছিয়ে" (এই ফাইলের মূল টেস্ট),
 *   ২· "সারি নেই" আর "সারি আছে, ০ ঘণ্টা" এক করে ফেলা — তাতে এজেন্ট চালু
 *      থাকা অবস্থার প্রকৃত অনুপস্থিতি কোনোদিন "Behind" তালিকায় উঠত না,
 *   ৩· রিপোর্ট থেকে বাদ পড়া কর্মীদের নাম বার্তায় না যাওয়া,
 *   ৪· ৪০৯৬ অক্ষর ছাড়িয়ে যাওয়ায় গোটা বার্তাটাই না পৌঁছানো,
 *   ৫· ছাঁটাই করতে গিয়ে **সংখ্যা**ও কেটে ফেলা ("৪ জন পিছিয়ে" অথচ আসলে ১২)।
 */

// ── ফিক্সচার ────────────────────────────────────────────────────────────────

/** উইন্ডো: ৮–১৪ আগস্ট ২০২৬ (শনি → শুক্র), আজ = ১৪ */
const WINDOW_DATES = [
  '2026-08-08',
  '2026-08-09',
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
] as const;

const TODAY_DATE = '2026-08-14';

/**
 * ⚠️ ফিক্সচারে সাপ্তাহিক ছুটি **রবিবার**, শুক্রবার নয় — ইচ্ছাকৃত। তাতে
 * আজকের দিনটা (শুক্র ১৪) কর্মদিবস থাকে আর "আজকের টার্গেট বাদ" নিয়মটা
 * আদৌ পরীক্ষা হয়। ছুটি আজকের দিনেই পড়লে বাদ যেত ০ ঘণ্টা, আর নিয়মটা
 * ভেঙে থাকলেও সব টেস্ট সবুজ থাকত।
 *
 * ⭐ বাংলাদেশের আসল ডিফল্ট (শুক্র ছুটি) আলাদা করে পরীক্ষা হয়েছে নিচের
 * "প্রথম বার্তা" ঘরে — কারণ ওই বিন্যাসেই বাগটা সবচেয়ে ভয়ংকর ছিল।
 */
const OFF_DATE = '2026-08-09';

/** ৬ কর্মদিবস × ৮ ঘণ্টা = ৪৮ — `week()`-এর টার্গেটের সাথে মেলানো */
const DAY_TARGET = 8;

function att(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employeeId: 1,
    empCode: 'OX-001',
    fullName: 'Jane Doe',
    staffType: null,
    department: null,
    date: TODAY_DATE,
    dayType: 'workday',
    status: 'worked',
    // ⚠️ নমুনায় কেউ ছুটিতে নেই — এই ফিক্সচার G130 নিয়ে দাবি করে না
    onLeave: false,
    workedHours: 8,
    idleHours: 0,
    adjustmentHours: 0,
    // ⭐ ডিজাইনের সংখ্যা (২১ আগস্ট) — ডিজাইনার না হলে null
    designsDone: null,
    creditedHours: 8,
    targetHours: DAY_TARGET,
    ...over,
  };
}

/**
 * এক কর্মীর F01 সারি, উইন্ডোর প্রতিটি দিনের একটা।
 *
 * ⚠️ `buildWeekly()` এই সারিগুলোর **ঘণ্টা পড়ে না**, শুধু `date` ও
 * `targetHours` — ঘণ্টা আসে F02 থেকে (দুই উৎস থেকে যোগ করলে গোল করা মান
 * জমে দুই পর্দায় দুই সংখ্যা হতো)। তাই এখানকার ঘণ্টাগুলো নিছক আবর্জনা,
 * আর সেটাই ঠিক আছে।
 */
function daysOf(
  employeeId = 1,
  empCode = 'OX-001',
  dates: readonly string[] = WINDOW_DATES,
): AttendanceRow[] {
  return dates.map((date) =>
    att({
      employeeId,
      empCode,
      date,
      dayType: date === OFF_DATE ? 'weekly_off' : 'workday',
      targetHours: date === OFF_DATE ? 0 : DAY_TARGET,
    }),
  );
}

/** ওই দিনগুলোর `daily_summary` সারি আছে — অর্থাৎ দিনগুলো মাপা হয়েছে */
function seenOn(
  employeeId = 1,
  dates: readonly string[] = WINDOW_DATES,
): ObservedDay[] {
  return dates.map((date) => ({ employeeId, date }));
}

function week(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    employeeId: 1,
    empCode: 'OX-001',
    fullName: 'Jane Doe',
    bucket: '2026-08-08',
    bucketStart: '2026-08-08',
    bucketEnd: TODAY_DATE,
    workdays: 6,
    daysWithWork: 6,
    workedHours: 48,
    adjustmentHours: 0,
    creditedHours: 48,
    // ৬ কর্মদিবস × ৮ ঘণ্টা — **আজকের দিনটাসহ**
    targetHours: 48,
    shortfallHours: 0,
    overtimeHours: 0,
    ...over,
  };
}

/** F02 সারি → পুরো উইন্ডো দেখা হয়েছে এমন একটা উৎস */
function fullyObserved(
  rows: SummaryRow[],
  dates: readonly string[] = WINDOW_DATES,
): Pick<WeeklySource, 'week' | 'daily' | 'observed'> {
  return {
    week: rows,
    daily: rows.flatMap((r) => daysOf(r.employeeId, r.empCode, dates)),
    observed: rows.flatMap((r) => seenOn(r.employeeId, dates)),
  };
}

function source(over: Partial<WeeklySource> = {}): WeeklySource {
  return {
    from: '2026-08-08',
    to: TODAY_DATE,
    days: 7,
    ...fullyObserved([week()]),
    excludedEmployees: [],
    ...over,
  };
}

/** n জন কর্মী, একই ধাঁচে — শুধু কোড ও নাম আলাদা */
function staff(
  n: number,
  over: (i: number) => Partial<SummaryRow> = () => ({}),
): SummaryRow[] {
  return Array.from({ length: n }, (_, i) =>
    week({
      employeeId: i + 1,
      empCode: `OX-${String(i + 1).padStart(3, '0')}`,
      // ⚠️ বাস্তবসম্মত লম্বা বাংলা নাম — ASCII "Jane Doe" দিয়ে দৈর্ঘ্যের
      //    টেস্ট করলে সবচেয়ে জরুরি কেসটাই (বাংলা নামের দল) ফাঁকি পড়ত
      fullName: `মোহাম্মদ আব্দুর রহমান চৌধুরী ${i + 1}`,
      ...over(i),
    }),
  );
}

// ── শিডিউল ──────────────────────────────────────────────────────────────────

describe('weeklyScheduleOf — env থেকে দিন ও ঘণ্টা', () => {
  it('কিছু না দিলে শুক্রবার সন্ধ্যা ৬টা', () => {
    const s = weeklyScheduleOf(undefined, undefined);

    expect(s.isoDay).toBe(5);
    expect(s.hour).toBe(18);
    expect(s.expression).toBe('0 0 18 * * 5');
    expect(s.ignored).toEqual([]);
  });

  it('দেওয়া মান মানা হয়', () => {
    expect(weeklyScheduleOf('1', '9').expression).toBe('0 0 9 * * 1');
    expect(weeklyScheduleOf(' 3 ', ' 0 ').expression).toBe('0 0 0 * * 3');
  });

  it('⚠️ ISO ৭ (রবিবার) cron-এ ০ — না মেলালে বার্তা কোনোদিন যেত না', () => {
    const s = weeklyScheduleOf('7', '18');

    expect(s.isoDay).toBe(7);
    expect(s.expression).toBe('0 0 18 * * 0');
  });

  it('⚠️ ভুল মানে ক্র্যাশ নয় — ডিফল্ট, কিন্তু নীরবে নয়', () => {
    const s = weeklyScheduleOf('Friday', '25');

    expect(s.isoDay).toBe(5);
    expect(s.hour).toBe(18);
    expect(s.ignored).toHaveLength(2);
    expect(s.ignored[0]).toContain('WEEKLY_DIGEST_DAY');
    expect(s.ignored[1]).toContain('WEEKLY_DIGEST_HOUR');
  });

  it('⚠️ "18abc" ১৮ নয় — অর্ধেক পড়ে নিলে টাইপোটা কোনোদিন ধরা পড়ত না', () => {
    const s = weeklyScheduleOf('5', '18abc');

    expect(s.hour).toBe(18); // ডিফল্ট, কাকতালীয়ভাবে একই
    expect(s.ignored).toHaveLength(1);
  });

  it('সীমার বাইরের দিন (০ বা ৮) নাকচ', () => {
    expect(weeklyScheduleOf('0').ignored).toHaveLength(1);
    expect(weeklyScheduleOf('8').ignored).toHaveLength(1);
  });
});

describe('weeklyWindow — শেষ ৭ দিন, ঢাকার হিসাবে', () => {
  it('আজকের দিনসহ পেছনে ৭ দিন', () => {
    const w = weeklyWindow(new Date('2026-08-14T12:00:00Z'));

    expect(w).toEqual({ from: '2026-08-08', to: '2026-08-14', days: 7 });
  });

  it('⚠️ "আজ" মানে ঢাকার আজ — UTC-তে তখনো গতকাল হলেও', () => {
    // ঢাকায় ১৫ আগস্ট রাত ১২:৩০, UTC-তে তখনো ১৪ আগস্ট সন্ধ্যা ৬:৩০
    const w = weeklyWindow(new Date('2026-08-14T18:30:00Z'));

    expect(w.to).toBe('2026-08-15');
    expect(w.from).toBe('2026-08-09');
  });

  it('মাসের সীমানা পেরোয়', () => {
    expect(weeklyWindow(new Date('2026-09-02T06:00:00Z')).from).toBe(
      '2026-08-27',
    );
  });
});

// ── সপ্তাহের হিসাব ──────────────────────────────────────────────────────────

describe('buildWeekly — প্রত্যাশা থেকে আজকের টার্গেট বাদ', () => {
  it('⭐ দিন শেষ হয়নি, তাই আজকের টার্গেট গোনা হয় না', () => {
    const w = buildWeekly(source());
    const row = w.rows[0];

    expect(row.targetHours).toBe(48);
    expect(row.expectedHours).toBe(40); // ৪৮ − আজকের ৮
    expect(row.paceHours).toBe(8); // ৪৮ ঘণ্টা কাজ − ৪০ প্রত্যাশা
    expect(row.standing).toBe('on_track');
    // পুরো উইন্ডো দেখা হয়েছে — কোথাও ফাঁক নেই
    expect(row.observedDays).toBe(7);
    expect(row.unobservedDays).toBe(0);
    expect(row.countedFrom).toBe('2026-08-08');
  });

  it('⚠️ আজকের টার্গেট ধরলে এই কর্মী "পিছিয়ে" দেখাতেন — দেখান না', () => {
    // পুরো সপ্তাহ ঠিকঠাক, শুধু আজকের দিনটা এখনো চলছে (৩ ঘণ্টা হয়েছে)
    const w = buildWeekly(
      source(
        fullyObserved([
          week({ creditedHours: 43, workedHours: 43, daysWithWork: 6 }),
        ]),
      ),
    );

    expect(w.rows[0].paceHours).toBe(3);
    expect(w.behind).toHaveLength(0);
  });

  it('আজ কর্মরত না থাকলে (গতকাল ছেড়েছেন) পুরো টার্গেটই প্রত্যাশা', () => {
    // ⚠️ F01-এ আজকের সারিই নেই — ছেড়ে যাওয়ার পরের দিন রিপোর্টে ওঠে না
    const upTo13 = WINDOW_DATES.slice(0, 6);
    const w = buildWeekly(
      source(
        fullyObserved(
          [week({ workdays: 5, targetHours: 40, creditedHours: 40 })],
          upTo13,
        ),
      ),
    );

    expect(w.rows[0].expectedHours).toBe(40);
    expect(w.rows[0].paceHours).toBe(0);
    expect(w.rows[0].unobservedDays).toBe(0);
  });

  it('সত্যিই পিছিয়ে থাকলে ধরা পড়ে', () => {
    const w = buildWeekly(
      source(
        fullyObserved([
          week({ creditedHours: 30, workedHours: 30, daysWithWork: 4 }),
        ]),
      ),
    );

    expect(w.behind).toHaveLength(1);
    expect(w.behind[0].paceHours).toBe(-10);
    expect(w.rows[0].standing).toBe('behind');
  });

  it('⚠️ কয়েক মিনিটের ঘাটতিতে কারো নাম "Behind" তালিকায় ওঠে না', () => {
    // ২০৮ ÷ ২৭ জাতীয় টার্গেটে দিন-ঘণ্টা আর সপ্তাহ-ঘণ্টা দুটোই দুই
    // দশমিকে গোল হয়, আর বিয়োগফলে দু-তিন মিনিট এদিক-ওদিক হতে পারে
    const w = buildWeekly(
      source(
        fullyObserved([
          week({ creditedHours: 39.98, workedHours: 39.98, daysWithWork: 6 }),
        ]),
      ),
    );

    expect(w.rows[0].paceHours).toBe(-0.02);
    // সংখ্যাটা সত্যি বলেই থাকে, কিন্তু ঘরটা "on track"
    expect(w.rows[0].standing).toBe('on_track');
    expect(w.behind).toHaveLength(0);
  });
});

describe('buildWeekly — দুই বালতিতে ভাগ হওয়া সপ্তাহ', () => {
  it('⚠️ বালতিগুলো যোগ হয়, শেষেরটা নেওয়া হয় না', () => {
    // কারো সাপ্তাহিক ছুটি অন্য দিনে — ৭ দিনের উইন্ডো দুই সপ্তাহ-বালতিতে
    const w = buildWeekly(
      source({
        ...fullyObserved([week()]),
        week: [
          week({
            bucket: '2026-08-01',
            workdays: 2,
            daysWithWork: 2,
            creditedHours: 16,
            targetHours: 16,
          }),
          week({
            bucket: '2026-08-08',
            workdays: 4,
            daysWithWork: 4,
            creditedHours: 32,
            targetHours: 32,
          }),
        ],
      }),
    );

    expect(w.rows).toHaveLength(1);
    expect(w.rows[0].creditedHours).toBe(48);
    expect(w.rows[0].targetHours).toBe(48);
    expect(w.rows[0].workdays).toBe(6);
    expect(w.rows[0].daysWithWork).toBe(6);
    // দুটো বালতি হলেও দিনের সারি সাতটাই — প্রত্যাশা তাই ৪৮ − আজকের ৮
    expect(w.rows[0].expectedHours).toBe(40);
  });
});

// ══════════ ⭐⭐ আংশিক-পর্যবেক্ষিত সপ্তাহ — এই ফাইলের মূল টেস্ট ══════════

describe('buildWeekly — ⭐⭐ ট্র্যাকিং শুরুর আগের দিন প্রত্যাশায় নেই', () => {
  /**
   * ⚠️⚠️ **এই ইনস্টলেশনের প্রথম বার্তাটাই এখানে দাঁড়িয়ে।**
   *
   * ট্র্যাকিং বসেছে ১৩ আগস্ট ২০২৬, ডিফল্ট শিডিউল শুক্রবার সন্ধ্যা ৬টা,
   * আর ১৪ আগস্ট শুক্রবার। তাই প্রথম উইন্ডো ৮–১৪ আগস্ট, যার ৮–১২ কেউ
   * দেখেনি। এখানে সাপ্তাহিক ছুটি **শুক্রবার** (স্পেকের ডিফল্ট), অর্থাৎ
   * আজকের টার্গেট ০ — সংশোধনের আগে বাদ যেত ওই শূন্যটুকুই, আর প্রত্যাশা
   * দাঁড়াত পুরো ৪৮ ঘণ্টা। ৮ ঘণ্টা কাজের বিপরীতে বার্তা যেত
   * **"৪০ ঘণ্টা পিছিয়ে"**, নাম ধরে, owner-এর টেলিগ্রামে — এমন দিনের
   * জন্য যখন এজেন্টই বসেনি। আর টেলিগ্রামের বার্তা ফেরত নেওয়া যায় না।
   */
  const FRIDAY_OFF_DAYS: AttendanceRow[] = WINDOW_DATES.map((date) =>
    att({
      date,
      // ১৪ আগস্ট শুক্রবার = সাপ্তাহিক ছুটি, টার্গেট ০
      dayType: date === TODAY_DATE ? 'weekly_off' : 'workday',
      targetHours: date === TODAY_DATE ? 0 : DAY_TARGET,
    }),
  );

  /** ⭐ ১৩ তারিখে ট্র্যাকিং বসেছে — তার আগের কোনো দিনের সারি নেই */
  const firstWeek = (): WeeklySource =>
    source({
      daily: FRIDAY_OFF_DAYS,
      observed: seenOn(1, ['2026-08-13', '2026-08-14']),
      week: [
        week({
          workdays: 6,
          targetHours: 48,
          daysWithWork: 1,
          workedHours: 8,
          creditedHours: 8,
        }),
      ],
    });

  it('⭐⭐ প্রত্যাশা ৮ ঘণ্টা, ৪৮ নয় — না-দেখা দিন ঘাটতিও নয়', () => {
    const row = buildWeekly(firstWeek()).rows[0];

    // ১৩ তারিখ একমাত্র গোনা দিন (১৪ আজ, আর বাকিগুলো দেখাই হয়নি)
    expect(row.expectedHours).toBe(8);
    expect(row.paceHours).toBe(0);
    expect(row.standing).toBe('on_track');
  });

  it('⭐ কোন দিন থেকে গোনা হলো সেটা সারিতে থাকে', () => {
    const row = buildWeekly(firstWeek()).rows[0];

    expect(row.countedFrom).toBe('2026-08-13');
    expect(row.observedDays).toBe(2); // ১৩ ও ১৪
    expect(row.unobservedDays).toBe(5); // ৮–১২
  });

  it('⭐ আর বার্তাতেও লেখা থাকে — নইলে সমন্বয়টা অদৃশ্য অনুমান', () => {
    const m = weeklyMessage(buildWeekly(firstWeek()), 'Acme');

    expect(m.text).toContain('counted from 2026-08-13');
    expect(m.text).toContain('Not every day was observed — 1 of 1 staff');
    expect(m.text).toContain('neither as');
    // ⚠️ যে বাক্যটা কখনো যাওয়া চলবে না
    expect(m.text).not.toContain('behind');
  });

  it('⚠️ সবাই মিলে — প্রথম বার্তায় একটাও নাম "Behind" ঘরে ওঠে না', () => {
    const rows = staff(4, () => ({
      daysWithWork: 1,
      workedHours: 8,
      creditedHours: 8,
    }));
    const w = buildWeekly(
      source({
        week: rows,
        daily: rows.flatMap((r) =>
          FRIDAY_OFF_DAYS.map((d) => ({
            ...d,
            employeeId: r.employeeId,
            empCode: r.empCode,
          })),
        ),
        observed: rows.flatMap((r) =>
          seenOn(r.employeeId, ['2026-08-13', '2026-08-14']),
        ),
      }),
    );

    expect(w.behind).toHaveLength(0);
    expect(w.onTrack).toHaveLength(4);
    expect(w.totals.withGaps).toBe(4);
  });

  it('⚠️ মাঝখানের ফাঁকও বাদ — সার্ভার একদিন বন্ধ ছিল', () => {
    // ১১ তারিখ ছাড়া সব দিন দেখা হয়েছে; ১১ কর্মদিবস, টার্গেট ৮
    const seen = WINDOW_DATES.filter((d) => d !== '2026-08-11');
    const w = buildWeekly(
      source({
        observed: seenOn(1, seen),
        week: [week({ creditedHours: 32, workedHours: 32, daysWithWork: 4 })],
      }),
    );
    const row = w.rows[0];

    // ৪৮ − আজকের ৮ − না-দেখা ১১ তারিখের ৮ = ৩২
    expect(row.expectedHours).toBe(32);
    expect(row.paceHours).toBe(0);
    expect(row.countedFrom).toBe('2026-08-08'); // শুরু ঠিকই আছে
    expect(row.unobservedDays).toBe(1);

    const m = weeklyMessage(w, 'Acme');
    expect(m.text).toContain('1 day not observed');
    expect(m.text).not.toContain('counted from');
  });

  it('⚠️ একটা দিনও গোনা না গেলে প্রত্যাশা ঠিক ০ — "প্রায় ০" নয়', () => {
    // ট্র্যাকিং আজই বসেছে: আজকের সারি আছে, কিন্তু আজ গোনা হয় না
    const w = buildWeekly(
      source({
        observed: seenOn(1, [TODAY_DATE]),
        week: [
          week({ creditedHours: 0, workedHours: 0, daysWithWork: 0 }),
        ],
      }),
    );
    const row = w.rows[0];

    expect(row.countedFrom).toBeNull();
    expect(row.expectedHours).toBe(0);
    expect(row.paceHours).toBe(0);
    // ⭐ সারি আছে, তাই "দেখা হয়নি" নয় — শূন্য প্রত্যাশায় পিছিয়েও নন
    expect(row.recorded).toBe(true);
    expect(w.behind).toHaveLength(0);
  });

  it('⚠️ F01 সারি না এলে হিসাব শিথিল হয় না — পুরো টার্গেটই প্রত্যাশা', () => {
    // রক্ষাকবচ: কোনো কারণে দিনভিত্তিক সারি না পেলে আগের আচরণে ফেরে,
    // নীরবে সবাইকে "on track" বলে দেয় না
    const w = buildWeekly(
      source({
        daily: [],
        observed: [],
        week: [week({ creditedHours: 10, workedHours: 10, daysWithWork: 2 })],
      }),
    );

    expect(w.rows[0].expectedHours).toBe(48);
    expect(w.rows[0].standing).toBe('behind');
  });
});

// ══════════ সারি নেই বনাম সারি আছে, ০ ঘণ্টা ══════════

describe('buildWeekly — ⚠️⚠️ "সারি নেই" আর "০ ঘণ্টা" এক নয়', () => {
  it('⭐ একটাও সারি নেই → "পিছিয়ে" নয়, "দেখা হয়নি"', () => {
    const w = buildWeekly(
      source({
        observed: [],
        week: [week({ creditedHours: 0, workedHours: 0, daysWithWork: 0 })],
      }),
    );

    expect(w.rows[0].standing).toBe('no_records');
    expect(w.rows[0].recorded).toBe(false);
    expect(w.behind).toHaveLength(0);
    expect(w.noRecords).toHaveLength(1);
    expect(w.totals.withData).toBe(0);
  });

  it('⭐⭐ সারি আছে অথচ ০ ঘণ্টা → এটা পর্যবেক্ষণ, তাই "Behind"', () => {
    // এজেন্ট দিব্যি চলছে, প্রতিদিনের সারি লেখা হয়েছে — কিন্তু কাজ হয়নি।
    // ⚠️ সংশোধনের আগে ইনিও "রেকর্ড নেই" ঘরে যেতেন, ফলে প্রকৃত অনুপস্থিতি
    //    কোনোদিন কারো চোখে পড়ত না।
    const w = buildWeekly(
      source({
        week: [week({ creditedHours: 0, workedHours: 0, daysWithWork: 0 })],
      }),
    );

    expect(w.rows[0].recorded).toBe(true);
    expect(w.rows[0].observedDays).toBe(7);
    expect(w.rows[0].standing).toBe('behind');
    expect(w.behind[0].paceHours).toBe(-40);
    expect(w.noRecords).toHaveLength(0);
    expect(w.totals.withData).toBe(1);
  });

  it('⭐ আর বার্তায় দুটো আলাদা শব্দে বলা হয়', () => {
    const observedZero = weeklyMessage(
      buildWeekly(
        source({
          week: [week({ creditedHours: 0, workedHours: 0, daysWithWork: 0 })],
        }),
      ),
      'Acme',
    );
    const nothingSeen = weeklyMessage(
      buildWeekly(
        source({
          observed: [],
          week: [week({ creditedHours: 0, workedHours: 0, daysWithWork: 0 })],
        }),
      ),
      'Acme',
    );

    expect(observedZero.text).toContain('observed, no work recorded');
    expect(observedZero.text).toContain('Behind (1)');
    expect(observedZero.text).not.toContain('Not observed (');

    expect(nothingSeen.text).toContain('Not observed (1)');
    expect(nothingSeen.text).toContain('does NOT mean zero work');
    expect(nothingSeen.text).not.toContain('observed, no work recorded');
  });

  it('⚠️ owner-এর সংশোধন থাকলে সেটাও পর্যবেক্ষণ — সারি না থাকলেও', () => {
    // worked_sec শূন্য, কিন্তু owner হাতে ৪০ ঘণ্টা বসিয়েছেন
    const w = buildWeekly(
      source({
        observed: [],
        week: [
          week({
            workedHours: 0,
            daysWithWork: 0,
            adjustmentHours: 40,
            creditedHours: 40,
          }),
        ],
      }),
    );

    expect(w.rows[0].recorded).toBe(true);
    expect(w.rows[0].standing).toBe('on_track');
    expect(w.noRecords).toHaveLength(0);
  });

  it('⚠️ পুরো উইন্ডোতে কর্মদিবস না থাকলে (ঈদের ছুটি) "off"', () => {
    const holidays = WINDOW_DATES.map((date) =>
      att({ date, dayType: 'holiday', targetHours: 0, creditedHours: 0 }),
    );
    const w = buildWeekly(
      source({
        daily: holidays,
        week: [
          week({
            workdays: 0,
            daysWithWork: 0,
            workedHours: 0,
            creditedHours: 0,
            targetHours: 0,
          }),
        ],
      }),
    );

    expect(w.rows[0].standing).toBe('off');
    expect(w.off).toHaveLength(1);
    expect(w.noRecords).toHaveLength(0);
    expect(w.behind).toHaveLength(0);
  });
});

describe('buildWeekly — মোট ও ক্রম', () => {
  it('মোট ঘণ্টা ও কার তথ্য আছে', () => {
    const rows = [
      week({ employeeId: 1, empCode: 'OX-001', creditedHours: 40 }),
      week({
        employeeId: 2,
        empCode: 'OX-002',
        creditedHours: 0,
        workedHours: 0,
        daysWithWork: 0,
      }),
    ];
    const w = buildWeekly(
      source({
        week: rows,
        daily: rows.flatMap((r) => daysOf(r.employeeId, r.empCode)),
        // ⚠️ দ্বিতীয়জনের একটাও সারি নেই — তাঁর ব্যাপারে কিছুই জানা নেই
        observed: seenOn(1),
      }),
    );

    expect(w.totals.employees).toBe(2);
    expect(w.totals.withData).toBe(1);
    expect(w.totals.hoursRecorded).toBe(40);
    expect(w.totals.withGaps).toBe(1);
  });

  it('সারি এমপ কোডের ক্রমে, "পিছিয়ে" তালিকা সবচেয়ে পিছিয়ে থাকা আগে', () => {
    const w = buildWeekly(
      source(
        fullyObserved([
          week({ employeeId: 2, empCode: 'OX-002', creditedHours: 30 }),
          week({ employeeId: 1, empCode: 'OX-001', creditedHours: 20 }),
          week({ employeeId: 3, empCode: 'OX-003', creditedHours: 10 }),
        ]),
      ),
    );

    expect(w.rows.map((r) => r.empCode)).toEqual([
      'OX-001',
      'OX-002',
      'OX-003',
    ]);
    // তিনজনই পিছিয়ে (প্রত্যাশা ৪০), কিন্তু ক্রমটা সবচেয়ে পিছিয়ে থাকা আগে
    expect(w.behind.map((r) => r.empCode)).toEqual([
      'OX-003',
      'OX-001',
      'OX-002',
    ]);
  });
});

// ══════════ রিপোর্ট থেকে বাদ পড়া কর্মী ══════════

describe('buildWeekly / weeklyMessage — ⚠️ বাদ পড়া কর্মীরা', () => {
  it('⭐ নাম বার্তায় যায় — চুপচাপ হারিয়ে যান না', () => {
    const w = buildWeekly(
      source({ excludedEmployees: ['Karim Uddin', 'রহিম মিয়া'] }),
    );
    const m = weeklyMessage(w, 'Acme');

    expect(w.totals.excluded).toBe(2);
    expect(m.text).toContain('Not in this report (2)');
    expect(m.text).toContain('Karim Uddin');
    expect(m.text).toContain('রহিম মিয়া');
    // কেন বাদ পড়লেন আর কী করলে ফিরবেন — দুটোই লেখা থাকে
    expect(m.text).toContain('inactive with no leaving date');
  });

  it('⚠️⚠️ পুরো দল বাদ পড়লেও নামগুলো যায় — এখানেই খবরটা সবচেয়ে বড়', () => {
    // `employees === 0`, অর্থাৎ "Nobody was on the payroll" শাখা
    const w = buildWeekly(
      source({
        week: [],
        daily: [],
        observed: [],
        excludedEmployees: ['Karim Uddin', 'Rahim Mia'],
      }),
    );
    const m = weeklyMessage(w, 'Acme');

    expect(m.text).toContain('Nobody was on the payroll');
    expect(m.text).toContain('Not in this report (2)');
    expect(m.text).toContain('Karim Uddin');
  });

  it('কেউ বাদ না পড়লে ঘরটাই থাকে না', () => {
    const m = weeklyMessage(buildWeekly(source()), 'Acme');

    expect(m.text).not.toContain('Not in this report');
    expect(m.text).not.toContain('inactive with no leaving date');
  });

  it('⭐ নাম ছাঁটা পড়লেও শিরোনামের সংখ্যাটা থাকে', () => {
    const w = buildWeekly(
      source({
        ...fullyObserved(staff(15)),
        excludedEmployees: Array.from({ length: 9 }, (_, i) => `Excluded ${i}`),
      }),
    );
    const cut = weeklyMessage(w, 'Acme', 900);

    expect(cut.text).toContain('Not in this report (9)');
    expect(cut.hidden).toBeGreaterThan(0);
  });
});

// ── বার্তা ──────────────────────────────────────────────────────────────────

describe('weeklyMessage — খালি সপ্তাহ', () => {
  it('⚠️ কেউ কর্মরত না থাকলে "০ ঘণ্টা" লেখা হয় না', () => {
    const m = weeklyMessage(
      buildWeekly(source({ week: [], daily: [], observed: [] })),
      'Acme',
    );

    expect(m.text).toContain('Nobody was on the payroll');
    expect(m.text).not.toContain('0.00h');
    expect(m.hidden).toBe(0);
  });

  it('⭐⭐ সারা সপ্তাহে কারো একটা সারিও না থাকলে দলকে "০ ঘণ্টা" বলা হয় না', () => {
    // এজেন্ট আপডেট আটকে গেছে, বা সার্ভার সদ্য বসেছে — ট্র্যাকিংই ছিল না
    const rows = staff(4, () => ({
      creditedHours: 0,
      workedHours: 0,
      daysWithWork: 0,
    }));
    const w = buildWeekly(
      source({
        week: rows,
        daily: rows.flatMap((r) => daysOf(r.employeeId, r.empCode)),
        observed: [],
      }),
    );
    const m = weeklyMessage(w, 'Acme');

    expect(m.text).toContain('nothing was observed for any of the 4 staff');
    expect(m.text).not.toContain('0.00h recorded');
    expect(m.text).toContain('Not observed (4)');
    // ⚠️ কারণটা বার্তাতেই লেখা থাকতে হবে — নইলে পাঠক নিজেই "কেউ কাজ
    //    করেনি" ধরে নিতেন, আর সেটাই সবচেয়ে ক্ষতিকর ভুল পড়া
    expect(m.text).toContain('does NOT mean zero work');
  });
});

describe('weeklyMessage — একজন কর্মী', () => {
  it('নাম, ঘণ্টা, কত এগিয়ে, আর কত দিনে কাজ হয়েছে', () => {
    const m = weeklyMessage(buildWeekly(source()), 'Acme');

    expect(m.text).toContain('Acme — Weekly summary');
    expect(m.text).toContain('2026-08-08 → 2026-08-14 (Dhaka, 7 days)');
    expect(m.text).toContain('48.00h recorded · 1 of 1 staff have data');
    expect(m.text).toContain('On track (1)');
    expect(m.text).toContain('Jane Doe (OX-001) — 48.00h · +8.00 · 6/6 days');
    expect(m.hidden).toBe(0);
    // পুরো সপ্তাহ দেখা হয়েছে — বাড়তি ব্যাখ্যার দরকার নেই
    expect(m.text).not.toContain('Not every day was observed');
    expect(m.text).not.toContain('counted from');
  });

  it('পিছিয়ে থাকলে কত পিছিয়ে সেটাই লেখা হয়', () => {
    const w = buildWeekly(
      source(
        fullyObserved([
          week({ creditedHours: 30, workedHours: 30, daysWithWork: 4 }),
        ]),
      ),
    );
    const m = weeklyMessage(w, 'Acme');

    expect(m.text).toContain('Behind (1)');
    expect(m.text).toContain(
      'Jane Doe (OX-001) — 30.00h · 10.00 behind · 4/6 days',
    );
  });

  it('⚠️ "+-0.02" কখনো লেখা হয় না — চিহ্নটা আলাদা করে বসে', () => {
    const w = buildWeekly(
      source(
        fullyObserved([
          week({ creditedHours: 39.98, workedHours: 39.98, daysWithWork: 6 }),
        ]),
      ),
    );
    const m = weeklyMessage(w, 'Acme');

    expect(m.text).not.toContain('+-');
    expect(m.text).toContain('-0.02');
  });

  it('⚠️ খালি ঘর দেখানো হয় না — "Behind (0)" পড়তে বাধ্য করার মানে নেই', () => {
    const m = weeklyMessage(buildWeekly(source()), 'Acme');

    expect(m.text).not.toContain('Behind (0)');
    expect(m.text).not.toContain('Not observed (0)');
    expect(m.text).not.toContain('Off all week (0)');
  });

  it('⚠️ নামের ভেতরের newline বার্তার গঠন ভাঙতে পারে না', () => {
    const w = buildWeekly(
      source(fullyObserved([week({ fullName: 'Jane\nDoe' })])),
    );
    const m = weeklyMessage(w, 'Acme');

    expect(m.text).toContain('Jane Doe (OX-001)');
    // প্রতিটা সারি ঠিক এক লাইন — নইলে ছাঁটাইয়ের হিসাবও ভেঙে যেত
    expect(m.text.split('\n').filter((l) => l.includes('OX-001'))).toHaveLength(
      1,
    );
  });
});

describe('weeklyMessage — ছাঁটাই', () => {
  /**
   * ⚠️ ১৫ জন **সাধারণ অবস্থায় ৪০৯৬ ছাড়ায় না** — বাংলা লম্বা নাম নিয়েও
   * বার্তাটা দুই হাজারের ঘরে থাকে। তাই ছাঁটাইয়ের যন্ত্রটা এখানে ছোট সীমা
   * দিয়ে পরীক্ষা করা হয়; আসল ৪০৯৬-এর পরীক্ষা নিচের বড় দলের টেস্টে।
   * সীমাটা প্যারামিটার না রাখলে এই আচরণ যাচাই করার উপায়ই থাকত না।
   */
  it('১৫ জন — সীমা ছোট হলে নাম ছাঁটা পড়ে, "… and N more" বসে', () => {
    const w = buildWeekly(source(fullyObserved(staff(15))));
    const full = weeklyMessage(w, 'Acme');

    expect(full.hidden).toBe(0);
    expect(full.text.length).toBeLessThan(TELEGRAM_TEXT_LIMIT);

    const cut = weeklyMessage(w, 'Acme', 900);

    expect(cut.text.length).toBeLessThanOrEqual(900);
    expect(cut.hidden).toBeGreaterThan(0);
    expect(cut.text).toContain(`… and ${cut.hidden} more`);
  });

  it('⭐ ছাঁটাই হলেও শিরোনামের **সংখ্যা** আসলটাই থাকে', () => {
    const w = buildWeekly(source(fullyObserved(staff(15))));
    const cut = weeklyMessage(w, 'Acme', 700);

    // ১৫ জনই on track — নাম কেটে গেলেও সংখ্যাটা কখনো মিথ্যে বলে না
    expect(cut.text).toContain('On track (15)');
    expect(cut.text).toContain('15 of 15 staff have data');
  });

  it('⚠️ "পিছিয়ে" ঘরটা সবার শেষে ছাঁটা হয় — ওটাই পড়ে কিছু করার থাকে', () => {
    const rows = [
      ...staff(10),
      ...staff(2, () => ({ creditedHours: 10, workedHours: 10 })).map(
        (r, i) => ({
          ...r,
          employeeId: 100 + i,
          empCode: `OX-1${String(i).padStart(2, '0')}`,
        }),
      ),
    ];
    const cut = weeklyMessage(buildWeekly(source(fullyObserved(rows))), 'Acme', 800);

    expect(cut.hidden).toBeGreaterThan(0);
    // দুজন পিছিয়ে — দুজনের নামই টিকে থাকে
    expect(cut.text).toContain('OX-100');
    expect(cut.text).toContain('OX-101');
  });
});

describe('weeklyMessage — ⭐ দৈর্ঘ্যসীমা কখনো ছাড়ায় না', () => {
  /**
   * ⚠️ টেলিগ্রাম ৪০৯৬ অক্ষরের বেশি নিলে গোটা কলটাই HTTP 400 — অর্থাৎ
   * সপ্তাহের সারাংশ **কিছুই** পৌঁছাত না, আর ব্যর্থতাটা দেখা যেত কেবল
   * সার্ভারের লগে। তাই সব আকারের দলেই সীমাটা যাচাই করা হয়।
   *
   * ⚠️ মাপা হয় `String.length`-এ, বাইটে নয় — টেলিগ্রাম UTF-16 code unit
   *    গোনে, আর বাংলা অক্ষর UTF-8-এ ৩ বাইট। বাইট ধরলে অকারণে তিন ভাগের
   *    দুই ভাগ নাম কেটে যেত।
   */
  for (const n of [1, 15, 40, 120, 500]) {
    it(`${n} জন কর্মী`, () => {
      const rows = staff(n, (i) => ({
        // কিছু এগিয়ে, কিছু পিছিয়ে, কিছুর কোনো রেকর্ড নেই
        creditedHours: i % 3 === 0 ? 48 : i % 3 === 1 ? 20 : 0,
        workedHours: i % 3 === 2 ? 0 : 48,
        daysWithWork: i % 3 === 2 ? 0 : 6,
      }));
      const w = buildWeekly(
        source({
          week: rows,
          daily: rows.flatMap((r) => daysOf(r.employeeId, r.empCode)),
          // ⚠️ প্রতি তৃতীয়জনের একটাও সারি নেই, আর একজনের সপ্তাহ মাঝপথে
          //    শুরু — অর্থাৎ সব ব্যাখ্যা-লাইন একসাথে বার্তায় থাকে, আর
          //    তবুও সীমা ছাড়ায় না
          observed: rows.flatMap((r, i) =>
            i % 3 === 2
              ? []
              : seenOn(
                  r.employeeId,
                  i % 3 === 1 ? WINDOW_DATES.slice(4) : WINDOW_DATES,
                ),
          ),
          excludedEmployees: Array.from(
            { length: Math.min(n, 5) },
            (_, i) => `বাদ পড়া কর্মী ${i}`,
          ),
        }),
      );
      const m = weeklyMessage(w, 'oXeio Monitoring');

      expect(m.text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
      // পাদটীকা (কীভাবে পড়তে হয়) কখনো হারায় না
      expect(m.text).toContain('How to read this');
    });
  }

  it('⚠️ ORG_NAME-এ কেউ উপন্যাস বসালেও সীমা ছাড়ায় না', () => {
    const w = buildWeekly(source(fullyObserved(staff(20))));
    const m = weeklyMessage(w, 'গ'.repeat(5000));

    expect(m.text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it('⚠️ বার্তায় কখনো ডোমেইন, অ্যাপের নাম বা স্ক্রিনশটের পথ যায় না', () => {
    const m = weeklyMessage(buildWeekly(source()), 'Acme');

    expect(m.text).not.toMatch(/https?:\/\//);
    expect(m.text).not.toMatch(/\.(com|net|org|exe|png|jpg)\b/);
  });
});

// ── সার্ভিস ও জব (DB ছাড়াই) ─────────────────────────────────────────────────

const meta: ReportMeta = {
  from: '2026-08-08',
  to: TODAY_DATE,
  requestedTo: TODAY_DATE,
  clampedToToday: false,
  days: 7,
  generatedAt: '2026-08-14T12:00:00.000Z',
  excludedEmployees: [],
  targetHoursInRange: {},
  // ⚠️ এই দুটো সাপ্তাহিক সারাংশ পড়ে না — শুধু `ReportMeta` পূরণ করতে
  expectedHours: {},
  approximateHolidayDates: [],
  // ⚠️ নমুনায় কেউ 'না-দেখা' নয় — এই ফিক্সচার G110/G111 নিয়ে কোনো দাবি করে না
  observed: {},
  trackedFrom: {},
};

interface Stub {
  service: WeeklyDigestService;
  /** টেলিগ্রামে কী কী পাঠানো হলো */
  sent: string[];
  /** `ReportsService`-এ কোন কোন রেঞ্জ চাওয়া হলো, ডাকার ক্রমে */
  calls: { report: string; from: string; to: string; groupBy?: string }[];
  /** `daily_summary`-তে কোন রেঞ্জ চাওয়া হলো */
  observedQueries: { gte: Date; lte: Date }[];
}

function makeService(
  over: {
    outcome?: TelegramOutcome;
    env?: Record<string, string>;
    reports?: Partial<ReportsService>;
    /** কোন দিনগুলোর সারি আছে (ডিফল্ট: সাত দিনই) */
    observedDates?: readonly string[];
    excludedEmployees?: string[];
  } = {},
): Stub {
  const sent: string[] = [];
  const calls: Stub['calls'] = [];
  const observedQueries: Stub['observedQueries'] = [];

  const reportMeta: ReportMeta = {
    ...meta,
    excludedEmployees: over.excludedEmployees ?? [],
  };

  const reports = {
    attendance: (q: { from: string; to: string }) => {
      calls.push({ report: 'attendance', from: q.from, to: q.to });
      return Promise.resolve({
        meta: reportMeta,
        rows: daysOf(),
        totals: {
          employees: 1,
          rows: 7,
          workedHours: 48,
          creditedHours: 48,
          targetHours: 48,
          daysWithWork: 6,
        },
      } satisfies AttendanceReport);
    },
    summary: (q: { from: string; to: string; groupBy?: string }) => {
      calls.push({
        report: 'summary',
        from: q.from,
        to: q.to,
        groupBy: q.groupBy,
      });
      return Promise.resolve({
        meta: reportMeta,
        groupBy: 'week',
        overtimeNote: '',
        rows: [week()],
      } satisfies SummaryReport);
    },
    ...over.reports,
  } as unknown as ReportsService;

  const dates = over.observedDates ?? WINDOW_DATES;

  const prisma = {
    dailySummary: {
      findMany: (q: { where: { workDate: { gte: Date; lte: Date } } }) => {
        observedQueries.push(q.where.workDate);
        return Promise.resolve(
          dates.map((date) => ({
            employeeId: 1,
            workDate: new Date(`${date}T00:00:00.000Z`),
          })),
        );
      },
    },
  } as unknown as PrismaService;

  const telegram = {
    send: (text: string) => {
      sent.push(text);
      return Promise.resolve(over.outcome ?? 'sent');
    },
    // ⚠️ ইচ্ছাকৃতভাবে **নেই**: `runOnce()`। এই স্টাবে ওটা ডাকলে টেস্ট
    //    ভেঙে পড়বে — আর সেটাই চাই, কারণ ডাইজেস্টের `TelegramChannel`
    //    ইনস্ট্যান্স অ্যালার্টের sweep চালালে প্রতিটা অ্যালার্ট দুবার যেত।
  } as unknown as TelegramChannel;

  /**
   * ⚠️ Teams কনফিগ করা নেই ধরে নেওয়া — এই ফাইলের সব টেস্ট টেলিগ্রামের
   *    আচরণ নিয়ে, আর Teams-কে সেখানে টেনে আনলে প্রতিটা দাবির অর্থ
   *    ঘোলাটে হতো। Teams-এর নিজের গড়ন `teams-card.spec.ts`-এ বাঁধা।
   */
  const teams = {
    configured: false,
    send: () => Promise.resolve('not_configured' as const),
  } as unknown as TeamsChannel;

  /**
   * ⚠️ SMTP কনফিগ করা নেই ধরে নেওয়া — এই ফাইলের টেস্টগুলো টেলিগ্রামের
   *    আচরণ নিয়ে। ইমেইলের প্রাপক বাছার নিয়মটা `digest-recipients.spec.ts`-এ
   *    আলাদা করে বাঁধা, যেখানে সেটাই একমাত্র প্রশ্ন।
   */
  const mailer = {
    configured: false,
    send: () => Promise.resolve('not_configured' as const),
  } as unknown as AlertMailer;

  const config = {
    get: (key: string) => over.env?.[key],
  } as unknown as ConfigService;

  return {
    service: new WeeklyDigestService(reports, prisma, telegram, teams, mailer, config),
    sent,
    calls,
    observedQueries,
  };
}

/** UTC ১২:০০ = ঢাকার সন্ধ্যা ৬:০০, শুক্রবার — জবটা ঠিক এই সময়েই চলে */
const AT_6_PM_FRIDAY = new Date('2026-08-14T12:00:00.000Z');

describe('WeeklyDigestService — কোন রেঞ্জ চাওয়া হয়', () => {
  it('⭐ F01 ও F02 দুটোই **পুরো উইন্ডোর**', async () => {
    const { service, calls } = makeService();
    await service.runOnce(AT_6_PM_FRIDAY);

    // ⚠️ F01 আগে শুধু আজকের দিনটা চাইত; দিনভিত্তিক টার্গেট ছাড়া
    //    "যে দিন দেখা হয়নি" বাদ দেওয়ার উপায় নেই
    expect(calls).toEqual([
      { report: 'attendance', from: '2026-08-08', to: '2026-08-14' },
      {
        report: 'summary',
        from: '2026-08-08',
        to: '2026-08-14',
        groupBy: 'week',
      },
    ]);
  });

  it('⭐ `daily_summary`-ও ঠিক ওই সাত দিনের জন্যই দেখা হয়', async () => {
    const { service, observedQueries } = makeService();
    await service.runOnce(AT_6_PM_FRIDAY);

    expect(observedQueries).toHaveLength(1);
    expect(observedQueries[0].gte.toISOString()).toBe(
      '2026-08-08T00:00:00.000Z',
    );
    expect(observedQueries[0].lte.toISOString()).toBe(
      '2026-08-14T00:00:00.000Z',
    );
  });

  it('⚠️ "আজ" মানে ঢাকার আজ — UTC-তে তখনো গতকাল হলেও', async () => {
    const { service, calls, observedQueries } = makeService();
    // UTC ১৪ আগস্ট ২০:০০ = ঢাকার ১৫ আগস্ট ভোর ২টা
    await service.runOnce(new Date('2026-08-14T20:00:00.000Z'));

    expect(calls[0].from).toBe('2026-08-09');
    expect(calls[1].from).toBe('2026-08-09');
    expect(observedQueries[0].lte.toISOString()).toBe(
      '2026-08-15T00:00:00.000Z',
    );
  });

  it('⭐⭐ ট্র্যাকিং সদ্য বসলে সার্ভিসও কম প্রত্যাশা গোনে', async () => {
    const { service } = makeService({
      observedDates: ['2026-08-13', '2026-08-14'],
    });

    const weekly = await service.collect(AT_6_PM_FRIDAY);

    // ৪৮ − আজকের ৮ − না-দেখা ৮/৯/১০/১১/১২ (৮+০+৮+৮+৮) = ৮
    expect(weekly.rows[0].expectedHours).toBe(8);
    expect(weekly.rows[0].countedFrom).toBe('2026-08-13');
    expect(weekly.totals.withGaps).toBe(1);
  });

  it('⭐ বাদ পড়া কর্মীর নাম `meta` থেকে বার্তায় পৌঁছায়', async () => {
    const { service, sent } = makeService({
      excludedEmployees: ['Karim Uddin'],
    });
    const result = await service.runOnce(AT_6_PM_FRIDAY);

    expect(result.excluded).toBe(1);
    expect(sent[0]).toContain('Not in this report (1)');
    expect(sent[0]).toContain('Karim Uddin');
  });
});

describe('WeeklyDigestService — কোথায় যায়', () => {
  it('⚠️ গন্তব্য এই কোড বেছে দেয় না — `send()` কেবল লেখা নেয়', async () => {
    const { service, sent } = makeService();
    const result = await service.runOnce(AT_6_PM_FRIDAY);

    // ⚠️ আগে এখানে লেখা ছিল "তাই ভুল করেও গ্রুপে পাঠানো যায় না" — ওটা
    //    মিথ্যা ছিল: গন্তব্য বাছতে না পারা মানে গন্তব্য নিরাপদ নয়।
    //    চ্যানেলের `TELEGRAM_CHAT_ID` দিব্যি একটা দলের গ্রুপ হতে পারত,
    //    আর তখন র‍্যাঙ্কিং সেখানেই যেত। আসল প্রহরী নিচের describe-এ।
    expect(sent).toHaveLength(1);
    expect(result.outcome).toBe('sent');
    expect(sent[0]).toContain('Weekly summary');
  });

  it('ORG_NAME বার্তার মাথায় বসে', async () => {
    const { service, sent } = makeService({ env: { ORG_NAME: 'Acme Ltd' } });
    await service.runOnce(AT_6_PM_FRIDAY);

    expect(sent[0].startsWith('Acme Ltd — Weekly summary')).toBe(true);
  });
});

// ── ⭐⭐ গ্রুপ-চ্যাটের প্রহরী ───────────────────────────────────────────────

describe('isPrivateChatId — গ্রুপ চেনা যায় চিহ্ন দেখেই', () => {
  it('⭐ ব্যক্তিগত চ্যাট = নিছক ধনাত্মক সংখ্যা', () => {
    expect(isPrivateChatId('123456789')).toBe(true);
    expect(isPrivateChatId('  123456789  ')).toBe(true);
  });

  it('⚠️⚠️ গ্রুপ ও সুপারগ্রুপের id ঋণাত্মক', () => {
    expect(isPrivateChatId('-1001234567890')).toBe(false);
    expect(isPrivateChatId('-987654321')).toBe(false);
  });

  it('⚠️ `@name` কেবল প্রকাশ্য চ্যানেল/সুপারগ্রুপেরই হয়', () => {
    expect(isPrivateChatId('@oxeio_team')).toBe(false);
  });

  it('⚠️ চেনা না গেলে "ব্যক্তিগত" বলা হয় না — জানি না মানে জানি না', () => {
    expect(isPrivateChatId('abc')).toBe(false);
    expect(isPrivateChatId('+8801700000000')).toBe(false);
    expect(isPrivateChatId('')).toBe(false);
  });
});

describe('weeklyGateOf — কখন সারাংশ যাবে না', () => {
  it('ব্যক্তিগত চ্যাট হলে যায়', () => {
    expect(weeklyGateOf('123456789', undefined)).toEqual({
      send: true,
      blockedBecause: null,
    });
  });

  it('⚠️⚠️ গ্রুপ হলে যায় না, আর কারণটা সবসময় লেখা থাকে', () => {
    const gate = weeklyGateOf('-1001234567890', undefined);

    expect(gate.send).toBe(false);
    expect(gate.blockedBecause).toContain('WEEKLY_DIGEST_ALLOW_GROUP=true');
    // ⚠️ কী করলে চালু হবে, দুটো পথই লেখা থাকে — নীরব বাধা নয়
    expect(gate.blockedBecause).toContain('TELEGRAM_CHAT_ID');
  });

  it('⚠️ কারণের লাইনে chat id নিজে **কখনো** যায় না', () => {
    const gate = weeklyGateOf('-1009999999999', undefined);

    expect(gate.blockedBecause).not.toContain('9999999999');
  });

  it('⭐ `WEEKLY_DIGEST_ALLOW_GROUP=true` দিলে মালিকের সিদ্ধান্তই চলে', () => {
    expect(weeklyGateOf('-1001234567890', 'true').send).toBe(true);
    expect(weeklyGateOf('-1001234567890', '  TRUE ').send).toBe(true);
  });

  it('⚠️ `true` ছাড়া আর কিছুতেই প্রহরী খোলে না', () => {
    for (const raw of ['1', 'yes', 'on', 'True!', '', undefined]) {
      expect(weeklyGateOf('-1001234567890', raw).send).toBe(false);
    }
  });

  it('⚠️ chat id খালি হলে এই ফাংশন কোনো সিদ্ধান্ত নেয় না', () => {
    // ⭐ "কনফিগার করা হয়নি" বলার একমাত্র জায়গা `TelegramChannel`;
    //    এখানে আটকালে লগে ভুল কারণ লেখা হতো
    expect(weeklyGateOf(undefined, undefined).send).toBe(true);
    expect(weeklyGateOf('   ', undefined).send).toBe(true);
  });
});

describe('WeeklyDigestService — ⭐⭐ র‍্যাঙ্কিং গ্রুপে যায় না', () => {
  it('⚠️⚠️ গ্রুপ chat id হলে `send()` **ডাকাই হয় না**', async () => {
    const { service, sent } = makeService({
      env: { TELEGRAM_CHAT_ID: '-1001234567890' },
    });
    const logged: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).logger = { log: () => {}, warn: (m: string) => logged.push(m) };

    const result = await service.runOnce(AT_6_PM_FRIDAY);

    expect(sent).toHaveLength(0);
    // ⚠️ `not_configured` নয় — টোকেন ও chat id দুটোই আছে, কারণটা আলাদা
    expect(result.outcome).toBe('chat_not_private');
  });

  it('⭐ আটকালেও সপ্তাহটা হারায় না — পুরো বার্তা লগে যায়', async () => {
    const { service } = makeService({
      env: { TELEGRAM_CHAT_ID: '-1001234567890' },
    });
    const logged: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).logger = { log: () => {}, warn: (m: string) => logged.push(m) };

    await service.runOnce(AT_6_PM_FRIDAY);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('WEEKLY_DIGEST_ALLOW_GROUP=true');
    expect(logged[0]).toContain('48.00h recorded');
  });

  it('⭐ সংখ্যাগুলো তবু গোনা হয় — ফলটা আগের মতোই পূর্ণ', async () => {
    const { service } = makeService({
      env: { TELEGRAM_CHAT_ID: '-1001234567890' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).logger = { log: () => {}, warn: () => {} };

    await expect(service.runOnce(AT_6_PM_FRIDAY)).resolves.toMatchObject({
      from: '2026-08-08',
      employees: 1,
      withData: 1,
      outcome: 'chat_not_private',
    });
  });

  it('⭐ মালিক সজ্ঞানে অনুমতি দিলে গ্রুপেও যায়', async () => {
    const { service, sent } = makeService({
      env: {
        TELEGRAM_CHAT_ID: '-1001234567890',
        WEEKLY_DIGEST_ALLOW_GROUP: 'true',
      },
    });

    const result = await service.runOnce(AT_6_PM_FRIDAY);

    expect(sent).toHaveLength(1);
    expect(result.outcome).toBe('sent');
  });

  it('ব্যক্তিগত chat id হলে আগের মতোই যায়', async () => {
    const { service, sent } = makeService({
      env: { TELEGRAM_CHAT_ID: '123456789' },
    });

    await service.runOnce(AT_6_PM_FRIDAY);

    expect(sent).toHaveLength(1);
  });
});

describe('WeeklyDigestService — টেলিগ্রাম না থাকলে', () => {
  it('⚠️ ক্র্যাশ নয়, আর পুরো বার্তাটা লগে যায়', async () => {
    const { service } = makeService({ outcome: 'not_configured' });
    const logged: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).logger = {
      log: () => {},
      warn: (m: string) => logged.push(m),
    };

    const result = await service.runOnce(AT_6_PM_FRIDAY);

    expect(result.outcome).toBe('not_configured');
    // ⭐ সপ্তাহে একবারের বার্তা — লগে না রাখলে ওই সপ্তাহটা চিরতরে হারাত
    expect(logged[0]).toContain('Weekly summary');
    expect(logged[0]).toContain('48.00h recorded');
  });

  it('পাঠানো ব্যর্থ হলেও ফলটা একটা মান, ব্যতিক্রম নয়', async () => {
    const { service } = makeService({ outcome: 'failed' });

    await expect(service.runOnce(AT_6_PM_FRIDAY)).resolves.toMatchObject({
      outcome: 'failed',
      employees: 1,
      withData: 1,
    });
  });
});

describe('WeeklyDigestJob — কখনো throw করে না', () => {
  it('⭐ রিপোর্ট ৫০০ ছুড়লেও জব শান্তভাবে null ফেরায়', async () => {
    const { service } = makeService({
      reports: {
        summary: () => Promise.reject(new Error('no active work policy')),
      },
    });
    const job = new WeeklyDigestJob(service);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (job as any).logger = { log: () => {}, error: () => {} };

    await expect(job.runOnce(AT_6_PM_FRIDAY)).resolves.toBeNull();
  });

  it('সফল হলে ফলটাই ফেরে', async () => {
    const { service } = makeService();
    const job = new WeeklyDigestJob(service);

    await expect(job.runOnce(AT_6_PM_FRIDAY)).resolves.toMatchObject({
      from: '2026-08-08',
      to: TODAY_DATE,
      outcome: 'sent',
    });
  });

  it('⚠️ টেস্টে শিডিউলার বন্ধ — `scheduled()` কিছুই করে না', async () => {
    const { service, sent } = makeService();
    const job = new WeeklyDigestJob(service);

    await job.scheduled();

    expect(sent).toHaveLength(0);
  });
});
