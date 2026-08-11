import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmployeeStatus, type Productivity } from '@prisma/client';

import {
  addSeconds,
  emptyBuckets,
  foldUsage,
  scoreOf,
  type CategoryMeta,
  type SecondBuckets,
  type UsageGroup,
  type UsageTally,
} from '../activity/activity.math';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProductivityQuery, ReportRangeQuery, SummaryQuery } from './dto';
import {
  MIME_OF,
  reportFilename,
  type DownloadFormat,
} from './reports.download';
import { attendancePdf, summaryPdf } from './reports.pages';
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
} from './reports.types';

const HOUR = 3600;
const DEFAULT_TOP = 25;

/**
 * লেটারহেডে ছাপা প্রতিষ্ঠানের নাম।
 * ⚠️ `ORG_NAME` না থাকলে ফাঁকা লেটারহেড নয় — অন্তত পণ্যের নামটা বসে,
 *    কারণ শিরোনামহীন একটা কাগজ কোন কোম্পানির তা কেউ বলতে পারত না।
 */
const DEFAULT_ORG_NAME = 'oXeio Monitoring';

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

  private readonly orgName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.orgName =
      config.get<string>('ORG_NAME')?.trim() || DEFAULT_ORG_NAME;
  }

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

  /**
   * F05 (xlsx) ও F06 (pdf) — একই রিপোর্ট, দুই মোড়ক।
   *
   * ⭐ দুটো ফরম্যাট **একই `attendance()` কল** থেকে বানানো হয়। আলাদা কোয়েরি
   * লিখলে একদিন একটা ফিল্টার শুধু একটাতে বসত, আর তখন একই রেঞ্জের Excel ও
   * PDF দুই রকম যোগফল দেখাত — যেটা রিপোর্টে হতে পারে এমন সবচেয়ে খারাপ ভুল।
   */
  async attendanceFile(
    q: ReportRangeQuery,
    format: DownloadFormat,
    actorUserId: number,
    ip: string,
  ): Promise<ReportFile> {
    const report = await this.attendance(q);
    const buffer =
      format === 'pdf'
        ? await attendancePdf(report, this.orgName)
        : await attendanceWorkbook(report);

    return this.fileOf('attendance', report.meta, report.rows.length, format, {
      buffer,
      actorUserId,
      ip,
    });
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
    format: DownloadFormat,
    actorUserId: number,
    ip: string,
  ): Promise<ReportFile> {
    const report = await this.summary(q);
    const buffer =
      format === 'pdf'
        ? await summaryPdf(report, this.orgName)
        : await summaryWorkbook(report);

    return this.fileOf('summary', report.meta, report.rows.length, format, {
      buffer,
      actorUserId,
      ip,
    });
  }

  // ── F04 · productivity ────────────────────────────────────────────────────

  /**
   * ⭐ **productivity-র সংজ্ঞা একটাই, আর সেটা
   * [activity.math.ts](../activity/activity.math.ts)-এ।** এই মেথড এখন শুধু
   * সারি আনে আর ছাপার আকৃতিতে সাজায়।
   *
   * আগে এখানে নিজের একটা `switch` ছিল যেটা সেকেন্ডগুলো
   * productive/neutral/unproductive/uncategorized ভাগে ফেলত — অর্থাৎ
   * `addSeconds()`-এর হুবহু নকল, শুধু আলাদা কোডে। রুট আলাদা বলে দুটো কখনো
   * মুখোমুখি হতো না, কিন্তু **তারা ইতিমধ্যেই দু-রকম উত্তর দিত**: এখানে
   * শতাংশের হরে অচিহ্নিত সময় ছিল, `scoreOf()`-এ ছিল না। কেউ প্রশ্ন করলে
   * "কোনটা সত্যি" বলার কোনো উপায় থাকত না। এখন দুটো সংখ্যাই আসে একই
   * `scoreOf()` থেকে, আর প্রত্যেকটার আলাদা নাম ও আলাদা মানে
   * ([reports.types.ts](./reports.types.ts))।
   *
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
    const limit = q.limit ?? DEFAULT_TOP;

    const [byKey, byEmployee, meta] = await Promise.all([
      this.prisma.appUsage.groupBy({
        by: ['processName', 'domain', 'categoryId'],
        where,
        _sum: { durationSec: true },
        // `foldUsage` কতগুলো সারি মিলেছে সেটাও গোনে — একটা ডোমেইনের ৩ ঘণ্টা
        // ৪টা লম্বা খণ্ডে না ২০০টা ছোট খণ্ডে, দুটো খুব আলাদা অভ্যাস
        _count: { _all: true },
      }),
      this.prisma.appUsage.groupBy({
        by: ['employeeId', 'categoryId'],
        where,
        _sum: { durationSec: true },
      }),
      this.categoryMeta(),
    ]);

    // ── টপ অ্যাপ ও সাইট
    //
    // ⚠️ প্রতিটা DB সারি **ঠিক একটা** তালিকায় যায়: ডোমেইন থাকলে সাইট,
    //    নইলে অ্যাপ। এই ভাগটা এখানে TypeScript-এ করা হয়, দুটো আলাদা
    //    কোয়েরিতে নয় — দুটো `where` লিখলে ফাঁকা-স্ট্রিং ডোমেইনের সারি
    //    দুই দিকেই পড়ে যেত বা কোনো দিকেই না, আর মোট সময় নীরবে ভুল হতো।
    // ⭐ এখানেই `/activity/top`-এর সাথে তফাত: ওখানে অ্যাপ ও সাইট **একই**
    //    সময়ের দুই রকম কাটাছেঁড়া (chrome.exe-এর ভেতরেই youtube.com), তাই
    //    যোগ করা যায় না। এখানে ভাগ দুটো পরস্পরছেদী, তাই যোগফলই মোট সময়।
    const appGroups: UsageGroup[] = [];
    const siteGroups: UsageGroup[] = [];

    for (const row of byKey) {
      const seconds = row._sum.durationSec ?? 0;
      if (seconds <= 0) continue;

      const site =
        row.domain !== null && row.domain.trim().length > 0 ? row.domain : null;

      const group: UsageGroup = {
        key: site ?? row.processName,
        categoryId: row.categoryId,
        seconds,
        records: row._count._all,
      };

      if (site === null) appGroups.push(group);
      else siteGroups.push(group);
    }

    const apps = foldUsage(appGroups, meta, 'app', limit);
    const sites = foldUsage(siteGroups, meta, 'site', limit);
    const totalSec = apps.totalSec + sites.totalSec;

    // ⚠️ প্রতিটা তালিকা থেকে টপ `limit` নিয়ে তারপর আবার `limit`-এ কাটা হয়।
    //    এতে কিছু হারায় না — সব মিলিয়ে সেরা `limit`টা সবসময় দুই তালিকার
    //    সেরা `limit`-এর ভেতরেই থাকে।
    // ⚠️ সাজানো হয় **সেকেন্ড ধরে**, ঘণ্টা ধরে নয়। ঘণ্টা দুই দশমিকে গোল করা,
    //    তাই ৩৫ সেকেন্ডের তফাত থাকা দুটো সারি সমান দেখাত আর ক্রমটা
    //    বর্ণক্রমে গড়িয়ে যেত — অর্থাৎ ছোট সারিটা উপরে উঠে আসত।
    const top: ProductivityItem[] = [
      ...apps.rows.map((tally) => ({ tally, kind: 'app' as const })),
      ...sites.rows.map((tally) => ({ tally, kind: 'site' as const })),
    ]
      // সমান হলে key-র বর্ণক্রম — একই রিপোর্ট দু-বার খুললে একই ক্রম
      .sort(
        (a, b) =>
          b.tally.seconds - a.tally.seconds ||
          (a.tally.key < b.tally.key ? -1 : 1),
      )
      .slice(0, limit)
      .map(({ tally, kind }) => itemOf(tally, kind, totalSec));

    // ── কর্মীভিত্তিক ভাগ
    const perEmployee = new Map<number, SecondBuckets>();

    for (const row of byEmployee) {
      const seconds = row._sum.durationSec ?? 0;
      if (seconds <= 0) continue;

      let buckets = perEmployee.get(row.employeeId);
      if (!buckets) {
        buckets = emptyBuckets();
        perEmployee.set(row.employeeId, buckets);
      }

      // ⚠️ `null` ক্যাটাগরি = **অচেনা**, neutral নয় — `addSeconds()` ওটাই
      //    করে, আর দুটো মিলিয়ে ফেললে প্রতিটা অচেনা অ্যাপ নীরবে স্কোরের হর
      //    বাড়িয়ে দিত (যত বেশি অচেনা, স্কোর তত কম, অথচ কারণটা অদৃশ্য)।
      addSeconds(buckets, categoryOf(meta, row.categoryId), seconds);
    }

    let uncategorizedSec = 0;
    const rows: ProductivityEmployeeRow[] = ctx.employees.map((employee) => {
      // ⭐ যাদের একটাও সারি নেই তারাও তালিকায় থাকেন — বাদ দিলে "এজেন্ট বন্ধ"
      //    আর "সব ঠিক আছে" দেখতে একরকম হতো
      const score = scoreOf(perEmployee.get(employee.id) ?? emptyBuckets());
      uncategorizedSec += score.unknownSec;

      return {
        employeeId: employee.id,
        empCode: employee.empCode,
        fullName: employee.fullName,
        productiveHours: secondsToHours(score.productiveSec),
        neutralHours: secondsToHours(score.neutralSec),
        unproductiveHours: secondsToHours(score.unproductiveSec),
        uncategorizedHours: secondsToHours(score.unknownSec),
        trackedHours: secondsToHours(score.totalSec),
        productiveSharePct: sharePct(score.productiveSec, score.totalSec),
        productivityScorePct: score.scorePct,
        uncategorizedSharePct: score.unknownPct,
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

  /** ⚠️ productivity-র PDF নেই — `ProductivityQuery` DTO-তেই আটকানো (F06) */
  async productivityFile(
    q: ProductivityQuery,
    actorUserId: number,
    ip: string,
  ): Promise<ReportFile> {
    const report = await this.productivity(q);
    const buffer = await productivityWorkbook(report);

    return this.fileOf(
      'productivity',
      report.meta,
      report.top.length,
      'xlsx',
      { buffer, actorUserId, ip },
    );
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

  /**
   * id → ক্যাটাগরির পরিচয়। ~১১০টা সারি, তাই প্রতিবার পুরোটা পড়াই সবচেয়ে সহজ।
   *
   * ⚠️ শুধু ব্যবহৃত id-গুলো আনা হয় **না** — `matchType` লাগে লেবেল বাছতে
   *    (`foldUsage`-এর chrome.exe/YouTube ফাঁদ), আর সেই লেবেল বাছাই যেন
   *    `/activity/top`-এর সাথে হুবহু এক থাকে সে জন্য ম্যাপটাও একই রকম
   *    হওয়া দরকার।
   *
   * ⚠️ `AppCategoryService`-এর ক্যাশ ব্যবহার করা হয় না — ওটা `compile()` করা
   *    রুল রাখে, আর ভুল regex-ওয়ালা রুলগুলো সেখানে বাদ পড়ে। রিপোর্টে ওই
   *    রুলের id-ওয়ালা পুরোনো সারি থাকতেই পারে; ক্যাশ থেকে নিলে সেগুলো নীরবে
   *    "অচেনা" দেখাত, অথচ ডাটাবেসে ক্যাটাগরি বসানোই আছে।
   */
  private async categoryMeta(): Promise<Map<number, CategoryMeta>> {
    const rows = await this.prisma.appCategory.findMany({
      select: { id: true, displayName: true, category: true, matchType: true },
    });

    return new Map(
      rows.map((r) => [
        r.id,
        {
          displayName: r.displayName,
          category: r.category,
          matchType: r.matchType,
        },
      ]),
    );
  }

  /**
   * ⭐ এক্সপোর্ট একটা ঘটনা — কে কোন রেঞ্জ কোন ফরম্যাটে নামিয়ে নিল, লেখা থাকবে (§ ৭)।
   *
   * ⚠️ `format` আগে `'xlsx'` হার্ডকোড ছিল। PDF যোগ করার সময় সেটা না বদলালে
   *    অডিট লগ **মিথ্যে** বলত — কেউ PDF নামালেও লেখা থাকত xlsx, আর "কে কী
   *    নিয়েছে" প্রশ্নের উত্তর অডিট থেকেই আসার কথা।
   */
  private async fileOf(
    report: string,
    meta: ReportMeta,
    rows: number,
    format: DownloadFormat,
    out: { buffer: Buffer; actorUserId: number; ip: string },
  ): Promise<ReportFile> {
    await this.audit.record({
      userId: out.actorUserId,
      action: 'export_report',
      targetType: 'report',
      targetId: report,
      ipAddress: out.ip,
      meta: { from: meta.from, to: meta.to, rows, format },
    });

    return {
      filename: reportFilename(report, meta.from, meta.to, format),
      mime: MIME_OF[format],
      buffer: out.buffer,
    };
  }
}

/**
 * ⚠️ id ম্যাপে না থাকলে `null` — অর্থাৎ "অচেনা", crash নয়। foreign key
 * থাকায় এমন হওয়ার কথা নয়, কিন্তু একটা রুল মুছে ফেলার আর ম্যাপটা পড়ার
 * মাঝখানে এটা ঘটতে পারে, আর তখন গোটা রিপোর্ট ৫০০ দেওয়ার কোনো মানে নেই।
 *
 * ⚠️ `activity.math.ts`-এও হুবহু এই নিয়মটা আছে, কিন্তু সেটা ফাইল-প্রাইভেট।
 * export হলে এই ছয় লাইন মুছে ফেলা যেত — নোটে লেখা আছে।
 */
function categoryOf(
  meta: ReadonlyMap<number, CategoryMeta>,
  categoryId: number | null,
): Productivity | null {
  if (categoryId === null) return null;
  return meta.get(categoryId)?.category ?? null;
}

/**
 * `activity.math`-এর `UsageTally` → F04-এর সারি।
 *
 * ⚠️ `sharePct`-এর হর **দুই তালিকা মিলিয়ে মোট**, `foldUsage`-এর নিজের
 * মোট নয়। নইলে অ্যাপ ও সাইট আলাদাভাবে ১০০%-এ যোগ হতো আর এক টেবিলে
 * পাশাপাশি বসে শতাংশগুলোর যোগফল ২০০ দেখাত।
 */
function itemOf(
  tally: UsageTally,
  kind: 'app' | 'site',
  totalSec: number,
): ProductivityItem {
  return {
    key: tally.key,
    kind,
    category: tally.category ?? 'uncategorized',
    // `foldUsage` রুলের নাম না পেলে key-টাই লেবেল করে; F04-এর চুক্তি বলে
    // "নিয়মে নাম না মিললে null"
    displayName: tally.label === tally.key ? null : tally.label,
    mixed: tally.mixed,
    hours: secondsToHours(tally.seconds),
    sharePct: sharePct(tally.seconds, totalSec),
  };
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

    // ⭐ পুরো মাসের টার্গেট — হিসাব নয়, নীতিতে লেখা সংখ্যা। ওয়েব পাতা
    //    এটা নিজে বানাতে গিয়ে সরকারি ছুটি বাদ দিতে ভুলত (২০৮ → ২১৬)।
    monthTargetHours: Object.fromEntries(
      ctx.employees.map((e) => [e.id, e.monthlyTargetSec / HOUR]),
    ),
  };
}
