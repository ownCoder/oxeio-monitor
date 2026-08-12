import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { parseCalendarDate } from '../admin/calendar-date';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../summary/summary.service';
import {
  ADJUSTMENT_MAX_SEC,
  type CreateAdjustmentDto,
  type RevokeAdjustmentDto,
} from './adjustments.dto';

/**
 * স্টাফও নিজের সংশোধন দেখে (J08), তাই এখানে কোনো অভ্যন্তরীণ তথ্য নেই —
 * শুধু কী, কত, কেন, আর কে।
 */
export interface AdjustmentView {
  id: string;
  employeeId: number;
  workDate: string;
  deltaSec: number;
  cause: string;
  reason: string;
  beyondEvidence: boolean;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  /** এখনো গোনা হচ্ছে কি না — বাতিল হলে হয় না */
  active: boolean;
}

/**
 * **B14 · G35 · ADR-011e** — সিস্টেমের দোষে হারানো ঘণ্টা ফেরত দেওয়া।
 *
 * ⚠️⚠️ এই মডিউলটা এতদিন **ছিলই না**, অথচ পড়ার দিকটা সম্পূর্ণ তৈরি:
 * `progress.service` (tray-র সংখ্যা), `summary.service` (rollup),
 * `payroll.math` (`credited = worked + adjustment`), `reports` — সবাই
 * `time_adjustments` পড়ত। কেউ কখনো একটা সারিও লিখত না, তাই যোগফলটা
 * চিরকাল ০ থাকত। ⭐ ফল: owner সিস্টেমের দোষে হারানো ঘণ্টা ফেরত দিতেই
 * পারতেন না, আর কোথাও কোনো ভুল দেখাত না।
 *
 * ⭐ **কাঁচা সেগমেন্ট কখনো ছোঁয়া হয় না।** সংশোধন আলাদা সারি হিসেবে বসে,
 * তাই "মেশিন কী দেখেছে" আর "মানুষ কী ঠিক করেছে" দুটো চিরকাল আলাদা থাকে।
 * সেগমেন্ট এডিট করলে সেটা আর অডিটযোগ্য থাকত না।
 */
@Injectable()
export class AdjustmentsService {
  private readonly logger = new Logger(AdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly summary: SummaryService,
  ) {}

  async create(
    actor: SessionUser,
    employeeId: number,
    dto: CreateAdjustmentDto,
    ip: string,
  ): Promise<AdjustmentView> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, empCode: true },
    });
    if (!employee) throw new NotFoundException('Staff member not found');

    if (dto.deltaSec === 0) {
      throw new BadRequestException('deltaSec cannot be zero');
    }

    if (Math.abs(dto.deltaSec) > ADJUSTMENT_MAX_SEC) {
      throw new BadRequestException(
        `deltaSec must be within ±${ADJUSTMENT_MAX_SEC} seconds (24 hours) for a single day`,
      );
    }

    const workDate = parseCalendarDate(dto.workDate);
    if (!workDate) throw new BadRequestException('workDate is not a valid date');

    // ⚠️ ভবিষ্যতের দিনে ঘণ্টা ফেরত দেওয়া যায় না — যেদিন এখনো আসেইনি,
    //    সেদিনের "হারানো ঘণ্টা" বলে কিছু নেই।
    if (workDate.getTime() > workDateOf(new Date()).getTime()) {
      throw new BadRequestException('workDate cannot be in the future');
    }

    // প্রমাণের অ্যালার্টটা সত্যিই আছে কি না — ভুল আইডি দিলে FK ভেঙে ৫০০ হতো
    if (dto.evidenceAlertId !== undefined) {
      const alert = await this.prisma.alert.findUnique({
        where: { id: BigInt(dto.evidenceAlertId) },
        select: { id: true },
      });
      if (!alert) throw new BadRequestException('evidenceAlertId not found');
    }

    const row = await this.prisma.timeAdjustment.create({
      data: {
        employeeId,
        workDate,
        deltaSec: dto.deltaSec,
        cause: dto.cause,
        reason: dto.reason.trim(),
        evidenceAlertId:
          dto.evidenceAlertId === undefined
            ? null
            : BigInt(dto.evidenceAlertId),
        beyondEvidence: dto.beyondEvidence ?? false,
        createdById: actor.userId,
      },
      include: SELECT_PEOPLE,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'time_adjustment',
      targetType: 'employee',
      targetId: employeeId,
      ipAddress: ip,
      meta: {
        adjustmentId: String(row.id),
        empCode: employee.empCode,
        workDate: dto.workDate,
        deltaSec: dto.deltaSec,
        cause: dto.cause,
        reason: dto.reason.trim(),
        beyondEvidence: dto.beyondEvidence ?? false,
      },
    });

    await this.refresh(workDate);

    this.logger.log(
      `${employee.empCode} ${dto.workDate}: ${dto.deltaSec > 0 ? '+' : ''}${dto.deltaSec}s (${dto.cause})`,
    );

    return toView(row);
  }

  /**
   * ⚠️ ডিলিট নয়, **revoke** — স্কিমাতেই ডিলিট রাখা হয়নি। "সংশোধনটা ছিল,
   * পরে বাতিল হলো" আর "কোনোদিন ছিল না" — দুটো সম্পূর্ণ আলাদা ইতিহাস,
   * বিশেষ করে যদি ওই মাসের বেতন ইতিমধ্যে দেওয়া হয়ে থাকে।
   */
  async revoke(
    actor: SessionUser,
    id: bigint,
    dto: RevokeAdjustmentDto,
    ip: string,
  ): Promise<AdjustmentView> {
    const before = await this.prisma.timeAdjustment.findUnique({
      where: { id },
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        deltaSec: true,
        revokedAt: true,
        employee: { select: { empCode: true } },
      },
    });
    if (!before) throw new NotFoundException('Adjustment not found');

    // ⚠️ দুবার বাতিল করলে দ্বিতীয়বারের কারণটা প্রথমটাকে চাপা দিত
    if (before.revokedAt) {
      throw new BadRequestException('This adjustment is already revoked');
    }

    const row = await this.prisma.timeAdjustment.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedById: actor.userId,
        revokeReason: dto.reason.trim(),
      },
      include: SELECT_PEOPLE,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'time_adjustment_revoke',
      targetType: 'employee',
      targetId: before.employeeId,
      ipAddress: ip,
      meta: {
        adjustmentId: String(id),
        empCode: before.employee.empCode,
        workDate: before.workDate.toISOString().slice(0, 10),
        deltaSec: before.deltaSec,
        reason: dto.reason.trim(),
      },
    });

    await this.refresh(before.workDate);

    return toView(row);
  }

  /**
   * J08 — স্টাফ **নিজের** সংশোধন কারণসহ দেখতে পাবে।
   *
   * ⭐ এটাই ADR-011e-র শর্ত: ঘণ্টা ফেরত দেওয়াটা গোপন কোনো ব্যবস্থা নয়।
   * যে সংখ্যাটা দিয়ে তার বেতন হিসাব হবে, সেটা কেন বদলেছে তা তার জানা চাই।
   */
  async list(actor: SessionUser, employeeId: number): Promise<AdjustmentView[]> {
    this.assertCanSee(actor, employeeId);

    const rows = await this.prisma.timeAdjustment.findMany({
      where: { employeeId },
      orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
      include: SELECT_PEOPLE,
    });

    return rows.map(toView);
  }

  /**
   * ⚠️ স্টাফের ক্ষেত্রে আইডি আসে **সেশন থেকে**, পথ থেকে নয় — আর অন্যের
   * আইডি চাইলে চুপচাপ নিজেরটা দেওয়া হয় না (`screenshots.service`-এর
   * `resolveEmployeeScope`-এর মতোই)। চুপচাপ বদলে দিলে পর্দায় অন্যের নাম
   * নিয়ে নিজের ডেটা দেখাত।
   */
  private assertCanSee(actor: SessionUser, employeeId: number): void {
    if (actor.role !== UserRole.employee) return;

    if (actor.employeeId === null) {
      throw new ForbiddenException(
        'This account is not linked to any staff member',
      );
    }

    if (actor.employeeId !== employeeId) {
      throw new ForbiddenException('You can only view your own adjustments');
    }
  }

  /**
   * ⭐ সংশোধনের পর ওই দিনের সারাংশ **সাথে সাথেই** নতুন করে বসানো হয়।
   *
   * ⚠️ না করলে tray-তে সংখ্যাটা সাথে সাথে বদলাত (progress.service কাঁচা
   * `time_adjustments` পড়ে) কিন্তু রিপোর্ট ও হিটম্যাপ ১৫ মিনিট পুরোনো
   * থাকত — অর্থাৎ owner ঘণ্টা ফেরত দিয়ে রিপোর্ট খুলে দেখতেন কিছুই
   * বদলায়নি, আর ভাবতেন কাজটা হয়নি।
   *
   * ব্যর্থ হলে শুধু লগ — সংশোধনটা ইতিমধ্যে DB-তে বসে গেছে, আর পরের
   * নিয়মিত rollup (K06, ১৫ মিনিট) এমনিতেই ঠিক করে দেবে।
   */
  private async refresh(workDate: Date): Promise<void> {
    try {
      await this.summary.refreshDate(workDate);
    } catch (err) {
      this.logger.warn(
        `Could not refresh the summary for ${workDate.toISOString().slice(0, 10)} — the next rollup will: ${String(err)}`,
      );
    }
  }
}

const SELECT_PEOPLE = {
  createdBy: { select: { fullName: true, email: true } },
  revokedBy: { select: { fullName: true, email: true } },
} as const;

type AdjustmentRow = {
  id: bigint;
  employeeId: number;
  workDate: Date;
  deltaSec: number;
  cause: string;
  reason: string;
  beyondEvidence: boolean;
  createdAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdBy: { fullName: string; email: string };
  revokedBy: { fullName: string; email: string } | null;
};

/**
 * ⚠️ `id` স্ট্রিং হয়ে যায় — `BigInt` `JSON.stringify`-তে ছুড়ে ফেলে, আর
 * তখন গোটা রেসপন্স ৫০০ হতো ([09 § ৩অ.১২](../../../docs/09-Build-Log.md))।
 */
function toView(row: AdjustmentRow): AdjustmentView {
  return {
    id: String(row.id),
    employeeId: row.employeeId,
    workDate: row.workDate.toISOString().slice(0, 10),
    deltaSec: row.deltaSec,
    cause: row.cause,
    reason: row.reason,
    beyondEvidence: row.beyondEvidence,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy.fullName,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy?.fullName ?? null,
    revokeReason: row.revokeReason,
    active: row.revokedAt === null,
  };
}
