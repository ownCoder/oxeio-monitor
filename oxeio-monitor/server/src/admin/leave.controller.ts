import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { CreateLeaveDto } from './dto';
import { LeaveService, type LeaveView } from './leave.service';

/**
 * R2 — `/api/v1/leaves`।
 *
 * ⚠️⚠️ **owner-only, আর সেটা ইচ্ছাকৃতভাবে পর্দার সাথে মিলিয়ে**: ছুটির
 * খাতা Settings-এ, আর গোটা Settings পাতাটাই owner-এর। এখানে manager
 * খুলে রাখলে API এমন একটা প্রবেশাধিকারের দাবি করত যেটা পৌঁছানোর কোনো
 * পথই নেই — অর্থাৎ একটা মিথ্যা দরজা।
 *
 * ⭐ ম্যানেজারকে দিতে হলে দুটোই একসাথে বদলাতে হবে (এই ডেকোরেটর আর
 * `SettingsPage`-এর গার্ড), নইলে আবার একটা পর্দাহীন অনুমতি জন্মাবে।
 *
 * ⚠️ staff কখনোই নয়: নিজের ছুটি নিজে লেখা মানে নিজের টার্গেট নিজে কমানো।
 */
@Roles(UserRole.owner)
@Controller('leaves')
export class LeaveController {
  constructor(private readonly leaves: LeaveService) {}

  /** ⚠️ `?month=YYYY-MM` বাধ্যতামূলক — কেন, `LeaveService.list()`-এর নোটে */
  @Get()
  list(@Query('month') month: string): Promise<{ rows: LeaveView[] }> {
    return this.leaves.list(month);
  }

  @Post()
  create(
    @CurrentUser() actor: SessionUser,
    @Body() dto: CreateLeaveDto,
    @Ip() ip: string,
  ): Promise<{ created: number; skipped: string[] }> {
    return this.leaves.create(actor, dto, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<void> {
    return this.leaves.remove(actor, id, ip);
  }
}
