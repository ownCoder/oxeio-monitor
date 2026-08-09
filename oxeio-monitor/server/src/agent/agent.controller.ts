import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Device } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';

import { Public } from '../auth/decorators';
import { MAX_SCREENSHOT_BYTES } from './agent.constants';
import { AgentConfigService, type AgentConfig } from './agent-config.service';
import type { Drift } from './clock-drift.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceRateLimitService } from './device-rate-limit.service';
import { CurrentDevice, CurrentDrift } from './device.decorator';
import {
  AppUsageBatchDto,
  EnrollDto,
  EventBatchDto,
  HeartbeatDto,
  ScreenshotMetaDto,
  SegmentBatchDto,
} from './dto';
import { EnrollmentService, type EnrollResult } from './enrollment.service';
import { IngestService, type IngestResult } from './ingest.service';
import { ScreenshotIngestService } from './screenshot-ingest.service';
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
  ) {}

  /** ইনস্টলের সময় একবার — এখানে টোকেন নেই, enrollment code-ই পরিচয় (H05) */
  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  enroll(@Body() dto: EnrollDto): Promise<EnrollResult> {
    return this.enrollment.enroll(dto);
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
  ): Promise<{ commands: AgentCommand[]; configVersion: string }> {
    this.rate.hit(device.id, 'ingest');

    const { version } = await this.configs.buildForDevice(device);
    const commands: AgentCommand[] = [];

    if (dto.configVersion && dto.configVersion !== version) {
      commands.push('reload_config');
    }

    if (device.agentVersion) {
      const offer = await this.updates.offerFor(device.agentVersion);
      if (offer) commands.push('update_agent');
    }

    // ⏳ capture_now / pause_tracking-এর জন্য একটা কমান্ড-কিউ টেবিল লাগবে —
    //    ড্যাশবোর্ড থেকে চাপা বাটনটা কোথাও জমা থাকতে হয় (A09, Phase 6)।
    return { commands, configVersion: version };
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
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SCREENSHOT_BYTES } }),
  )
  async screenshot(
    @CurrentDevice() device: Device,
    @CurrentDrift() drift: Drift,
    @Body('meta') metaRaw: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ accepted: number; duplicate: boolean; path: string }> {
    this.rate.hit(device.id, 'screenshot');

    if (!file) throw new BadRequestException('`file` অংশটি নেই');

    const meta = await this.parseMeta(metaRaw);
    return this.screenshots.ingest(device, drift, meta, file);
  }

  /**
   * multipart-এ `meta` আসে JSON স্ট্রিং হিসেবে, তাই গ্লোবাল ValidationPipe
   * ওটাকে ছুঁতে পারে না — হাতে parse ও validate করতে হয়।
   */
  private async parseMeta(raw: string): Promise<ScreenshotMetaDto> {
    if (!raw) throw new BadRequestException('`meta` অংশটি নেই');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('`meta` বৈধ JSON নয়');
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
    );
    if (!offer) {
      res.status(HttpStatus.NO_CONTENT);
      return null;
    }
    return offer;
  }

  @UseGuards(DeviceAuthGuard)
  @Get('update/download')
  async download(
    @Query('version') version: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!version) throw new BadRequestException('version দিতে হবে');

    const { stream, size } = await this.updates.openMsi(version);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="oXeioAgent-${version}.msi"`,
    );
    stream.pipe(res);
  }
}
