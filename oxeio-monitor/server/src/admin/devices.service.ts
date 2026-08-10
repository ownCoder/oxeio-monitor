import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_TARGET } from './admin-audit';
import type {
  CreateEnrollmentCodeDto,
  DeviceListQueryDto,
  RestoreDeviceDto,
  RevokeDeviceDto,
} from './dto';
import {
  enrollmentCodeExpiry,
  formatEnrollmentCode,
  hashEnrollmentCode,
} from './enrollment-code';

/**
 * ⭐ whitelist — `tokenHash` ইচ্ছাকৃতভাবে **নেই**।
 *
 * ⚠️ `include: { employee: true }` লিখলে পুরো সারিটা যেত, আর তাতে
 * `monthlySalary`ও থাকত। ডিভাইসের তালিকা ম্যানেজারের জন্য নয় বলে সেটা
 * এখনই বিপদ নয়, কিন্তু "কোন endpoint দিয়ে বেতন বেরোতে পারে" প্রশ্নের
 * উত্তর একটাই থাকা ভালো: কোনোটা দিয়েই নয়, শুধু বেছে নেওয়া ফিল্ড যায়।
 */
const DEVICE_SELECT = {
  id: true,
  hostname: true,
  windowsUsername: true,
  machineGuid: true,
  osVersion: true,
  agentVersion: true,
  monitors: true,
  status: true,
  lastSeenAt: true,
  lastDriftSec: true,
  maxDriftSec: true,
  enrolledAt: true,
  employee: { select: { id: true, empCode: true, fullName: true } },
} satisfies Prisma.DeviceSelect;

/** ⭐ টাইপটা select থেকেই জন্মায় — হাতে লেখা interface হলে দুটো আলাদা হয়ে যেত */
export type DeviceView = Prisma.DeviceGetPayload<{
  select: typeof DEVICE_SELECT;
}>;

export interface EnrollmentCodeResult {
  /** ⚠️ এই একবারই যাবে — সার্ভারে শুধু sha256 জমা থাকে */
  code: string;
  expiresAt: string;
  employee: { id: number; empCode: string; fullName: string };
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: DeviceListQueryDto,
  ): Promise<{ rows: DeviceView[]; total: number }> {
    const rows = await this.prisma.device.findMany({
      where: {
        ...(query.employeeId === undefined
          ? {}
          : { employeeId: query.employeeId }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
      select: DEVICE_SELECT,
      // চুপ হয়ে যাওয়া এজেন্ট আগে দেখাই কাজে লাগে (G01 অ্যালার্টের সাথে মেলে)
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
    });

    return { rows, total: rows.length };
  }

  async get(id: number): Promise<DeviceView> {
    const row = await this.prisma.device.findUnique({
      where: { id },
      select: DEVICE_SELECT,
    });
    if (!row) throw new NotFoundException('ডিভাইস পাওয়া যায়নি');
    return row;
  }

  /**
   * H06 — দূর থেকে ডিভাইস বন্ধ।
   *
   * ⚠️ ডিলিট নয়। ওই ডিভাইসের নামে work_sessions, activity_segments,
   * screenshots — সবই FK দিয়ে বাঁধা; সারিটা মুছলে কারো মাসের ঘণ্টাই
   * উবে যেত।
   *
   * ⚠️ `tokenHash` মোছা হয় না, শুধু দরজা বন্ধ হয় — `DeviceAuthGuard`
   * `status === 'revoked'` দেখে আটকায়। মানে **restore করলে পুরোনো
   * টোকেনটাই আবার জেগে ওঠে**। ল্যাপটপ হারিয়ে গেলে তাই restore করবেন না;
   * নতুন enrollment code দিন — enroll `machineGuid` দিয়ে upsert করে
   * tokenHash বদলে দেয়, পুরোনো টোকেন তখন মরে।
   */
  async revoke(
    actor: SessionUser,
    id: number,
    dto: RevokeDeviceDto,
    ip: string,
  ): Promise<DeviceView> {
    const before = await this.prisma.device.findUnique({
      where: { id },
      select: { id: true, hostname: true, status: true },
    });
    if (!before) throw new NotFoundException('ডিভাইস পাওয়া যায়নি');
    if (before.status === 'revoked') {
      throw new ConflictException('এই ডিভাইস আগেই revoke করা হয়েছে');
    }

    const row = await this.prisma.device.update({
      where: { id },
      data: { status: 'revoked' },
      select: DEVICE_SELECT,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'revoke_device',
      targetType: ADMIN_TARGET.device,
      targetId: id,
      ipAddress: ip,
      meta: { hostname: before.hostname, reason: dto.reason },
    });

    this.logger.warn(`device ${id} (${before.hostname}) revoke — ${dto.reason}`);
    return row;
  }

  /**
   * আবার চালু।
   *
   * ⚠️ `revoke_device` action-টা এখানে ব্যবহার করা হয়নি — একই action দিয়ে
   * উল্টো কাজ লিখলে audit log পড়ে কেউ বুঝতেই পারত না কোনটা বন্ধ আর কোনটা
   * খোলা। তাই `change_setting` + `meta.op = 'restore'`।
   */
  async restore(
    actor: SessionUser,
    id: number,
    dto: RestoreDeviceDto,
    ip: string,
  ): Promise<DeviceView> {
    const before = await this.prisma.device.findUnique({
      where: { id },
      select: { id: true, hostname: true, status: true, employeeId: true },
    });
    if (!before) throw new NotFoundException('ডিভাইস পাওয়া যায়নি');
    if (before.status === 'active') {
      throw new ConflictException('এই ডিভাইস আগে থেকেই সক্রিয়');
    }

    // ⚠️ নিষ্ক্রিয় কর্মীর ডিভাইস আবার চালু করা মানে চাকরি ছেড়ে দেওয়া
    //    একজনের স্ক্রিনশট আবার উঠতে শুরু করা — deactivate যা বন্ধ করেছিল
    //    সেটাই নীরবে ফিরে আসত।
    if (before.employeeId !== null) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: before.employeeId },
        select: { status: true, empCode: true },
      });
      if (employee?.status === 'inactive') {
        throw new ConflictException(
          `${employee.empCode} নিষ্ক্রিয় — আগে কর্মচারীকে সক্রিয় করুন`,
        );
      }
    }

    const row = await this.prisma.device.update({
      where: { id },
      data: { status: 'active' },
      select: DEVICE_SELECT,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.device,
      targetId: id,
      ipAddress: ip,
      meta: { op: 'restore', hostname: before.hostname, reason: dto.reason },
    });

    return row;
  }

  /**
   * H05 — `POST /api/v1/devices/enrollment-code`।
   *
   * ⚠️ কোডটা **একবারই** দেখানো হয়; ডাটাবেসে শুধু sha256। হারালে নতুন কোড
   * বানাতে হবে, উদ্ধারের কোনো পথ নেই — সেটাই উদ্দেশ্য।
   */
  async createEnrollmentCode(
    actor: SessionUser,
    dto: CreateEnrollmentCodeDto,
    ip: string,
  ): Promise<EnrollmentCodeResult> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, empCode: true, fullName: true, status: true },
    });
    if (!employee) throw new NotFoundException('কর্মচারী পাওয়া যায়নি');

    // ⚠️ চলে যাওয়া কর্মীর নামে নতুন এজেন্ট বসানোর কোড দেওয়া যাবে না
    if (employee.status === 'inactive') {
      throw new BadRequestException(
        `${employee.empCode} নিষ্ক্রিয় — নিষ্ক্রিয় কর্মীর জন্য enrollment code দেওয়া যায় না`,
      );
    }

    const now = new Date();
    const code = formatEnrollmentCode(randomBytes(32));
    const expiresAt = enrollmentCodeExpiry(now);

    try {
      await this.prisma.$transaction(async (tx) => {
        // ⭐ নতুন কোড দিলে আগেরগুলো তখনই মেয়াদোত্তীর্ণ। নইলে একই কর্মীর
        //    নামে একসাথে কয়েকটা জীবন্ত কোড ঘুরত, আর "কোনটা কাকে দিয়েছিলাম"
        //    প্রশ্নের উত্তর থাকত না।
        await tx.enrollmentCode.updateMany({
          where: {
            employeeId: employee.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { expiresAt: now },
        });

        await tx.enrollmentCode.create({
          data: {
            codeHash: hashEnrollmentCode(code),
            employeeId: employee.id,
            createdById: actor.userId,
            expiresAt,
          },
        });
      });
    } catch (err) {
      // ⚠️ codeHash UNIQUE। ৬০ বিটে সংঘর্ষ কার্যত অসম্ভব, কিন্তু হলে
      //    চুপচাপ পুরোনো কোড আবার বিলি করার চেয়ে ৫০০ হয়ে ফেটে পড়া ভালো —
      //    তখন এক কোডে দুজন enroll করতে পারত।
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.error('enrollment code hash সংঘর্ষ — আবার চেষ্টা করুন');
      }
      throw err;
    }

    await this.audit.record({
      userId: actor.userId,
      action: 'create_enrollment_code',
      targetType: ADMIN_TARGET.employee,
      targetId: employee.id,
      ipAddress: ip,
      // ⚠️ কোড বা তার hash কখনো audit meta-তে নয় — audit_log owner-only
      //    হলেও ওটা লগ, গোপন কিছু রাখার জায়গা নয়
      meta: { empCode: employee.empCode, expiresAt: expiresAt.toISOString() },
    });

    return {
      code,
      expiresAt: expiresAt.toISOString(),
      employee: {
        id: employee.id,
        empCode: employee.empCode,
        fullName: employee.fullName,
      },
    };
  }
}
