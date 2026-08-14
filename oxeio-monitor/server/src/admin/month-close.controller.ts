import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { CloseMonthDto } from './dto';
import {
  MonthCloseService,
  type MonthClosureView,
} from './month-close.service';

/**
 * R1 — `/api/v1/months` · **owner-only**।
 *
 * ⚠️ ম্যানেজার নয়, ইচ্ছাকৃতভাবে: মাস বন্ধ করা মানে বেতনের ভিত্তি স্থির
 * করা, আর ম্যানেজার বেতনের সংখ্যা দেখেনই না (§ ৪.৩)। যিনি ফল দেখেন না,
 * তিনি ফলটা জমাটও করতে পারেন না।
 */
@Roles(UserRole.owner)
@Controller('months')
export class MonthCloseController {
  constructor(private readonly months: MonthCloseService) {}

  @Get()
  list(): Promise<{ rows: MonthClosureView[] }> {
    return this.months.list();
  }

  @Post(':yearMonth/close')
  close(
    @CurrentUser() actor: SessionUser,
    @Param('yearMonth') yearMonth: string,
    @Body() dto: CloseMonthDto,
    @Ip() ip: string,
  ): Promise<MonthClosureView> {
    return this.months.close(actor, yearMonth, dto.note, ip);
  }

  /**
   * ⚠️ `DELETE`, `POST …/reopen` নয় — খোলা মানে বন্ধ-করার রেকর্ডটা
   * **তুলে নেওয়া**, নতুন কিছু তৈরি নয়। ⭐ তবু audit-এ দুটো সারিই থেকে
   * যায়, তাই ইতিহাস মোছে না।
   */
  @Delete(':yearMonth')
  reopen(
    @CurrentUser() actor: SessionUser,
    @Param('yearMonth') yearMonth: string,
    @Ip() ip: string,
  ): Promise<{ yearMonth: string; reopened: true }> {
    return this.months.reopen(actor, yearMonth, ip);
  }
}
