import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Device } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_SCREENSHOT_MIME,
  MAX_SCREENSHOT_BYTES,
} from './agent.constants';
import { ClockDriftService, type Drift } from './clock-drift.service';
import type { ScreenshotMetaDto } from './dto';
import { dhakaPathParts, workDateOf } from './util/dhaka-time';

export interface ScreenshotResult {
  accepted: number;
  duplicate: boolean;
  path: string;
}

@Injectable()
export class ScreenshotIngestService {
  private readonly logger = new Logger(ScreenshotIngestService.name);
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockDriftService,
    config: ConfigService,
  ) {
    this.root = resolve(
      config.get<string>('STORAGE_ROOT') ?? join(process.cwd(), '..', '.data', 'storage'),
    );
  }

  async ingest(
    device: Device,
    drift: Drift,
    meta: ScreenshotMetaDto,
    file: Express.Multer.File,
  ): Promise<ScreenshotResult> {
    if (!meta.clientUuid) {
      throw new UnprocessableEntityException('meta-তে client_uuid নেই');
    }
    if (device.employeeId === null) {
      throw new UnprocessableEntityException(
        'এই ডিভাইস কোনো স্টাফের সাথে যুক্ত নয়',
      );
    }
    if (file.mimetype !== ALLOWED_SCREENSHOT_MIME) {
      throw new BadRequestException(
        `শুধু ${ALLOWED_SCREENSHOT_MIME} নেওয়া হয় (ADR-007), পাওয়া গেছে ${file.mimetype}`,
      );
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      throw new BadRequestException('ছবি ৫ MB-র বেশি');
    }

    const capturedAt = this.clock.correct(meta.capturedAt, drift);
    const slotStart = this.clock.correct(meta.slotStart, drift);
    const workDate = workDateOf(capturedAt);

    // D:\oXeio\storage\screenshots\YYYY\MM\DD\emp-003\093147_m0.webp
    // তারিখ ধরে ফোল্ডার — তাই ৯০ দিনের retention শুধু ফোল্ডার মুছেই করা যায় (ADR-006)
    const { year, month, day, hhmmss } = dhakaPathParts(capturedAt);
    const emp = `emp-${String(device.employeeId).padStart(3, '0')}`;
    const relPath = join(
      'screenshots',
      year,
      month,
      day,
      emp,
      `${hhmmss}_m${meta.monitorIndex}.webp`,
    ).replace(/\\/g, '/');

    const absPath = join(this.root, relPath);

    try {
      // DB আগে — UNIQUE-এ আটকালে ডিস্কে অযথা ফাইল লিখব না
      await this.prisma.screenshot.create({
        data: {
          employeeId: device.employeeId,
          deviceId: device.id,
          clientUuid: meta.clientUuid,
          workDate,
          slotStart,
          capturedAt,
          monitorIndex: meta.monitorIndex,
          filePath: relPath,
          // থাম্বনেইল Phase 3-এ (A06) — তখন sharp দিয়ে backfill হবে
          thumbPath: null,
          width: meta.width ?? null,
          height: meta.height ?? null,
          sizeBytes: file.size,
          activeApp: meta.activeApp ?? null,
          activeTitle: meta.activeTitle ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // client_uuid অথবা (device, slot, monitor) — দুটোর যেকোনোটায় ডুপ্লিকেট।
        // এজেন্ট আপলোড রিট্রাই করেছে, ভুল কিছু নয়।
        return { accepted: 0, duplicate: true, path: relPath };
      }
      throw err;
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, file.buffer);

    return { accepted: 1, duplicate: false, path: relPath };
  }
}
