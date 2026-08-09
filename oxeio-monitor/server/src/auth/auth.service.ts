import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import type { SessionUser } from './types';

export interface LoginResult {
  user: Omit<SessionUser, 'issuedAt'>;
  mustChangePassword: boolean;
}

export interface MeResult {
  userId: number;
  email: string;
  fullName: string;
  role: UserRole;
  employeeId: number | null;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginResult> {
    this.throttle.assertNotLocked(email, ip);

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // ইউজার নেই আর পাসওয়ার্ড ভুল — দুটোতেই একই বার্তা, নইলে
    // কোন ইমেইলগুলো আসল তা বাইরে থেকে বোঝা যেত (user enumeration)
    const ok =
      user !== null &&
      user.isActive &&
      (await this.passwords.verify(user.passwordHash, password));

    if (!ok) {
      this.throttle.recordFailure(email, ip);
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'login_failed',
        ipAddress: ip,
        meta: { email },
      });
      throw new UnauthorizedException('ইমেইল বা পাসওয়ার্ড ভুল');
    }

    // I06 — 2FA Phase 6-এ। সিক্রেট বসানো থাকলেও যাচাই করার কোড এখনো নেই,
    // তাই চুপচাপ ঢুকতে দেওয়ার বদলে fail-closed: লগইন আটকে দিই।
    if (user.totpSecret) {
      throw new UnauthorizedException(
        'এই অ্যাকাউন্টে 2FA বসানো আছে, কিন্তু যাচাই এখনো তৈরি হয়নি (Phase 6)। ' +
          'owner-কে দিয়ে totp_secret সরিয়ে নিন।',
      );
    }

    this.throttle.recordSuccess(email, ip);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      userId: user.id,
      action: 'login',
      ipAddress: ip,
    });

    return {
      user: {
        userId: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        mustChangePw: user.mustChangePw,
      },
      mustChangePassword: user.mustChangePw,
    };
  }

  async me(userId: number): Promise<MeResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('অ্যাকাউন্ট আর সক্রিয় নেই');
    }

    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      employeeId: user.employeeId,
      mustChangePassword: user.mustChangePw,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('বর্তমান পাসওয়ার্ড ভুল');

    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException('নতুন পাসওয়ার্ড আগেরটার মতোই হতে পারবে না');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        mustChangePw: false,
        pwChangedAt: new Date(),
      },
    });

    await this.audit.record({
      userId,
      action: 'change_password',
      ipAddress: ip,
    });
  }

  /**
   * G33 — owner কারো পাসওয়ার্ড রিসেট করে।
   * নতুন পাসওয়ার্ড **একবারই** ফেরত যায়; কোথাও plaintext-এ জমা হয় না।
   * SMTP লাগে না, তাই Phase 1-এই কাজ করে।
   */
  async resetPassword(
    actorId: number,
    targetUserId: number,
    ip: string,
  ): Promise<{ email: string; tempPassword: string }> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) throw new NotFoundException('ইউজার পাওয়া যায়নি');

    const tempPassword = this.passwords.generateTempPassword();

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        passwordHash: await this.passwords.hash(tempPassword),
        mustChangePw: true,
        pwChangedAt: null,
      },
    });

    await this.audit.record({
      userId: actorId,
      action: 'reset_password',
      targetType: 'user',
      targetId: targetUserId,
      ipAddress: ip,
      meta: { email: target.email },
    });

    return { email: target.email, tempPassword };
  }

  /** স্টাফের self-view অ্যাকাউন্ট (J04/J05) — owner খোলে */
  async createPortalAccount(
    actorId: number,
    employeeId: number,
    email: string,
    role: UserRole,
    ip: string,
  ): Promise<{ userId: number; email: string; tempPassword: string }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('স্টাফ পাওয়া যায়নি');

    const normalized = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) {
      throw new BadRequestException('এই ইমেইলে অ্যাকাউন্ট আগেই আছে');
    }

    const tempPassword = this.passwords.generateTempPassword();

    const created = await this.prisma.user.create({
      data: {
        email: normalized,
        passwordHash: await this.passwords.hash(tempPassword),
        fullName: employee.fullName,
        role,
        employeeId,
        mustChangePw: true,
      },
    });

    await this.audit.record({
      userId: actorId,
      action: 'create_portal_account',
      targetType: 'employee',
      targetId: employeeId,
      ipAddress: ip,
      meta: { email: normalized, role },
    });

    return { userId: created.id, email: normalized, tempPassword };
  }
}
