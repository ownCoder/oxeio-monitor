import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { prorate } from './proration';
import {
  countWorkdays,
  hoursToSec,
  isWorkday,
  monthBounds,
  rollupMonth,
  summarizeDay,
  type Span,
} from './summary.math';

/** work policy না থাকলে স্পেকের ডিফল্ট (07 § ১) */
const DEFAULT_TARGET_HOURS = 208;

/**
 * ⚠️ পলিসি না থাকলে ২৬ — কারণ ২০৮ ÷ ২৬ = ৮ ঘণ্টা, স্পেকের দৈনিক টার্গেট।
 * দুটো ডিফল্ট আলাদা হয়ে গেলে দৈনিক টার্গেট নীরবে অন্য সংখ্যা হয়ে যেত।
 */
const DEFAULT_POLICY_WORKDAYS = 26;

interface EmployeePolicy {
  id: number;
  /** পলিসির মাসিক টার্গেট (২০৮ঘ) — ⚠️ এটা আর সরাসরি target_sec নয়, G37-এর পর */
  targetSec: number;
  /** পলিসির `expected_workdays` (২৬) — দৈনিক টার্গেট এটা দিয়েই ভাগ হয় */
  policyWorkdays: number;
  /** ISO দিন (শুক্র = ৫), null = প্রতিটি দিনই কর্মদিবস */
  weeklyOffDay: number | null;
  /** G37 — `null` = আগে থেকেই আছে / এখনো আছে */
  joinedOn: Date | null;
  leftOn: Date | null;
}

export interface RefreshResult {
  workDate: Date;
  employees: number;
}

/**
 * ⭐ `daily_summary` ও `monthly_summary` — rollup লেখার একমাত্র জায়গা।
 *
 * K06 (প্রতি ১৫ মিনিট) আর K05 (দিন-ক্লোজ) দুটোই এই একই কোড ডাকে। আলাদা
 * করে লিখলে দিন-ক্লোজে কোনো একটা কলাম অন্যভাবে হিসাব হতো, আর দিনের বেলার
 * সংখ্যা মাঝরাতে নীরবে বদলে যেত — যে বাগ ধরা পড়তে মাস লেগে যায়।
 *
 * ⚠️ এই সার্ভিস `activity_segments`-এ **কখনো হাত দেয় না**। কাঁচা ডেটা
 * অপরিবর্তনীয় (§ ২.১-ঙ, নিয়ম ৪) — সারাংশ যেকোনো সময় শূন্য থেকে আবার
 * বানানো যায়, আর সেজন্যই upsert, insert নয়।
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ঢাকার আজকের কর্মদিবস — K06-এর প্রবেশপথ। */
  refreshToday(now: Date = new Date()): Promise<RefreshResult> {
    return this.refreshDate(workDateOf(now), now);
  }

  /**
   * একটা কর্মদিবসের সারাংশ নতুন করে বসায়, তারপর ওই দিনের মাসটাও।
   *
   * ⚠️ **সব active কর্মীর** জন্য চলে, শুধু যাদের ডেটা আছে তাদের নয়। খরচ
   * নগণ্য (১৫ জন), আর বিনিময়ে যে দিন কেউ একেবারেই কাজ করেনি সেদিনও একটা
   * `no_activity` সারি তৈরি হয় — হিটম্যাপে ওই ফাঁকা ঘরটা তখন "ডেটা আসেনি"
   * নাকি "কাজ হয়নি" সেই সন্দেহ আর থাকে না।
   */
  async refreshDate(
    workDate: Date,
    now: Date = new Date(),
  ): Promise<RefreshResult> {
    const employees = await this.activeEmployees();
    if (employees.length === 0) {
      return { workDate, employees: 0 };
    }

    const ids = employees.map((e) => e.id);

    const [segments, shots, adjustments, usage, holiday] = await Promise.all([
      this.prisma.activitySegment.findMany({
        where: { workDate, employeeId: { in: ids } },
        select: {
          employeeId: true,
          state: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
        },
      }),
      this.prisma.screenshot.groupBy({
        by: ['employeeId'],
        // ⚠️ retention যেগুলো মুছে ফেলার জন্য মার্ক করেছে সেগুলো বাদ —
        //    গ্যালারিতে যা দেখা যায় না, গোনাতেও তা থাকা উচিত নয়
        where: { workDate, employeeId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.timeAdjustment.groupBy({
        by: ['employeeId'],
        // ⚠️ revoke করা সংশোধন বাদ (§ ২.১-ঙ) — ডিলিট হয় না, তাই ফিল্টারই ভরসা
        where: { workDate, employeeId: { in: ids }, revokedAt: null },
        _sum: { deltaSec: true },
      }),
      this.prisma.appUsage.findMany({
        where: { workDate, employeeId: { in: ids }, categoryId: { not: null } },
        select: {
          employeeId: true,
          startedAt: true,
          endedAt: true,
          category: { select: { category: true } },
        },
      }),
      this.prisma.holiday.findUnique({ where: { holidayDate: workDate } }),
    ]);

    const segmentsBy = groupBy(segments, (s) => s.employeeId);
    const shotsBy = new Map(shots.map((s) => [s.employeeId, s._count._all]));
    const adjustBy = new Map(
      adjustments.map((a) => [a.employeeId, a._sum.deltaSec ?? 0]),
    );

    const productiveBy = new Map<number, Span[]>();
    const unproductiveBy = new Map<number, Span[]>();
    for (const u of usage) {
      const bucket =
        u.category?.category === 'productive'
          ? productiveBy
          : u.category?.category === 'unproductive'
            ? unproductiveBy
            : null;
      // neutral আর ক্যাটাগরিহীন — দুটোই productivity ভগ্নাংশের বাইরে
      if (bucket === null) continue;
      push(bucket, u.employeeId, u);
    }

    const holidays = new Set(holiday ? [workDate.getTime()] : []);

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const e of employees) {
      const numbers = summarizeDay({
        segments: segmentsBy.get(e.id) ?? [],
        screenshotCount: shotsBy.get(e.id) ?? 0,
        adjustmentSec: adjustBy.get(e.id) ?? 0,
        productiveSpans: productiveBy.get(e.id) ?? [],
        unproductiveSpans: unproductiveBy.get(e.id) ?? [],
        isOffDay: !isWorkday(workDate, e.weeklyOffDay, holidays),
      });

      ops.push(
        this.prisma.dailySummary.upsert({
          where: { employeeId_workDate: { employeeId: e.id, workDate } },
          create: { employeeId: e.id, workDate, ...numbers, computedAt: now },
          update: { ...numbers, computedAt: now },
        }),
      );
    }

    // এক ট্রানজেকশনে — ১৫টা আলাদা রাউন্ড-ট্রিপের বদলে একটাই, আর ড্যাশবোর্ড
    // কখনো "অর্ধেক কর্মীর হালনাগাদ, বাকিদের পুরোনো" অবস্থায় দেখে না
    await this.prisma.$transaction(ops);

    await this.refreshMonth(workDate, employees, now);

    return { workDate, employees: employees.length };
  }

  /**
   * ওই তারিখ যে মাসে পড়ে, সেই মাসের rollup।
   *
   * ⚠️ মাস বের হয় **`workDate` থেকে, `now` থেকে নয়**। ১ তারিখ রাত ০০:১৫-তে
   * দিন-ক্লোজ আগের মাসের শেষ দিনটা বন্ধ করে; `now` ধরলে হালনাগাদ হতো সদ্য
   * শুরু হওয়া নতুন মাসের সারিতে, আর আগের মাসের শেষ দিনের ঘণ্টা পে-রোলে
   * কোনোদিনই যোগ হতো না।
   */
  private async refreshMonth(
    workDate: Date,
    employees: readonly EmployeePolicy[],
    now: Date,
  ): Promise<void> {
    const { start, end, yearMonth } = monthBounds(workDate);
    const ids = employees.map((e) => e.id);

    const [days, holidayRows, existing] = await Promise.all([
      this.prisma.dailySummary.findMany({
        where: { employeeId: { in: ids }, workDate: { gte: start, lte: end } },
        select: {
          employeeId: true,
          workedSec: true,
          adjustmentSec: true,
        },
      }),
      this.prisma.holiday.findMany({
        where: { holidayDate: { gte: start, lte: end } },
        select: { holidayDate: true },
      }),
      this.prisma.monthlySummary.findMany({
        where: { employeeId: { in: ids }, yearMonth },
        select: { employeeId: true, targetMetAt: true },
      }),
    ]);

    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));
    const daysBy = groupBy(days, (d) => d.employeeId);
    const metAtBy = new Map(existing.map((m) => [m.employeeId, m.targetMetAt]));

    // "আজ পর্যন্ত" — তবে পুরোনো মাস হালনাগাদ করলে মাসের শেষ দিন পর্যন্ত,
    // নইলে গত মাসের workdays_elapsed চিরকাল পুরো মাস ছাড়িয়ে যেত
    const today = workDateOf(now);
    const elapsedTo = today < start ? null : today > end ? end : today;

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const e of employees) {
      const rows = daysBy.get(e.id) ?? [];

      /**
       * ⭐⭐ **G37 · ADR-025** — টার্গেট আর ফ্ল্যাট ২০৮ নয়, **তার কর্মদিবস
       * × দৈনিক টার্গেট**। যে ১৫ তারিখে যোগ দিয়েছে তার টার্গেট ১৪ × ৮।
       *
       * ⚠️ `expectedWorkdays` কলামটার **মানে এখানেই বদলায়** — "মাসের
       * কর্মদিবস" থেকে "তার কর্মদিবস"। D আলাদা কলামে যায়, কারণ পে-রোলে
       * d ÷ D লাগে আর দুটো একই সময়ের হিসাব হওয়া চাই।
       */
      const p = prorate({
        monthStart: start,
        monthEnd: end,
        joinedOn: e.joinedOn,
        leftOn: e.leftOn,
        weeklyOffDay: e.weeklyOffDay,
        holidays,
        monthlyTargetSec: e.targetSec,
        policyWorkdays: e.policyWorkdays,
      });

      /**
       * ⚠️ `workdaysElapsed`-ও তার কর্মকালের ভেতরেই গোনা হয়। নইলে ১৫
       * তারিখে যোগ দেওয়া কর্মী মাসের শুরু থেকে "পিছিয়ে" দেখাত — প্রথম
       * দিনেই ৮০ ঘণ্টা ঘাটতি নিয়ে শুরু করত।
       */
      const elapsedFrom =
        e.joinedOn !== null && e.joinedOn.getTime() > start.getTime()
          ? e.joinedOn
          : start;

      const elapsedEnd =
        e.leftOn !== null && elapsedTo !== null && e.leftOn.getTime() < elapsedTo.getTime()
          ? e.leftOn
          : elapsedTo;

      const numbers = rollupMonth({
        workedSec: sum(rows.map((r) => r.workedSec)),
        adjustmentSec: sum(rows.map((r) => r.adjustmentSec)),
        targetSec: p.targetSec,
        expectedWorkdays: p.employeeWorkdays,
        monthWorkdays: p.monthWorkdays,
        workdaysElapsed:
          elapsedEnd === null || elapsedFrom.getTime() > elapsedEnd.getTime()
            ? 0
            : countWorkdays(elapsedFrom, elapsedEnd, e.weeklyOffDay, holidays),
        daysWithWork: rows.filter((r) => r.workedSec > 0).length,
      });

      /**
       * ⭐ প্রথমবার টার্গেট ছোঁয়ার সময়টা ধরে রাখা হয় — বারবার লেখা হয় না,
       * নইলে প্রতি ১৫ মিনিটে "এইমাত্র টার্গেট পূরণ হলো" হয়ে যেত।
       *
       * ⚠️ আবার টার্গেটের নিচে নেমে গেলে (কোনো সংশোধন revoke হলে) সময়টা
       * মুছে দেওয়া হয়। রেখে দিলে সারিটা এমন একটা অর্জনের দাবি করত যেটা
       * আর সত্যি নয়।
       */
      const targetMetAt = numbers.targetMet
        ? (metAtBy.get(e.id) ?? now)
        : null;

      ops.push(
        this.prisma.monthlySummary.upsert({
          where: { employeeId_yearMonth: { employeeId: e.id, yearMonth } },
          create: {
            employeeId: e.id,
            yearMonth,
            ...numbers,
            targetMetAt,
            computedAt: now,
          },
          update: { ...numbers, targetMetAt, computedAt: now },
        }),
      );
    }

    await this.prisma.$transaction(ops);
  }

  /**
   * ⚠️ শুধু `active` কর্মী — `payroll.service.ts`-এর মতোই। চলে যাওয়া কারো
   * পুরোনো rollup সারি থেকে যায় (রিপোর্টের জন্য দরকার), কিন্তু নতুন করে
   * হিসাব হয় না — তাঁর তো আর ডেটাই আসছে না।
   */
  private async activeEmployees(): Promise<EmployeePolicy[]> {
    const rows = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        joinedOn: true,
        leftOn: true,
        policy: {
          select: {
            monthlyTargetHours: true,
            weeklyOffDay: true,
            expectedWorkdays: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      targetSec: hoursToSec(
        Number(r.policy?.monthlyTargetHours ?? DEFAULT_TARGET_HOURS),
      ),
      policyWorkdays: r.policy?.expectedWorkdays ?? DEFAULT_POLICY_WORKDAYS,
      weeklyOffDay: r.policy?.weeklyOffDay ?? null,
      joinedOn: r.joinedOn,
      leftOn: r.leftOn,
    }));
  }
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) push(map, key(row), row);
  return map;
}

function push<T>(map: Map<number, T[]>, key: number, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
