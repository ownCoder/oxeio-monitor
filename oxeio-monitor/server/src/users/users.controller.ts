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
import { IsEmail } from 'class-validator';
import { UserRole } from '@prisma/client';

import { AuthService } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';

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
    @Ip() ip: string,
  ): Promise<{ email: string; tempPassword: string }> {
    return this.auth.resetPassword(actor.userId, id, ip);
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
}
