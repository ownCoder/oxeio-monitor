import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toDataURL } from 'qrcode';

import { AuditService, type AuditAction } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import {
  buildOtpauthUri,
  decodeEnvelope,
  encodeEnvelope,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  verifyTotpCode,
  type TotpEnvelope,
} from './totp';

/**
 * ⭐ **`AuditAction` থেকেই ছেঁকে নেওয়া, আলাদা তালিকা নয়।** আগে নামগুলো
 * `two-factor.audit.ts`-এ আলাদা লেখা ছিল আর একটা cast দিয়ে গুঁজে দেওয়া হতো,
 * কারণ ইউনিয়নটা তখন অন্য এজেন্টের ফাইল ছিল। এখন নামগুলো আসল ইউনিয়নেই আছে,
 * তাই cast-ও নেই — টাইপো লিখলে **কম্পাইলেই** ধরা পড়বে, নীরবে একটা
 * অচেনা action `audit_log`-এ বসে যাবে না।
 */
type TwoFactorAuditAction = Extract<AuditAction, `2fa_${string}`>;

export interface TwoFactorStatus {
  enabled: boolean;
  /** setup হয়েছে কিন্তু কোড দিয়ে প্রমাণ করা হয়নি */
  pendingSetup: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
  /** `data:image/png;base64,…` — CSP-এর কারণে বাইরের কোনো URL নয় */
  qrDataUrl: string;
}

/**
 * I06 — ঐচ্ছিক TOTP 2FA-র I/O অংশ। খাঁটি হিসাব সব `totp.ts`-এ;
 * এখানে শুধু DB পড়া-লেখা, QR আঁকা আর অডিট।
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private async loadEnvelope(userId: number): Promise<TotpEnvelope | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true },
    });
    if (!user) throw new UnauthorizedException('অ্যাকাউন্ট পাওয়া যায়নি');
    return decodeEnvelope(user.totpSecret);
  }

  private saveEnvelope(userId: number, env: TotpEnvelope | null): Promise<unknown> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: env === null ? null : encodeEnvelope(env) },
    });
  }

  private log(
    userId: number,
    action: TwoFactorAuditAction,
    ip: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      userId,
      action,
      ipAddress: ip,
      meta: meta as Prisma.InputJsonValue | undefined,
    });
  }

  async status(userId: number): Promise<TwoFactorStatus> {
    const env = await this.loadEnvelope(userId);
    return {
      enabled: env?.enabled === true,
      pendingSetup: env !== null && !env.enabled,
      recoveryCodesLeft: env?.recoveryHashes.length ?? 0,
    };
  }

  /**
   * ধাপ ১ — সিক্রেট বানিয়ে QR ফেরত দেয়।
   *
   * ⚠️ এখানে 2FA **চালু হয় না** (`enabled: false`)। চালু করলে ইউজার QR
   *    স্ক্যান করতে ভুলে গিয়ে বা ভুল অ্যাপে স্ক্যান করে নিজের অ্যাকাউন্ট
   *    থেকে চিরতরে তালাবদ্ধ হয়ে যেত — আর owner-এর ক্ষেত্রে সেটা মানে
   *    পুরো সিস্টেম হাতছাড়া।
   */
  async setup(userId: number, ip: string): Promise<TwoFactorSetup> {
    const existing = await this.loadEnvelope(userId);
    if (existing?.enabled) {
      // ⚠️ চালু থাকা অবস্থায় নতুন সিক্রেট বসালে পুরোনো ফোনের কোড হঠাৎ
      //    কাজ করা বন্ধ করত, অথচ ইউজার হয়তো নতুনটা স্ক্যানই করেনি।
      throw new BadRequestException(
        '2FA আগেই চালু আছে। নতুন করে বসাতে হলে আগে বন্ধ করুন।',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new UnauthorizedException('অ্যাকাউন্ট পাওয়া যায়নি');

    const secret = generateSecret();
    const otpauthUri = buildOtpauthUri(secret, user.email);

    await this.saveEnvelope(userId, {
      v: 1,
      secret,
      enabled: false,
      recoveryHashes: [],
      lastCounter: 0,
    });

    await this.log(userId, '2fa_setup', ip);

    return {
      secret,
      otpauthUri,
      qrDataUrl: await toDataURL(otpauthUri, { margin: 1, width: 240 }),
    };
  }

  /**
   * ধাপ ২ — একটা কোড দিয়ে প্রমাণ করলে তবেই চালু, আর তখনই রিকভারি কোড।
   *
   * ⭐ রিকভারি কোড **এখানেই** বানানো হয়, setup-এ নয় — সেটাপ অসম্পূর্ণ
   *    রেখে দিলে যেন অকারণে কোড ঘুরে না বেড়ায়। ফেরত যায় একবারই।
   */
  async enable(
    userId: number,
    code: string,
    ip: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const env = await this.loadEnvelope(userId);
    if (env === null) {
      throw new BadRequestException('আগে setup করুন');
    }
    if (env.enabled) {
      throw new BadRequestException('2FA আগেই চালু আছে');
    }

    const verdict = verifyTotpCode(env, code);
    if (!verdict.ok) {
      await this.log(userId, '2fa_enable_failed', ip, { reason: verdict.reason });
      throw new BadRequestException('কোড মেলেনি — অ্যাপের সময় ঠিক আছে কি না দেখুন');
    }

    const recoveryCodes = generateRecoveryCodes();

    await this.saveEnvelope(userId, {
      ...env,
      enabled: true,
      recoveryHashes: recoveryCodes.map(hashRecoveryCode),
      lastCounter: verdict.counter,
    });

    await this.log(userId, '2fa_enable', ip, {
      recoveryCodes: recoveryCodes.length,
    });

    return { recoveryCodes };
  }

  /**
   * ⚠️ পাসওয়ার্ড লাগে। শুধু সেশন cookie যথেষ্ট ধরলে খোলা রেখে যাওয়া
   *    ল্যাপটপ থেকে যে কেউ 2FA খুলে ফেলতে পারত — অথচ 2FA-র পুরো উদ্দেশ্যই
   *    "cookie চুরি গেলেও রক্ষা"।
   */
  async disable(userId: number, password: string, ip: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('অ্যাকাউন্ট পাওয়া যায়নি');

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.log(userId, '2fa_disable_failed', ip);
      throw new UnauthorizedException('পাসওয়ার্ড ভুল');
    }

    await this.saveEnvelope(userId, null);
    await this.log(userId, '2fa_disable', ip);
  }

  /**
   * রিকভারি কোড ফুরিয়ে এলে বা কাগজ হারালে নতুন সেট।
   * ⚠️ পুরোনো সবগুলো **সাথে সাথেই** অচল হয় — নইলে হারানো কাগজটা এখনো
   *    কাজ করত, আর নতুন সেট বানানোর মানেই থাকত না।
   */
  async regenerateRecoveryCodes(
    userId: number,
    password: string,
    ip: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('অ্যাকাউন্ট পাওয়া যায়নি');

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('পাসওয়ার্ড ভুল');
    }

    const env = decodeEnvelope(user.totpSecret);
    if (env === null || !env.enabled) {
      throw new BadRequestException('2FA চালু নেই');
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.saveEnvelope(userId, {
      ...env,
      recoveryHashes: recoveryCodes.map(hashRecoveryCode),
    });

    await this.log(userId, '2fa_recovery_regenerate', ip, {
      recoveryCodes: recoveryCodes.length,
    });

    return { recoveryCodes };
  }
}
