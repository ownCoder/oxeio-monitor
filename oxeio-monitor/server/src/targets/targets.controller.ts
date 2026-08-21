import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { DesignTargetStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { TargetsService, type BulkResult, type MyTarget } from './targets.service';

class BulkDto {
  /**
   * ⚠️ ছাদ ৬০,০০০ অক্ষর — ৫০০টা লম্বা Amazon URL ~৫০ KB। ছাদ না থাকলে
   * কেউ ভুল করে একটা গোটা ফাইল পেস্ট করলে সার্ভার সেটা পার্স করতে বসত।
   */
  @IsString() @MaxLength(60_000)
  text!: string;
}

class ListQueryDto {
  @IsOptional() @IsIn(['pool', 'assigned', 'done', 'skipped'])
  status?: DesignTargetStatus;

  /** ⭐ URL বা ASIN — দুটোই চলে */
  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  /** ⚠️ `@Type` ছাড়া query string-এর `"2"` স্ট্রিং হয়েই থাকত */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;
}

class SkipDto {
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

/**
 * **ডিজাইন-টার্গেট** *(২২ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **এই কন্ট্রোলারে `@Roles()` বসানো হয়নি ইচ্ছাকৃতভাবে** — কারণ
 * অনুমতিটা পোর্টালের রোল ধরে নয়, **কাজের ধরন** ধরে (গবেষক ঢোকেন
 * `employee` হিসেবে)। পাহারাটা `TargetsService.assertCanSubmit()`-এ,
 * আর সেখানেই তার কারণ লেখা।
 */
@Controller('design-targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  /** ⭐ একবারে ৫০০টা URL — গবেষক · ম্যানেজার · মালিক */
  @Post('bulk')
  bulk(
    @CurrentUser() actor: SessionUser,
    @Body() dto: BulkDto,
    @Ip() ip: string,
  ): Promise<BulkResult> {
    return this.targets.bulkAdd(actor, dto.text, ip);
  }

  /**
   * ⭐⭐ **পুরো তালিকা** — মালিক · ম্যানেজার · গবেষক *(২৩ আগস্ট)*।
   *
   * ⚠️ পাহারাটা এখানে **হাতে ডাকা**, `@Roles()` দিয়ে নয় — গবেষকের রোল
   * `employee`, তাই ডেকোরেটর দিয়ে তাঁকে আলাদা করা যায় না।
   */
  @Get()
  async list(@CurrentUser() actor: SessionUser, @Query() q: ListQueryDto) {
    await this.targets.assertCanUse(actor);
    return this.targets.list(q);
  }

  /**
   * ⚠️ এখানেও একই পাহারা। আগে এটা **খোলা ছিল** — যেকোনো কর্মী পুলের
   * সংখ্যা পড়তে পারতেন। বড় ফাঁস নয়, কিন্তু একই পর্দার দুটো রুটে দুই
   * নিয়ম থাকলে একদিন ভুলটা বড় জায়গায় হতো।
   */
  @Get('stats')
  async stats(@CurrentUser() actor: SessionUser) {
    await this.targets.assertCanUse(actor);
    return this.targets.stats();
  }

  /**
   * ⭐ হাতে বণ্টন — রোজ সকালের জবের **পাশাপাশি**, বিকল্প নয়।
   *
   * ⚠️ owner/manager-only: বণ্টন একবার হয়ে গেলে ফেরানো যায় না (নম্বর
   * বসে যায়), তাই বোতামটা সবার হাতে থাকা উচিত নয়।
   */
  @Roles(UserRole.owner, UserRole.manager)
  @Post('distribute')
  distribute() {
    return this.targets.distribute();
  }
}

/**
 * **ডিজাইনারের নিজের টার্গেট** — `/me`-র নিচে।
 *
 * ⚠️ আলাদা কন্ট্রোলার, কারণ পথটাও আলাদা (`/me/targets`), আর এখানে
 * কোনো রোল-পাহারা লাগে না: প্রত্যেকে **কেবল নিজের** তালিকাই পান।
 */
@Controller('me/targets')
export class MyTargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get()
  mine(@CurrentUser() actor: SessionUser): Promise<MyTarget[]> {
    return this.targets.mine(employeeIdOf(actor));
  }

  /**
   * ⭐ "এটা বাদ দিলাম" — মালিকের বাছাই ছিল **দুটোই** (নিজে থেকে ধরা
   * **আর** ডিজাইনারের শুধরানো)।
   *
   * ⚠️ বাদ দেওয়া টার্গেট পুলে **ফেরত যায় না** — নইলে পরদিন আবার কারো
   * হাতে পড়ত, আর সে-ও হয়তো একই কারণে বাদ দিত। মালিক তালিকায় দেখে
   * সিদ্ধান্ত নেবেন।
   */
  @Post(':id/skip')
  skip(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SkipDto,
  ) {
    return this.targets.skip(employeeIdOf(actor), id, dto.reason ?? null);
  }

  /**
   * "শেষ করেছি" — হাতে চিহ্ন।
   *
   * ⚠️ সাধারণত এটা লাগেই না: ফাইলের নামে কাজের নম্বর বসালে সিস্টেম নিজেই
   * ধরে ফেলে। এটা সেই ক্ষেত্রগুলোর জন্য যেখানে নম্বর বসাতে ভুল হয়েছে।
   */
  @Post(':id/done')
  done(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.targets.markDone(employeeIdOf(actor), id);
  }
}

/**
 * ⚠️ owner ও manager-এর `employeeId` সাধারণত `null` — তাঁরা কর্মীর সারিতে
 * বাঁধা নন, তাই তাঁদের "নিজের টার্গেট" বলে কিছু নেই। `me.service.ts`-এর
 * একই নিয়ম, একই বার্তা।
 */
function employeeIdOf(actor: SessionUser): number {
  if (actor.employeeId === null) {
    throw new ForbiddenException(
      'This account is not linked to a staff record, so there are no targets to show.',
    );
  }

  return actor.employeeId;
}
