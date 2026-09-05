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
  effectiveDepositStart,
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

  /**
   * ⭐ এই কর্মীর জন্য মালিকের বেছে দেওয়া শুরুর মাস — না দিলে `null`।
   *
   * ⚠️ `effectiveStart`-ও পাঠানো হয়, কারণ পর্দায় দরকার **কোন মাস থেকে
   * সত্যিই কাটা হচ্ছে** — সেটা override, যোগদানের মাস আর নিয়মের মাস
   * তিনটের মধ্যে কোনটা জিতেছে তার উপর নির্ভর করে। শুধু override পাঠালে
   * খালি ঘর দেখে মালিক বুঝতেন না আসলে কোন মাস খাটছে।
   */
  startYearMonth: string | null;
  effectiveStart: string | null;
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
      select: {
        id: true,
        joinedOn: true,
        leftOn: true,
        status: true,
        depositStartYearMonth: true,
      },
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
      // ⭐ নিয়মটা `deposit.math.ts`-এ, একটাই সংজ্ঞা — পর্দা আর খাতা
      //    যেন কোনোদিন আলাদা মাস না বলে
      const from = effectiveDepositStart({
        override: e.depositStartYearMonth,
        joinedMonth: e.joinedOn ? e.joinedOn.toISOString().slice(0, 7) : null,
        policyStart: policy.startYearMonth,
      });

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
   * ⭐⭐ **এই কর্মীর জামানত কোন মাস থেকে কাটা শুরু** — মালিক হাতে বসান।
   *
   * ⚠️⚠️ **পুরোনো কিস্তি সরানো হয়, আর সেটাই এই ফিচারের আসল কাজ।** শুরুর
   * মাস পিছিয়ে দিলে নতুন কিস্তি বসে; **এগিয়ে দিলে আগের ভুল কিস্তিগুলো
   * মুছে যায়**। না মুছলে "ভুল সংশোধন" করেও খাতায় ভুলটা রয়ে যেত, আর
   * মালিক ভাবতেন সেভ হয়নি।
   *
   * ⚠️ মুছে ফেলা সারিগুলো **স্বয়ংক্রিয়ভাবে বসানো** কিস্তি, হাতে লেখা
   * কিছু নয় — তাই এটা ইতিহাস মোছা নয়, ভুল হিসাব ঠিক করা। কতগুলো গেল
   * সেটা audit log-এ লেখা থাকে।
   *
   * ⚠️⚠️ নিষ্পত্তি হয়ে যাওয়া কর্মীর খাতা **বন্ধ** — টাকা ফেরত বা বাজেয়াপ্ত
   * হয়ে গেছে, তাই সেখানে হাত দেওয়া মানে মিটে যাওয়া হিসাব নাড়ানো।
   */
  async setStartMonth(
    actor: SessionUser,
    employeeId: number,
    yearMonth: string | null,
    ip: string,
  ): Promise<{ removed: number; added: number }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, fullName: true, depositStartYearMonth: true },
    });
    if (!employee) throw new NotFoundException('Staff member not found');

    if (yearMonth !== null && !isYearMonth(yearMonth)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    /**
     * ⚠️ ভবিষ্যতের মাস আটকানো — নইলে খাতাটা চুপচাপ খালি হয়ে যেত (কোনো
     *    কিস্তিই আর বসত না), আর কারণটা পর্দায় কোথাও লেখা থাকত না।
     */
    if (yearMonth !== null && yearMonth > this.currentMonth()) {
      throw new BadRequestException('That month has not started yet');
    }

    const settled = await this.prisma.depositSettlement.findFirst({
      where: { employeeId },
      select: { employeeId: true },
    });
    if (settled) {
      throw new ConflictException(
        'This deposit is already settled — the ledger is closed, so the start month cannot change',
      );
    }

    // ⚠️ কিছুই বদলায়নি — audit-এ ঘটনা লেখা হয় না
    if ((employee.depositStartYearMonth ?? null) === yearMonth) {
      return { removed: 0, added: 0 };
    }

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { depositStartYearMonth: yearMonth },
    });

    /**
     * ⚠️ আগের মাসগুলোর কিস্তি সরানো হয় **শুধু নতুন শুরু বসালে**। `null`
     *    করলে (নিয়মের সাধারণ মাসে ফেরত) কিছু মোছা হয় না — তখন খাতাটা
     *    এমনিতেই আবার ভরে যাবে, আর অকারণে সারি মুছে ঝুঁকি নেওয়ার মানে নেই।
     */
    let removed = 0;
    if (yearMonth !== null) {
      const gone = await this.prisma.securityDeposit.deleteMany({
        where: { employeeId, yearMonth: { lt: yearMonth } },
      });
      removed = gone.count;
    }

    const before = await this.prisma.securityDeposit.count({ where: { employeeId } });
    await this.ensureLedger();
    const after = await this.prisma.securityDeposit.count({ where: { employeeId } });

    await this.audit.record({
      userId: actor.userId,
      action: 'deposit_policy_update',
      targetType: 'employee',
      targetId: employeeId,
      ipAddress: ip,
      meta: {
        op: 'deposit_start_month',
        from: employee.depositStartYearMonth,
        to: yearMonth,
        removed,
        added: after - before,
      },
    });

    this.logger.log(
      `${employee.fullName}: জামানতের শুরু ${employee.depositStartYearMonth ?? 'নিয়ম'} → ` +
        `${yearMonth ?? 'নিয়ম'} (${removed} মোছা, ${after - before} যোগ)`,
    );

    return { removed, added: after - before };
  }

  /**
   * ⭐⭐⭐ **বসে যাওয়া একটা কিস্তির অঙ্ক সংশোধন** *(৫ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️⚠️ **কেন দরকার হলো:** খাতায় ভুল অঙ্কে একটা কিস্তি বসে গেলে সেটা
   * ঠিক করার **কোনো পথই ছিল না**। `ensureLedger()` চলে
   * `createMany({ skipDuplicates: true })` দিয়ে, তাই বিদ্যমান সারি কখনো
   * হালনাগাদ হয় না — আর সেটা ইচ্ছাকৃত (নিয়মের অঙ্ক বদলালে পুরোনো মাস
   * ফিরে লেখা হয় না)। ফলে মাঠে একটা ৳০ সারি দু-সপ্তাহ ধরে বসে ছিল, আর
   * পাতা দেখাত *"2 months held · ৳500"*।
   *
   * ⭐ ওটা শেষমেশ সারানো গেছে একটা **কৌশলে**: শুরুর মাস এগিয়ে দিয়ে সারিটা
   * মুছে, তারপর নিয়মে ফিরিয়ে নতুন করে বসিয়ে। কাজ করেছে **কেবল কারণ ভুল
   * মাসটা শুরুর দিকে ছিল**; মাঝের কোনো মাস হলে ওই কৌশল আগের সব মাসও
   * মুছে দিত। কৌশলটা কোথাও লেখাও ছিল না।
   *
   * ⚠️ **এটা "নিয়ম বদল" নয়, "ভুল সংশোধন"** — তাই `reason` বাধ্যতামূলক,
   * ঠিক `time_adjustments`-এর মতো। ছ-মাস পরে "ওই মাসে অন্যদের ৫০০, এর
   * ৩০০ কেন" প্রশ্নের উত্তর খাতাতেই থাকা দরকার।
   *
   * ⚠️⚠️ **শূন্য বসানো যায় না** — ডাটাবেসের `CHECK`-ও তা আটকায়। মকুব মানে
   * ওই মাসে কিস্তি **নেই**, ৳০-এর কিস্তি **আছে**; দুটো এক করে ফেললে
   * "কত মাস জমা হয়েছে" প্রশ্নের উত্তরই নষ্ট হয়। শুরুর দিকের মাস বাদ দিতে
   * `setStartMonth()` আছে।
   * ⏳ **মাঝের একটা মাস মকুব করার কোনো ব্যবস্থা এখনো নেই** — লাগলে সেটা
   *    আলাদা সিদ্ধান্ত (সারি রেখে `waived` চিহ্ন, নাকি মুছে ফেলা), আর
   *    মুছে ফেললে `ensureLedger()` ওটা আবার বসিয়ে দেবে।
   */
  async correctInstalment(
    actor: SessionUser,
    employeeId: number,
    yearMonth: string,
    amountPaisa: number,
    reason: string,
    ip: string,
  ): Promise<{ from: number; to: number }> {
    if (!isYearMonth(yearMonth)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    /**
     * ⚠️ ০ বা ঋণাত্মক এখানেই আটকানো, ডাটাবেসের `CHECK`-এর ভরসায় নয় —
     *    নইলে বার্তাটা হতো একটা কাঁচা Postgres এরর, আর মালিক বুঝতেন না
     *    কী ভুল করলেন।
     */
    if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) {
      throw new BadRequestException(
        'The instalment must be more than zero — to skip the early months use the start month instead',
      );
    }

    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(
        'Write why — six months from now this line is the only answer',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, fullName: true, empCode: true },
    });
    if (!employee) throw new NotFoundException('Staff member not found');

    /**
     * ⚠️ নিষ্পত্তি হয়ে গেলে খাতা বন্ধ — টাকা ফেরত বা বাজেয়াপ্ত হয়ে গেছে,
     *    তাই এখন অঙ্ক বদলানো মানে মিটে যাওয়া হিসাব নাড়ানো।
     *    ⭐ শর্তটা `setStartMonth()`-এর হুবহু একই।
     */
    const settled = await this.prisma.depositSettlement.findFirst({
      where: { employeeId },
      select: { employeeId: true },
    });
    if (settled) {
      throw new ConflictException(
        'This deposit is already settled — the ledger is closed',
      );
    }

    /**
     * ⚠️⚠️ **বন্ধ মাসে সংশোধন নয়** (R1) — ছুটি ও সংশোধনের ঠিক একই নিয়ম।
     *    বন্ধ মাস মানে ওই মাসের কাগজ বেরিয়ে গেছে; খাতা বদলালে কাগজ আর
     *    খাতা দুই কথা বলত, আর কেউ টের পেত না।
     */
    const closed = await this.prisma.monthClosure.findUnique({
      where: { yearMonth },
      select: { yearMonth: true },
    });
    if (closed) {
      throw new ConflictException(
        `${yearMonth} is closed — reopen the month first`,
      );
    }

    /**
     * ⚠️ সারিটা **থাকতে হবে**। না থাকলে এটা সংশোধন নয়, নতুন কিস্তি বসানো —
     *    আর সেটা `ensureLedger()`-এর কাজ, নিয়ম ধরে। এখানে বসাতে দিলে
     *    খাতায় এমন মাস ঢুকত যেটা কোনো নিয়ম থেকে আসেনি।
     */
    const row = await this.prisma.securityDeposit.findUnique({
      where: { employeeId_yearMonth: { employeeId, yearMonth } },
    });
    if (!row) {
      throw new NotFoundException(
        `No instalment for ${yearMonth} — the ledger only holds months the rule created`,
      );
    }

    // ⚠️ কিছুই বদলায়নি — খাতায় ঘটনা লেখা হয় না (setStartMonth-এর একই নিয়ম)
    if (row.amountPaisa === amountPaisa) return { from: row.amountPaisa, to: amountPaisa };

    await this.prisma.securityDeposit.update({
      where: { employeeId_yearMonth: { employeeId, yearMonth } },
      data: { amountPaisa },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'deposit_policy_update',
      targetType: 'employee',
      targetId: employeeId,
      ipAddress: ip,
      meta: {
        op: 'deposit_instalment_corrected',
        empCode: employee.empCode,
        yearMonth,
        fromPaisa: row.amountPaisa,
        toPaisa: amountPaisa,
        why: trimmed,
      },
    });

    this.logger.warn(
      `${employee.fullName}: ${yearMonth}-এর কিস্তি ${row.amountPaisa} → ${amountPaisa} পয়সা · ${trimmed}`,
    );

    return { from: row.amountPaisa, to: amountPaisa };
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
        select: {
          id: true,
          empCode: true,
          fullName: true,
          status: true,
          joinedOn: true,
          depositStartYearMonth: true,
        },
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

        // ⭐ `ensureLedger()` যে ফাংশনটা ডাকে, এখানেও ঠিক সেটাই
        const effectiveStart = effectiveDepositStart({
          override: e.depositStartYearMonth,
          joinedMonth: e.joinedOn ? e.joinedOn.toISOString().slice(0, 7) : null,
          policyStart: policy.startYearMonth,
        });

        return {
          startYearMonth: e.depositStartYearMonth,
          effectiveStart,
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
