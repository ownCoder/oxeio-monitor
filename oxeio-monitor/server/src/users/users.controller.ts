import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IsEmail, IsIn } from 'class-validator';
import { UserRole } from '@prisma/client';

import { AuthService } from '../auth/auth.service';
import { ResetPasswordDto } from '../auth/dto';
import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';

/**
 * ⚠️⚠️ `owner` ইচ্ছাকৃতভাবে **তালিকার বাইরে** — `@IsIn` তাই দ্বিতীয় জাল
 * নয়, **প্রথম** জাল। সার্ভিসও আলাদা করে আটকায়, কিন্তু এখানেই আটকালে
 * অনুরোধটা কোনো ব্যবসায়িক কোড ছোঁয়ারই সুযোগ পায় না।
 */
class ChangeRoleDto {
  @IsIn(['employee', 'manager'])
  role!: 'employee' | 'manager';
}

class ChangeEmailDto {
  /** ⚠️ `class-validator` দিয়েই যাচাই — সার্ভিসের চেকটা দ্বিতীয় জাল */
  @IsEmail()
  email!: string;
}

@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  /**
   * G33 — owner কারো পাসওয়ার্ড রিসেট করে।
   * ⚠️ রেসপন্সে আসা `tempPassword` **একবারই** দেখা যাবে — কোথাও জমা থাকে না।
   */
  @Roles(UserRole.owner)
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  reset(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @Ip() ip: string,
  ): Promise<{ email: string; tempPassword: string }> {
    // ⭐ ঘরটা খালি রাখলে আগের আচরণ — এলোমেলো পাসওয়ার্ড + বাধ্যতামূলক বদল
    return this.auth.resetPassword(actor.userId, id, ip, dto.password);
  }

  /**
   * লগইনের ইমেইল বদলানো — স্টাফের "ইউজারনেম"।
   *
   * ⚠️ পাসওয়ার্ড আলাদা রুটে (`reset-password`), ইচ্ছাকৃতভাবে: বানান ঠিক
   * করতে গিয়ে কারো পাসওয়ার্ড অকারণে বদলে যাওয়া উচিত নয়।
   */
  @Roles(UserRole.owner)
  @Patch(':id/email')
  changeEmail(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeEmailDto,
    @Ip() ip: string,
  ): Promise<{ id: number; email: string }> {
    return this.auth.changeLoginEmail(actor.userId, id, dto.email, ip);
  }

  /**
   * স্টাফ ↔ ম্যানেজার।
   *
   * ⚠️ ভূমিকা আগে বসত কেবল অ্যাকাউন্ট খোলার সময়। বদলাতে হলে অ্যাকাউন্ট
   * মুছে নতুন করে খুলতে হতো — নতুন পাসওয়ার্ড, আর audit log-এ তাঁর
   * পুরোনো ইতিহাস ছিঁড়ে যেত।
   */
  @Roles(UserRole.owner)
  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeRoleDto,
    @Ip() ip: string,
  ): Promise<{ id: number; email: string; role: UserRole }> {
    return this.auth.changeRole(actor.userId, id, dto.role, ip);
  }
}
