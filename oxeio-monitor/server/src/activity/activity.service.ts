import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import {
  foldDailyScores,
  foldTeamSites,
  foldUsage,
  resolveRange,
  scoreOf,
  emptyBuckets,
  toDateKey,
  TOP_N,
  type CategoryMeta,
  type DailyScore,
  type ProductivityScore,
  type TeamSiteReport,
  type UsageReport,
  type WorkDateRange,
} from './activity.math';
import type {
  EmployeeRangeQueryDto,
  RangeQueryDto,
  TeamQueryDto,
  TopQueryDto,
} from './dto';

export interface EmployeeProductivity {
  employeeId: number;
  empCode: string;
  fullName: string;
  days: DailyScore[];
  total: ProductivityScore;
}

export interface ProductivityReport {
  from: string;
  to: string;
  employees: EmployeeProductivity[];
  caveat: string;
}

export interface TopReport {
  from: string;
  to: string;
  employeeId: number | null;
  apps: UsageReport;
  sites: UsageReport;
  caveat: string;
}

export interface TeamReport extends TeamSiteReport {
  from: string;
  to: string;
  employeesWithData: number;
  caveat: string;
}

/**
 * ⚠️ **একজনের দুটো PC চললে সময় দু-বার গোনা হয়** (স্পেক § ২.১-গ)।
 *
 * `worked_sec` ওই সমস্যা এড়ায় ACTIVE সেগমেন্টের **UNION** নিয়ে। কিন্তু
 * `app_usage`-এ union করার কোনো অর্থপূর্ণ উপায় নেই: একই মুহূর্তে ডেস্কটপে
 * VS Code আর ল্যাপটপে YouTube চললে "ওই সেকেন্ডটা কার" — এর সঠিক উত্তর নেই,
 * আর একটা বেছে নিলে সেটা নীরবে নীতি হয়ে যেত।
 *
 * তাই এখানে **যোগফলই** নেওয়া হয়, আর সেটা স্পষ্ট করে বলা হয়:
 * - **অনুপাত (scorePct, sharePct) টিকে থাকে** — লব ও হর দুটোই সমানুপাতে বাড়ে
 * - **পরম সেকেন্ড কাজের ঘণ্টা নয়** — কখনোই `credited_sec`-এর সাথে মেলানো
 *   যাবে না, আর কোনো অবস্থাতেই বেতনের হিসাবে ঢোকে না
 */
const OVERLAP_CAVEAT =
  'একজনের একাধিক ডিভাইস চললে সময় যোগ হয়ে যায় (§ ২.১-গ) — অনুপাত ঠিক থাকে, কিন্তু পরম সেকেন্ডকে কাজের ঘণ্টা ধরা যাবে না';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  // ── D07 · দৈনিক productivity স্কোর ─────────────────────────────────────────

  async productivity(query: EmployeeRangeQueryDto): Promise<ProductivityReport> {
    const range = this.range(query);
    const employees = await this.employees(query.employeeId);

    const [groups, meta] = await Promise.all([
      this.prisma.appUsage.groupBy({
        by: ['employeeId', 'workDate', 'categoryId'],
        where: this.where(range, employees.map((e) => e.id)),
        _sum: { durationSec: true },
      }),
      this.categoryMeta(),
    ]);

    const folded = foldDailyScores(
      groups.map((g) => ({
        employeeId: g.employeeId,
        workDate: g.workDate,
        categoryId: g.categoryId,
        seconds: g._sum.durationSec ?? 0,
      })),
      meta,
    );

    return {
      from: toDateKey(range.from),
      to: toDateKey(range.to),
      // ⭐ যাদের একটাও সারি নেই তারাও তালিকায় থাকেন — শূন্য দিন চুপচাপ
      //    বাদ দিলে "এজেন্ট বন্ধ" আর "সব ঠিক আছে" দেখতে একরকম হতো
      employees: employees.map((e) => {
        const rows = folded.get(e.id);
        return {
          employeeId: e.id,
          empCode: e.empCode,
          fullName: e.fullName,
          days: rows?.days ?? [],
          total: rows?.total ?? scoreOf(emptyBuckets()),
        };
      }),
      caveat: OVERLAP_CAVEAT,
    };
  }

  // ── D08 · টপ ১০ অ্যাপ ও সাইট ───────────────────────────────────────────────

  async top(query: TopQueryDto): Promise<TopReport> {
    const range = this.range(query);
    const employeeIds =
      query.employeeId === undefined
        ? undefined
        : (await this.employees(query.employeeId)).map((e) => e.id);

    const where = this.where(range, employeeIds);
    const limit = query.limit ?? TOP_N;

    const [appGroups, siteGroups, meta] = await Promise.all([
      this.prisma.appUsage.groupBy({
        by: ['processName', 'categoryId'],
        where,
        _sum: { durationSec: true },
        _count: { _all: true },
      }),
      this.prisma.appUsage.groupBy({
        by: ['domain', 'categoryId'],
        // ⚠️ ডোমেইনহীন সারি (ব্রাউজার নয় এমন অ্যাপ) সাইটের তালিকায়
        //    ঢুকলে "(খালি)" নামে একটা সারি সবচেয়ে উপরে বসে থাকত
        where: { ...where, domain: { not: null } },
        _sum: { durationSec: true },
        _count: { _all: true },
      }),
      this.categoryMeta(),
    ]);

    return {
      from: toDateKey(range.from),
      to: toDateKey(range.to),
      employeeId: query.employeeId ?? null,
      apps: foldUsage(
        appGroups.map((g) => ({
          key: g.processName,
          categoryId: g.categoryId,
          seconds: g._sum.durationSec ?? 0,
          records: g._count._all,
        })),
        meta,
        'app',
        limit,
      ),
      sites: foldUsage(
        siteGroups
          .filter((g): g is typeof g & { domain: string } => g.domain !== null)
          .map((g) => ({
            key: g.domain,
            categoryId: g.categoryId,
            seconds: g._sum.durationSec ?? 0,
            records: g._count._all,
          })),
        meta,
        'site',
        limit,
      ),
      // ⚠️ অ্যাপ ও সাইটের সময় **যোগ করা যাবে না** — chrome.exe-এর ৩ ঘণ্টার
      //    ভেতরেই youtube.com-এর ১ ঘণ্টা আছে। দুটো তালিকা একই সময়ের
      //    দুই রকম কাটাছেঁড়া, দুটো আলাদা ভাগ নয়।
      caveat: `${OVERLAP_CAVEAT}। অ্যাপ ও সাইটের সময় একই সময়ের দুই রকম হিসাব — যোগ করা যাবে না`,
    };
  }

  // ── D09 · টিম-ভিত্তিক সাইট সারাংশ ──────────────────────────────────────────

  /**
   * পুরো টিম মিলিয়ে কোন সাইটে কত সময়।
   *
   * ⚠️ `employeeId` ফিল্টার ইচ্ছাকৃতভাবে **নেই** — একজনের হিসাব চাইলে
   * `/activity/top` আছে। দুটো এক করে ফেললে "টিমের অভ্যাস" আর "একজনের
   * অভ্যাস" একই রেসপন্স শেপে আসত, আর কোনটা দেখা হচ্ছে বোঝা যেত না।
   * পাশাপাশি প্রতিটা সারিতে `employees` ও `topEmployeeId` থাকে, যাতে
   * একজনের সময়কে টিমের বলে চালানো না যায়।
   */
  async team(query: TeamQueryDto): Promise<TeamReport> {
    const range = this.range(query);

    const [groups, meta] = await Promise.all([
      this.prisma.appUsage.groupBy({
        by: ['domain', 'employeeId', 'categoryId'],
        where: { ...this.where(range), domain: { not: null } },
        _sum: { durationSec: true },
      }),
      this.categoryMeta(),
    ]);

    const rows = groups.filter(
      (g): g is typeof g & { domain: string } => g.domain !== null,
    );

    const report = foldTeamSites(
      rows.map((g) => ({
        domain: g.domain,
        employeeId: g.employeeId,
        categoryId: g.categoryId,
        seconds: g._sum.durationSec ?? 0,
      })),
      meta,
      query.limit ?? TOP_N,
    );

    return {
      ...report,
      from: toDateKey(range.from),
      to: toDateKey(range.to),
      employeesWithData: new Set(rows.map((g) => g.employeeId)).size,
      caveat: OVERLAP_CAVEAT,
    };
  }

  // ── ভাগাভাগি করা অংশ ───────────────────────────────────────────────────────

  /**
   * ⚠️ খাঁটি `resolveRange()` HTTP-র কিছু জানে না, তাই সে `RangeError` ছোড়ে।
   * সেটা এখানেই ৪০০-তে বদলানো হয় — নইলে ব্যবহারকারীর একটা টাইপো
   * ৫০০ Internal Server Error হয়ে ফিরত, আর লগে অকারণে স্ট্যাক ট্রেস জমত।
   */
  private range(query: RangeQueryDto): WorkDateRange {
    try {
      // ⭐ "আজ" মানে **ঢাকার** আজ — সার্ভারের টাইমজোন যা-ই হোক
      return resolveRange(query.from, query.to, workDateOf(new Date()));
    } catch (err) {
      if (err instanceof RangeError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private where(
    range: WorkDateRange,
    employeeIds?: number[],
  ): Prisma.AppUsageWhereInput {
    return {
      workDate: { gte: range.from, lte: range.to },
      ...(employeeIds === undefined ? {} : { employeeId: { in: employeeIds } }),
    };
  }

  /**
   * ⚠️ `monthly_salary` **কখনো** select করা হয় না। ওটা পড়ার একমাত্র জায়গা
   * `PayrollService`, আর সেটাই owner-only ও audit করা (ADR-023)। এখানে
   * ভুল করে `select` না লিখলে পুরো Employee সারি চলে আসত — ম্যানেজারের
   * রেসপন্সেও বেতন ঢুকে যেত।
   */
  private async employees(
    employeeId?: number,
  ): Promise<Array<{ id: number; empCode: string; fullName: string }>> {
    const rows = await this.prisma.employee.findMany({
      where: employeeId === undefined ? { status: 'active' } : { id: employeeId },
      select: { id: true, empCode: true, fullName: true },
      orderBy: { empCode: 'asc' },
    });

    if (employeeId !== undefined && rows.length === 0) {
      throw new NotFoundException(`${employeeId} নম্বর কর্মী নেই`);
    }

    return rows;
  }

  /**
   * id → ক্যাটাগরির পরিচয়। ~১১০টা সারি, তাই প্রতিবার পুরোটা পড়াই সবচেয়ে সহজ।
   *
   * ⚠️ `AppCategoryService`-এর ক্যাশ **ব্যবহার করা হয় না** — ওটা `compile()`
   * করা রুল রাখে, আর সেখানে ভুল regex-ওয়ালা রুলগুলো বাদ পড়ে যায়। রিপোর্টে
   * ওই রুলের id-ওয়ালা পুরোনো সারি থাকতেই পারে; ক্যাশ থেকে নিলে সেগুলো
   * নীরবে "অচেনা" দেখাত, অথচ ডাটাবেসে ক্যাটাগরি বসানোই আছে।
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
}
