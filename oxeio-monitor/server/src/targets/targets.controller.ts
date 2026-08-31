import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Delete,
} from '@nestjs/common';
import { DesignTargetStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { DROP_REASONS, type DropReason } from './targets.rules';
import {
  DELETE_MAX,
  TargetsService,
  type BulkResult,
  type DeleteResult,
  type MyTarget,
} from './targets.service';

class BulkDto {
  /**
   * ⭐⭐ **ছাদ ৫০ লাখ অক্ষর** *(২৩ আগস্ট ২০২৬, মালিকের চাওয়া)* — আগে ছিল
   * ৬০,০০০ (~৫০০টা URL)।
   *
   * ⭐ ৫০ লাখ অক্ষরে ~৪৫,০০০ Amazon URL ধরে। গবেষকেরা রোজ ~৫০০ তোলেন,
   * তাই বাস্তবে এটা "সীমা নেই"-এর সমান।
   *
   * ⚠️⚠️ **তবু একটা ছাদ রাখা হয়েছে, আর সেটা ইচ্ছাকৃত।** সীমা পুরোপুরি
   * তুলে দিলে কেউ ভুল করে ৫০০ MB-র একটা ফাইল পেস্ট করলে সার্ভার সেটা
   * মেমোরিতে তুলে পার্স করতে বসত — আর তখন গোটা অফিসের এজেন্টরাও ডেটা
   * পাঠাতে পারত না। ⭐ ছাদটা মানুষকে আটকানোর জন্য নয়, দুর্ঘটনা আটকানোর জন্য।
   *
   * ⚠️ HTTP বডির ছাদ (৮ MB, `app.setup.ts`) এর **চেয়ে বড়** রাখা হয়েছে,
   * নইলে বেশি পেস্ট করলে Express-এর নীরব ৪১৩ আসত, এই বার্তাটা নয়।
   */
  @IsString() @MaxLength(5_000_000)
  text!: string;
}

/**
 * ⭐⭐ **একসাথে অনেকগুলো মোছা** *(২৯ আগস্ট ২০২৬)*।
 *
 * ⚠️ `@Type(() => Number)` ছাড়া JSON-এর `["12"]` স্ট্রিং হয়েই থাকত আর
 *    `IsInt` ফেল করত — অথচ ভুলটা পর্দার নয়, রূপান্তরের।
 */
class DeleteManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(DELETE_MAX)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];

  /** ⭐ Skip-এর সাথে একই তিনটে — `targets.rules.ts`-এর `DROP_REASONS` */
  @IsIn([...DROP_REASONS])
  reason!: DropReason;
}

class ListQueryDto {
  /** ⚠️ `deleted`-ও আছে — নইলে মালিক মরা ASIN-গুলো খুঁজেই পেতেন না */
  @IsOptional() @IsIn(['pool', 'assigned', 'done', 'skipped', 'deleted'])
  status?: DesignTargetStatus;

  /** ⭐ URL বা ASIN — দুটোই চলে */
  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  /** ⚠️ `@Type` ছাড়া query string-এর `"2"` স্ট্রিং হয়েই থাকত */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  /** ⭐ কোন ডিজাইনারের — `employees.id` *(২৩ আগস্ট)* */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  staffId?: number;

  /**
   * ⭐ কে এনেছেন — `users.id` *(২৫ আগস্ট)*।
   *
   * ⚠️⚠️ উপরেরটার সাথে **আলাদা id-র জগৎ** — ওটা `employees`, এটা `users`।
   * নাম দুটো পাশাপাশি রাখা হয়েছে ঠিক এই কারণেই: এক নজরে যেন দেখা যায়
   * ওরা এক জিনিস নয়।
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  addedById?: number;

  /**
   * ⭐ তারিখের সীমা — **শেষ যা ঘটেছে** তার দিন ধরে।
   *
   * ⚠️ `YYYY-MM-DD` ছাড়া কিছু নেওয়া হয় না: আলগা পার্সিং মানে
   * `03-04-2026` কারো কাছে মার্চ, কারো কাছে এপ্রিল — আর ভুল ফল
   * "কিছু পাওয়া গেল না" হয়ে দেখা দিত, ভুল বলে নয়।
   */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "from must be a date like 2026-08-23",
  })
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "to must be a date like 2026-08-23",
  })
  to?: string;

  /**
   * ⭐⭐ **কাজের ধাপ ধরে ছাঁকনি** *(২৪ আগস্ট ২০২৬)* — গবেষকের রোজকার
   * কিউ দুটো।
   *
   * ⚠️ `status` দিয়ে এটা করা যায় না: `uploaded`/`live` কোনো **অবস্থা**
   *    নয়, **তারিখ** — আর সেটা ইচ্ছাকৃত, নইলে সারিটা `done` থেকে সরে
   *    গিয়ে সব "কতগুলো ডিজাইন হয়েছে" গণনা নীরবে কমে যেত।
   */
  @IsOptional() @IsIn(['to_check', 'to_fix', 'to_upload', 'to_live'])
  stage?: 'to_check' | 'to_fix' | 'to_upload' | 'to_live';
}

class UpdateTargetDto {
  @IsIn(['pool', 'assigned', 'done', 'skipped'])
  status!: DesignTargetStatus;
}

class CheckedDto {
  /**
   * ⭐ `true` = বানান ঠিক আছে · `false` = ভুল পাওয়া গেছে।
   *
   * ⚠️ ঐচ্ছিক করা হয়নি ইচ্ছাকৃতভাবে — ডিফল্ট বসালে ভুল করে খালি পাঠালে
   * সেটা নীরবে "ঠিক আছে" হয়ে যেত, আর ভুল ডিজাইন Amazon-এ চলে যেত।
   */
  @IsBoolean()
  ok!: boolean;
}

class LiveDto {
  /**
   * ⭐ লাইভ হওয়া **নতুন** পণ্যের ASIN — ঐচ্ছিক।
   *
   * ⚠️⚠️ গবেষকের আনা নমুনা ASIN-এর সাথে গুলিয়ে ফেলা যাবে না; এটা
   * আমাদের নিজের বিক্রয়যোগ্য পণ্যের। ⚠️ ঐচ্ছিক রাখা হয়েছে কারণ হাতে
   * না থাকলেও "লাইভ হয়েছে" বলা যাওয়া উচিত — নইলে ঘরটা ভরার জন্য কেউ
   * ভুল কিছু বসিয়ে দিত।
   */
  @IsOptional() @IsString() @Matches(/^[A-Z0-9]{10}$/, {
    message: 'liveAsin must be a 10-character Amazon ASIN',
  })
  liveAsin?: string;
}

/**
 * ⭐⭐ **"কেন বাদ দিলেন"** *(মালিকের চাওয়া, ৩১ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ আগে ছিল `@IsOptional()` মুক্ত-লেখা, আর ফল: মাঠে ৯৩টা skipped
 * সারির **একটাতেও** কারণ লেখা ছিল না — পর্দা কোনোদিন কিছু পাঠায়ইনি।
 * ⭐ এখন তিনটে বাছাইয়ের একটা, আর **বাধ্যতামূলক**: পর্দায় বোতামটাই কারণ,
 * তাই না-পাঠানোর কোনো পথ নেই।
 *
 * ⚠️ তালিকাটা `targets.rules.ts`-এ এক জায়গায় — Skip ও Delete দুই পথেই
 * একই তিনটে, নইলে একদিন একটায় নতুন কারণ যোগ হতো আর অন্যটায় নয়।
 */
class DropReasonDto {
  @IsIn([...DROP_REASONS])
  reason!: DropReason;
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
  /**
   * ⭐⭐ **কে কতগুলো এনেছেন** *(মালিকের চাওয়া, ২৫ আগস্ট)*।
   *
   * ⚠️ `designers`-এর মতো এটাও কেবল ড্রপডাউন ভরার জন্য, কিন্তু সংখ্যাটা
   * সঙ্গে যায় — মালিক একটাও ক্লিক না করেই উত্তরটা পেয়ে যান।
   */
  @Get('adders')
  async adders(@CurrentUser() actor: SessionUser) {
    await this.targets.assertCanUse(actor);
    return this.targets.adders();
  }

  /** ⭐ ছাঁকনির ড্রপডাউনের জন্য — owner · manager · গবেষক *(২৩ আগস্ট)* */
  @Get('designers')
  async designers(@CurrentUser() actor: SessionUser) {
    await this.targets.assertCanUse(actor);
    return this.targets.designers();
  }

  @Get('stats')
  async stats(@CurrentUser() actor: SessionUser) {
    await this.targets.assertCanUse(actor);
    return this.targets.stats();
  }

  /**
   * ⭐ তালিকা সম্পাদনা — owner · manager · গবেষক *(২৩ আগস্ট)*।
   *
   * ⚠️ ASIN বদলানোর কোনো পথ **নেই** — ওটা সারিটার পরিচয়; বদলালে
   * ডুপ্লিকেট-প্রহরীর ভিত্তিই নড়ে যেত।
   */
  @Patch(':id')
  async update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTargetDto,
  ) {
    await this.targets.assertCanUse(actor);
    return this.targets.update(id, dto.status, new Date(), actor.userId);
  }

  /**
   * ⭐⭐ **বেছে বেছে মুছে ফেলা** *(মালিকের চাওয়া, ২৯ আগস্ট ২০২৬:
   * "not found asin gula delete korar time e select kora zabe")*।
   *
   * ⚠️⚠️ **`POST`, `DELETE` নয়** — বডিসহ `DELETE` অনেক প্রক্সি ও
   * ক্লায়েন্ট নীরবে ফেলে দেয়, আর তখন "কিছুই মুছল না" বলে বাগ খুঁজতে
   * হতো। ⭐ এই কন্ট্রোলারের বাকি কাজগুলোও (`:id/checked`, `distribute`)
   * POST — নিয়মটা এক জায়গায় এক।
   *
   * ⚠️ পাহারা `assertCanUse` (owner · manager · গবেষক), নিচের একক
   * `@Delete(':id')`-এর মতোই — দুটো পথ একই কাজ করে, তাই দুই রকম
   * পাহারা বসালে একদিন একটা দিয়ে অন্যটা ফাঁকি দেওয়া যেত। ⭐ পর্দায়
   * বোতামটা কেবল owner/manager দেখেন (`mayDelete`)।
   */
  @Post('delete')
  async deleteMany(
    @CurrentUser() actor: SessionUser,
    @Body() dto: DeleteManyDto,
    @Ip() ip: string,
  ): Promise<DeleteResult> {
    await this.targets.assertCanUse(actor);
    return this.targets.softDelete(dto.ids, actor.userId, ip, dto.reason);
  }

  /**
   * ⭐ একটা সারি — উপরের বাল্ক পথেরই এক-সদস্যের রূপ।
   *
   * ⚠️⚠️ **এটা আর সত্যিকারের `DELETE` নয়** *(২৯ আগস্ট)*। সারিটা থেকে
   * যায়, অবস্থা হয় `deleted` — নইলে `asin` UNIQUE প্রহরীটাও মুছে যেত
   * আর মরা ASIN কাল আবার পুলে ঢুকত।
   */
/**
   * ⚠️ বডিসহ `DELETE` অনেক প্রক্সি ফেলে দেয়, তাই কারণটা **query-তে**
   * (`?reason=not_found`) — একটা ছোট, চেনা মান, আর ওতে ব্যক্তিগত কিছু নেই।
   */
  @Delete(':id')
  async remove(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DropReasonDto,
    @Ip() ip: string,
  ): Promise<DeleteResult> {
    await this.targets.assertCanUse(actor);
    return this.targets.softDelete([id], actor.userId, ip, query.reason);
  }

  /**
   * ⭐ হাতে বণ্টন — রোজ সকালের জবের **পাশাপাশি**, বিকল্প নয়।
   *
   * ⚠️ owner/manager-only: বণ্টন একবার হয়ে গেলে ফেরানো যায় না (নম্বর
   * বসে যায়), তাই বোতামটা সবার হাতে থাকা উচিত নয়।
   */
  /**
   * ⭐⭐ **"আপলোড হয়েছে"** *(২৩ আগস্ট ২০২৬)* — owner · manager · গবেষক।
   *
   * ⚠️ ডিজাইনার নন: ফাইল বানানো আর Amazon-এ পাঠানো দুটো আলাদা কাজ, আর
   *    দ্বিতীয়টা যিনি করেন তিনিই বলবেন।
   */
  /**
   * ⭐⭐ **"বানান দেখলাম"** *(ADR-038, ২৫ আগস্ট ২০২৬)* — সুমাইয়ার কাজ।
   *
   * ⚠️ পাহারা `assertCanUse` — owner · manager · **গবেষক**। সুমাইয়ার রোল
   *    `employee`, তাই রোল দিয়ে এটা করা যেত না; ধরন দিয়েই হয়।
   *    ⭐ ডিজাইনার নিজের কাজ নিজে পাশ করাতে পারেন না, আর সেটাই উদ্দেশ্য।
   *
   * ⚠️ `ok: false` মানে ভুল পাওয়া গেছে — সারিটা তখন "ঠিক করতে হবে" কিউতে।
   */
  @Post(':id/checked')
  async checked(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CheckedDto,
  ) {
    await this.targets.assertCanProofread(actor);
    return this.targets.markChecked(id, dto.ok, actor.userId, new Date());
  }

  /**
   * ⭐ **"ঠিক করেছি"** — বেলালের কাজ।
   *
   * ⚠️⚠️ ডিজাইনের মালিকানা **বদলায় না** — কে ঠিক করলেন সেটা আলাদা ঘরে।
   */
  @Post(':id/fixed')
  async fixed(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.targets.assertCanProofread(actor);
    return this.targets.markFixed(id, actor.userId, new Date());
  }

  @Post(':id/uploaded')
  async uploaded(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.targets.assertCanUse(actor);
    return this.targets.markUploaded(id, new Date());
  }

  /** ⭐ **"Amazon-এ লাইভ"** — সাথে নতুন পণ্যের ASIN (ঐচ্ছিক) */
  @Post(':id/live')
  async live(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LiveDto,
  ) {
    await this.targets.assertCanUse(actor);
    return this.targets.markLive(id, dto.liveAsin ?? null, new Date());
  }

  /**
   * ⭐⭐ **"শেষ" ফিরিয়ে নেওয়া** *(মালিকের রিপোর্ট, ২৫ আগস্ট:
   * "vule kew colplete press kore felole byak anote paren na")*।
   *
   * ⚠️⚠️ `PATCH :id { status: 'assigned' }` দিয়ে এটা করা **যায় না** —
   * ওই পথ কেবল `status` বদলায়, `completedAt` মোছে না। আর কিউগুলো
   * `completedAt` ধরে চলে, তাই সারিটা "হাতে আছে" দেখাত অথচ আপলোডের
   * কিউতে বসেই থাকত।
   *
   * ⚠️ ডিজাইনারের নিজের Undo আলাদা রুটে (`/me/targets/:id/undone`) —
   * ওখানে আজকের দিনের সীমা আছে, এখানে নেই।
   */
  @Post(':id/undone')
  async undone(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ) {
    await this.targets.assertCanUse(actor);
    return this.targets.undoComplete(id, { userId: actor.userId, ip });
  }

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
    @Body() dto: DropReasonDto,
  ) {
    return this.targets.skip(employeeIdOf(actor), id, dto.reason);
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
    return this.targets.markDone(employeeIdOf(actor), id, actor.userId);
  }

  /**
   * ⭐⭐ **"ভুল করে চেপে ফেলেছি"** *(মালিকের রিপোর্ট, ২৫ আগস্ট:
   * "onek somoy vule kew colplete press kore felole byak anote paren na")*।
   *
   * ⚠️ **আজকের** কাজ, **নিজের** সারি, আর শেকলে এগোয়নি — তিনটে শর্তই
   * সার্ভিসে। পুরোনো ভুল মালিক ফেরাবেন, ডিজাইনার নন: গতকালেরটা ফেরালে
   * গতকালের সংখ্যাও বদলে যেত।
   */
  @Post(':id/undone')
  undone(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ) {
    return this.targets.undoMine(employeeIdOf(actor), id, new Date(), {
      userId: actor.userId,
      ip,
    });
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
