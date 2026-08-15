import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { CreateHolidayDto, HolidayListQueryDto, UpdateHolidayDto } from './dto';
import { HolidaysService, type HolidayView } from './holidays.service';

/**
 * `CRUD /api/v1/holidays` — **owner ও manager** *(মালিকের সিদ্ধান্ত,
 * ১৫ আগস্ট; আগে owner-only ছিল, স্পেক § ৪.২)*।
 *
 * ⚠️⚠️ ম্যানেজারকে দেওয়ার আগে জেনে রাখা দরকার **ছুটির তারিখ টাকা নাড়ায়**:
 * একটা তারিখ যোগ বা সরালে ওই মাসের কর্মদিবস (D) বদলায়, আর তাতে
 * `target_sec` · `expected_sec` · `pace_sec` আর পে-রোলের `d ÷ D` — সবই।
 * ⭐ ক্ষতিটা সীমিত রাখে দুটো জিনিস: বন্ধ মাস (E16/R1) আর ছোঁয়া যায় না,
 * আর প্রতিটা বদল `audit_log`-এ নাম ধরে লেখা থাকে।
 */
@Roles(UserRole.owner, UserRole.manager)
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  /** `GET /api/v1/holidays?year=2026` */
  @Get()
  list(@Query() query: HolidayListQueryDto): Promise<{ rows: HolidayView[] }> {
    return this.holidays.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: SessionUser,
    @Body() dto: CreateHolidayDto,
    @Ip() ip: string,
  ): Promise<HolidayView> {
    return this.holidays.create(actor, dto, ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHolidayDto,
    @Ip() ip: string,
  ): Promise<HolidayView> {
    return this.holidays.update(actor, id, dto, ip);
  }

  /**
   * ⚠️ পুরো E10-এ এটাই একমাত্র সত্যিকারের DELETE — ছুটির সারির দিকে কোনো
   * FK তাকিয়ে নেই। তবু মুছে ফেলা সারিটা audit meta-তে তোলা থাকে, কারণ
   * ছুটি মুছলে ওই মাসে সবার pace পিছিয়ে যায়।
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<{ deleted: HolidayView }> {
    return this.holidays.remove(actor, id, ip);
  }
}
