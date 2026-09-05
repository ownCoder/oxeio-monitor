import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Device, Prisma, SegmentState } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';

import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_SCREENSHOT_BYTES } from './agent.constants';
import { AgentConfigService, type AgentConfig } from './agent-config.service';
import type { Drift } from './clock-drift.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceRateLimitService } from './device-rate-limit.service';
import { CurrentDevice, CurrentDrift } from './device.decorator';
import {
  AppUsageBatchDto,
  EnrollDto,
  EnrollLoginDto,
  EventBatchDto,
  HeartbeatDto,
  ScreenshotMetaDto,
  SegmentBatchDto,
} from './dto';
import {
  EnrollmentService,
  type EnrollLoginResult,
  type EnrollResult,
} from './enrollment.service';
import { IngestService, type IngestResult } from './ingest.service';
import { ProgressService, type EmployeeProgress } from './progress.service';
import {
  ScreenshotIngestService,
  type ScreenshotResult,
} from './screenshot-ingest.service';
import { UpdateService } from './update.service';

type AgentCommand =
  | 'reload_config'
  | 'capture_now'
  | 'pause_tracking'
  | 'update_agent'
  | 'revoke';

/**
 * এজেন্টের সব endpoint।
 *
 * ক্লাস-লেভেলে `@Public()` — কারণ এগুলো ড্যাশবোর্ডের JWT/CSRF দিয়ে নয়,
 * **device token** দিয়ে সুরক্ষিত (`DeviceAuthGuard`)। দুটো আলাদা জগৎ।
 */
@Public()
@Controller('agent')
export class AgentController {
  constructor(
    private readonly enrollment: EnrollmentService,
    private readonly configs: AgentConfigService,
    private readonly ingest: IngestService,
    private readonly screenshots: ScreenshotIngestService,
    private readonly updates: UpdateService,
    private readonly rate: DeviceRateLimitService,
    private readonly progress: ProgressService,
    private readonly prisma: PrismaService,
  ) {}

  /** ইনস্টলের সময় একবার — এখানে টোকেন নেই, enrollment code-ই পরিচয় (H05) */
  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  enroll(@Body() dto: EnrollDto): Promise<EnrollResult> {
    return this.enrollment.enroll(dto);
  }

  /**
   * ⭐⭐ **স্টাফ নিজের ইমেইল-পাসওয়ার্ড দিয়ে নিজের PC যোগ করে।**
   *
   * ⚠️ এটাই এখন সাধারণ পথ; কোডেরটা (`/enroll`) থাকে স্ক্রিপ্টেড
   * রোলআউটের জন্য। কেন — `EnrollmentService.enrollWithLogin()` দেখুন।
   *
   * ⚠️⚠️ `@Ip()` **দিতেই হবে**, আর সেটা নিছক লগের জন্য নয়:
   * `AuthService.login()` ওই IP ধরেই brute-force throttle করে। খালি
   * স্ট্রিং পাঠালে সব চেষ্টা একই বালতিতে পড়ত — অর্থাৎ একটা ভুল
   * পাসওয়ার্ড দিলে **গোটা অফিসের** enrollment আটকে যেত।
   *
   * ⚠️ ২০০ ফেরে, ২০১ নয়। উত্তরটা দু-রকম হতে পারে (ডিভাইস তৈরি হলো, নাকি
   * 2FA কোড চাই) — "তৈরি হয়েছে" বলাটা তখন অর্ধেক ক্ষেত্রে মিথ্যা হতো।
   */
  @Post('enroll-login')
  @HttpCode(HttpStatus.OK)
  enrollWithLogin(
    @Body() dto: EnrollLoginDto,
    @Ip() ip: string,
  ): Promise<EnrollLoginResult> {
    return this.enrollment.enrollWithLogin(dto, ip);
  }

  @UseGuards(DeviceAuthGuard)
  @Get('config')
  config(
    @CurrentDevice() device: Device,
  ): Promise<{ version: string; config: AgentConfig }> {
    return this.configs.buildForDevice(device);
  }

  @UseGuards(DeviceAuthGuard)
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @CurrentDevice() device: Device,
    @Body() dto: HeartbeatDto,
  ): Promise<{
    commands: AgentCommand[];
    configVersion: string;
    progress: EmployeeProgress | null;
  }> {
    this.rate.hit(device.id, 'ingest');

    const { version } = await this.configs.buildForDevice(device);
    const commands: AgentCommand[] = [];

    if (dto.configVersion && dto.configVersion !== version) {
      commands.push('reload_config');
    }

    // ⭐ এজেন্ট যে ভার্সন বলছে সেটাই সত্য — ডাটাবেসেরটা নয়।
    //
    // ⚠️ ক্রমটা গুরুত্বপূর্ণ: **আগে** হালনাগাদ, **তারপর** আপডেট অফারের
    //    সিদ্ধান্ত। উল্টো করলে সদ্য আপডেট হওয়া এজেন্টকেও পুরোনো ভার্সন
    //    ধরে আরেকবার একই আপডেট অফার করা হতো — আর সে আপডেট করে আবার
    //    heartbeat পাঠাত, অর্থাৎ অসীম লুপ ([G59](../../../docs/08-Gap-Analysis.md))।
    const runningVersion = dto.agentVersion?.trim() || device.agentVersion;

    await this.recordHeartbeatState(device, dto.state, runningVersion);

    if (runningVersion) {
      const offer = await this.updates.offerFor(
        runningVersion,
        device.machineGuid,
        device.id,
      );
      if (offer) commands.push('update_agent');
    }

    // ⏳ capture_now / pause_tracking-এর জন্য একটা কমান্ড-কিউ টেবিল লাগবে —
    //    ড্যাশবোর্ড থেকে চাপা বাটনটা কোথাও জমা থাকতে হয় (A09, Phase 6)।
    // ⭐ এজেন্ট নিজে মাসের হিসাব জানে না — রিবুটের পর তার কাউন্টার শূন্য।
    //    tray-তে সত্যি সংখ্যা দেখাতে হলে সেটা এখান থেকেই যেতে হবে।
    const progress = device.employeeId
      ? await this.progress.forEmployee(device.employeeId)
      : null;

    return { commands, configVersion: version, progress };
  }

  /**
   * ⭐ heartbeat-এর `state` এখানেই `devices`-এ জমা হয় — Live Board-এর রঙ
   * এটার উপরেই দাঁড়ানো। এর আগে মানটা নেওয়া হতো কিন্তু কোথাও লেখা হতো না,
   * তাই বোর্ড শেষ `activity_segments` সারি থেকে **অনুমান** করত; এজেন্ট
   * সেগমেন্ট ব্যাচে পাঠায় বলে ওই অনুমান কয়েক মিনিট পুরোনো।
   *
   * ⚠️ `lastState` ও `agentVersion` দুটোই **বদলালে তবেই** SET-এ ঢোকে, কিন্তু
   *    `lastStateAt` প্রতিবারই বসে — কারণ "কখন বলেছিল" না জানলে মানটা এখনো
   *    বিশ্বাসযোগ্য কি না বোঝার কোনো উপায় নেই। বন্ধ হয়ে যাওয়া এজেন্টের শেষ
   *    কথা ছিল `active`; সময় ছাড়া সেটা কলামে বসে থাকত আর কার্ড **চিরকাল
   *    সবুজ** দেখাত (`dashboard.math.ts` → `freshReportedState`)।
   *
   * ⭐ তিনটে কলামই **একটাই** UPDATE-এ। আলাদা করলে ১৫ ডিভাইস × ৩০ সে. =
   *    দিনে ২১,৬০০ heartbeat-এ ২১,৬০০ বাড়তি round-trip হতো — G59-এর
   *    ঠিক একই শিক্ষা, শুধু উল্টো দিক থেকে।
   */
  private async recordHeartbeatState(
    device: Device,
    state: SegmentState,
    runningVersion: string | null,
  ): Promise<void> {
    const data: Prisma.DeviceUpdateInput = { lastStateAt: new Date() };

    if (state !== device.lastState) data.lastState = state;

    // ⚠️ ভার্সন না এলে আগেরটা **মুছে যায় না** — পুরোনো এজেন্ট ফিল্ডটা
    //    চেনে না, আর null বসিয়ে দিলে তার আপডেট অফারই বন্ধ হয়ে যেত (G59)।
    if (runningVersion && runningVersion !== device.agentVersion) {
      data.agentVersion = runningVersion;

      /**
       * ⭐⭐ **রোলআউট নিজে থেকে এগোনোর একমাত্র প্রমাণ** *(৫ সেপ্টেম্বর ২০২৬)*।
       *
       * ⚠️⚠️ সময়টা বসে **কেবল ভার্সন বদলালে** — প্রতি heartbeat-এ নয়।
       * প্রতিবার বসালে ঘড়িটা রোজ শূন্য থেকে শুরু হতো, আর "ছ-ঘণ্টা ধরে
       * টিকে আছে" শর্তটা **কোনোদিনই** সত্যি হতো না; রোলআউট চিরকাল
       * canary-তেই আটকে থাকত, অর্থাৎ যে সমস্যাটা সারানো হচ্ছে সেটাই
       * ফিরে আসত, কেবল আরও নীরবে।
       *
       * ⚠️ `if`-এর ভেতরে রাখাটা তাই ঘটনাচক্রে নয় — শর্তটাই সংজ্ঞা।
       */
      data.agentVersionSince = new Date();
    }

    await this.prisma.device.update({ where: { id: device.id }, data });
  }

  @UseGuards(DeviceAuthGuard)
  @Post('segments')
  @HttpCode(HttpStatus.OK)
  segments(
    @CurrentDevice() device: Device,
    @CurrentDrift() drift: Drift,
    @Body() dto: SegmentBatchDto,
  ): Promise<IngestResult> {
    this.rate.hit(device.id, 'ingest');
    return this.ingest.ingestSegments(device, drift, dto.segments);
  }

  @UseGuards(DeviceAuthGuard)
  @Post('app-usage')
  @HttpCode(HttpStatus.OK)
  appUsage(
    @CurrentDevice() device: Device,
    @CurrentDrift() drift: Drift,
    @Body() dto: AppUsageBatchDto,
  ): Promise<IngestResult> {
    this.rate.hit(device.id, 'ingest');
    return this.ingest.ingestAppUsage(device, drift, dto.items);
  }

  @UseGuards(DeviceAuthGuard)
  @Post('events')
  @HttpCode(HttpStatus.OK)
  events(
    @CurrentDevice() device: Device,
    @CurrentDrift() drift: Drift,
    @Body() dto: EventBatchDto,
  ): Promise<IngestResult> {
    this.rate.hit(device.id, 'ingest');
    return this.ingest.ingestEvents(device, drift, dto.events);
  }

  @UseGuards(DeviceAuthGuard)
  @Post('screenshots')
  @HttpCode(HttpStatus.CREATED)
  /**
   * ⭐ **A06 — `FileInterceptor` নয়, `FileFieldsInterceptor`।** আগেরটা
   * ঠিক একটাই অংশ নিত, তাই এজেন্টের পাঠানো `thumb` অংশটা multer নীরবে
   * ফেলে দিত আর `ingest()`-এ কোনোদিন পৌঁছাত না — থাম্বনেইলের পুরো কোডটা
   * লেখা থাকত, চলত না, আর `thumb_path` চিরকাল null থাকত।
   *
   * ⚠️ `maxCount: 1` **দুটোতেই** — নইলে একই নামে অনেকগুলো অংশ পাঠিয়ে
   *    মেমরিতে যত খুশি বাফার জমানো যেত (`limits.fileSize` প্রতি ফাইলে
   *    খাটে, মোটে নয়)।
   *
   * ⚠️ শুধু `file` থাকা রিকোয়েস্টও এটা মেনে নেয়, তাই থাম্বনেইল না চেনা
   *    পুরোনো এজেন্ট অক্ষত থাকে — গ্যালারি তখন ফুল ছবিতে ফেরত যায়।
   */
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'thumb', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_SCREENSHOT_BYTES } },
    ),
  )
  async screenshot(
    @CurrentDevice() device: Device,
    @CurrentDrift() drift: Drift,
    @Body('meta') metaRaw: string,
    @UploadedFiles()
    files?: { file?: Express.Multer.File[]; thumb?: Express.Multer.File[] },
  ): Promise<ScreenshotResult> {
    this.rate.hit(device.id, 'screenshot');

    const full = files?.file?.[0];
    if (!full) throw new BadRequestException('The `file` part is missing');

    const meta = await this.parseMeta(metaRaw);
    return this.screenshots.ingest(
      device,
      drift,
      meta,
      full,
      files?.thumb?.[0],
    );
  }

  /**
   * multipart-এ `meta` আসে JSON স্ট্রিং হিসেবে, তাই গ্লোবাল ValidationPipe
   * ওটাকে ছুঁতে পারে না — হাতে parse ও validate করতে হয়।
   */
  private async parseMeta(raw: string): Promise<ScreenshotMetaDto> {
    if (!raw) throw new BadRequestException('The `meta` part is missing');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('`meta` is not valid JSON');
    }

    const dto = plainToInstance(ScreenshotMetaDto, parsed, {
      enableImplicitConversion: false,
    });
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw new BadRequestException(
        errors.map((e) => Object.values(e.constraints ?? {}).join(', ')),
      );
    }
    return dto;
  }

  @UseGuards(DeviceAuthGuard)
  @Get('update')
  async update(
    @CurrentDevice() device: Device,
    @Query('current') current: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const offer = await this.updates.offerFor(
      current ?? device.agentVersion ?? '0.0.0',
      device.machineGuid,
    );
    if (!offer) {
      res.status(HttpStatus.NO_CONTENT);
      return null;
    }
    return offer;
  }

  /**
   * ⚠️ **`StreamableFile` ফেরত দিতেই হবে — `stream.pipe(res)` করে `void`
   *    ফেরত দিলে চলবে না।**
   *
   * `passthrough: true` মানে সাড়াটা Nest-ই পাঠাবে। হ্যান্ডলার `void`
   * ফেরত দিলে Nest সাথে সাথে সাড়া **শেষ** করে দিত — pipe একটা বাইটও
   * লেখার আগেই। বাইরে থেকে সব ঠিক দেখাত: `200 OK`, `Content-Length:
   * 65139658`, কোনো এরর লগ নেই — কিন্তু শরীরে **শূন্য বাইট**, আর
   * ক্লায়েন্ট পেত `CURLE_PARTIAL_FILE`।
   *
   * ⭐ অর্থাৎ H04-এর MSI নামানোর ধাপটা কোনোদিন কাজ করেনি। ধরা পড়েনি
   *    কারণ endpoint-টা কখনো সত্যিকারের HTTP দিয়ে ডাকা হয়নি — ইউনিট
   *    টেস্টে `pipe` ডাকা হয়েছে কি না দেখলে এটা কখনোই ধরা পড়ত না।
   */
  @UseGuards(DeviceAuthGuard)
  @Get('update/download')
  async download(
    @Query('version') version: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!version) throw new BadRequestException('version is required');

    const { stream, size } = await this.updates.openMsi(version);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="oXeioAgent-${version}.msi"`,
    );
    return new StreamableFile(stream);
  }
}
