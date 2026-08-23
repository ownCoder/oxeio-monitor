import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { supersededThrough } from '../payroll/payroll.math';
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
  type EmployeeRow,
  type EmployeeView,
} from './redact';

/**
 * কর্মী-কোড বসাতে সর্বোচ্চ কতবার চেষ্টা (§ `createWithGeneratedCode`)।
 *
 * ⚠️ পাঁচ — কারণ প্রতিটা ব্যর্থতার মানে ঠিক ওই মুহূর্তে আরেকজন মালিক
 *    কর্মী যোগ করেছেন। পরপর পাঁচবার সেটা ঘটা ১৫ জনের অফিসে কার্যত অসম্ভব;
 *    বেশি রাখলে আসল কোনো গোলমাল ঢাকা পড়ত।
 */
const CODE_ATTEMPTS = 5;

/**
 * P2002-টা কি **কোডের** সংঘাত, নাকি ইমেইলের?
 *
 * ⚠️ দুটো UNIQUE কলামই একই এরর কোড দেয়। আলাদা না করলে ইমেইল ডুপ্লিকেট
 *    হলেও পাঁচবার নতুন কোড বানানোর চেষ্টা হতো — একই ৪০৯, শুধু পাঁচগুণ
 *    দেরিতে।
 */
function isEmpCodeConflict(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return false;
  }

  const raw: unknown = err.meta?.target;
  const target = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');

  return target.includes('emp_code') || target.includes('empCode');
}

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
  staffType: true,
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
  /**
   * ⚠️⚠️ `_count` ছিল, কিন্তু ওটা দিয়ে **দুই রকম গোনা যায় না** — Prisma
   * একই রিলেশনের ছাঁকা-গোনা একবারই দেয়। অথচ দরকার দুটোই: সচল ডিভাইস
   * আছে কি না, আর বাতিল ডিভাইস আছে কি না। নইলে "কখনো এজেন্ট বসেনি" আর
   * "এজেন্ট বন্ধ করে দেওয়া" আলাদা করা যেত না — অথচ প্রথমটায় PC-তে গিয়ে
   * বসাতে হয়, দ্বিতীয়টায় সারিতেই একটা বোতাম।
   *
   * ⭐ তাই সারি টানা হয়, কিন্তু **শুধু `status`** — hostname, token,
   * machineGuid কিছুই আসে না। `_count`-এর মূল প্রতিশ্রুতিটা (whitelist)
   * অক্ষুণ্ন, শুধু আকারটা বদলেছে।
   */
  devices: { select: { status: true } },

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
    // ⚠️ `role`-ও লাগে — পর্দায় ড্রপডাউনটা **বর্তমান** ভূমিকা দেখিয়ে
    //    খুলতে হয়, নইলে না বদলেও "সেভ" চাপলে ভুল ভূমিকা বসে যেত।
    select: { id: true, email: true, role: true },
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
   * পরের কর্মী-কোডটা **আগেভাগে দেখানোর** জন্য — নতুন কর্মীর ফর্মে।
   *
   * ⚠️ এটা প্রতিশ্রুতি নয়, **পূর্বাভাস**। আসল কোড বসে `create()`-এ, সেভ
   * করার মুহূর্তে; দুজন মালিক একসাথে যোগ করলে একজন পরেরটা পাবেন। তাই
   * পর্দায় লেখাটাও "next" — "your code will be" নয়।
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
    this.assertMaySetSalary(actor, dto.monthlySalary);
    await this.assertPolicyExists(dto.policyId);

    const row = await this.createWithGeneratedCode(dto);

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
    this.assertMaySetSalary(actor, dto.monthlySalary);

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
    // ⚠️ `empCode` ইচ্ছাকৃতভাবে নেই — কোড বসে একবার, `create()`-এ।
    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.designation !== undefined) data.designation = dto.designation;
    if (dto.department !== undefined) data.department = dto.department;
    // ⚠️ `null`-ও একটা বৈধ মান (ধরন তুলে নেওয়া), তাই `!== undefined`
    if (dto.staffType !== undefined) data.staffType = dto.staffType;
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

    // ⚠️ `empCode` আর এখানে আসতে পারে না (DTO-তে ঘরটাই নেই), তাই বাকি
    //    একমাত্র UNIQUE হলো ইমেইল।
    const row = await this.prisma.employee
      .update({ where: { id }, data, select: EMPLOYEE_SELECT })
      .catch((err: unknown) => {
        throw this.translateUniqueViolation(
          err,
          undefined,
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

    /**
     * ⚠️⚠️ **portal লগইনটাও ফিরিয়ে দিতে হয় — এটাই আগে বাদ পড়েছিল।**
     *
     * `deactivate()` কর্মীর `users` সারিতে `is_active = false` বসায়।
     * এখানে সেটা ফেরানো হতো না, ফলে যা ঘটত:
     *
     *   ১· Staff পর্দায় কর্মী **Active** দেখাত
     *   ২· "Reset password" চাপলে **সফল** হতো, নতুন পাসওয়ার্ডও দেখাত
     *   ৩· কিন্তু লগইনে সবসময় *"Email or password is incorrect"*
     *
     * ⚠️ কারণ `login()` পাসওয়ার্ডের সাথে `user.isActive`-ও মেলায়, আর
     *    ব্যর্থতার বার্তা ইচ্ছাকৃতভাবে একই রাখা হয় (user enumeration
     *    ঠেকাতে)। ফলে **কারণটা জানার কোনো উপায়ই ছিল না** — মালিক বারবার
     *    রিসেট করতেন আর প্রতিবার একই বার্তা পেতেন।
     *
     * ⭐ ডিভাইস ইচ্ছাকৃতভাবে ফেরে না (উপরের মন্তব্য), কিন্তু লগইন আর
     *    ডিভাইস এক জিনিস নয়: লগইন ছাড়া কর্মী **এজেন্টে সাইন ইনই করতে
     *    পারেন না**, অর্থাৎ ফিরে আসার পথটাই বন্ধ থাকে।
     */
    const [row, portal] = await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: 'active', leftOn: null },
        select: EMPLOYEE_SELECT,
      }),
      this.prisma.user.updateMany({
        where: { employeeId: id, isActive: false },
        data: { isActive: true },
      }),
    ]);

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.employee,
      targetId: id,
      ipAddress: ip,
      // ⚠️ কতগুলো লগইন ফিরল সেটাও লেখা — deactivate-এ `portalDisabled`
      //    লেখা হয়, তাই জোড়াটা audit-এ মিলিয়ে দেখা যায়
      meta: {
        op: 'reactivate',
        empCode: before.empCode,
        portalRestored: portal.count,
      },
    });

    return toEmployeeView(row, actor.role);
  }

  /**
   * ⭐ **এই কর্মীর এজেন্ট আবার চালু করা** — বন্ধ হয়ে যাওয়া ডিভাইসগুলো ফেরানো।
   *
   * ⚠️⚠️ **কেন কর্মী ধরে, ডিভাইস ধরে নয়:** মালিক "ডিভাইস #৬১" নিয়ে ভাবেন
   * না, ভাবেন "Belal-এর PC" নিয়ে। আলাদা একটা Devices পর্দা রাখলে একই
   * প্রশ্নের উত্তর দুই জায়গায় খুঁজতে হতো, আর মালিকের ভাষায় বললে সেটা
   * "পুরো সিস্টেমটাকে জটিল করে দিচ্ছিল"।
   *
   * ⚠️ এটা দরকার হয় কারণ `deactivate()` কর্মীর সব ডিভাইস revoke করে, আর
   * `reactivate()` সেগুলো **ইচ্ছাকৃতভাবে ফেরায় না** — ফিরে আসা কর্মীর
   * পুরোনো টোকেন আপনাআপনি জেগে ওঠা উচিত নয়। ফলে বোর্ডে তিনি চিরকাল
   * "Offline" থাকতেন, অথচ এজেন্ট তাঁর PC-তে দিব্যি চলছে।
   *
   * ⚠️⚠️ **হারিয়ে যাওয়া ল্যাপটপে এটা চালাবেন না** — revoke `token_hash`
   * মোছে না, শুধু দরজা বন্ধ করে। ফেরালে **পুরোনো টোকেনটাই আবার জেগে
   * ওঠে**, অর্থাৎ যে ল্যাপটপটা ধরে আছে সে-ও ফিরে আসে। ওই ক্ষেত্রে
   * কর্মীকে নিষ্ক্রিয় রাখুন, আর নতুন মেশিনে নতুন করে সাইন ইন করান।
   */
  async turnAgentOn(
    actor: SessionUser,
    id: number,
    ip: string,
  ): Promise<{ restored: number }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, empCode: true, status: true },
    });
    if (!employee) throw new NotFoundException('Staff member not found');

    /**
     * ⚠️ নিষ্ক্রিয় কর্মীর ডিভাইস ফেরানো যায় না — নইলে ছাঁটাই হওয়া কারো
     *    মেশিন আবার ঘণ্টা পাঠাতে শুরু করত, অথচ Staff পর্দায় তিনি
     *    "Inactive"। আগে তাঁকে ফেরান, তারপর এজেন্ট।
     */
    if (employee.status !== 'active') {
      throw new ConflictException(
        'This staff member is inactive — reactivate them first, then turn the agent on',
      );
    }

    const { count } = await this.prisma.device.updateMany({
      where: { employeeId: id, status: 'revoked' },
      data: { status: 'active' },
    });

    // ⚠️ কিছুই বদলায়নি — audit-এ ঘটনা লেখা হয় না, নইলে ইতিহাসে এমন সারি
    //    জমত যেখানে আসলে কিছু ঘটেনি।
    if (count === 0) return { restored: 0 };

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.employee,
      targetId: id,
      ipAddress: ip,
      meta: { op: 'turn_agent_on', empCode: employee.empCode, restored: count },
    });

    this.logger.warn(
      `employee ${employee.empCode}: ${count} device(s) turned back on by user ${actor.userId}`,
    );
    return { restored: count };
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

  /**
   * ⭐⭐ **বেতন বদলালে পুরোনো মানটা রেখে দেওয়া** *(২৩ আগস্ট ২০২৬)*।
   *
   * ⚠️⚠️ আগে কেবল audit-এ "কত থেকে কত" লেখা হতো, আর পে-রোল বেতন পড়ত
   * `employees.monthly_salary` থেকে — **লাইভ**। ফলে কারো বেতন বাড়ালে
   * **বন্ধ মাসের পে-রোলও নীরবে বদলে যেত**, আর যে কাগজে বেতন দেওয়া
   * হয়েছিল তার সাথে আর মিলত না। audit বলত বদলটা হয়েছে, কিন্তু শিট
   * নতুন সংখ্যাতেই ছাপা হতো।
   *
   * ⚠️ `from === null` হলে সারি বসে **না** — আগে কোনো বেতনই ছিল না, তাই
   *    "পুরোনো মান" বলে কিছু নেই (নতুন কর্মী)।
   */
  private async recordSalaryChange(
    actor: SessionUser,
    ip: string,
    employeeId: number,
    from: string | null,
    to: string | null,
  ): Promise<void> {
    if (from === to) return;

    if (from !== null) {
      const yearMonth = workDateOf(new Date()).toISOString().slice(0, 7);
      const closed = await this.prisma.monthClosure.findUnique({
        where: { yearMonth },
        select: { yearMonth: true },
      });

      await this.prisma.salaryPeriod.upsert({
        where: {
          employeeId_throughMonth: {
            employeeId,
            throughMonth: supersededThrough(yearMonth, closed !== null),
          },
        },
        // ⚠️ একই মাসে দুবার বদলালে **প্রথম** মানটাই থাকা উচিত — ওটাই ওই
        //    মাস পর্যন্ত সত্যিই চলেছিল। তাই `update` খালি।
        update: {},
        create: {
          employeeId,
          throughMonth: supersededThrough(yearMonth, closed !== null),
          monthlySalary: from,
          changedById: actor.userId,
        },
      });
    }

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

  /**
   * ⭐⭐ কর্মী-কোড **এখানেই** বসে — ক্লায়েন্ট কিছু বলে না, বলতেও পারে না
   * (`CreateEmployeeDto`-তে ঘরটাই নেই)।
   *
   * ⚠️⚠️ "সর্বোচ্চ কোড পড়া" আর "নতুন সারি বসানো" — দুটো আলাদা কল, আর
   * মাঝের ফাঁকটা আসল। দুজন মালিক একসাথে যোগ করলে দুজনেই একই `OX-13`
   * পড়তে পারেন; দ্বিতীয় INSERT-এ `emp_code` UNIQUE ভেঙে P2002 আসে।
   * তখন **আবার গুনে আবার চেষ্টা** — সংঘাতটাই সংকেত।
   *
   * ⚠️ ট্রানজেকশনে মুড়লে সমস্যাটা যেত না: Postgres-এর ডিফল্ট
   * READ COMMITTED-এ দুটো ট্রানজেকশন একই সর্বোচ্চ মান পড়তে পারে, আর
   * সংঘাত ধরা পড়ত COMMIT-এ — অর্থাৎ ঠিক এখানেই, শুধু আরও দেরিতে।
   *
   * ⚠️ চেষ্টার সীমা আছে। অসীম লুপ একটা ভাঙা UNIQUE বা অদ্ভুত কোড-ধাঁচকে
   * হ্যাং-এ বদলে দিত, আর মালিক শুধু ঘুরন্ত চাকা দেখতেন।
   */
  private async createWithGeneratedCode(
    dto: CreateEmployeeDto,
  ): Promise<EmployeeRow> {
    const base = {
      fullName: dto.fullName,
      email: dto.email ?? null,
      designation: dto.designation ?? null,
      department: dto.department ?? null,
      staffType: dto.staffType ?? null,
      policyId: dto.policyId ?? null,
      // ⭐ স্ট্রিং সরাসরি Decimal-এ — মাঝপথে কোনো float নেই
      monthlySalary: dto.monthlySalary ?? null,
      joinedOn: dto.joinedOn
        ? this.calendarDate(dto.joinedOn, 'joinedOn')
        : null,
    };

    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
      const { code: empCode } = await this.nextCode();

      try {
        return await this.prisma.employee.create({
          data: { ...base, empCode },
          select: EMPLOYEE_SELECT,
        });
      } catch (err: unknown) {
        // ⚠️ কেবল **কোডের** সংঘাতে আবার চেষ্টা। ইমেইলের সংঘাতে বারবার
        //    চেষ্টা করলে একই ৪০৯ পাঁচবার আসত, শুধু পাঁচগুণ দেরিতে।
        if (attempt < CODE_ATTEMPTS && isEmpCodeConflict(err)) continue;
        throw this.translateUniqueViolation(err, empCode, dto.email);
      }
    }

    // ⚠️ এখানে পৌঁছানো মানে পরপর কয়েকবার হেরে যাওয়া — অস্বাভাবিক, তাই
    //    চুপ করে না থেকে স্পষ্ট বার্তা।
    throw new ConflictException(
      'Could not assign an employee code — too many staff were added at the same moment. Please try again.',
    );
  }

  /**
   * ⭐⭐ **বেতন একমাত্র owner-এর** ([ADR-023](../../../docs/05-Options-Decisions.md),
   * স্পেক § ৪.৩) — ম্যানেজার কর্মী যোগ ও এডিট করতে পারেন, বেতন নয়।
   *
   * ⚠️⚠️ এই পাহারাটা ছাড়া অবস্থাটা দুটোর চেয়েও খারাপ হতো: `redact.ts`
   * ম্যানেজারের **রেসপন্স থেকে** বেতন ছেঁকে ফেলে, কিন্তু কেউ তো
   * `monthlySalary` **পাঠাতে** পারে। ফলে ম্যানেজার এমন একটা ঘরে লিখতে
   * পারতেন যেটা তিনি পড়তেও পারেন না — আর ভুল বসালে সেটা নিজে দেখেও
   * ধরতে পারতেন না।
   *
   * ⚠️ ৪০৩, নীরবে বাদ দেওয়া নয়। ফিল্ডটা চুপচাপ ফেলে দিলে ম্যানেজার
   * ভাবতেন বেতন বসে গেছে, আর ভুলটা ধরা পড়ত মাসের শেষে পে-রোলে।
   *
   * ⚠️ `undefined` আর `null` আলাদা: ফিল্ড **না পাঠানো** স্বাভাবিক (হাত
   * দিচ্ছেন না), কিন্তু `null` পাঠানো মানে "বেতন মুছে দাও" — সেটাও বেতনে
   * হাত দেওয়া, তাই সমান নিষিদ্ধ।
   */
  private assertMaySetSalary(
    actor: SessionUser,
    monthlySalary: string | null | undefined,
  ): void {
    if (monthlySalary === undefined || canSeeSalary(actor.role)) return;

    throw new ForbiddenException(
      'Only the owner can set or clear salary. Save the rest without the salary field.',
    );
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
