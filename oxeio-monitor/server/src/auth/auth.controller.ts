import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { IDLE_WARN_BEFORE_SEC, SESSION_TTL_MIN } from './auth.constants';
import { AuthService, type MeResult } from './auth.service';
import { AllowWhileMustChangePw, CurrentUser, Public } from './decorators';
import {
  ChangePasswordDto,
  LoginDto,
  PasswordConfirmDto,
  TotpCodeDto,
} from './dto';
import { TokenService } from './token.service';
import type { SessionUser } from './types';
import {
  TwoFactorService,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from './two-factor.service';

/** লগইনের উত্তর — দুটোর একটাই আসে, কখনো দুটো একসাথে নয় */
interface LoginResponse {
  /** true হলে সেশন cookie **বসেনি**; ইউজারকে কোড চাইতে হবে */
  needsTotp?: true;
  mustChangePassword?: boolean;
  usedRecoveryCode?: boolean;
  recoveryCodesLeft?: number | null;
}

/** I09 — ওয়েব এই সংখ্যাগুলো দিয়েই নিজের কাউন্টডাউন মেলায় */
interface SessionPolicy {
  idleTimeoutSec: number;
  warnBeforeSec: number;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const outcome = await this.auth.login(
      dto.email,
      dto.password,
      ip,
      dto.totp,
      dto.recoveryCode,
    );

    // ⚠️ ২০০ কিন্তু cookie নেই — ইচ্ছাকৃত। ৪০১ দিলে ওয়েবের গ্লোবাল
    //    "সেশন শেষ" হ্যান্ডলার চালু হতো, অথচ এটা ব্যর্থতাই নয়, ধাপ ১।
    if (outcome.status === 'needs_totp') return { needsTotp: true };

    await this.tokens.issue(res, outcome.user);
    return {
      mustChangePassword: outcome.mustChangePassword,
      usedRecoveryCode: outcome.usedRecoveryCode,
      recoveryCodesLeft: outcome.recoveryCodesLeft,
    };
  }

  @AllowWhileMustChangePw()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    this.tokens.clear(res);
  }

  @AllowWhileMustChangePw()
  @Get('me')
  me(@CurrentUser() user: SessionUser): Promise<MeResult> {
    return this.auth.me(user.userId);
  }

  /**
   * I09 — ওয়েবের কাউন্টডাউন যেন সার্ভারের সাথে না মেলে এমন না হয়।
   * ⚠️ সংখ্যাগুলো ফ্রন্টএন্ডে হার্ডকোড করলে একদিন সার্ভারে TTL বদলে গেলে
   *    ওয়েব ৩০ মিনিটে সতর্ক করত অথচ সেশন মরত ১৫ মিনিটে — বা উল্টো।
   */
  @Public()
  @Get('session-policy')
  sessionPolicy(): SessionPolicy {
    return {
      idleTimeoutSec: SESSION_TTL_MIN * 60,
      warnBeforeSec: IDLE_WARN_BEFORE_SEC,
    };
  }

  @AllowWhileMustChangePw()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
      ip,
    );
    // টোকেনে mustChangePw বসানো আছে — নতুন করে ইস্যু না করলে
    // পাসওয়ার্ড বদলানোর পরেও ইউজার আটকে থাকত
    await this.tokens.issue(res, { ...user, mustChangePw: false });
  }

  // ══════════════════ I06 — ঐচ্ছিক TOTP 2FA ══════════════════
  //
  // ⚠️ কোনোটাতেই `@AllowWhileMustChangePw()` নেই। প্রথম লগইনে অস্থায়ী
  //    পাসওয়ার্ড নিয়েই কেউ 2FA বসিয়ে ফেললে ওই দুর্বল পাসওয়ার্ডটাই
  //    রয়ে যেত — আগে পাসওয়ার্ড বদলাক, তারপর 2FA।

  @Get('2fa')
  twoFactorStatus(@CurrentUser() user: SessionUser): Promise<TwoFactorStatus> {
    return this.twoFactor.status(user.userId);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(
    @CurrentUser() user: SessionUser,
    @Ip() ip: string,
  ): Promise<TwoFactorSetup> {
    return this.twoFactor.setup(user.userId, ip);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enableTwoFactor(
    @CurrentUser() user: SessionUser,
    @Body() dto: TotpCodeDto,
    @Ip() ip: string,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.twoFactor.enable(user.userId, dto.code, ip);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disableTwoFactor(
    @CurrentUser() user: SessionUser,
    @Body() dto: PasswordConfirmDto,
    @Ip() ip: string,
  ): Promise<void> {
    return this.twoFactor.disable(user.userId, dto.password, ip);
  }

  @Post('2fa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(
    @CurrentUser() user: SessionUser,
    @Body() dto: PasswordConfirmDto,
    @Ip() ip: string,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.twoFactor.regenerateRecoveryCodes(user.userId, dto.password, ip);
  }
}
