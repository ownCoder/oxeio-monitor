import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmployeeStatus, SegmentState, type Productivity } from '@prisma/client';

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
import { workDateOf } from '../agent/util/dhaka-time';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { countLeaveWorkdays, elapsedWindow } from '../summary/summary.math';
import { trackedFromBy } from '../summary/tracking-start';
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
/**
 * ⚠️⚠️ **`countWorkdays` ও `monthBoundsOf` এখানে ইচ্ছাকৃতভাবে import করা
 * হয় না।** দৈনিক টার্গেটের হর পলিসির `expected_workdays`, ক্যালেন্ডার
 * থেকে গোনা কোনো সংখ্যা নয় — আর ঠিক ওই দুটো ফাংশন হাতের কাছে থাকাতেই
 * একদিন হরটা ক্যালেন্ডারে ফিরে গিয়েছিল। কর্মদিবস গোনার দরকার হলে
 * `targetSecIn()` নিজেই গুনে নেয় (সেটা লব, হর নয়)।
 */
import {
  approximateHolidayDates,
  bucketOf,
  dailyTargetSec,
  eachDate,
  isoDayOf,
  isWorkday,
  monthsIn,
  overlapOf,
  parseReportRange,
  secondsToHours,
  sharePct,
  targetSecIn,
  toIsoDate,
  weekStartIsoDay,
  type DateSpan,
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
  /** ⭐ কাজের ধরন — ডিজাইনের কলামটা কেবল ডিজাইনারদের জন্য ভরে (২১ আগস্ট) */
  staffType: 'designer' | 'researcher' | 'manager' | null;
  joinedOn: Date | null;
  leftOn: Date | null;
  monthlyTargetSec: number;
  weeklyOffDay: number | null;
  /**
   * ⭐⭐ এক কর্মদিবসের টার্গেট = মাসিক ÷ পলিসির `expected_workdays`।
   *
   * ⚠️ কর্মীপ্রতি **একবারই** বের করা হয় এবং মাস বদলালেও বদলায় না — ঠিক
   *    এই ধ্রুবকতাটাই `prorate()`-এর সাথে মিল রাখে। আগে এটা মাসভেদে
   *    বদলাত (হর ছিল ওই মাসের ক্যালেন্ডার কর্মদিবস), আর তাতে একই কর্মীর
   *    একই মাসে রিপোর্ট বলত ৭.৭০ ঘণ্টা, tray বলত ৮.০০।
   */
  dailyTargetSec: number;
}

interface ReportContext {
  range: ReportRange;
  employees: ResolvedEmployee[];
  excluded: string[];
  /**
   * ⭐⭐ যে ছুটির তারিখগুলোর উপর এই রিপোর্টের হর দাঁড়ানো, তার মধ্যে যেগুলো
   * এখনো পাকা নয় ('YYYY-MM-DD')। ঠিক সেই সারিগুলো থেকেই আসে যেগুলো দিয়ে
   * কর্মদিবস গোনা হয়েছে — এক সংখ্যা, এক সংজ্ঞা।
   */
  approximateHolidayDates: string[];
  /**
   * ⭐⭐ কর্মীপ্রতি "এ পর্যন্ত কত হওয়ার কথা ছিল", ঘণ্টায় — `ReportMeta.expectedHours`।
   * সংজ্ঞা ও কেন সার্ভারে, দুটোই ওই টাইপের নোটে।
   */
  expectedHours: Record<number, number>;
  /**
   * ⭐⭐ কর্মীপ্রতি **এই পরিসরের মোট টার্গেট**, ঘণ্টায় — অফিস-ডে × দৈনিক
   * টার্গেট, শুক্রবার · সরকারি ছুটি · তার নিজের ছুটি বাদ। সংজ্ঞা
   * `ReportMeta.targetHoursInRange`-এর নোটে।
   */
  targetHoursInRange: Record<number, number>;
  /** ওই কর্মীর ওই দিনের টার্গেট, সেকেন্ডে (ছুটির দিনে ০) */
  targetSecOf(employee: ResolvedEmployee, date: Date): number;
  /**
   * ⭐⭐ ওই পরিসরের **প্রত্যাশা**, সেকেন্ডে — অর্থাৎ পরিসরের যেটুকু
   * `elapsedWindow()`-এর ভেতরে পড়ে কেবল সেটুকুর টার্গেট।
   *
   * ⚠️ `targetSecOf()`-এর যোগফলের চেয়ে এটা **ছোট বা সমান**, আর ফারাকটা
   *    ইচ্ছাকৃত: ট্র্যাকিং শুরুর আগের দিন আর আজকের অসমাপ্ত দিনটা টার্গেটে
   *    আছে, প্রত্যাশায় নেই। কারও ঘাটতি মাপা হয় **কেবল** এই সংখ্যাটার
   *    বিপরীতে — না-দেখা দিন কারো ব্যর্থতা নয়।
   */
  expectedSecOf(employee: ResolvedEmployee, span: DateSpan): number;
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

    /**
     * ⭐⭐ **কে কোন দিনে কতগুলো টার্গেট "শেষ" বলেছেন** *(২৩ আগস্ট ২০২৬,
     * মালিকের চাওয়া)*।
     *
     * ⚠️⚠️ `daily_summary`-তে এটা নেই, আর থাকার কথাও নয় — ওই টেবিল সময়ের
     * হিসাব রাখে, আর এটা কাজের। তাই `design_targets` থেকে সরাসরি।
     *
     * ⚠️ `completed_at` timestamptz, আর সারিগুলো **ঢাকার দিনে** ভাগ করতে
     * হবে — তাই raw কুয়েরি; Prisma-র `groupBy` তারিখ কাটতে পারে না।
     *
     * ⭐ **একটাই কুয়েরি পুরো সীমার জন্য** — প্রতি সারিতে আলাদা করে গুনলে
     * ৩০ দিন × ১৩ জন = ৩৯০টা কুয়েরি হতো (N+1)।
     */
    const finishedRows = await this.prisma.$queryRaw<
      { employee_id: number; work_date: Date; n: number }[]
    >`
      SELECT assigned_to_id AS employee_id,
             (completed_at AT TIME ZONE 'Asia/Dhaka')::date AS work_date,
             count(*)::int AS n
        FROM design_targets
       WHERE assigned_to_id = ANY(${ctx.employees.map((e) => e.id)}::int[])
         AND completed_at IS NOT NULL
         AND (completed_at AT TIME ZONE 'Asia/Dhaka')::date
             BETWEEN ${range.from}::date AND ${range.to}::date
       GROUP BY 1, 2
    `;

    /**
     * ⚠️ চাবিটা `daily_summary`-র মতোই — UTC-মধ্যরাতের Date। raw কুয়েরি
     *    `date` ফেরত দেয়, তাই ঘণ্টা-মিনিট ছেঁটে একই আকারে আনা হয়।
     */
    const finishedByKey = new Map(
      finishedRows.map((r) => [
        `${r.employee_id}|${Date.UTC(
          r.work_date.getUTCFullYear(),
          r.work_date.getUTCMonth(),
          r.work_date.getUTCDate(),
        )}`,
        Number(r.n),
      ]),
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
          staffType: employee.staffType,
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
          /**
           * ⚠️ ডিজাইন **না করলে** `null` (কলামটা খালি), শূন্য নয়।
           * ⭐ ডিজাইনার না হয়েও কেউ করলে সংখ্যাটা ওঠে — ম্যানেজার নিজেও
           * ডিজাইন করেন, আর সেটা লুকোনো মানে তথ্য হারানো (২২ আগস্ট)।
           */
          /**
           * ⭐ **কেবল "শেষ"** *(মালিকের সিদ্ধান্ত, ২৩ আগস্ট)* — আগে এখানে
           * `daily_summary.designsDone` বসত, অর্থাৎ কতগুলো ফাইল **খোলা**
           * হয়েছে। ⚠️ ওই সংখ্যা মাঠে বিভ্রান্তি তৈরি করেছিল: ম্যানেজার
           * ১৯টা ফাইলে ৪৪ মিনিট দিয়ে "১৬" দেখাচ্ছিলেন।
           *
           * ⚠️ ০ হলে `null` — স্প্রেডশিটে ০ মানে "মেপে শূন্য পাওয়া গেছে",
           * আর ডিজাইন-বহির্ভূত কর্মীর সারিতে সেটা মিথ্যা হতো।
           */
          designsDone:
            finishedByKey.get(`${employee.id}|${date.getTime()}`) ?? null,
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
        /**
         * ⚠️⚠️ এটা **উপরের সারিগুলোর Target কলামের যোগফল**, "এ পর্যন্ত কত
         * হওয়ার কথা ছিল" নয় (সেটা `meta.expectedHours`)। ওয়েবে ও PDF-এ
         * সংখ্যাটা ঠিক ওই কলামের নিচে পাদটীকা হিসেবে বসে, তাই এটাকে
         * প্রত্যাশার জানালায় নিলে **কলামটা আর যোগ হতো না** — একটা মোট
         * যেটা নিজের কলামের সাথে মেলে না, সেটা যেকোনো ভুল সংখ্যার চেয়ে
         * খারাপ। তাই ফারাকটা লেবেলে বলা হয় ("Target · days listed"), মোট
         * বদলে নয়।
         */
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
        /**
         * ⭐⭐ **ঘাটতির হর প্রত্যাশা, অতিরিক্তের হর টার্গেট — ইচ্ছাকৃতভাবে
         * আলাদা, আর এটাই এই ফাইলের সবচেয়ে জরুরি সিদ্ধান্ত।**
         *
         * টার্গেট একটা **ক্যালেন্ডারের তথ্য**: এই দিনগুলোর জন্য কত ঘণ্টা
         * ছিল। ঘাটতি একটা **মানুষ সম্পর্কে রায়**, আর রায় কেবল সেই
         * দিনগুলোর উপর হতে পারে যেগুলো আমরা সত্যিই দেখেছি ও যেগুলো শেষ
         * হয়েছে — তাই তার হর `expectedSecOf()`।
         *
         * ⚠️⚠️ এটা না করলে যা হতো (আর গত রাউন্ডে হয়েছিল): Monthly পাতা
         *    বলত "expected ৮ঘ · pace −২ঘ", অথচ **একই মাসের** Excel/PDF
         *    বলত "target ৮৩.২ঘ · shortfall ৭৭.২ঘ" — কারণ ওতে এজেন্ট বসার
         *    আগের দিনগুলোও ধরা ছিল। দুটোর মধ্যে মানুষ কাগজটাকেই বিশ্বাস
         *    করে, আর কাগজটাই ছিল অভিযোগকারী।
         *
         * ⚠️ অতিরিক্ত মাপা হয় **পুরো টার্গেটের** বিপরীতে, প্রত্যাশার নয়।
         *    প্রত্যাশা ধরলে আজকের কাজ করা ঘণ্টাগুলো (আজকের দিনটা
         *    প্রত্যাশায় নেই) সবার নামে "অতিরিক্ত" হয়ে ছাপা হতো, অথচ
         *    মাসের টার্গেটই এখনো ছোঁয়া হয়নি। "এগিয়ে আছি" আর "বেশি কাজ
         *    করেছি" এক কথা নয়।
         *
         * ⭐ পর্ব শেষ হয়ে গেলে (গত মাসের রিপোর্ট) জানালা পুরো বালতিটাই
         *    ঢাকে, অর্থাৎ প্রত্যাশা = টার্গেট আর দুটো হর মিলে যায় — তাই
         *    পুরোনো মাসের ছাপা কাগজ এই বদলে নড়ে না।
         *
         * ⚠️ দুটোই মেলানো হয় `credited_sec`-এর সাথে, `worked_sec`-এর সাথে
         *    নয় (§ ২.১-ঙ) — নইলে owner-এর দেওয়া সংশোধন রিপোর্টে উধাও হয়ে
         *    যেত।
         */
        const expectedSec = ctx.expectedSecOf(employee, {
          from: acc.start,
          to: acc.end,
        });

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
          shortfallHours: secondsToHours(
            Math.max(0, expectedSec - acc.creditedSec),
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
      // ⭐ R22a — শুধু ACTIVE-এ দেখা খণ্ড গোনা হয়। idle-এ দেখা সারি এখন
      //    জমা হয় (মিটিং চেনার জন্য), কিন্তু কোনো হিসাবে যায় না।
      segmentState: SegmentState.active,
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
          staffType: true,
          status: true,
          joinedOn: true,
          leftOn: true,
          // ⚠️ `monthlySalary` এখানে **নেই** এবং কখনো যোগ করা যাবে না —
          //    ম্যানেজারও এই endpoint ডাকেন
          policy: {
            // ⭐⭐ `expectedWorkdays` — দৈনিক টার্গেটের **হর**। এটা না আনলে
            //    এখানে আবার ক্যালেন্ডার থেকে গোনা কর্মদিবস বসত, আর ঠিক
            //    সেটাই ছিল রিপোর্ট ও tray-র দুই সংখ্যার উৎস।
            select: {
              monthlyTargetHours: true,
              expectedWorkdays: true,
              weeklyOffDay: true,
            },
          },
        },
        orderBy: { empCode: 'asc' },
      }),
      this.prisma.workPolicy.findFirst({
        where: { isActive: true },
        orderBy: { id: 'asc' },
        select: {
          monthlyTargetHours: true,
          expectedWorkdays: true,
          weeklyOffDay: true,
        },
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
          'There is no active work policy — the target cannot be worked out',
        );
      }

      const monthlyTargetSec = Number(policy.monthlyTargetHours) * HOUR;

      employees.push({
        id: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        department: e.department,
        staffType: e.staffType,
        joinedOn: e.joinedOn,
        leftOn: e.leftOn,
        monthlyTargetSec,
        weeklyOffDay: policy.weeklyOffDay,
        dailyTargetSec: dailyTargetSec(
          monthlyTargetSec,
          policy.expectedWorkdays,
        ),
      });
    }

    if (excluded.length > 0) {
      this.logger.warn(
        `${excluded.length} inactive staff have no left_on — they are missing from the report`,
      );
    }

    // ⚠️ ছুটি আনা হয় **পুরো মাসগুলোর** জন্য, শুধু রেঞ্জের জন্য নয় — কারণ
    //    দুটো, আর কোনোটাই দৈনিক টার্গেটের হর নয় (হর পলিসির ধ্রুবক):
    //    `monthsIn()`-এর নোট দেখুন।
    const months = monthsIn(range.from, range.to);
    const holidayRows = await this.prisma.holiday.findMany({
      where: {
        holidayDate: {
          gte: months[0].first,
          lte: months[months.length - 1].last,
        },
      },
      // ⚠️ `name`-ও আনা হয়, কারণ অনিশ্চয়তার চিহ্নটা ("(সম্ভাব্য)") নামেই
      //    থাকে — আলাদা কলামে নয় (`prisma/holidays.data.ts`-এর মাথা দেখুন)।
      select: { holidayDate: true, name: true },
    });
    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    const ruleOf = (employee: ResolvedEmployee): WorkdayRule => ({
      weeklyOffDay: employee.weeklyOffDay,
      holidays,
    });

    /**
     * ⭐⭐ R2 — **ছুটি, কর্মীপ্রতি।**
     *
     * ⚠️ ছুটির দিনগুলো `holidays` সেটে ঢালা হয় **না**, যদিও তাতে নিচের
     *    দুটো ফাংশনই এমনিতেই ঠিক হয়ে যেত। কারণ ওই একই সেট দিয়ে
     *    `approximateHolidayDates()` চলে — অর্থাৎ একজনের ব্যক্তিগত ছুটি
     *    রিপোর্টের পাদটীকায় "সরকারি ছুটি" হয়ে সবার চোখে পড়ত।
     */
    const leaveRows = await this.prisma.leave.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        leaveDate: {
          gte: months[0].first,
          lte: months[months.length - 1].last,
        },
      },
      select: { employeeId: true, leaveDate: true },
    });
    const leaveBy = new Map<number, Set<number>>();
    for (const l of leaveRows) {
      let set = leaveBy.get(l.employeeId);
      if (!set) leaveBy.set(l.employeeId, (set = new Set()));
      set.add(l.leaveDate.getTime());
    }

    /**
     * ⭐⭐ **এক হার।** দিনটা কর্মদিবস হলে তার টার্গেট কর্মীর নিজের
     * `dailyTargetSec` — মাস যাই হোক, ওই মাসে কটা ছুটি থাকুক না কেন।
     *
     * ⚠️⚠️ আগে এখানে হর ছিল **ওই মাসের ক্যালেন্ডার কর্মদিবস**, আর সেটাই
     *    ছিল একই কর্মীর একই মাসে দুটো আলাদা দৈনিক টার্গেটের উৎস: tray ও
     *    `monthly_summary` বলত ২০৮ ÷ ২৬ = ৮.০০ ঘণ্টা, রিপোর্ট বলত
     *    ২০৮ ÷ ২৭ = ৭.৭০। আরও খারাপ, ছুটি বাড়লে রিপোর্টের দৈনিক টার্গেট
     *    **বাড়ত** — অর্থাৎ ছুটি দিয়ে কর্মীর কোনো লাভই হতো না।
     *    কেন পলিসির ধ্রুবকই সঠিক, তা `dailyTargetSec()`-এর নোটে।
     */
    const targetSecOf = (employee: ResolvedEmployee, date: Date): number => {
      if (!isWorkday(date, ruleOf(employee))) return 0;
      // ⭐ R2 — ছুটির দিনে টার্গেট ০, ঠিক সাপ্তাহিক ছুটির দিনের মতোই
      if (leaveBy.get(employee.id)?.has(date.getTime())) return 0;
      return employee.dailyTargetSec;
    };

    /**
     * ⭐⭐ **"এ পর্যন্ত কত হওয়ার কথা ছিল" — এখানেই, একবারই।**
     *
     * ⚠️ জানালাটা নিজে বানানো হয় **না**: `summary.math.ts`-এর
     *    `elapsedWindow()` ডাকা হয়, ঠিক যেটা মাসিক rollup আর tray ডাকে।
     *    এখানে আবার `today − ১` লিখলে সেটাই হতো চতুর্থ সংজ্ঞা, আর ঠিক
     *    এভাবেই আগের তিনটে জন্মেছিল।
     *
     * ⭐ **ওই কর্মীর নিজের** ট্র্যাকিং-শুরু (তার সবচেয়ে পুরোনো
     *    `daily_summary` সারি), সংস্থার প্রথম দিন নয় — নইলে যে কর্মীর
     *    রেকর্ডই পরে তৈরি হয়েছে, তার আগের দিনগুলোও তার ঘাটতি হয়ে যেত।
     *
     * ⚠️⚠️ **যেটা এটা সারায় না** (`summary.math.ts` ও `progress.service.ts`-এর
     *    একই নোট দেখুন): ১ অক্টোবর সক্রিয় হয়ে ৮ অক্টোবর এজেন্ট পাওয়া কর্মী।
     *    `refreshDate()` প্রতিটি active কর্মীর সারি লেখে — ডেটা থাক বা না
     *    থাক — তাই তার ট্র্যাকিং-শুরুও ১ অক্টোবরই বসে, আর এজেন্টহীন সাতটা
     *    দিন **এখনো পুরো ঘাটতি**। এই জানালা প্রথম ইনস্টলের ফাঁকটা ঢাকে,
     *    পরে যোগ দেওয়া কর্মীর ফাঁক নয় (G120)।
     *
     * ⚠️ যোগফলটা `targetSecIn()` দিয়ে — **কর্মদিবস × দৈনিক টার্গেট**, ঠিক
     *    যেভাবে `prorate()` মাসের টার্গেট বের করে। দৈনিক টার্গেট এখন সব
     *    মাসে এক, তাই এই গুণফল আর দিনে-দিনে যোগফল একই ঘণ্টা দেয় — অর্থাৎ
     *    সংখ্যাটা পাতায় দেখা ঘরগুলোরই যোগফল। **দুটোই**
     *    `test/reports.target.spec.ts` পাহারা দেয়; হর মাসভেদে বদলালে এই
     *    সমতাটা ভাঙত, আর তখন গুণ করাটা ভুল হতো।
     */
    const trackedFrom = await trackedFromBy(
      this.prisma,
      employees.map((e) => e.id),
    );

    // ⚠️ ঢাকার আজ — `parseReportRange()`-ও ঠিক এভাবেই ছাঁটাইয়ের সীমা বের করে
    const today = workDateOf(new Date());

    const windowBy = new Map(
      employees.map((employee) => [
        employee.id,
        elapsedWindow({
          periodStart: range.from,
          periodEnd: range.to,
          today,
          joinedOn: employee.joinedOn,
          leftOn: employee.leftOn,
          // ⚠️⚠️ `?? today` — না-দেখা কর্মীর জানালা খালি, প্রত্যাশা ০ (G120)
          trackingStartedOn: trackedFrom.get(employee.id) ?? today,
        }),
      ]),
    );

    /**
     * ⭐⭐ **প্রত্যাশা মাপার একমাত্র জায়গা** — meta-র সংখ্যা আর সারির
     * ঘাটতি, দুটোই এখান দিয়ে যায়। বালতিগুলোর প্রত্যাশা যোগ করলে ঠিক
     * `meta.expectedHours`-ই ফেরে, কারণ বালতিগুলো রেঞ্জটাকে ভাগ করে নেয়।
     *
     * ⚠️ জানালা `null` = খালি (আজ রেঞ্জের প্রথম দিন, বা তাকে এখনো একটা
     *    শেষ-হওয়া দিনেও দেখা হয়নি) — তখন প্রত্যাশা ০, আর ০-এর বিপরীতে
     *    কারও ঘাটতিও থাকতে পারে না। সেটাই কাম্য।
     */
    /**
     * ⭐⭐ **অফিস-ডে × দৈনিক টার্গেট − ছুটি** — এই প্রকল্পের একমাত্র
     * টার্গেট-সূত্র, আর এখানে **একবারই** লেখা।
     *
     * ⚠️⚠️ আগে সূত্রটা দু-জায়গায় লেখা হতো, আর ঠিক সেভাবেই G117 জন্মেছিল:
     * এক পাশে ছুটি বাদ যেত, অন্য পাশে যেত না। ⭐ এখন দুটো কলার (প্রত্যাশা
     * আর পরিসরের টার্গেট) কেবল **আলাদা জানালা** পাঠায়, আলাদা অঙ্ক নয়।
     *
     * ⚠️ R2 — ছুটি আলাদা করে বাদ দিতে হয়, কারণ `targetSecIn()` গুণ করে
     *    (দিনে-দিনে যোগ করে না)। না কাটলে meta-র সংখ্যা আর সারিগুলোর
     *    যোগফল মিলত না — ওই সমতাটাই `test/reports.target.spec.ts` পাহারা দেয়।
     */
    const netTargetSecIn = (
      employee: ResolvedEmployee,
      span: DateSpan,
    ): number => {
      const onLeave = countLeaveWorkdays(
        leaveBy.get(employee.id),
        span.from,
        span.to,
        employee.weeklyOffDay,
        holidays,
      );
      return (
        targetSecIn(span, ruleOf(employee), employee.dailyTargetSec) -
        onLeave * employee.dailyTargetSec
      );
    };

    const expectedSecOf = (
      employee: ResolvedEmployee,
      span: DateSpan,
    ): number => {
      const window = windowBy.get(employee.id) ?? null;
      if (window === null) return 0;

      const seen = overlapOf(window, span);
      if (seen === null) return 0;

      return netTargetSecIn(employee, seen);
    };

    const expectedHours: Record<number, number> = {};
    for (const employee of employees) {
      expectedHours[employee.id] = secondsToHours(
        expectedSecOf(employee, { from: range.from, to: range.to }),
      );
    }

    /**
     * ⭐⭐ **এই পরিসরে তার মোট টার্গেট** — মালিকের নিয়ম *(২৩ আগস্ট ২০২৬)*:
     * *"daily 8 ghonta kore, without holiday and friday"*, আর
     * *"maser hisab na kore office day hisab koro"*।
     *
     * অর্থাৎ **অফিস-ডে গোনা হয়, মাস নয়** — যে ক-দিন দেখা হচ্ছে সেই
     * পরিসরের কর্মদিবস × দৈনিক টার্গেট, শুক্রবার ও সরকারি ছুটি বাদ।
     *
     * ⚠️⚠️ এটাই G117 সারাল: আগে এখানে বসত পলিসির **ফ্ল্যাট ২০৮**, অথচ
     * অক্টোবরে অফিস-ডে ২৪ (= ১৯২ঘ)। ফলে রিপোর্ট ১৬ ঘণ্টার **ভুতুড়ে
     * ঘাটতি** দেখাত, আর tray একই মাসে অন্য সংখ্যা বলত।
     *
     * ⭐ মাস ধরে না গোনায় *"কোন মাসের টার্গেট"* প্রশ্নটাই আর ওঠে না —
     * এক মাস, আধা মাস, তিন মাস, সবেতেই সংখ্যাটার মানে এক।
     *
     * ⚠️ **ব্যক্তিগত ছুটিও বাদ** (`netTargetSecIn`) — নইলে সবেতন ছুটির
     *    দিনগুলো ঘাটতি হয়ে দাঁড়াত, আর tray/`monthly_summary`/পে-রোলের
     *    সাথে আবার দুই সংখ্যা হতো, কেবল উল্টো চিহ্নে।
     *
     * ⚠️ কর্মকালে ছাঁটা — জয়েনের আগের বা ছাড়ার পরের দিন কারো টার্গেট নয়।
     *    ছেদ খালি হলে **০**, আর ০ একটা বৈধ উত্তর ("তার কোনো অফিস-ডে নেই")।
     *
     * ⚠️⚠️ **জানালা `requestedTo`, `to` নয় — এটা নীরব পছন্দ নয়।**
     *
     * `range.to` আজকের দিনে ছাঁটা (`clampedToToday`)। ওটা ধরলে ২৩ আগস্টে
     * আগস্টের টার্গেট দাঁড়াত **১৬০ঘ** (২০ অফিস-ডে), অথচ আগস্টের টার্গেট
     * ২০৮ — মাস শেষ হয়নি বলে টার্গেট ছোট হয়ে যায় না।
     *
     * ⭐ আর ছাঁটলে সংখ্যাটা কার্যত `expectedHours`-এর **নকল** হয়ে যেত, অথচ
     * দুটোর কাজ আলাদা: এটা *"মোট কত হওয়ার কথা"* (অগ্রগতির হর), আর ওটা
     * *"এ পর্যন্ত কত হওয়ার কথা"* (ঘাটতির মাপকাঠি)। একটাকে অন্যটার সমান
     * করে দিলে Monthly পাতার অগ্রগতি-বার সারাদিন ১০০%-এর কাছে বসে থাকত।
     *
     * ⚠️ ধরা পড়েছে CI-তে, এই ফাইলের টেস্ট লাল হয়ে — প্রথমে `to` ধরা হয়েছিল।
     */
    const targetHoursInRange: Record<number, number> = {};
    const targetSpan = { from: range.from, to: range.requestedTo };
    for (const employee of employees) {
      const employed = overlapOf(targetSpan, {
        from: employee.joinedOn ?? targetSpan.from,
        to: employee.leftOn ?? targetSpan.to,
      });
      targetHoursInRange[employee.id] = secondsToHours(
        employed === null ? 0 : Math.round(netTargetSecIn(employee, employed)),
      );
    }

    return {
      range,
      employees,
      excluded,
      expectedHours,
      targetHoursInRange,
      expectedSecOf,
      /**
       * ⭐⭐ **ঠিক সেই সারিগুলো**, যেগুলো দিয়ে উপরের `holidays` সেটটা — আর
       * তাই মাসের কর্মদিবস ও দৈনিক টার্গেটের হর — বানানো হলো। আলাদা
       * কোয়েরি করলে দুটো সংখ্যা দুই জায়গা থেকে আসত, আর একদিন (রেঞ্জ বা
       * ফিল্টার একটু বদলালেই) দুটো আলাদা কথা বলত।
       */
      approximateHolidayDates: approximateHolidayDates(
        holidayRows.map((h) => ({ date: h.holidayDate, name: h.name })),
      ),
      ruleOf,
      employedOn: (employee, date) =>
        (employee.joinedOn === null ||
          date.getTime() >= employee.joinedOn.getTime()) &&
        (employee.leftOn === null ||
          date.getTime() <= employee.leftOn.getTime()),
      targetSecOf,
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

    // ⭐⭐ অনিশ্চয়তা সংখ্যা পর্যন্ত পৌঁছায়: এই মাসগুলোর কোন ছুটির তারিখ
    //    এখনো পাকা নয়। ওগুলো নড়লে কর্মদিবস নড়ে, টার্গেট নড়ে, পে-রোলের
    //    ভগ্নাংশও নড়ে — তাই চুপ করে থাকা যায় না।
    approximateHolidayDates: ctx.approximateHolidayDates,

    // ⭐⭐ এই পরিসরে তার **আসল** টার্গেট — অফিস-ডে × দৈনিক টার্গেট (G117)।
    // ⚠️ আগে এখানে বসত পলিসির ফ্ল্যাট ২০৮, যেটা কেবল ২৬ অফিস-ডের মাসে
    //    ঠিক হতো; অক্টোবরে ২৪ দিন = ১৯২ঘ, অর্থাৎ ১৬ ঘণ্টার ভুতুড়ে ঘাটতি।
    // ⭐ হিসাবটা `context()`-এ, `expectedHours`-এর সাথে **একই সূত্রে**।
    targetHoursInRange: ctx.targetHoursInRange,

    // ⭐⭐ "এ পর্যন্ত কত হওয়ার কথা ছিল" — জানালাটা `elapsedWindow()`-এর,
    //    অর্থাৎ tray ও Live Board-এর সাথে হুবহু একই সংজ্ঞা।
    expectedHours: ctx.expectedHours,
  };
}
