import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { nextEmployeeCode } from './next-code';
import { ADMIN_TARGET } from './admin-audit';
import { parseCalendarDate } from './calendar-date';
import type {
  CreateEmployeeDto,
  DeactivateEmployeeDto,
  EmployeeListQueryDto,
  UpdateEmployeeDto,
} from './dto';
import {
  canSeeSalary,
  toEmployeeView,
  toEmployeeViews,
  type EmployeeView,
} from './redact';

/**
 * ⚠️ একটাই select, সব জায়গায় একই। আলাদা আলাদা জায়গায় কলাম বাছলে কোথাও
 * না কোথাও `monthlySalary` ঢুকে যেত আর `redact` কিছু বুঝত না — কারণ
 * redact তখন এমন একটা ফিল্ড ছেঁকে ফেলার কথা ভাবত যেটা তার হাতে আসেইনি।
 */
const EMPLOYEE_SELECT = {
  id: true,
  empCode: true,
  fullName: true,
  email: true,
  designation: true,
  department: true,
  policyId: true,
  monthlySalary: true,
  joinedOn: true,
  leftOn: true,
  status: true,
  policySignedAt: true,
  policyDocPath: true,
  createdAt: true,

  /**
   * ⭐ **সেটআপ কতদূর এগিয়েছে** — এজেন্ট বসানোর আগে দুটো জিনিস লাগে:
   * তার একটা লগইন, আর তারপর একটা enrolled ডিভাইস।
   *
   * ⚠️ আগে এর কোনোটাই তালিকায় আসত না, তাই মালিককে ১৫টা সারিতে একে একে
   * ক্লিক করে দেখতে হতো কার অ্যাকাউন্ট খোলা হয়েছে আর কার হয়নি — আর
   * ভুলে একজন বাদ পড়লে সেটা ধরা পড়ত ওই PC-তে গিয়ে, যখন সে সাইন ইন
   * করতে পারত না।
   *
   * ⭐ `_count` ব্যবহার করা হয়েছে, সারি টেনে নয় — ইউজারের ইমেইল বা
   * ডিভাইসের টোকেন এই রেসপন্সে ঢোকার কোনো কারণ নেই।
   */
  _count: { select: { devices: { where: { status: 'active' } } } },

  /**
   * ⭐ portal অ্যাকাউন্ট — **id ও ইমেইল**, শুধু "আছে কি নেই" নয়।
   *
   * ⚠️ id ছাড়া পর্দা থেকে পাসওয়ার্ড রিসেট বা ইমেইল বদলানো যেত না
   * (`/users/:id/…` দুটোই id চায়)। ⭐ `resetUserPassword()` ওয়েবের
   * API-তে লেখাই ছিল, কিন্তু **কেউ ডাকত না** — কারণ ডাকার মতো id-ই
   * রেসপন্সে আসত না।
   *
   * ⚠️ `passwordHash` বা `totpSecret` **নেওয়া হয় না** — whitelist,
   * `redact.ts`-এর একই যুক্তি।
   */
  portalUsers: {
    select: { id: true, email: true },
    orderBy: { id: 'asc' },
    take: 1,
  },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── পড়া (owner + manager) ─────────────────────────────────────────────────

  /**
   * পরের কর্মী-কোডের **পরামর্শ** — নতুন কর্মীর ফর্মে আগে থেকে বসানোর জন্য।
   *
   * ⚠️⚠️ `where` ইচ্ছাকৃতভাবে **নেই** — active ও inactive, দুটোই লাগে।
   * শুধু active নিলে ছাঁটাই হওয়া কারো কোড আবার পরামর্শ হতো, আর সেভ করতে
   * গিয়ে ৪০৯; অথচ পর্দায় (active ফিল্টারে) ওই কোডের কাউকে দেখা যেত না,
   * তাই কারণটা বোঝাই যেত না।
   *
   * ⭐ শুধু `empCode` তোলা হয় — নাম বা বেতন এই কলে ঢোকার কোনো কারণ নেই,
   * আর ম্যানেজারও এটা ডাকে।
   */
  async nextCode(): Promise<{ code: string }> {
    const rows = await this.prisma.employee.findMany({
      select: { empCode: true },
    });

    return { code: nextEmployeeCode(rows.map((r) => r.empCode)) };
  }


  async list(
    actor: SessionUser,
    query: EmployeeListQueryDto,
    ip: string,
  ): Promise<{ rows: EmployeeView[]; total: number }> {
    const status = query.status ?? 'active';
    const search = query.search?.trim();

    const where: Prisma.EmployeeWhereInput = {
      ...(status === 'all' ? {} : { status }),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { empCode: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.employee.findMany({
      where,
      select: EMPLOYEE_SELECT,
      orderBy: { empCode: 'asc' },
    });

    // ⚠️ targetId এখানে কোনো একজনের id নয় — গোটা তালিকাটাই লক্ষ্য।
    //    `list` লেখা থাকলে audit-এ "কে পুরো তালিকার বেতন দেখল" আর
    //    "কে একজনেরটা দেখল" আলাদা করে পড়া যায়।
    await this.recordSalaryRead(actor, ip, rows, 'list');

    return { rows: toEmployeeViews(rows, actor.role), total: rows.length };
  }

  async get(actor: SessionUser, id: number, ip: string): Promise<EmployeeView> {
    const row = await this.prisma.employee.findUnique({
      where: { id },
      select: EMPLOYEE_SELECT,
    });
    if (!row) throw new NotFoundException('Staff member not found');

    await this.recordSalaryRead(actor, ip, [row], String(id));

    return toEmployeeView(row, actor.role);
  }

  // ── লেখা (owner-only) ─────────────────────────────────────────────────────

  async create(
    actor: SessionUser,
    dto: CreateEmployeeDto,
    ip: string,
  ): Promise<EmployeeView> {
    await this.assertPolicyExists(dto.policyId);

    const row = await this.prisma.employee
      .create({
        data: {
          empCode: dto.empCode,
          fullName: dto.fullName,
          email: dto.email ?? null,
          designation: dto.designation ?? null,
          department: dto.department ?? null,
          policyId: dto.policyId ?? null,
          // ⭐ স্ট্রিং সরাসরি Decimal-এ — মাঝপথে কোনো float নেই
          monthlySalary: dto.monthlySalary ?? null,
          joinedOn: dto.joinedOn
            ? this.calendarDate(dto.joinedOn, 'joinedOn')
            : null,
        },
        select: EMPLOYEE_SELECT,
      })
      .catch((err: unknown) => {
        throw this.translateUniqueViolation(err, dto.empCode, dto.email);
      });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.employee,
      targetId: row.id,
      ipAddress: ip,
      meta: { op: 'create', empCode: row.empCode, fullName: row.fullName },
    });

    if (dto.monthlySalary !== undefined) {
      await this.recordSalaryChange(actor, ip, row.id, null, dto.monthlySalary);
    }

    return toEmployeeView(row, actor.role);
  }

  async update(
    actor: SessionUser,
    id: number,
    dto: UpdateEmployeeDto,
    ip: string,
  ): Promise<EmployeeView> {
    const before = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, empCode: true, monthlySalary: true },
    });
    if (!before) throw new NotFoundException('Staff member not found');

    if (dto.policyId !== undefined && dto.policyId !== null) {
      await this.assertPolicyExists(dto.policyId);
    }

    // ⚠️ `undefined` = "হাত দিও না", `null` = "মুছে দাও" — দুটো আলাদা।
    //    সব ফিল্ড একসাথে বসিয়ে দিলে না-পাঠানো ফিল্ডগুলো null হয়ে যেত।
    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.empCode !== undefined) data.empCode = dto.empCode;
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.designation !== undefined) data.designation = dto.designation;
    if (dto.department !== undefined) data.department = dto.department;
    if (dto.monthlySalary !== undefined) data.monthlySalary = dto.monthlySalary;
    if (dto.joinedOn !== undefined) {
      data.joinedOn =
        dto.joinedOn === null ? null : this.calendarDate(dto.joinedOn, 'joinedOn');
    }
    if (dto.policyId !== undefined) {
      data.policy =
        dto.policyId === null
          ? { disconnect: true }
          : { connect: { id: dto.policyId } };
    }

    const row = await this.prisma.employee
      .update({ where: { id }, data, select: EMPLOYEE_SELECT })
      .catch((err: unknown) => {
        throw this.translateUniqueViolation(
          err,
          dto.empCode,
          dto.email ?? undefined,
        );
      });

    // ⚠️ Prisma-র update input-এ relation-টার নাম `policy`, কলামের নাম নয়।
    //    সরাসরি key তুলে দিলে audit-এ `policy` লেখা থাকত আর API-র
    //    `policyId`-র সাথে মিলত না।
    const changed = Object.keys(data)
      .filter((k) => k !== 'monthlySalary')
      .map((k) => (k === 'policy' ? 'policyId' : k));
    if (changed.length > 0) {
      await this.audit.record({
        userId: actor.userId,
        action: 'change_setting',
        targetType: ADMIN_TARGET.employee,
        targetId: id,
        ipAddress: ip,
        meta: { op: 'update', fields: changed, empCode: row.empCode },
      });
    }

    if (dto.monthlySalary !== undefined) {
      await this.recordSalaryChange(
        actor,
        ip,
        id,
        before.monthlySalary === null ? null : before.monthlySalary.toFixed(2),
        dto.monthlySalary,
      );
    }

    return toEmployeeView(row, actor.role);
  }

  /**
   * ⚠️ **ডিলিট নয়, deactivate** — কারো সারি মুছলে তার মাসের হিসাব,
   * স্ক্রিনশট আর audit trail সব অনাথ হয়ে যেত (FK-ও আটকাত)।
   *
   * ⭐ শুধু status বদলানো যথেষ্ট নয়। কেউ চলে গেছে অথচ তার PC-তে এজেন্ট
   * চলছে — মানে চাকরি ছেড়ে দেওয়া একজন মানুষের স্ক্রিনশট উঠতেই থাকত।
   * তাই একই লেনদেনে:
   *   · তার সব active ডিভাইস revoke,
   *   · অব্যবহৃত enrollment code-গুলোর মেয়াদ শেষ (নইলে নতুন PC-তে তার
   *     নামে এজেন্ট বসানো যেত),
   *   · তার portal অ্যাকাউন্ট নিষ্ক্রিয়।
   */
  async deactivate(
    actor: SessionUser,
    id: number,
    dto: DeactivateEmployeeDto,
    ip: string,
  ): Promise<EmployeeView> {
    const before = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, empCode: true, status: true },
    });
    if (!before) throw new NotFoundException('Staff member not found');
    if (before.status === 'inactive') {
      // ⚠️ চুপচাপ আবার চালালে আগের `leftOn` মুছে আজকের তারিখ বসে যেত
      throw new ConflictException(
        'This staff member has already been deactivated',
      );
    }

    const now = new Date();
    const leftOn = dto.leftOn
      ? this.calendarDate(dto.leftOn, 'leftOn')
      : workDateOf(now);

    const { row, devicesRevoked, codesExpired, portalDisabled } =
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.employee.update({
          where: { id },
          data: { status: 'inactive', leftOn },
          select: EMPLOYEE_SELECT,
        });

        const devices = await tx.device.updateMany({
          where: { employeeId: id, status: 'active' },
          data: { status: 'revoked' },
        });

        // মেয়াদ "এখন" বসিয়ে দেওয়া — মুছে ফেলা নয়, কারণ কোনটা কখন
        // ইস্যু হয়েছিল সেটাও ইতিহাসের অংশ
        const codes = await tx.enrollmentCode.updateMany({
          where: { employeeId: id, usedAt: null, expiresAt: { gt: now } },
          data: { expiresAt: now },
        });

        const portal = await tx.user.updateMany({
          where: { employeeId: id, isActive: true },
          data: { isActive: false },
        });

        return {
          row: updated,
          devicesRevoked: devices.count,
          codesExpired: codes.count,
          portalDisabled: portal.count,
        };
      });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.employee,
      targetId: id,
      ipAddress: ip,
      meta: {
        op: 'deactivate',
        empCode: before.empCode,
        reason: dto.reason,
        leftOn: leftOn.toISOString().slice(0, 10),
        devicesRevoked,
        codesExpired,
        portalDisabled,
      },
    });

    this.logger.log(
      `${before.empCode} deactivated — ${devicesRevoked} devices revoked, ${codesExpired} codes cancelled`,
    );

    return toEmployeeView(row, actor.role);
  }

  /**
   * ⚠️ ডিভাইসগুলো নিজে থেকে আবার চালু হয় **না** — ইচ্ছাকৃত। ফিরে আসা
   * কর্মীর জন্য নতুন enrollment code দেওয়াই স্বাভাবিক পথ; পুরোনো টোকেন
   * আপনাআপনি জেগে ওঠা মানে ওই মেশিনটা এখনো তারই আছে ধরে নেওয়া।
   */
  async reactivate(
    actor: SessionUser,
    id: number,
    ip: string,
  ): Promise<EmployeeView> {
    const before = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, empCode: true, status: true },
    });
    if (!before) throw new NotFoundException('Staff member not found');
    if (before.status === 'active') {
      throw new ConflictException('This staff member is already active');
    }

    const row = await this.prisma.employee.update({
      where: { id },
      data: { status: 'active', leftOn: null },
      select: EMPLOYEE_SELECT,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.employee,
      targetId: id,
      ipAddress: ip,
      meta: { op: 'reactivate', empCode: before.empCode },
    });

    return toEmployeeView(row, actor.role);
  }

  // ── ভেতরের সাহায্যকারী ────────────────────────────────────────────────────

  /**
   * ⭐ বেতন **দেখাও** একটা ঘটনা (ADR-023) — payroll শিটের মতোই এখানেও
   * লেখা থাকে কে কখন দেখল।
   *
   * ⚠️ শুধু তখনই লেখা হয় যখন সত্যিই একটা সংখ্যা বেরিয়ে গেছে। নইলে
   * ম্যানেজারের প্রতিটা পেজ-লোড আর বেতন বসানো নেই এমন তালিকাও
   * audit_log ভরিয়ে ফেলত, আর আসল ঘটনাগুলো তার নিচে চাপা পড়ত।
   */
  private async recordSalaryRead(
    actor: SessionUser,
    ip: string,
    rows: readonly { monthlySalary: unknown }[],
    targetId: string,
  ): Promise<void> {
    if (!canSeeSalary(actor.role)) return;
    const disclosed = rows.filter((r) => r.monthlySalary !== null).length;
    if (disclosed === 0) return;

    await this.audit.record({
      userId: actor.userId,
      action: 'payroll_view',
      targetType: ADMIN_TARGET.employee,
      targetId,
      ipAddress: ip,
      meta: { via: 'employees', disclosed },
    });
  }

  private async recordSalaryChange(
    actor: SessionUser,
    ip: string,
    employeeId: number,
    from: string | null,
    to: string | null,
  ): Promise<void> {
    if (from === to) return;

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.employeeSalary,
      targetId: employeeId,
      ipAddress: ip,
      // audit-log নিজেই owner-only, তাই আসল অঙ্কটা এখানে রাখা নিরাপদ —
      // আর "কত থেকে কত" না লিখলে অডিটের অর্ধেক মানে থাকত না
      meta: { op: 'update_salary', from, to },
    });
  }

  private async assertPolicyExists(policyId?: number): Promise<void> {
    if (policyId === undefined) return;
    const policy = await this.prisma.workPolicy.findUnique({
      where: { id: policyId },
      select: { id: true },
    });
    // ⚠️ FK ভাঙলে Prisma P2003 ছুড়ত আর সেটা ৫০০ হয়ে যেত — এখানেই ধরা
    if (!policy) {
      throw new BadRequestException('There is no work policy with this policyId');
    }
  }

  /**
   * ⭐ সই করা মনিটরিং পলিসি রেকর্ড করা — **রোলআউটের একমাত্র শর্ত**।
   *
   * ⚠️ এতদিন এই পথটা ছিল না: কলাম ছিল, API পড়ত, ওয়েবে টাইপ করা ছিল —
   * শুধু **বসানোর কোনো উপায় ছিল না**। অর্থাৎ "সই ছাড়া কারো PC-তে এজেন্ট
   * বসবে না" শর্তটা সিস্টেমে রেকর্ডই করা যেত না, আর ছ-মাস পরে কেউ
   * জিজ্ঞেস করলে উত্তর থাকত শুধু কাগজের ফাইলে।
   */
  async setPolicySigned(
    actor: SessionUser,
    id: number,
    signedOn: string | undefined,
    ip: string,
  ): Promise<EmployeeView> {
    const before = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, empCode: true, policySignedAt: true },
    });
    if (!before) throw new NotFoundException('Staff member not found');

    /**
     * ⚠️ তারিখটা **ঢাকার মধ্যরাত** হিসেবে বসে, বসানোর মুহূর্ত নয়।
     * কলামটা `timestamptz`, তাই মুহূর্ত বসালে "৩ আগস্ট সই" রেকর্ডটা
     * টাইমজোন বদলালে ২ বা ৪ আগস্ট দেখাত — একটা আইনি নথির তারিখ হিসেবে
     * সেটা অগ্রহণযোগ্য।
     */
    const when = signedOn
      ? this.calendarDate(signedOn, 'signedOn')
      : workDateOf(new Date());

    // ⚠️ ভবিষ্যতের তারিখ নয় — কাগজ সই হওয়ার আগেই রেকর্ড হয়ে গেলে
    //    গোটা শর্তটার মানেই থাকে না।
    if (when.getTime() > workDateOf(new Date()).getTime()) {
      throw new BadRequestException('The signing date cannot be in the future');
    }

    const row = await this.prisma.employee.update({
      where: { id },
      data: { policySignedAt: when },
      select: EMPLOYEE_SELECT,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'policy_signed',
      targetType: ADMIN_TARGET.employee,
      targetId: id,
      ipAddress: ip,
      meta: {
        empCode: before.empCode,
        signedOn: when.toISOString().slice(0, 10),
        // ⚠️ আগেরটাও রাখা — দ্বিতীয়বার বসানো মানে হয় সংশোধন, নয় ভুল
        previous: before.policySignedAt?.toISOString().slice(0, 10) ?? null,
      },
    });

    this.logger.log(`${before.empCode} — monitoring policy signed on ${when.toISOString().slice(0, 10)}`);

    return toEmployeeView(row, actor.role);
  }

  /**
   * ভুল করে বসানো সই তুলে নেওয়া।
   *
   * ⚠️ ডিলিট নয়, **শূন্য করা** — আর ঘটনাটা audit-এ থাকে। সই "ছিল, তারপর
   * তুলে নেওয়া হলো" আর "কোনোদিন ছিল না" — দুটো সম্পূর্ণ আলাদা ব্যাপার,
   * বিশেষ করে যদি ইতিমধ্যে ওই PC-তে এজেন্ট বসে গিয়ে থাকে।
   */
  async clearPolicySigned(
    actor: SessionUser,
    id: number,
    ip: string,
  ): Promise<EmployeeView> {
    const before = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, empCode: true, policySignedAt: true },
    });
    if (!before) throw new NotFoundException('Staff member not found');

    const row = await this.prisma.employee.update({
      where: { id },
      data: { policySignedAt: null },
      select: EMPLOYEE_SELECT,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'policy_signed_cleared',
      targetType: ADMIN_TARGET.employee,
      targetId: id,
      ipAddress: ip,
      meta: {
        empCode: before.empCode,
        cleared: before.policySignedAt?.toISOString().slice(0, 10) ?? null,
      },
    });

    return toEmployeeView(row, actor.role);
  }

  private calendarDate(value: string, field: string): Date {
    const parsed = parseCalendarDate(value);
    if (!parsed) throw new BadRequestException(`${field} is not a valid date`);
    return parsed;
  }

  private translateUniqueViolation(
    err: unknown,
    empCode?: string,
    email?: string,
  ): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const raw: unknown = err.meta?.target;
      const target = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');

      // ⚠️ দুটো UNIQUE কলামই একই P2002 দেয়। কোনটা সংঘাত করল না বললে
      //    ব্যবহারকারী "ডুপ্লিকেট" দেখে empCode বদলাতে থাকত, অথচ দোষ email-এর।
      if (target.includes('email')) {
        return new ConflictException(
          `The email "${email}" is already registered to someone else`,
        );
      }
      return new ConflictException(`The code "${empCode}" is already in use`);
    }
    return err;
  }
}
