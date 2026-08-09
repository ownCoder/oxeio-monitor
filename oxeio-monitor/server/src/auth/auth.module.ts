import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './guards/must-change-password.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * চারটি গার্ডই **গ্লোবাল** — নিরাপত্তা opt-out মডেলে, opt-in নয়।
 * নতুন কোনো কন্ট্রোলার লিখলে সেটা ডিফল্টভাবেই সুরক্ষিত থাকবে;
 * খোলা রাখতে হলে ইচ্ছাকৃতভাবে `@Public()` লিখতে হবে।
 *
 * ক্রম গুরুত্বপূর্ণ:
 *   JWT → CSRF → পাসওয়ার্ড বদলের বাধ্যবাধকতা → role
 *
 * JWT আগে কেন: CSRF আগে রাখলে লগইন না করা রিকোয়েস্টও "CSRF মেলেনি" (403) পেত,
 * অথচ আসল কারণ "লগইন করুন" (401)। নিরাপত্তায় ক্ষতি নেই — CSRF আক্রমণ তো
 * ভুক্তভোগীর cookie নিয়েই হয়, অর্থাৎ সে লগইন করা থাকেই।
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    LoginThrottleService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
