import {
  Body,
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
import { CreatePortalAccountDto } from '../auth/dto';
import type { SessionUser } from '../auth/types';

@Controller('employees')
export class EmployeePortalController {
  constructor(private readonly auth: AuthService) {}

  /**
   * স্টাফের নিজস্ব ভিউয়ের অ্যাকাউন্ট (G6 · J04 · J05)।
   * স্বচ্ছতার মূল ভিত্তি — স্টাফ নিজের ডেটা নিজেই দেখতে পাবে।
   */
  @Roles(UserRole.owner)
  @Post(':id/portal-account')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: CreatePortalAccountDto,
    @Ip() ip: string,
  ): Promise<{ userId: number; email: string; tempPassword: string }> {
    return this.auth.createPortalAccount(
      actor.userId,
      employeeId,
      dto.email,
      dto.role ?? UserRole.employee,
      ip,
    );
  }
}
