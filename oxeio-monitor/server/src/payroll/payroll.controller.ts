import { Body, Controller, Get, Ip, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { PayrollService, type PayrollSheet } from './payroll.service';
import { RecordSalaryPaymentDto } from './salary.dto';
import { SalaryService, type SalaryOverview } from './salary.service';

/**
 * ⚠️ পুরো কন্ট্রোলারটাই **owner-only** — মেথড-লেভেলে নয়, ক্লাস-লেভেলে।
 * পরে কেউ নতুন endpoint যোগ করলে সেটাও আপনাআপনি owner-only থাকবে।
 * মেথডে বসালে নতুন endpoint নীরবে ম্যানেজারের নাগালে চলে যেত।
 */
@Roles(UserRole.owner)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService, private readonly salary: SalaryService) {}

  /** F03 — `GET /api/v1/payroll?month=2026-08` */
  @Get()
  sheet(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Query('month') month: string,
  ): Promise<PayrollSheet> {
    return this.payroll.sheet(month, actor.userId, ip);
  }

  @Get('salary')
  salaryOverview(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Query('month') month: string,
  ): Promise<SalaryOverview> {
    return this.salary.overview(month, actor.userId, ip);
  }

  @Put('salary/:month/:employeeId/payment')
  recordPayment(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Param('month') month: string,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() body: RecordSalaryPaymentDto,
  ): Promise<{ ok: true }> {
    return this.salary.recordPayment(month, employeeId, body, actor.userId, ip);
  }
}
