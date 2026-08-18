import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  AgentVersionsService,
  type AgentVersionView,
} from './agent-versions.service';
import { AuditService } from '../audit/audit.service';
import { UpdateService } from '../agent/update.service';
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
  constructor(
    private readonly versions: AgentVersionsService,
    private readonly updates: UpdateService,
    private readonly audit: AuditService,
  ) {}

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
  /**
   * ⭐⭐ **MSI নামানো — হাতে বসানোর জন্য** *(১৮ আগস্ট)*।
   *
   * ⚠️⚠️ কেন দরকার হলো: ০.৪.১-এর **আগের** এজেন্টে tray-তে "Install update"
   * মেনুটাই নেই, তাই ধাপে ধাপে রোলআউট ওদের কাছে পৌঁছায় না — ফাইলটা নেমে
   * পড়ে থাকে, কেউ জানে না (09 § ৩ভ৯)। ওই PC-গুলোয় একবার হাতে বসাতে হয়,
   * আর তার জন্য MSI-টা **হাতে পাওয়ার কোনো পথই ছিল না**: `/agent/update/download`
   * শুধু ডিভাইস-টোকেনে খোলে, আর owner-এর কাছে টোকেন থাকে না।
   *
   * ⭐ ফাইলটা `UpdateService.openMsi()` দিয়েই খোলা হয়, নিজে path জোড়া
   * লাগিয়ে নয় — ওখানে storage-এর বাইরের পাথ আটকানোর পাহারা বসানো আছে।
   *
   * ⚠️ owner-only (ক্লাস-লেভেল `@Roles`) আর audit-এ লেখা: কে, কখন, কোন
   *    ভার্সন নামাল — ইনস্টলার হাতে হাতে ঘোরার আগে সেটা জানা থাকা দরকার।
   */
  @Get(':version/download')
  @Header('Content-Type', 'application/x-msi')
  async download(
    @CurrentUser() actor: SessionUser,
    @Param('version') version: string,
    @Ip() ip: string,
  ): Promise<StreamableFile> {
    const file = await this.updates.openMsi(version);

    await this.audit.record({
      userId: actor.userId,
      action: 'agent_version.download',
      targetType: 'agent_version',
      targetId: version,
      ipAddress: ip,
      meta: { sizeBytes: file.size },
    });

    return new StreamableFile(file.stream, {
      // ⚠️ নামটা ASCII ও অনুমেয় — PC-তে PC-তে ঘোরার সময় "কোন ফাইলটা"
      //    প্রশ্নের উত্তর নামেই থাকা দরকার
      disposition: `attachment; filename="oXeioAgent-${version}.msi"`,
      length: file.size,
    });
  }

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
