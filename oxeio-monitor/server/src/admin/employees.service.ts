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
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── পড়া (owner + manager) ─────────────────────────────────────────────────

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
    if (!row) throw new NotFoundException('কর্মচারী পাওয়া যায়নি');

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
    if (!before) throw new NotFoundException('কর্মচারী পাওয়া যায়নি');

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
    if (!before) throw new NotFoundException('কর্মচারী পাওয়া যায়নি');
    if (before.status === 'inactive') {
      // ⚠️ চুপচাপ আবার চালালে আগের `leftOn` মুছে আজকের তারিখ বসে যেত
      throw new ConflictException('এই কর্মচারী আগেই নিষ্ক্রিয় করা হয়েছে');
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
      `${before.empCode} নিষ্ক্রিয় — ${devicesRevoked}টি ডিভাইস revoke, ${codesExpired}টি কোড বাতিল`,
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
    if (!before) throw new NotFoundException('কর্মচারী পাওয়া যায়নি');
    if (before.status === 'active') {
      throw new ConflictException('এই কর্মচারী আগে থেকেই সক্রিয়');
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
    if (!policy) throw new BadRequestException('এই policyId-র work policy নেই');
  }

  private calendarDate(value: string, field: string): Date {
    const parsed = parseCalendarDate(value);
    if (!parsed) throw new BadRequestException(`${field} একটা বৈধ তারিখ নয়`);
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
        return new ConflictException(`"${email}" ইমেইল আরেকজনের নামে আছে`);
      }
      return new ConflictException(`"${empCode}" কোড আগেই ব্যবহার হয়েছে`);
    }
    return err;
  }
}
