import {
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthService } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';

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
}
