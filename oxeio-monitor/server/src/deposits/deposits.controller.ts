import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  DepositsService,
  type DepositBalance,
  type DepositPolicyView,
  type DepositSettlementView,
} from './deposits.service';
import { SetDepositStartDto,
  SettleDepositDto, UpdateDepositPolicyDto } from './dto';

/**
 * R21 — জামানতের owner-এর দিক (`/api/v1/deposits`)।
 *
 * ⚠️⚠️ পুরো ক্লাসটা **owner-only**, ম্যানেজারও নয় — জামানত সরাসরি বেতনের
 * অংশ, আর বেতনের কোনো সংখ্যা ম্যানেজারের নাগালে নেই
 * ([ADR-023](../../../docs/05-Options-Decisions.md) · ADR-027)।
 *
 * ⭐ স্টাফ নিজের জমাটা দেখেন `GET /api/v1/me/deposit`-এ — সেখানে কেবল
 * **নিজের** সংখ্যা, আর কারো নয়।
 */
@Roles(UserRole.owner)
@Controller('deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  /** নিয়ম ও সবার জমা — এক কলেই, কারণ পর্দাটা দুটোই একসাথে দেখায় */
  @Get()
  balances(): Promise<{ rows: DepositBalance[]; policy: DepositPolicyView }> {
    return this.deposits.balances();
  }

  @Patch('policy')
  updatePolicy(
    @CurrentUser() actor: SessionUser,
    @Body() dto: UpdateDepositPolicyDto,
    @Ip() ip: string,
  ): Promise<DepositPolicyView> {
    return this.deposits.updatePolicy(actor, dto, ip);
  }

  /**
   * ⭐⭐ `PATCH /api/v1/deposits/:employeeId/start` — এই কর্মীর জামানত
   * কোন মাস থেকে কাটা শুরু।
   *
   * ⚠️ `yearMonth: null` পাঠালে নিয়মের সাধারণ শুরুর মাসে ফিরে যায়।
   *
   * ⚠️⚠️ মাস **এগিয়ে** দিলে তার আগের কিস্তিগুলো খাতা থেকে মুছে যায় — এটাই
   * এই রুটের আসল কাজ (ভুল সংশোধন)। কতগুলো গেল সেটা রেসপন্সে ফেরত আসে,
   * যাতে পর্দা মালিককে সত্যিটা দেখাতে পারে।
   */
  @Patch(':employeeId/start')
  setStart(
    @CurrentUser() actor: SessionUser,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SetDepositStartDto,
    @Ip() ip: string,
  ): Promise<{ removed: number; added: number }> {
    return this.deposits.setStartMonth(actor, employeeId, dto.yearMonth, ip);
  }

  /**
   * `POST /api/v1/deposits/:employeeId/settle` — ফেরত বা বাজেয়াপ্ত।
   *
   * ⚠️ সিদ্ধান্তটা মালিকের; সিস্টেম শুধু নোটিশের দিন গুনে সারিতে লিখে
   * রাখে। ⚠️ দ্বিতীয়বার ডাকলে ৪০৯ — টাকা দুবার ফেরত দেওয়ার হিসাব
   * কোথাও লেখা থাকত না।
   */
  @Post(':employeeId/settle')
  @HttpCode(HttpStatus.CREATED)
  settle(
    @CurrentUser() actor: SessionUser,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SettleDepositDto,
    @Ip() ip: string,
  ): Promise<DepositSettlementView> {
    return this.deposits.settle(actor, employeeId, dto, ip);
  }
}
