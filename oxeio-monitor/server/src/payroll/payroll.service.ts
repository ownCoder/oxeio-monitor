import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { computePayroll, paisaToTaka } from './payroll.math';

export interface PayrollRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  designation: string | null;
  /** null = এই কর্মীর বেতন বসানো নেই — শূন্য ধরা হয় না, আলাদা করে দেখানো হয় */
  monthlySalary: string | null;
  targetHours: string;
  /**
   * ⭐ **G37** — তার কর্মদিবস (d) ও মাসের কর্মদিবস (D)।
   *
   * ⚠️ শিটে দেখানোর জন্য **অপরিহার্য**: prorated সারিতে বেতনের ঘরে
   * পুরো মাসিক বেতনের চেয়ে কম সংখ্যা থাকে, আর কেন কম সেটা না দেখালে
   * প্রতিটা মাসে কেউ না কেউ জিজ্ঞেস করত — বা খারাপ ক্ষেত্রে, ভুল ধরে নিত।
   */
  workdays: number;
  monthWorkdays: number;
  creditedHours: string;
  shortfallHours: string;
  overtimeHours: string;
  hourlyRate: string | null;
  deduction: string | null;
  payable: string | null;
}

export interface PayrollSheet {
  yearMonth: string;
  rows: PayrollRow[];
  /** যাদের বেতন বসানো নেই — চুপচাপ বাদ না দিয়ে নাম ধরে জানানো হয় */
  missingSalary: string[];
  /** যাদের ওই মাসের rollup এখনো হয়নি */
  missingSummary: string[];
}

const HOUR = 3600;

/**
 * F03 — মাসিক পে-রোল শিট ([ADR-023](../../../docs/05-Options-Decisions.md))।
 *
 * ⚠️ এই সার্ভিসই একমাত্র জায়গা যেখানে `monthly_salary` পড়া হয়। অন্য কোনো
 * endpoint ওই কলামটা select করে না — তাই ম্যানেজার বা স্টাফের কোনো
 * রেসপন্সে ভুল করেও বেতন ফাঁস হওয়ার পথ নেই।
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async sheet(
    yearMonth: string,
    actorUserId: number,
    ip: string,
  ): Promise<PayrollSheet> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      throw new BadRequestException('The month must be in YYYY-MM format');
    }

    const employees = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        empCode: true,
        fullName: true,
        designation: true,
        monthlySalary: true,
      },
      orderBy: { empCode: 'asc' },
    });

    const summaries = await this.prisma.monthlySummary.findMany({
      where: { yearMonth, employeeId: { in: employees.map((e) => e.id) } },
    });
    const byEmployee = new Map(summaries.map((s) => [s.employeeId, s]));

    const rows: PayrollRow[] = [];
    const missingSalary: string[] = [];
    const missingSummary: string[] = [];

    for (const e of employees) {
      const summary = byEmployee.get(e.id);
      if (!summary) {
        missingSummary.push(e.fullName);
        continue;
      }

      const base = {
        employeeId: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        designation: e.designation,
        targetHours: hours(summary.targetSec),
        workdays: summary.expectedWorkdays,
        monthWorkdays: summary.monthWorkdays,
        creditedHours: hours(summary.creditedSec),
        shortfallHours: hours(Math.max(0, summary.targetSec - summary.creditedSec)),
        overtimeHours: hours(Math.max(0, summary.creditedSec - summary.targetSec)),
      };

      if (e.monthlySalary === null) {
        // ⚠️ শূন্য ধরে নেওয়া হয় না। "বেতন বসানো নেই" আর "বেতন শূন্য" এক নয়,
        //    আর প্রথমটাকে দ্বিতীয়টা ধরে নিলে শিটে চুপচাপ ভুল সংখ্যা যেত।
        missingSalary.push(e.fullName);
        rows.push({
          ...base,
          monthlySalary: null,
          hourlyRate: null,
          deduction: null,
          payable: null,
        });
        continue;
      }

      const line = computePayroll({
        monthlySalary: Number(e.monthlySalary),
        targetSec: summary.targetSec,
        creditedSec: summary.creditedSec,
        // ⭐ G37 — d ও D সারিতেই লেখা আছে, এখানে আবার গোনা হয় না।
        //    গুনলে ছুটির তালিকা বদলালে d আর D দুই আলাদা সময়ের হিসাব হতো।
        workdays: summary.expectedWorkdays,
        monthWorkdays: summary.monthWorkdays,
      });

      rows.push({
        ...base,
        monthlySalary: e.monthlySalary.toFixed(2),
        hourlyRate: paisaToTaka(line.hourlyRatePaisa),
        deduction: paisaToTaka(line.deductionPaisa),
        payable: paisaToTaka(line.payablePaisa),
      });
    }

    // ⭐ বেতন দেখা একটা ঘটনা — কে কখন দেখল, লেখা থাকবে (I-গ্রুপ, audit log)
    await this.audit.record({
      userId: actorUserId,
      action: 'payroll_view',
      targetType: 'payroll',
      targetId: yearMonth,
      ipAddress: ip,
      meta: { rows: rows.length },
    });

    if (missingSummary.length > 0) {
      this.logger.warn(
        `${yearMonth}: ${missingSummary.length} staff have no monthly rollup — they are missing from the sheet`,
      );
    }

    return { yearMonth, rows, missingSalary, missingSummary };
  }
}

function hours(sec: number): string {
  return (sec / HOUR).toFixed(2);
}
