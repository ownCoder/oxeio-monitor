import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import {
  decodeEnvelope,
  encodeEnvelope,
  verifySecondFactor,
  type TotpEnvelope,
} from './totp';
import type { SessionUser } from './types';

/**
 * ⭐ লগইনের ফল তিন রকম হতে পারে, তাই discriminated union — একটা optional
 *    ফিল্ড দিয়ে বোঝালে কল করার জায়গায় "needsTotp true অথচ user-ও আছে"
 *    এমন অসম্ভব অবস্থাও টাইপ-বৈধ হতো।
 */
export type LoginOutcome =
  | { status: 'needs_totp' }
  | {
      status: 'ok';
      user: Omit<SessionUser, 'issuedAt'>;
      mustChangePassword: boolean;
      /** রিকভারি কোড দিয়ে ঢুকেছে — ইউজারকে জানানো দরকার */
      usedRecoveryCode: boolean;
      /** 2FA চালু থাকলে আর কটা রিকভারি কোড বাকি; নইলে null */
      recoveryCodesLeft: number | null;
    };

export interface MeResult {
  userId: number;
  email: string;
  fullName: string;
  role: UserRole;
  employeeId: number | null;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  /** I06 — Security পর্দা এটা দেখেই অবস্থা বোঝায় */
  twoFactorEnabled: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ⭐ 2FA-র দ্বিতীয় ধাপে ইমেইল+পাসওয়ার্ড **আবার** পাঠাতে হয় — মাঝপথের
   *    কোনো "half-logged-in" টোকেন নেই। সেরকম টোকেন মানেই আরেকটা জিনিস
   *    যা চুরি হতে পারে, মেয়াদ শেষ হতে পারে, ভুল করে পুরো সেশনের ক্ষমতা
   *    পেয়ে যেতে পারে। ব্রাউজার পাসওয়ার্ডটা ফর্মেই ধরে রাখে, তাই
   *    ব্যবহারকারীর দিক থেকে পার্থক্য নেই।
   */
  async login(
    email: string,
    password: string,
    ip: string,
    totp?: string,
    recoveryCode?: string,
  ): Promise<LoginOutcome> {
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
      throw new UnauthorizedException('Email or password is incorrect');
    }

    // I06 — 2FA। খাম ভাঙা থাকলে `decodeEnvelope` ছোড়ে, অর্থাৎ fail-closed।
    const env = decodeEnvelope(user.totpSecret);
    let usedRecoveryCode = false;
    let nextEnv: TotpEnvelope | null = null;

    if (env?.enabled) {
      const result = verifySecondFactor(env, { totp, recoveryCode });

      if (!result.ok && result.reason === 'missing') {
        // ⚠️ এখানে `recordSuccess` **নয়** — পাসওয়ার্ড ঠিক হলেও লগইন এখনো
        //    সম্পূর্ণ নয়, তাই ব্যর্থতার কাউন্টার মুছে ফেলা যাবে না।
        //    ব্যর্থতাও নয়: কোড না দেওয়াটা আক্রমণ নয়, স্বাভাবিক প্রথম ধাপ।
        return { status: 'needs_totp' };
      }

      if (!result.ok) {
        // ⚠️ 2FA ধাপেও throttle — নইলে পাসওয়ার্ড জানা আক্রমণকারী ৬ অঙ্কের
        //    ১০ লাখ সম্ভাবনা নির্বিঘ্নে চেষ্টা করে যেতে পারত।
        this.throttle.recordFailure(email, ip);
        await this.audit.record({
          userId: user.id,
          action: '2fa_failed',
          ipAddress: ip,
          meta: { reason: result.reason },
        });
        throw new UnauthorizedException(
          result.reason === 'replayed'
            ? 'This code has already been used — wait for the next code in your app'
            : 'Verification code is invalid',
        );
      }

      usedRecoveryCode = result.usedRecoveryCode;
      nextEnv = result.env;
    }

    this.throttle.recordSuccess(email, ip);

    // ⚠️ খরচ হওয়া কোড/counter আর `lastLoginAt` একই `UPDATE`-এ — আলাদা করলে
    //    একটা ব্যর্থ হলে "লগইন হয়েছে কিন্তু কোড খরচ হয়নি" অবস্থা তৈরি হতো,
    //    অর্থাৎ replay ঠেকানোই ভেঙে যেত।
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(nextEnv === null ? {} : { totpSecret: encodeEnvelope(nextEnv) }),
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'login',
      ipAddress: ip,
      meta: { twoFactor: env?.enabled === true, recovery: usedRecoveryCode },
    });

    if (usedRecoveryCode) {
      await this.audit.record({
        userId: user.id,
        action: '2fa_recovery_used',
        ipAddress: ip,
        meta: { left: nextEnv?.recoveryHashes.length ?? 0 },
      });
    }

    return {
      status: 'ok',
      user: {
        userId: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        mustChangePw: user.mustChangePw,
      },
      mustChangePassword: user.mustChangePw,
      usedRecoveryCode,
      recoveryCodesLeft: nextEnv?.recoveryHashes.length ?? null,
    };
  }

  async me(userId: number): Promise<MeResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('This account is no longer active');
    }

    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      employeeId: user.employeeId,
      mustChangePassword: user.mustChangePw,
      lastLoginAt: user.lastLoginAt,
      twoFactorEnabled: decodeEnvelope(user.totpSecret)?.enabled === true,
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
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
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
    if (!target) throw new NotFoundException('User not found');

    /**
     * ⚠️⚠️ **নিষ্ক্রিয় অ্যাকাউন্টে রিসেট আটকানো হয়, আর কারণটা বলা হয়।**
     *
     * আগে এটা চুপচাপ সফল হতো — নতুন পাসওয়ার্ড পর্দায় দেখাত, অথচ
     * `login()` পাসওয়ার্ডের সাথে `isActive`-ও মেলায়, তাই ওই পাসওয়ার্ড
     * **কোনোদিন কাজ করত না**। আর লগইনের বার্তা ইচ্ছাকৃতভাবে সবসময় একই
     * (*"Email or password is incorrect"* — user enumeration ঠেকাতে),
     * তাই মালিকের কাছে ব্যাপারটা দাঁড়াত: রিসেট কাজ করছে, লগইন করছে না,
     * আর কেন — জানার কোনো উপায় নেই।
     *
     * ⭐ এখানে বার্তাটা লুকানোর কিছু নেই: এই রুটে ঢুকতেই owner হতে হয়,
     * অর্থাৎ তিনি এমনিতেই সব অ্যাকাউন্ট দেখতে পান।
     *
     * ⚠️ নিজে থেকে সক্রিয় করে দেওয়া হয় **না**। পাসওয়ার্ড রিসেট করতে গিয়ে
     * কেউ যেন ছেড়ে-যাওয়া কর্মীর অ্যাকাউন্ট অজান্তে খুলে না ফেলে —
     * সক্রিয় করাটা আলাদা, সচেতন কাজ (Staff → Reactivate)।
     */
    if (!target.isActive) {
      throw new ConflictException(
        'This login is disabled because the staff member is inactive. '
          + 'Reactivate them on the Staff screen first — then reset the password.',
      );
    }

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

  /**
   * লগইনের ইমেইল বদলানো — অর্থাৎ স্টাফের "ইউজারনেম"।
   *
   * ⚠️⚠️ **কেন এটা দরকার হলো:** portal অ্যাকাউন্ট খোলার সময় ইমেইলটা হাতে
   * টাইপ করতে হয়, আর ভুল হলে ওই অ্যাকাউন্ট চিরকাল ভুল ঠিকানায় আটকে থাকত —
   * বদলানোর কোনো পথ ছিল না। ১৫ জনের জন্য একবার করে টাইপ করলে অন্তত একটা
   * টাইপো হওয়াই স্বাভাবিক।
   *
   * ⚠️ পাসওয়ার্ড এখানে ছোঁয়া হয় **না** — সেটা `resetPassword()`। দুটো
   * আলাদা রাখা ইচ্ছাকৃত: ইমেইলের বানান ঠিক করতে গিয়ে কারো পাসওয়ার্ড
   * অকারণে বদলে যাওয়া উচিত নয়।
   */
  async changeLoginEmail(
    actorId: number,
    targetUserId: number,
    email: string,
    ip: string,
  ): Promise<{ id: number; email: string }> {
    const next = email.trim().toLowerCase();
    if (!next.includes('@')) {
      throw new BadRequestException('That does not look like an email address');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) throw new NotFoundException('User not found');

    if (target.email === next) return { id: target.id, email: target.email };

    // ⚠️ আগে থেকে দেখা হয়, শুধু unique constraint-এর ভরসায় নয় — নইলে
    //    পর্দায় যেত Prisma-র P2002, যেটা পড়ে কেউ বুঝত না কী ভুল হয়েছে।
    const taken = await this.prisma.user.findUnique({ where: { email: next } });
    if (taken) {
      throw new ConflictException('Another account already uses that email');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { email: next },
    });

    await this.audit.record({
      userId: actorId,
      action: 'change_login_email',
      targetType: 'user',
      targetId: targetUserId,
      ipAddress: ip,
      // ⭐ আগেরটাও লেখা থাকে — কে কার লগইন বদলেছে, সেটা পরে মেলানোর
      //    একমাত্র উপায় এটাই
      meta: { from: target.email, to: next },
    });

    return { id: updated.id, email: updated.email };
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
    if (!employee) throw new NotFoundException('Staff member not found');

    const normalized = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) {
      throw new BadRequestException('An account with this email already exists');
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
