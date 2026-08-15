import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { workDateOf } from '../agent/util/dhaka-time';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { paisaToTaka } from '../payroll/payroll.math';
import { PrismaService } from '../prisma/prisma.service';
import {
  checkNotice,
  isYearMonth,
  monthsBetween,
  type YearMonth,
} from './deposit.math';
import type { SettleDepositDto, UpdateDepositPolicyDto } from './dto';

export interface DepositPolicyView {
  amount: string;
  amountPaisa: number;
  startYearMonth: string;
  noticeDays: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface DepositMonth {
  yearMonth: string;
  amount: string;
}

export interface DepositSettlementView {
  outcome: 'refunded' | 'forfeited';
  amount: string;
  noticeGivenOn: string | null;
  lastWorkingDay: string | null;
  noticeDaysGiven: number | null;
  noticeDaysRule: number;
  note: string | null;
  settledAt: string;
  settledBy: string;
}

export interface DepositBalance {
  employeeId: number;
  empCode: string;
  fullName: string;
  status: string;
  months: number;
  balance: string;
  balancePaisa: number;
  /** নিষ্পত্তি হয়ে গেলে খাতা বন্ধ — তখন `balance` কেবল ইতিহাস */
  settlement: DepositSettlementView | null;
}

/**
 * R21 — **সিকিউরিটি মানি (জামানত)।**
 *
 * মালিকের কথা *(১৫ আগস্ট)*: প্রতি মাসে বেতন থেকে ৫০০ টাকা কেটে রাখা হয়,
 * আর কেউ ৩০ দিন আগে জানিয়ে চাকরি ছাড়লে পুরো জমাটা ফেরত পান।
 *
 * ⭐⭐ **খাতাটা লিখে রাখা হয়, গোনা হয় না** — কারণ জমা টাকা একটা ঘটনার
 * ইতিহাস, আজকের নিয়মের ফল নয়। অঙ্কটা কাল ৬০০ হলে গত ছ-মাসের জমাও পিছন
 * ফিরে বাড়ত, আর খাতা এমন টাকা দাবি করত যা কেউ কোনোদিন দেননি।
 *
 * ⚠️ কিস্তি বসে **অলসভাবে** (`ensureLedger`) — কোনো cron নেই। কারণ cron
 * হলে সার্ভার এক দিন বন্ধ থাকলেই একটা মাস নীরবে বাদ পড়ত, আর কেউ টের
 * পেত না। এখানে যে-ই খাতাটা খোলেন, খাতা তখনই আজকের দিন পর্যন্ত পূর্ণ হয়।
 */
@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** ঢাকার ক্যালেন্ডারে চলতি মাস — `2026-08` */
  private currentMonth(): YearMonth {
    return workDateOf(new Date()).toISOString().slice(0, 7);
  }

  async policy(): Promise<DepositPolicyView> {
    const row = await this.prisma.depositPolicy.findUnique({ where: { id: 1 } });

    /**
     * ⚠️ সারিটা migration-এই বসে যায়। তবু না পেলে **ছোড়া হয়**, ফাঁকা
     * ডিফল্ট বানানো হয় না — নইলে ডাটাবেস অর্ধেক বসা অবস্থায় সিস্টেম
     * নিজের বানানো একটা নিয়ম দিয়ে কর্মীর বেতন কাটা শুরু করত।
     */
    if (!row) {
      throw new NotFoundException(
        'The deposit rule has not been set up — run the database migrations.',
      );
    }

    return {
      amount: paisaToTaka(row.amountPaisa),
      amountPaisa: row.amountPaisa,
      startYearMonth: row.startYearMonth,
      noticeDays: row.noticeDays,
      active: row.active,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  }

  async updatePolicy(
    actor: SessionUser,
    dto: UpdateDepositPolicyDto,
    ip: string,
  ): Promise<DepositPolicyView> {
    const before = await this.policy();

    if (dto.startYearMonth && !isYearMonth(dto.startYearMonth)) {
      throw new BadRequestException('The start month must be in YYYY-MM format');
    }

    /**
     * ⚠️⚠️ শুরুর মাস **পিছিয়ে** দিলে আগের মাসগুলোয় নতুন কিস্তি বসবে, আর
     * সেটা ঠিকই আছে — মালিক তখন ইচ্ছে করেই পুরোনো মাস যোগ করছেন। কিন্তু
     * **এগিয়ে** দিলে আগের কিস্তিগুলো নিজে থেকে মুছে যায় না: টাকাটা তো
     * কেটে নেওয়া হয়েই গেছে। ভুল হলে সারিটা হাতে মুছতে হবে — নীরবে টাকা
     * উবে যাওয়ার চেয়ে সেটাই ভালো।
     */
    await this.prisma.depositPolicy.update({
      where: { id: 1 },
      data: {
        amountPaisa: dto.amountPaisa ?? undefined,
        startYearMonth: dto.startYearMonth ?? undefined,
        noticeDays: dto.noticeDays ?? undefined,
        active: dto.active ?? undefined,
        updatedBy: actor.email,
      },
    });

    const after = await this.policy();

    await this.audit.record({
      userId: actor.userId,
      action: 'deposit_policy_update',
      targetType: 'deposit_policy',
      targetId: 1,
      ipAddress: ip,
      // ⚠️ `{ ...before }` — `DepositPolicyView` একটা interface, আর Prisma-র
      //    `InputJsonValue` index signature চায়। spread করলে সেটা মেলে,
      //    আর `as any` লিখে টাইপটা চুপ করাতে হয় না।
      meta: { before: { ...before }, after: { ...after } },
    });

    return after;
  }

  /**
   * ⭐⭐ খাতাটা আজকের দিন পর্যন্ত পূর্ণ করা — **idempotent**।
   *
   * ⚠️ `skipDuplicates` ছাড়া দুটো ট্যাব একসাথে খুললেই দুবার কিস্তি বসত।
   * চাবিটা (`employee_id`, `year_month`) ডাটাবেসেও UNIQUE, তাই দৌড়ের
   * শেষ রক্ষাকবচও ওখানেই।
   */
  private async ensureLedger(): Promise<void> {
    const policy = await this.prisma.depositPolicy.findUnique({
      where: { id: 1 },
    });
    if (!policy || !policy.active) return;

    const now = this.currentMonth();
    if (policy.startYearMonth > now) return;

    const employees = await this.prisma.employee.findMany({
      select: { id: true, joinedOn: true, leftOn: true, status: true },
    });

    // ⚠️ নিষ্পত্তি হয়ে যাওয়া কর্মীর খাতায় আর কিস্তি বসে না — টাকাটা
    //    ফেরত (বা বাজেয়াপ্ত) হয়ে গেছে, খাতাটা বন্ধ।
    const settled = new Set(
      (
        await this.prisma.depositSettlement.findMany({
          select: { employeeId: true },
        })
      ).map((s) => s.employeeId),
    );

    const rows: { employeeId: number; yearMonth: string; amountPaisa: number }[] =
      [];

    for (const e of employees) {
      if (settled.has(e.id)) continue;

      /**
       * ⚠️ যোগ দেওয়ার **আগের** মাসে কিস্তি বসে না। `joined_on` না থাকলে
       * নিয়মের শুরুর মাসই ধরা হয় — অনুমান করে পিছিয়ে যাওয়ার চেয়ে
       * নিরাপদ, কারণ পিছিয়ে গেলে খাতা এমন টাকা দাবি করত যা তখন তিনি
       * এখানেই ছিলেন না।
       */
      const joinedMonth = e.joinedOn
        ? e.joinedOn.toISOString().slice(0, 7)
        : policy.startYearMonth;
      const from =
        joinedMonth > policy.startYearMonth ? joinedMonth : policy.startYearMonth;

      // ⚠️ চলে গেলে তাঁর শেষ মাস পর্যন্তই — তার পরের মাসে বেতনই নেই।
      const leftMonth = e.leftOn ? e.leftOn.toISOString().slice(0, 7) : null;
      const to = leftMonth && leftMonth < now ? leftMonth : now;

      if (from > to) continue;

      for (const yearMonth of monthsBetween(from, to)) {
        rows.push({ employeeId: e.id, yearMonth, amountPaisa: policy.amountPaisa });
      }
    }

    if (rows.length === 0) return;

    const { count } = await this.prisma.securityDeposit.createMany({
      data: rows,
      skipDuplicates: true,
    });

    if (count > 0) {
      this.logger.log(`জামানতের খাতায় ${count}টা নতুন কিস্তি বসল`);
    }
  }

  /**
   * ⭐ একটা মাসের কিস্তিগুলো, কর্মী ধরে — পে-রোলের শিট এটাই ডাকে।
   *
   * ⚠️ ম্যাপে **যাঁর কিস্তি বসেনি তাঁর চাবিই থাকে না**, শূন্য নয়। শিটে
   * "৳০ কাটা হয়েছে" আর "কাটার কথাই ছিল না" দুটো আলাদা কথা, আর শূন্য
   * বসালে দুটোই এক দেখাত।
   */
  async instalmentsFor(yearMonth: string): Promise<Map<number, number>> {
    await this.ensureLedger();

    const rows = await this.prisma.securityDeposit.findMany({
      where: { yearMonth },
      select: { employeeId: true, amountPaisa: true },
    });

    return new Map(rows.map((r) => [r.employeeId, r.amountPaisa]));
  }

  /** একজনের মাস-ধরে তালিকা ও মোট — স্টাফ নিজেরটা দেখতে এটাই ডাকে */
  async forEmployee(employeeId: number): Promise<{
    months: DepositMonth[];
    total: string;
    totalPaisa: number;
    settlement: DepositSettlementView | null;
    noticeDays: number;
  }> {
    await this.ensureLedger();

    const [rows, settlement, policy] = await Promise.all([
      this.prisma.securityDeposit.findMany({
        where: { employeeId },
        orderBy: { yearMonth: 'asc' },
      }),
      this.prisma.depositSettlement.findUnique({ where: { employeeId } }),
      this.policy(),
    ]);

    const totalPaisa = rows.reduce((sum, r) => sum + r.amountPaisa, 0);

    return {
      months: rows.map((r) => ({
        yearMonth: r.yearMonth,
        amount: paisaToTaka(r.amountPaisa),
      })),
      total: paisaToTaka(totalPaisa),
      totalPaisa,
      settlement: settlement ? toSettlementView(settlement) : null,
      noticeDays: policy.noticeDays,
    };
  }

  /** সবার জমা — owner-এর পর্দার তালিকা */
  async balances(): Promise<{ rows: DepositBalance[]; policy: DepositPolicyView }> {
    await this.ensureLedger();

    const [employees, sums, settlements, policy] = await Promise.all([
      this.prisma.employee.findMany({
        select: { id: true, empCode: true, fullName: true, status: true },
        orderBy: { empCode: 'asc' },
      }),
      this.prisma.securityDeposit.groupBy({
        by: ['employeeId'],
        _sum: { amountPaisa: true },
        _count: { _all: true },
      }),
      this.prisma.depositSettlement.findMany(),
      this.policy(),
    ]);

    const sumOf = new Map(sums.map((s) => [s.employeeId, s]));
    const settledOf = new Map(settlements.map((s) => [s.employeeId, s]));

    return {
      policy,
      rows: employees.map((e) => {
        const agg = sumOf.get(e.id);
        const balancePaisa = agg?._sum.amountPaisa ?? 0;
        const settlement = settledOf.get(e.id);

        return {
          employeeId: e.id,
          empCode: e.empCode,
          fullName: e.fullName,
          status: e.status,
          months: agg?._count._all ?? 0,
          balance: paisaToTaka(balancePaisa),
          balancePaisa,
          settlement: settlement ? toSettlementView(settlement) : null,
        };
      }),
    };
  }

  /**
   * ⭐⭐ **নিষ্পত্তি — সিদ্ধান্তটা মালিকের, হিসাবটা সিস্টেমের।**
   *
   * ⚠️ নিয়ম মিলুক বা না মিলুক, `outcome` মালিকই পাঠান। সিস্টেম শুধু
   * `noticeDaysGiven` বের করে সারিতে লিখে রাখে — যাতে ছ-মাস পরে কেউ
   * জিজ্ঞেস করলে "কিসের ভিত্তিতে" প্রশ্নের উত্তর খাতাতেই থাকে।
   * ব্যতিক্রম সবসময়ই থাকে (হাসপাতাল, পারিবারিক কারণ), আর সেগুলো কোনো
   * `if`-এ ধরা যায় না।
   */
  async settle(
    actor: SessionUser,
    employeeId: number,
    dto: SettleDepositDto,
    ip: string,
  ): Promise<DepositSettlementView> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, empCode: true, fullName: true },
    });
    if (!employee) throw new NotFoundException('No such employee');

    const existing = await this.prisma.depositSettlement.findUnique({
      where: { employeeId },
    });
    if (existing) {
      // ⚠️ ৪০৯, নীরবে দ্বিতীয় সারি নয় — টাকা দুবার ফেরত দেওয়ার হিসাব
      //    কোথাও লেখা থাকত না।
      throw new ConflictException(
        `${employee.empCode}-এর জামানত ইতিমধ্যে নিষ্পত্তি হয়েছে (${existing.outcome})।`,
      );
    }

    await this.ensureLedger();

    const agg = await this.prisma.securityDeposit.aggregate({
      where: { employeeId },
      _sum: { amountPaisa: true },
    });
    const amountPaisa = agg._sum.amountPaisa ?? 0;

    const policy = await this.policy();
    const notice = checkNotice(
      dto.noticeGivenOn ? new Date(dto.noticeGivenOn) : null,
      dto.lastWorkingDay ? new Date(dto.lastWorkingDay) : null,
      policy.noticeDays,
    );

    const row = await this.prisma.depositSettlement.create({
      data: {
        employeeId,
        outcome: dto.outcome,
        amountPaisa,
        noticeGivenOn: dto.noticeGivenOn ? new Date(dto.noticeGivenOn) : null,
        lastWorkingDay: dto.lastWorkingDay ? new Date(dto.lastWorkingDay) : null,
        noticeDaysGiven: notice.daysGiven,
        noticeDaysRule: notice.daysRule,
        note: dto.note ?? null,
        settledBy: actor.email,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'deposit_settle',
      targetType: 'employee',
      targetId: employeeId,
      ipAddress: ip,
      meta: {
        empCode: employee.empCode,
        outcome: dto.outcome,
        amount: paisaToTaka(amountPaisa),
        // ⭐ নিয়ম কী বলেছিল আর মালিক কী করলেন — দুটোই থাকে, কারণ ব্যতিক্রম
        //    হলে ঠিক ওই জোড়াটাই পরে দেখতে হবে
        noticeDaysGiven: notice.daysGiven,
        noticeDaysRule: notice.daysRule,
        followedRule: notice.meetsRule === (dto.outcome === 'refunded'),
      },
    });

    return toSettlementView(row);
  }
}

function toSettlementView(row: {
  outcome: string;
  amountPaisa: number;
  noticeGivenOn: Date | null;
  lastWorkingDay: Date | null;
  noticeDaysGiven: number | null;
  noticeDaysRule: number;
  note: string | null;
  settledAt: Date;
  settledBy: string;
}): DepositSettlementView {
  return {
    outcome: row.outcome as 'refunded' | 'forfeited',
    amount: paisaToTaka(row.amountPaisa),
    noticeGivenOn: row.noticeGivenOn?.toISOString().slice(0, 10) ?? null,
    lastWorkingDay: row.lastWorkingDay?.toISOString().slice(0, 10) ?? null,
    noticeDaysGiven: row.noticeDaysGiven,
    noticeDaysRule: row.noticeDaysRule,
    note: row.note,
    settledAt: row.settledAt.toISOString(),
    settledBy: row.settledBy,
  };
}
