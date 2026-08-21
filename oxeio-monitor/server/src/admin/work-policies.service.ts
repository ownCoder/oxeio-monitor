import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WorkPolicy } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_TARGET } from './admin-audit';
import type { CreateWorkPolicyDto, UpdateWorkPolicyDto } from './dto';
import {
  captureWindowProblem,
  DEFAULT_CAPTURE_WINDOW,
} from './work-policy.rules';

export interface WorkPolicyView {
  id: number;
  name: string;
  /** ⭐ একমাত্র টার্গেট। টাকা নয়, তাই সংখ্যা হিসেবেই যায়। */
  monthlyTargetHours: number;
  expectedWorkdays: number;
  weeklyOffDay: number | null;
  screenshotFrom: string | null;
  screenshotTo: string | null;
  idleThresholdSec: number;
  /** ⭐ ডিজাইনারের দৈনিক টার্গেট — কেবল `staffType = designer`-এ খাটে */
  dailyDesignTarget: number;
  slotMinutes: number;
  timezone: string;
  isActive: boolean;
  /** কতজন কর্মী এই পলিসিতে আছে — deactivate করার আগে এটাই দেখার জিনিস */
  employeeCount: number;
}

@Injectable()
export class WorkPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<{ rows: WorkPolicyView[] }> {
    const rows = await this.prisma.workPolicy.findMany({
      orderBy: [{ isActive: 'desc' }, { id: 'asc' }],
      include: { _count: { select: { employees: true } } },
    });

    return {
      rows: rows.map((p) => toView(p, p._count.employees)),
    };
  }

  async get(id: number): Promise<WorkPolicyView> {
    const row = await this.prisma.workPolicy.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (!row) throw new NotFoundException('Work policy not found');
    return toView(row, row._count.employees);
  }

  /**
   * ⭐ ক্যাপচার উইন্ডো না দিলে ০৭:০০–২৩:০০ বসে।
   *
   * ⚠️ স্কিমা বলে `NULL` মানে ২৪ ঘণ্টা ছবি — কিন্তু সেটা ADR-011c
   * সরাসরি ভাঙে (রাত ২টার ব্যক্তিগত কাজের ছবি)। তাই এই পথ দিয়ে কখনো
   * `NULL` বসানো যায় না; ফিল্ডটা খালি রাখলে অনুমোদিত উইন্ডোটাই বসে।
   */
  async create(
    actor: SessionUser,
    dto: CreateWorkPolicyDto,
    ip: string,
  ): Promise<WorkPolicyView> {
    const screenshotFrom =
      dto.screenshotFrom ?? DEFAULT_CAPTURE_WINDOW.screenshotFrom;
    const screenshotTo = dto.screenshotTo ?? DEFAULT_CAPTURE_WINDOW.screenshotTo;
    this.assertWindow(screenshotFrom, screenshotTo);

    const row = await this.prisma.workPolicy.create({
      data: {
        name: dto.name,
        ...(dto.monthlyTargetHours === undefined
          ? {}
          : { monthlyTargetHours: dto.monthlyTargetHours }),
        ...(dto.expectedWorkdays === undefined
          ? {}
          : { expectedWorkdays: dto.expectedWorkdays }),
        weeklyOffDay: dto.weeklyOffDay ?? null,
        screenshotFrom,
        screenshotTo,
        ...(dto.idleThresholdSec === undefined
          ? {}
          : { idleThresholdSec: dto.idleThresholdSec }),
        ...(dto.slotMinutes === undefined ? {} : { slotMinutes: dto.slotMinutes }),
        ...(dto.dailyDesignTarget === undefined
          ? {}
          : { dailyDesignTarget: dto.dailyDesignTarget }),
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.workPolicy,
      targetId: row.id,
      ipAddress: ip,
      meta: { op: 'create', name: row.name },
    });

    return toView(row, 0);
  }

  async update(
    actor: SessionUser,
    id: number,
    dto: UpdateWorkPolicyDto,
    ip: string,
  ): Promise<WorkPolicyView> {
    const before = await this.prisma.workPolicy.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Work policy not found');

    // ⚠️ শুধু একটা প্রান্ত পাঠালে পুরোনোটার সাথে মিলিয়ে যাচাই করতে হবে।
    //    নতুনটুকু আলাদা করে দেখলে "শুরু ২২:০০" বৈধ মনে হতো, অথচ পুরোনো
    //    শেষ ছিল ২৩:০০ নয়, ১৮:০০ — উইন্ডোটা উল্টে যেত।
    const screenshotFrom =
      dto.screenshotFrom ??
      before.screenshotFrom ??
      DEFAULT_CAPTURE_WINDOW.screenshotFrom;
    const screenshotTo =
      dto.screenshotTo ??
      before.screenshotTo ??
      DEFAULT_CAPTURE_WINDOW.screenshotTo;
    this.assertWindow(screenshotFrom, screenshotTo);

    const row = await this.prisma.workPolicy.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.monthlyTargetHours === undefined
          ? {}
          : { monthlyTargetHours: dto.monthlyTargetHours }),
        ...(dto.expectedWorkdays === undefined
          ? {}
          : { expectedWorkdays: dto.expectedWorkdays }),
        ...(dto.weeklyOffDay === undefined
          ? {}
          : { weeklyOffDay: dto.weeklyOffDay }),
        screenshotFrom,
        screenshotTo,
        ...(dto.idleThresholdSec === undefined
          ? {}
          : { idleThresholdSec: dto.idleThresholdSec }),
        ...(dto.slotMinutes === undefined ? {} : { slotMinutes: dto.slotMinutes }),
        ...(dto.dailyDesignTarget === undefined
          ? {}
          : { dailyDesignTarget: dto.dailyDesignTarget }),
      },
      include: { _count: { select: { employees: true } } },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.workPolicy,
      targetId: id,
      ipAddress: ip,
      // ⭐ কোন কনফিগ বদলাল সেটা এজেন্টে পৌঁছে যায় (config version hash বদলে
      //    যায়), তাই "কে idle threshold ৬০ থেকে ৬০০ করল" প্রশ্নের উত্তর লাগে
      meta: { op: 'update', fields: Object.keys(dto), name: row.name },
    });

    return toView(row, row._count.employees);
  }

  /**
   * ⚠️ ডিলিট নয় — `is_active = false`। পলিসির দিকে employees FK দিয়ে
   * তাকিয়ে আছে, আর পুরোনো মাসের হিসাব কোন টার্গেটে হয়েছিল সেটাও ইতিহাস।
   */
  async deactivate(
    actor: SessionUser,
    id: number,
    ip: string,
  ): Promise<WorkPolicyView> {
    const before = await this.prisma.workPolicy.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (!before) throw new NotFoundException('Work policy not found');
    if (!before.isActive) {
      throw new ConflictException('This policy has already been deactivated');
    }

    // ⭐⚠️ সবচেয়ে বড় ফাঁদ। `AgentConfigService.build(null)` policy না পেলে
    //     `findFirst({ isActive: true })` করে, আর কিছু না পেলে ছুড়ে দেয়
    //     "কোনো active work policy নেই"। অর্থাৎ শেষ active পলিসিটা
    //     নিষ্ক্রিয় করলে যেসব কর্মীর `policy_id` খালি, তাদের **প্রতিটা
    //     এজেন্টের config sync ও enroll ভেঙে পড়ত** — আর ভাঙত অন্য
    //     মডিউলে, তাই কারণ খুঁজে পেতে দিন লেগে যেত।
    const activeCount = await this.prisma.workPolicy.count({
      where: { isActive: true },
    });
    if (activeCount <= 1) {
      throw new ConflictException(
        'The last active work policy cannot be deactivated — activate another one first',
      );
    }

    // ⚠️ কর্মী এখনো এটার দিকে তাকিয়ে থাকলে নিষ্ক্রিয় পলিসিই তাদের এজেন্ট
    //    চালাত (`build(policyId)` isActive দেখে না) — "নিষ্ক্রিয়" শব্দটা
    //    তখন মিথ্যা হয়ে যেত।
    if (before._count.employees > 0) {
      throw new ConflictException(
        `${before._count.employees} staff are still on this policy — move them to another policy first`,
      );
    }

    const row = await this.prisma.workPolicy.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.workPolicy,
      targetId: id,
      ipAddress: ip,
      meta: { op: 'deactivate', name: row.name },
    });

    return toView(row, 0);
  }

  /**
   * ⭐⭐ **G85 — বন্ধ করার কোডের সাথে খোলার কোডও।**
   *
   * এতদিন `deactivate()` ছিল, `reactivate()` ছিল না। ফলে একবার নিষ্ক্রিয়
   * করা পলিসি **চিরতরে** নিষ্ক্রিয় থাকত, আর ফেরার একমাত্র পথ ছিল
   * সার্ভারে বসে SQL।
   *
   * ⚠️ ক্ষতিটা কর্মীর লগইনের মতো তীব্র নয় (G84) — পলিসি নিষ্ক্রিয় করতে
   * গেলে আগে সব কর্মীকে সরাতে হয়, তাই কেউ আটকে যান না। কিন্তু ভুল করে
   * চাপলে ফেরার পথ নেই, আর সেটা পর্দায় কোথাও লেখা থাকে না।
   *
   * ⭐ ধরা পড়েছে G84 সারানোর পর নিয়মটা লিখে রেখে **একই চোখে বাকি কোড
   * দেখতে গিয়ে** — মাঠে ধরা পড়ার অপেক্ষা না করে।
   */
  async reactivate(
    actor: SessionUser,
    id: number,
    ip: string,
  ): Promise<WorkPolicyView> {
    const before = await this.prisma.workPolicy.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (!before) throw new NotFoundException('Work policy not found');
    if (before.isActive) {
      throw new ConflictException('This policy is already active');
    }

    const row = await this.prisma.workPolicy.update({
      where: { id },
      data: { isActive: true },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.workPolicy,
      targetId: id,
      ipAddress: ip,
      meta: { op: 'reactivate', name: row.name },
    });

    /**
     * ⚠️ কর্মী-সংখ্যা এখানে `before`-এর গোনা থেকেই আসে, শূন্য ধরে নয়।
     *
     * `deactivate()`-এ `toView(row, 0)` লেখা **ঠিক**, কারণ সে শূন্য না
     * হলে চলতেই দেয় না। কিন্তু এখানে শূন্য ধরে নেওয়া হতো একটা অনুমান —
     * নিষ্ক্রিয় পলিসিতে কর্মী থাকা সম্ভব (কেউ SQL দিয়ে বসিয়ে দিলে, বা
     * ভবিষ্যতে নিয়ম বদলালে), আর তখন পর্দা "0 staff" দেখাত অথচ বাস্তবে
     * তাঁরা আছেন।
     */
    return toView(row, before._count.employees);
  }

  private assertWindow(from: string, to: string): void {
    const problem = captureWindowProblem(from, to);
    if (problem) throw new BadRequestException(problem);
  }
}

function toView(policy: WorkPolicy, employeeCount: number): WorkPolicyView {
  return {
    id: policy.id,
    name: policy.name,
    // Decimal → number। ⚠️ টাকা হলে এটা করা যেত না, কিন্তু ঘণ্টা টাকা নয়,
    // আর `AgentConfigService`ও ঠিক এভাবেই এজেন্টকে পাঠায় — দুই জায়গায়
    // দুই রকম হলে ড্যাশবোর্ড আর এজেন্ট আলাদা সংখ্যা দেখাত।
    monthlyTargetHours: Number(policy.monthlyTargetHours),
    expectedWorkdays: policy.expectedWorkdays,
    weeklyOffDay: policy.weeklyOffDay,
    screenshotFrom: policy.screenshotFrom,
    screenshotTo: policy.screenshotTo,
    idleThresholdSec: policy.idleThresholdSec,
    dailyDesignTarget: policy.dailyDesignTarget,
    slotMinutes: policy.slotMinutes,
    timezone: policy.timezone,
    isActive: policy.isActive,
    employeeCount,
  };
}
