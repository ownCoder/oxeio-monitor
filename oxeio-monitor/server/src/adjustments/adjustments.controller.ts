import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  CreateAdjustmentDto,
  RevokeAdjustmentDto,
} from './adjustments.dto';
import { AdjustmentsService, type AdjustmentView } from './adjustments.service';

/**
 * **B14 · ADR-011e** — ঘণ্টা সংশোধন।
 *
 * ⚠️ পথটা `employees/:id/...`, আর `/employees` ইতিমধ্যেই তিনটে কন্ট্রোলার
 * দাবি করে (`employees`, `employees-read`, `employee-activity`)। Express
 * একই পথ দুবার পেলে **প্রথমটাকেই** ডাকে আর দ্বিতীয়টা চিরকাল নীরবে অচল
 * থাকে ([09 § ৩অ.১২](../../../docs/09-Build-Log.md))। তাই সাব-পথটা
 * (`time-adjustments`) অন্য কোথাও নেই — `endpoints.e2e` সেটার পাহারা।
 */
@Controller('employees')
export class EmployeeAdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  /**
   * ⭐ **owner-only** — `@Roles` মেথডে, ক্লাসে নয়, কারণ নিচের `GET`
   * স্টাফের নিজের জন্যও খোলা (J08)। ⚠️ ক্লাসে বসালে স্টাফ নিজের
   * সংশোধন দেখতেই পেত না, আর ADR-011e-র স্বচ্ছতার শর্তটা ভাঙত।
   */
  @Roles(UserRole.owner)
  @Post(':id/time-adjustments')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAdjustmentDto,
    @Ip() ip: string,
  ): Promise<AdjustmentView> {
    return this.adjustments.create(actor, id, dto, ip);
  }

  /**
   * J08 — owner ও manager সবার, স্টাফ **শুধু নিজের**।
   *
   * ⚠️ এখানে `@Roles` **নেই**, ইচ্ছাকৃতভাবে — তিনটে ভূমিকাই ঢুকতে পারে,
   * আর সীমাটা সার্ভিসে (`assertCanSee`)। রোল দিয়ে আটকালে স্টাফের নিজের
   * ডেটাও বন্ধ হয়ে যেত।
   */
  @Get(':id/time-adjustments')
  list(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdjustmentView[]> {
    return this.adjustments.list(actor, id);
  }
}

/**
 * ⚠️ আলাদা কন্ট্রোলার, কারণ revoke-এর পথে কর্মীর আইডি থাকে না — সংশোধনের
 * নিজের আইডিই যথেষ্ট, আর ওটা কোন কর্মীর সেটা সার্ভার নিজেই দেখে নেয়।
 */
@Roles(UserRole.owner)
@Controller('time-adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  /** ⚠️ `DELETE` নয় — স্কিমাতেই ডিলিট নেই, শুধু revoke। রেকর্ড থেকে যায়। */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
    @Body() dto: RevokeAdjustmentDto,
    @Ip() ip: string,
  ): Promise<AdjustmentView> {
    /**
     * ⚠️ `ParseIntPipe` নয় — `time_adjustments.id` একটা `BigInt`, আর
     * `parseInt` ২^৫৩-এর পর নীরবে ভুল সংখ্যা দিত। বছর দশেকে ওখানে
     * পৌঁছানো যাবে না বটে, কিন্তু ভুলটা তখন ধরা পড়ত সবচেয়ে খারাপ সময়ে।
     */
    let parsed: bigint;
    try {
      parsed = BigInt(id);
    } catch {
      throw new BadRequestException('id must be a whole number');
    }

    return this.adjustments.revoke(actor, parsed, dto, ip);
  }
}
