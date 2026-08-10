import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EmployeeStatus, Productivity } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProductivityQuery, ReportRangeQuery, SummaryQuery } from './dto';
import { reportFilename } from './reports.excel';
import {
  attendanceWorkbook,
  productivityWorkbook,
  summaryWorkbook,
} from './reports.sheets';
import {
  bucketOf,
  countWorkdays,
  dailyTargetSec,
  eachDate,
  isoDayOf,
  isWorkday,
  monthBoundsOf,
  monthKeyOf,
  monthsIn,
  parseReportRange,
  secondsToHours,
  sharePct,
  toIsoDate,
  weekStartIsoDay,
  type GroupBy,
  type ReportRange,
  type WorkdayRule,
} from './reports.range';
import {
  OVERTIME_NOTE,
  type AttendanceReport,
  type AttendanceRow,
  type DayType,
  type ProductivityEmployeeRow,
  type ProductivityItem,
  type ProductivityReport,
  type ReportFile,
  type ReportMeta,
  type SummaryReport,
  type SummaryRow,
  type UsageCategory,
} from './reports.types';

const HOUR = 3600;
const DEFAULT_TOP = 25;

// ── ভেতরের সহায়ক টাইপ ──────────────────────────────────────────────────────

interface ResolvedEmployee {
  id: number;
  empCode: string;
  fullName: string;
  department: string | null;
  joinedOn: Date | null;
  leftOn: Date | null;
  monthlyTargetSec: number;
  weeklyOffDay: number | null;
}

interface ReportContext {
  range: ReportRange;
  employees: ResolvedEmployee[];
  excluded: string[];
  /** ওই কর্মীর ওই দিনের টার্গেট, সেকেন্ডে (ছুটির দিনে ০) */
  targetSecOf(employee: ResolvedEmployee, date: Date): number;
  ruleOf(employee: ResolvedEmployee): WorkdayRule;
  employedOn(employee: ResolvedEmployee, date: Date): boolean;
}

/**
 * F01–F02/F04/F05/F08 — রিপোর্ট ও Excel এক্সপোর্ট।
 *
 * ⚠️ এখানে **কোনো টাকার হিসাব নেই**। বেতন-সংক্রান্ত সবকিছু `src/payroll/`-এ,
 *    আর সেখানেই `monthly_salary` পড়া হয় — ম্যানেজারও এই রিপোর্টগুলো দেখেন
 *    (§ ৪.৩), তাই এখানে একটা টাকার কলাম ঢুকলেই বেতন ফাঁস হতো।
 *
 * ⚠️ **ক্যাটাগরি কখনো বেতনের হিসাবে ঢোকে না** — F04-এর productive/unproductive
 *    ভাগ শুধু দেখার জন্য; `worked_sec`, `credited_sec` বা টার্গেটে এর কোনো
 *    প্রভাব নেই।
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── F01 · অ্যাটেনডেন্স ────────────────────────────────────────────────────

  async attendance(q: ReportRangeQuery): Promise<AttendanceReport> {
    const ctx = await this.context(q);
    const { range } = ctx;

    const daily = await this.prisma.dailySummary.findMany({
      where: {
        employeeId: { in: ctx.employees.map((e) => e.id) },
        workDate: { gte: range.from, lte: range.to },
      },
      select: {
        employeeId: true,
        workDate: true,
        workedSec: true,
        idleSec: true,
        adjustmentSec: true,
        creditedSec: true,
      },
    });

    const byKey = new Map(
      daily.map((d) => [`${d.employeeId}|${d.workDate.getTime()}`, d]),
    );

    const dates = eachDate(range.from, range.to);
    const rows: AttendanceRow[] = [];
    let workedSec = 0;
    let creditedSec = 0;
    let targetSec = 0;
    let daysWithWork = 0;

    for (const employee of ctx.employees) {
      const rule = ctx.ruleOf(employee);

      for (const date of dates) {
        // ⚠️ যোগ দেওয়ার আগের বা ছেড়ে যাওয়ার পরের দিনগুলো সারি হিসেবেই
        //    আসে না। নইলে ২০ তারিখে যোগ দেওয়া কর্মীর নামে ১৯ দিনের
        //    "কোনো কাজ নেই" আর পুরো টার্গেট বসে যেত।
        if (!ctx.employedOn(employee, date)) continue;

        const summary = byKey.get(`${employee.id}|${date.getTime()}`);
        const dayTarget = ctx.targetSecOf(employee, date);
        const worked = summary?.workedSec ?? 0;
        const credited = summary?.creditedSec ?? 0;

        rows.push({
          employeeId: employee.id,
          empCode: employee.empCode,
          fullName: employee.fullName,
          department: employee.department,
          date: toIsoDate(date),
          dayType: dayTypeOf(date, rule),
          // ⭐ ডেটা না থাকা আর কাজ না করা — রিপোর্টে দুটোই "কোনো কাজ নেই"।
          //    তবু সারিটা **থাকে**: অনুপস্থিতি বাদ দিয়ে দিলে সেটা রিপোর্টে
          //    "তথ্য নেই" নয়, একেবারে অদৃশ্য হয়ে যেত।
          status: worked > 0 ? 'worked' : 'no_activity',
          workedHours: secondsToHours(worked),
          idleHours: secondsToHours(summary?.idleSec ?? 0),
          adjustmentHours: secondsToHours(summary?.adjustmentSec ?? 0),
          creditedHours: secondsToHours(credited),
          targetHours: secondsToHours(dayTarget),
        });

        workedSec += worked;
        creditedSec += credited;
        targetSec += dayTarget;
        if (worked > 0) daysWithWork += 1;
      }
    }

    return {
      meta: metaOf(ctx),
      rows,
      totals: {
        employees: ctx.employees.length,
        rows: rows.length,
        workedHours: secondsToHours(workedSec),
        creditedHours: secondsToHours(creditedSec),
        targetHours: secondsToHours(targetSec),
        daysWithWork,
      },
    };
  }

  async attendanceFile(
    q: ReportRangeQuery,
    actorUserId: number,
    ip: string,
  ): Promise<ReportFile> {
    const report = await this.attendance(q);
    const buffer = await attendanceWorkbook(report);

    await this.recordExport('attendance', report.meta, report.rows.length, {
      actorUserId,
      ip,
    });

    return {
      filename: reportFilename('attendance', report.meta.from, report.meta.to),
      buffer,
    };
  }

  // ── F02 · সাপ্তাহিক / মাসিক সারাংশ ────────────────────────────────────────

  async summary(q: SummaryQuery): Promise<SummaryReport> {
    const ctx = await this.context(q);
    const { range } = ctx;
    const groupBy: GroupBy = q.groupBy ?? 'month';

    const daily = await this.prisma.dailySummary.findMany({
      where: {
        employeeId: { in: ctx.employees.map((e) => e.id) },
        workDate: { gte: range.from, lte: range.to },
      },
      select: {
        employeeId: true,
        workDate: true,
        workedSec: true,
        adjustmentSec: true,
        creditedSec: true,
      },
    });

    const byKey = new Map(
      daily.map((d) => [`${d.employeeId}|${d.workDate.getTime()}`, d]),
    );

    const dates = eachDate(range.from, range.to);
    const rows: SummaryRow[] = [];

    for (const employee of ctx.employees) {
      const weekStart = weekStartIsoDay(employee.weeklyOffDay);
      const rule = ctx.ruleOf(employee);

      /** বালতির চাবি → জমতে থাকা হিসাব */
      const buckets = new Map<
        string,
        {
          start: Date;
          end: Date;
          workdays: number;
          daysWithWork: number;
          workedSec: number;
          adjustmentSec: number;
          creditedSec: number;
          targetSec: number;
        }
      >();

      for (const date of dates) {
        if (!ctx.employedOn(employee, date)) continue;

        const bucket = bucketOf(date, groupBy, weekStart);
        let acc = buckets.get(bucket.key);
        if (!acc) {
          acc = {
            // ⚠️ বালতির নিজের সীমা নয়, **যতটুকু আসলে হিসাবে এসেছে** সেটাই
            //    দেখানো হয়। ১০ আগস্ট থেকে শুরু হওয়া রিপোর্টে '2026-08'
            //    বালতির শুরু ১ আগস্ট লিখলে পাঠক ভাবতেন পুরো মাসের হিসাব
            //    হাতে আছে, অথচ টার্গেট গোনা হয়েছে মাত্র ২২ দিনের।
            start: date,
            end: date,
            workdays: 0,
            daysWithWork: 0,
            workedSec: 0,
            adjustmentSec: 0,
            creditedSec: 0,
            targetSec: 0,
          };
          buckets.set(bucket.key, acc);
        }
        acc.end = date;

        const summary = byKey.get(`${employee.id}|${date.getTime()}`);
        acc.workedSec += summary?.workedSec ?? 0;
        acc.adjustmentSec += summary?.adjustmentSec ?? 0;
        acc.creditedSec += summary?.creditedSec ?? 0;
        acc.targetSec += ctx.targetSecOf(employee, date);
        if (isWorkday(date, rule)) acc.workdays += 1;
        if ((summary?.workedSec ?? 0) > 0) acc.daysWithWork += 1;
      }

      for (const [key, acc] of [...buckets].sort(([a], [b]) =>
        a < b ? -1 : 1,
      )) {
        rows.push({
          employeeId: employee.id,
          empCode: employee.empCode,
          fullName: employee.fullName,
          bucket: key,
          bucketStart: toIsoDate(acc.start),
          bucketEnd: toIsoDate(acc.end),
          workdays: acc.workdays,
          daysWithWork: acc.daysWithWork,
          workedHours: secondsToHours(acc.workedSec),
          adjustmentHours: secondsToHours(acc.adjustmentSec),
          creditedHours: secondsToHours(acc.creditedSec),
          targetHours: secondsToHours(acc.targetSec),
          // ⚠️ ঘাটতি ও অতিরিক্ত মেলানো হয় `credited_sec`-এর সাথে,
          //    `worked_sec`-এর সাথে নয় (§ ২.১-ঙ) — নইলে owner-এর দেওয়া
          //    সংশোধন রিপোর্টে উধাও হয়ে যেত।
          shortfallHours: secondsToHours(
            Math.max(0, acc.targetSec - acc.creditedSec),
          ),
          overtimeHours: secondsToHours(
            Math.max(0, acc.creditedSec - acc.targetSec),
          ),
        });
      }
    }

    return { meta: metaOf(ctx), groupBy, overtimeNote: OVERTIME_NOTE, rows };
  }

  async summaryFile(
    q: SummaryQuery,
    actorUserId: number,
    ip: string,
  ): Promise<ReportFile> {
    const report = await this.summary(q);
    const buffer = await summaryWorkbook(report);

    await this.recordExport('summary', report.meta, report.rows.length, {
      actorUserId,
      ip,
    });

    return {
      filename: reportFilename('summary', report.meta.from, report.meta.to),
      buffer,
    };
  }

  // ── F04 · productivity ────────────────────────────────────────────────────

  /**
   * ⚠️ `window_title` কখনো select করা হয় না, আর ফুল URL কোথাও নেই — শুধু
   *    `domain` (ADR-013)। টাইটেলে প্রায়ই পুরো লিংক বা ব্যক্তিগত ডকুমেন্টের
   *    নাম থাকে; রিপোর্টে সেটা এলে ডোমেইন-only নিয়মটা কার্যত ফাঁকা হয়ে যেত।
   *
   * ⚠️ দুই ডিভাইস একসাথে চললে এখানে সময় দুইবার যোগ হতে পারে (§ ২.১-গ-র
   *    UNION এখানে করা হয় না — এক বছরের রেঞ্জে লক্ষ সারি মেমরিতে টানতে হতো)।
   *    ⭐ এতে কারো **টাকার** হিসাব নড়ে না: বেতন যায় `credited_sec` ধরে, আর
   *    ওটা rollup-এ UNION করেই বসানো — এই রিপোর্ট শুধু "সময় কোথায় যাচ্ছে"
   *    দেখায়।
   */
  async productivity(q: ProductivityQuery): Promise<ProductivityReport> {
    const ctx = await this.context(q);
    const ids = ctx.employees.map((e) => e.id);
    const where = {
      employeeId: { in: ids },
      workDate: { gte: ctx.range.from, lte: ctx.range.to },
    };

    const [byApp, byEmployee] = await Promise.all([
      this.prisma.appUsage.groupBy({
        by: ['processName', 'domain', 'categoryId'],
        where,
        _sum: { durationSec: true },
      }),
      this.prisma.appUsage.groupBy({
        by: ['employeeId', 'categoryId'],
        where,
        _sum: { durationSec: true },
      }),
    ]);

    const categoryIds = [
      ...new Set(
        [...byApp, ...byEmployee]
          .map((r) => r.categoryId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const categories = await this.prisma.appCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, category: true, displayName: true },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    // ── টপ অ্যাপ/সাইট
    const items = new Map<
      string,
      {
        kind: 'app' | 'site';
        category: UsageCategory;
        displayName: string | null;
        sec: number;
      }
    >();
    let totalSec = 0;

    for (const row of byApp) {
      const sec = row._sum.durationSec ?? 0;
      if (sec <= 0) continue;
      totalSec += sec;

      const site =
        row.domain !== null && row.domain.length > 0 ? row.domain : null;
      const key = site ?? row.processName;
      const rule =
        row.categoryId === null ? null : categoryById.get(row.categoryId);

      const existing = items.get(key);
      if (existing) {
        existing.sec += sec;
        // ⚠️ একই ডোমেইন recategorize-এর আগে-পরে দুই সারিতে আসতে পারে
        //    (একটায় categoryId null)। চিহ্নিত ভাগটাই জেতে, নইলে
        //    সদ্য-নিয়ম-পাওয়া সাইট আবার "অচিহ্নিত" দেখাত।
        if (existing.category === 'uncategorized' && rule) {
          existing.category = rule.category;
          existing.displayName = rule.displayName;
        }
        continue;
      }

      items.set(key, {
        kind: site === null ? 'app' : 'site',
        category: rule?.category ?? 'uncategorized',
        displayName: rule?.displayName ?? null,
        sec,
      });
    }

    const top: ProductivityItem[] = [...items]
      .sort(([, a], [, b]) => b.sec - a.sec)
      .slice(0, q.limit ?? DEFAULT_TOP)
      .map(([key, v]) => ({
        key,
        kind: v.kind,
        category: v.category,
        displayName: v.displayName,
        hours: secondsToHours(v.sec),
        sharePct: sharePct(v.sec, totalSec),
      }));

    // ── কর্মীভিত্তিক ভাগ
    const perEmployee = new Map<
      number,
      {
        productive: number;
        neutral: number;
        unproductive: number;
        uncategorized: number;
      }
    >();

    for (const row of byEmployee) {
      const sec = row._sum.durationSec ?? 0;
      if (sec <= 0) continue;

      let acc = perEmployee.get(row.employeeId);
      if (!acc) {
        acc = { productive: 0, neutral: 0, unproductive: 0, uncategorized: 0 };
        perEmployee.set(row.employeeId, acc);
      }

      const rule =
        row.categoryId === null ? null : categoryById.get(row.categoryId);
      switch (rule?.category) {
        case Productivity.productive:
          acc.productive += sec;
          break;
        case Productivity.unproductive:
          acc.unproductive += sec;
          break;
        case Productivity.neutral:
          acc.neutral += sec;
          break;
        default:
          acc.uncategorized += sec;
      }
    }

    let uncategorizedSec = 0;
    const rows: ProductivityEmployeeRow[] = ctx.employees.map((employee) => {
      const acc = perEmployee.get(employee.id) ?? {
        productive: 0,
        neutral: 0,
        unproductive: 0,
        uncategorized: 0,
      };
      const tracked =
        acc.productive + acc.neutral + acc.unproductive + acc.uncategorized;
      uncategorizedSec += acc.uncategorized;

      return {
        employeeId: employee.id,
        empCode: employee.empCode,
        fullName: employee.fullName,
        productiveHours: secondsToHours(acc.productive),
        neutralHours: secondsToHours(acc.neutral),
        unproductiveHours: secondsToHours(acc.unproductive),
        uncategorizedHours: secondsToHours(acc.uncategorized),
        trackedHours: secondsToHours(tracked),
        productiveSharePct: sharePct(acc.productive, tracked),
      };
    });

    return {
      meta: metaOf(ctx),
      totalTrackedHours: secondsToHours(totalSec),
      uncategorizedHours: secondsToHours(uncategorizedSec),
      top,
      byEmployee: rows,
    };
  }

  async productivityFile(
    q: ProductivityQuery,
    actorUserId: number,
    ip: string,
  ): Promise<ReportFile> {
    const report = await this.productivity(q);
    const buffer = await productivityWorkbook(report);

    await this.recordExport('productivity', report.meta, report.top.length, {
      actorUserId,
      ip,
    });

    return {
      filename: reportFilename(
        'productivity',
        report.meta.from,
        report.meta.to,
      ),
      buffer,
    };
  }

  // ── সাধারণ অংশ ────────────────────────────────────────────────────────────

  /**
   * তিনটি রিপোর্টেরই ভিত্তি: যাচাই করা রেঞ্জ, কর্মীর তালিকা, ছুটির ক্যালেন্ডার
   * এবং প্রতিটি দিনের টার্গেট।
   */
  private async context(q: ReportRangeQuery): Promise<ReportContext> {
    let range: ReportRange;
    try {
      range = parseReportRange(q.from, q.to);
    } catch (err) {
      // খাঁটি ফাংশন RangeError ছোড়ে (payroll.math-এর মতো); HTTP-র ভাষায়
      // অনুবাদ শুধু এখানেই হয়
      if (err instanceof RangeError) throw new BadRequestException(err.message);
      throw err;
    }

    const [employeeRows, defaultPolicy] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          ...(q.employeeId === undefined ? {} : { id: q.employeeId }),
          AND: [
            { OR: [{ joinedOn: null }, { joinedOn: { lte: range.to } }] },
            { OR: [{ leftOn: null }, { leftOn: { gte: range.from } }] },
          ],
        },
        select: {
          id: true,
          empCode: true,
          fullName: true,
          department: true,
          status: true,
          joinedOn: true,
          leftOn: true,
          // ⚠️ `monthlySalary` এখানে **নেই** এবং কখনো যোগ করা যাবে না —
          //    ম্যানেজারও এই endpoint ডাকেন
          policy: {
            select: { monthlyTargetHours: true, weeklyOffDay: true },
          },
        },
        orderBy: { empCode: 'asc' },
      }),
      this.prisma.workPolicy.findFirst({
        where: { isActive: true },
        orderBy: { id: 'asc' },
        select: { monthlyTargetHours: true, weeklyOffDay: true },
      }),
    ]);

    const employees: ResolvedEmployee[] = [];
    const excluded: string[] = [];

    for (const e of employeeRows) {
      // ⚠️ inactive অথচ `left_on` খালি — কবে থেকে ছিলেন না তা জানা নেই, তাই
      //    রেঞ্জজুড়ে শূন্য সারি বসিয়ে দিলে ভুল ছবি দাঁড়াত। বাদ যান, কিন্তু
      //    নাম meta-তে যায়।
      if (e.status === EmployeeStatus.inactive && e.leftOn === null) {
        excluded.push(e.fullName);
        continue;
      }

      const policy = e.policy ?? defaultPolicy;
      if (!policy) {
        // ⭐ ২০৮ ধরে নেওয়া হয় না। কোনো policy না থাকলে টার্গেট **অজানা**,
        //    আর অজানা টার্গেট দিয়ে ঘাটতি ছাপা মানে নীরবে একটা নীতি বানিয়ে ফেলা।
        throw new InternalServerErrorException(
          'কোনো active work policy নেই — টার্গেট বের করা যাচ্ছে না',
        );
      }

      employees.push({
        id: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        department: e.department,
        joinedOn: e.joinedOn,
        leftOn: e.leftOn,
        monthlyTargetSec: Number(policy.monthlyTargetHours) * HOUR,
        weeklyOffDay: policy.weeklyOffDay,
      });
    }

    if (excluded.length > 0) {
      this.logger.warn(
        `${excluded.length} জন inactive কর্মীর left_on নেই — রিপোর্টে আসেননি`,
      );
    }

    // ⚠️ ছুটি আনা হয় **পুরো মাসগুলোর** জন্য, শুধু রেঞ্জের জন্য নয় — দৈনিক
    //    টার্গেটের হর ওই মাসের মোট কর্মদিবস (§ ২.১-খ)।
    const months = monthsIn(range.from, range.to);
    const holidayRows = await this.prisma.holiday.findMany({
      where: {
        holidayDate: {
          gte: months[0].first,
          lte: months[months.length - 1].last,
        },
      },
      select: { holidayDate: true },
    });
    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    // একই নীতির কর্মীরা একই সংখ্যা ভাগ করে নেন — মাসে একবারই গোনা হয়
    const workdayCache = new Map<string, number>();
    const workdaysInMonth = (
      date: Date,
      weeklyOffDay: number | null,
    ): number => {
      const key = `${monthKeyOf(date)}|${weeklyOffDay ?? '-'}`;
      const cached = workdayCache.get(key);
      if (cached !== undefined) return cached;

      const { first, last } = monthBoundsOf(date);
      const count = countWorkdays(first, last, { weeklyOffDay, holidays });
      workdayCache.set(key, count);
      return count;
    };

    const ruleOf = (employee: ResolvedEmployee): WorkdayRule => ({
      weeklyOffDay: employee.weeklyOffDay,
      holidays,
    });

    return {
      range,
      employees,
      excluded,
      ruleOf,
      employedOn: (employee, date) =>
        (employee.joinedOn === null ||
          date.getTime() >= employee.joinedOn.getTime()) &&
        (employee.leftOn === null ||
          date.getTime() <= employee.leftOn.getTime()),
      targetSecOf: (employee, date) =>
        isWorkday(date, ruleOf(employee))
          ? dailyTargetSec(
              employee.monthlyTargetSec,
              workdaysInMonth(date, employee.weeklyOffDay),
            )
          : 0,
    };
  }

  /** ⭐ এক্সপোর্ট একটা ঘটনা — কে কোন রেঞ্জ নামিয়ে নিল, লেখা থাকবে (§ ৭) */
  private async recordExport(
    report: string,
    meta: ReportMeta,
    rows: number,
    actor: { actorUserId: number; ip: string },
  ): Promise<void> {
    await this.audit.record({
      userId: actor.actorUserId,
      action: 'export_report',
      targetType: 'report',
      targetId: report,
      ipAddress: actor.ip,
      meta: { from: meta.from, to: meta.to, rows, format: 'xlsx' },
    });
  }
}

// ── ছোট সহায়ক ───────────────────────────────────────────────────────────────

/**
 * ⭐ দিনের ধরন আর "কাজ হয়েছে কি না" আলাদা দুটি কলাম। এক কলামে মিলিয়ে দিলে
 * ছুটির দিনে করা কাজ হয় "ছুটি" হয়ে হারিয়ে যেত, নয়তো "কাজ হয়েছে" হয়ে
 * ছুটির তথ্যটাই মুছে যেত। ছুটির দিনে ঘণ্টা পুরোপুরি গোনা হয়, কিন্তু
 * টার্গেট ০ — তাই ওই দিনটা সরাসরি অতিরিক্ত হয়ে যায় (§ ২.১-খ, এটাই কাম্য)।
 */
function dayTypeOf(date: Date, rule: WorkdayRule): DayType {
  if (rule.holidays.has(date.getTime())) return 'holiday';
  if (rule.weeklyOffDay !== null && isoDayOf(date) === rule.weeklyOffDay) {
    return 'weekly_off';
  }
  return 'workday';
}

function metaOf(ctx: ReportContext): ReportMeta {
  return {
    from: toIsoDate(ctx.range.from),
    to: toIsoDate(ctx.range.to),
    requestedTo: toIsoDate(ctx.range.requestedTo),
    clampedToToday: ctx.range.clampedToToday,
    days: ctx.range.days,
    generatedAt: new Date().toISOString(),
    excludedEmployees: ctx.excluded,
  };
}
