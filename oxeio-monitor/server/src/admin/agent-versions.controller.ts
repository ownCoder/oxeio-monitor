import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  AgentVersionsService,
  type AgentVersionView,
} from './agent-versions.service';
import { PublishVersionDto, SetStageDto } from './dto';

/**
 * **H04 · G59** — এজেন্টের নতুন ভার্সন বিলি করা।
 *
 * ⚠️ পুরো ক্লাসটাই owner-only, ক্লাস-লেভেলে — ম্যানেজারও নয়। ১৫টা PC-তে
 * কী সফটওয়্যার চলবে সেটা মালিকের সিদ্ধান্ত, আর ভুল বিল্ড বেরোলে ফেরার
 * স্বয়ংক্রিয় পথ নেই (G69)।
 */
@Roles(UserRole.owner)
@Controller('agent-versions')
export class AgentVersionsController {
  constructor(private readonly versions: AgentVersionsService) {}

  /** কোনটা বেরিয়েছে, কোন ধাপে, আর কতগুলো PC ইতিমধ্যে ওই ভার্সনে */
  @Get()
  list(): Promise<AgentVersionView[]> {
    return this.versions.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  publish(
    @CurrentUser() actor: SessionUser,
    @Body() dto: PublishVersionDto,
    @Ip() ip: string,
  ): Promise<AgentVersionView> {
    return this.versions.publish(actor, dto, ip);
  }

  /**
   * `canary` → `partial` → `all`, অথবা **`halted`**।
   *
   * ⭐ `halted`-ই একমাত্র জরুরি ব্রেক: খারাপ আপডেট বেরিয়ে গেলে যারা
   * পেয়ে গেছে তাদের হাতে ঠিক করতে হবে, কিন্তু বাকিরা অন্তত বেঁচে যাবে।
   */
  @Post(':version/stage')
  @HttpCode(HttpStatus.OK)
  setStage(
    @CurrentUser() actor: SessionUser,
    @Param('version') version: string,
    @Body() dto: SetStageDto,
    @Ip() ip: string,
  ): Promise<AgentVersionView> {
    return this.versions.setStage(actor, version, dto, ip);
  }
}
