import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { DepositsService } from '../deposits/deposits.service';
import { PrismaService } from '../prisma/prisma.service';
import { computePayroll, paisaToTaka, salaryForMonth } from './payroll.math';

export interface PayrollRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  /**
   * ⭐ কাজের ধরন *(২২ আগস্ট)* — `designation`/`department`-এর জায়গায়।
   *
   * ⚠️ ওই দুটো ঘর ফর্ম থেকে তুলে দেওয়া হয়েছে (মালিকের সিদ্ধান্ত), তাই
   * পর্দায় ওগুলো দেখানো মানে **নীরবে বাসি মান** দেখানো — নতুন কর্মীর
   * ঘর খালিই থাকত।
   */
  staffType: 'designer' | 'researcher' | 'manager' | null;
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

  /**
   * ⭐ **R21 — ওই মাসের জামানতের কিস্তি** (`security_deposits` থেকে)।
   *
   * ⚠️ শূন্য নয়, `null` — যদি ওই মাসে কোনো কিস্তিই না বসে থাকে (নিয়ম
   * শুরুর আগের মাস, বা তিনি তখন যোগই দেননি)। শূন্য লিখলে "৳০ কাটা
   * হয়েছে" আর "কাটার কথাই ছিল না" এক দেখাত।
   */
  securityDeposit: string | null;

  /**
   * ⭐ হাতে যা যাবে — `payable − securityDeposit`।
   *
   * ⚠️⚠️ শিটে **দুটো সংখ্যাই** থাকে, কারণ ওরা দুটো আলাদা প্রশ্নের উত্তর:
   * `payable` = ঘণ্টার হিসাবে তাঁর প্রাপ্য, `netPayable` = এই মাসে হাতে
   * দেওয়া হবে। জামানত বেতন **কমায় না**, শুধু জমা থাকে — একটাই সংখ্যা
   * দেখালে ওই পার্থক্যটা হারিয়ে যেত, আর ছেড়ে দেওয়ার সময় ফেরতের হিসাবও
   * ব্যাখ্যা করা যেত না।
   */
  netPayable: string | null;
}

export interface PayrollSheet {
  yearMonth: string;
  rows: PayrollRow[];
  /** যাদের বেতন বসানো নেই — চুপচাপ বাদ না দিয়ে নাম ধরে জানানো হয় */
  missingSalary: string[];
  /** যাদের ওই মাসের rollup এখনো হয়নি */
  missingSummary: string[];

  /**
   * ⚠️⚠️ **R21** — যাঁদের ওই মাসের প্রদেয় জামানতের কিস্তির চেয়ে কম।
   *
   * এমনটা হয় কেউ পুরো মাস অনুপস্থিত থাকলে। তখন `netPayable` ঋণাত্মক হতো,
   * আর ঋণাত্মক বেতন কোনো অর্থ বহন করে না — তাই ওটা শূন্যে থামানো হয়, আর
   * নামটা এখানে **আলাদা করে বলা হয়**। ⭐ নীরবে থামালে খাতায় ৫০০ টাকা
   * জমা দেখাত অথচ টাকাটা কোনোদিন কাটাই যেত না।
   */
  depositExceedsPayable: string[];
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
    /**
     * ⭐ R21 — শিট খোলার সময় জামানতের খাতাটাও আজকের দিন পর্যন্ত পূর্ণ হয়ে
     * যায় (`ledgerFor`)। ⚠️ নিজে গুনে নেওয়া হয় না: হিসাবটা এক জায়গাতেই
     * থাকা দরকার, নইলে কর্মীর পাতা আর শিট দুই সংখ্যা দেখাত।
     */
    private readonly deposits: DepositsService,
  ) {}

  async sheet(
    yearMonth: string,
    actorUserId: number,
    ip: string,
  ): Promise<PayrollSheet> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      throw new BadRequestException('The month must be in YYYY-MM format');
    }

    /**
     * ⭐⭐ **ওই মাসে যাঁরা কর্মরত ছিলেন** *(২৩ আগস্ট ২০২৬)*, আজ যাঁরা আছেন
     * তাঁরা নন।
     *
     * ⚠️⚠️ আগে ছাঁকনি ছিল `status: 'active'` — অর্থাৎ কেউ চাকরি ছাড়লে
     * **তাঁর পুরোনো মাসের শিট থেকেও উধাও** হয়ে যেতেন, যদিও সেই বেতন
     * দেওয়া হয়ে গেছে। শিটটা ছাপা হয়েছিল একরকম, পরে খুললে আরেকরকম।
     *
     * ⭐ এখন প্রশ্নটা তারিখের: ওই মাস শেষ হওয়ার আগে যোগ দিয়েছেন, আর
     * মাস শুরুর আগে ছেড়ে যাননি।
     */
    const monthStart = new Date(`${yearMonth}-01T00:00:00Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    const employees = await this.prisma.employee.findMany({
      where: {
        AND: [
          { OR: [{ joinedOn: null }, { joinedOn: { lt: monthEnd } }] },
          { OR: [{ leftOn: null }, { leftOn: { gte: monthStart } }] },
        ],
      },
      select: {
        id: true,
        empCode: true,
        fullName: true,
        staffType: true,
        monthlySalary: true,
        /**
         * ⭐ পুরোনো বেতনের টুকরোগুলো — `salaryForMonth()` এখান থেকেই
         * ওই মাসের সত্যিকারের সংখ্যাটা বাছে।
         *
         * ⚠️ কেবল যেগুলো ওই মাস বা তার পরে শেষ হয়েছে — তার আগেরগুলো
         * এই মাসের কোনো উত্তর দেয় না, টেনে আনার মানে নেই।
         */
        salaryPeriods: {
          where: { throughMonth: { gte: yearMonth } },
          select: { throughMonth: true, monthlySalary: true },
        },
      },
      orderBy: { empCode: 'asc' },
    });

    const summaries = await this.prisma.monthlySummary.findMany({
      where: { yearMonth, employeeId: { in: employees.map((e) => e.id) } },
    });
    const byEmployee = new Map(summaries.map((s) => [s.employeeId, s]));

    /**
     * ⭐ R21 — ওই মাসের জামানতের কিস্তি। `depositsFor()` খাতাটা আগে আজকের
     * দিন পর্যন্ত পূর্ণ করে নেয়, তাই শিট খুললেই খাতাও হালনাগাদ।
     */
    const depositOf = await this.deposits.instalmentsFor(yearMonth);

    const rows: PayrollRow[] = [];
    const missingSalary: string[] = [];
    const missingSummary: string[] = [];
    const depositExceedsPayable: string[] = [];

    for (const e of employees) {
      const summary = byEmployee.get(e.id);
      if (!summary) {
        missingSummary.push(e.fullName);
        continue;
      }

      /**
       * ⚠️⚠️ **এখনকার বেতন নয় — ওই মাসে যেটা চলছিল।**
       *
       * আগে সরাসরি `e.monthlySalary` পড়া হতো, তাই কারো বেতন বাড়ালে
       * **বন্ধ মাসের শিটও বদলে যেত** (R1 কেবল ঘণ্টা সুরক্ষিত করেছিল)।
       * ইতিহাস খালি থাকলে `salaryForMonth()` এখনকার মানই ফেরত দেয়,
       * তাই যাঁদের বেতন কোনোদিন বদলায়নি তাঁদের কিছুই বদলায় না।
       */
      const salaryThatMonth = salaryForMonth(
        yearMonth,
        e.monthlySalary === null ? null : String(e.monthlySalary),
        e.salaryPeriods.map((s) => ({
          throughMonth: s.throughMonth,
          monthlySalary: String(s.monthlySalary),
        })),
      );

      const base = {
        employeeId: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        staffType: e.staffType,
        targetHours: hours(summary.targetSec),
        workdays: summary.expectedWorkdays,
        monthWorkdays: summary.monthWorkdays,
        creditedHours: hours(summary.creditedSec),
        shortfallHours: hours(Math.max(0, summary.targetSec - summary.creditedSec)),
        overtimeHours: hours(Math.max(0, summary.creditedSec - summary.targetSec)),
      };

      if (salaryThatMonth === null) {
        // ⚠️ শূন্য ধরে নেওয়া হয় না। "বেতন বসানো নেই" আর "বেতন শূন্য" এক নয়,
        //    আর প্রথমটাকে দ্বিতীয়টা ধরে নিলে শিটে চুপচাপ ভুল সংখ্যা যেত।
        missingSalary.push(e.fullName);
        rows.push({
          ...base,
          monthlySalary: null,
          hourlyRate: null,
          deduction: null,
          payable: null,
          // ⚠️ কিস্তিটা তবু দেখানো হয় — টাকাটা কাটার কথা ছিল কি না সেটা
          //    বেতন বসানো আছে কি না তার উপর নির্ভর করে না। কিন্তু নিট
          //    হিসাব করা যায় না, তাই `netPayable` null।
          securityDeposit: takaOrNull(depositOf.get(e.id)),
          netPayable: null,
        });
        continue;
      }

      const line = computePayroll({
        // ⚠️ ওই মাসের বেতন — এখনকারটা নয় (উপরের নোট দেখুন)
        monthlySalary: Number(salaryThatMonth),
        targetSec: summary.targetSec,
        creditedSec: summary.creditedSec,
        // ⭐ G37 — d ও D সারিতেই লেখা আছে, এখানে আবার গোনা হয় না।
        //    গুনলে ছুটির তালিকা বদলালে d আর D দুই আলাদা সময়ের হিসাব হতো।
        workdays: summary.expectedWorkdays,
        monthWorkdays: summary.monthWorkdays,
      });

      const depositPaisa = depositOf.get(e.id) ?? null;

      /**
       * ⚠️⚠️ ঋণাত্মক বেতন বলে কিছু নেই। কেউ পুরো মাস অনুপস্থিত থাকলে
       * `payable` ০ হয়ে যায়, আর তখন ৫০০ টাকা কাটার জায়গাই থাকে না।
       * সংখ্যাটা শূন্যে থামানো হয়, ⭐ কিন্তু নামটা `depositExceedsPayable`-এ
       * আলাদা করে বলা হয় — নীরবে থামালে খাতায় জমা দেখাত অথচ টাকাটা
       * কোনোদিন কাটাই যেত না।
       */
      if (depositPaisa !== null && depositPaisa > line.payablePaisa) {
        depositExceedsPayable.push(e.fullName);
      }

      rows.push({
        ...base,
        // ⚠️ `Number(...).toFixed(2)` নয় — স্ট্রিংটাই Decimal থেকে এসেছে,
        //    আর মাঝপথে number-এ নিলে টাকার মান নীরবে গোল হতে পারত
        monthlySalary: Number(salaryThatMonth).toFixed(2),
        hourlyRate: paisaToTaka(line.hourlyRatePaisa),
        deduction: paisaToTaka(line.deductionPaisa),
        payable: paisaToTaka(line.payablePaisa),
        securityDeposit: takaOrNull(depositPaisa),
        netPayable: paisaToTaka(
          Math.max(0, line.payablePaisa - (depositPaisa ?? 0)),
        ),
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

    return {
      yearMonth,
      rows,
      missingSalary,
      missingSummary,
      depositExceedsPayable,
    };
  }
}

function hours(sec: number): string {
  return (sec / HOUR).toFixed(2);
}

/** ⚠️ `null` মানে "ওই মাসে কিস্তিই বসেনি" — ০ টাকা নয় */
function takaOrNull(paisa: number | null | undefined): string | null {
  return paisa === null || paisa === undefined ? null : paisaToTaka(paisa);
}
