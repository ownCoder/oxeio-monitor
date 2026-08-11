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

import { storageRoot } from '../common/storage.config';
import { PrismaService } from '../prisma/prisma.service';
import {
  checkThumb,
  thumbPathFor,
  type ThumbCandidate,
} from '../screenshots/thumb';
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
  /** থাম্বনেইল বসেছে কি না — null মানে গ্যালারি ফুল ছবিতে ফেরত যাবে (A06) */
  thumbPath: string | null;
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
      storageRoot(config),
    );
  }

  /**
   * @param thumb ঐচ্ছিক ৩২০px থাম্বনেইল — এজেন্ট `thumb` নামের দ্বিতীয়
   *   multipart অংশে পাঠায় (A06)। না পাঠালে (পুরোনো এজেন্ট) কিছুই ভাঙে না।
   *
   *   ⭐ **কেন এজেন্ট বানায়, সার্ভার নয়** — Node-এ WebP ডিকোড করার কোনো
   *   উপায় নেই। `sharp` ইনস্টল করা নেই আর নতুন dependency নিষেধ; `pngjs`
   *   আছে বটে, কিন্তু সে PNG-ই বোঝে, আর এজেন্ট পাঠায় WebP (ADR-007)।
   *   এজেন্টে SkiaSharp আগে থেকেই আছে — সে ইতিমধ্যেই ১৯২০px-এ নামিয়ে
   *   এনকোড করে (`WebpEncoder.cs`), তাই একই সারফেস থেকে ৩২০px বের করা
   *   তার কাছে প্রায় বিনামূল্যে। বোনাস: থাম্বনেইলটাও নেটওয়ার্কের আগে
   *   তৈরি হয়, তাই সার্ভারের CPU-তে ১৫টা PC-র রিসাইজের ঢেউ ওঠে না।
   */
  async ingest(
    device: Device,
    drift: Drift,
    meta: ScreenshotMetaDto,
    file: Express.Multer.File,
    thumb?: Express.Multer.File,
  ): Promise<ScreenshotResult> {
    if (!meta.clientUuid) {
      throw new UnprocessableEntityException('client_uuid is missing from meta');
    }
    if (device.employeeId === null) {
      throw new UnprocessableEntityException(
        'This device is not linked to any staff member',
      );
    }
    if (file.mimetype !== ALLOWED_SCREENSHOT_MIME) {
      throw new BadRequestException(
        `Only ${ALLOWED_SCREENSHOT_MIME} is accepted (ADR-007), got ${file.mimetype}`,
      );
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      throw new BadRequestException('Image is larger than 5 MB');
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

    // ⚠️ `let` — আইডিটা try-র বাইরে দরকার, কারণ থাম্বনেইলের UPDATE-এ
    //    `where` লাগবে। `file_path` unique **নয়** (schema দেখুন), তাই
    //    পথ ধরে আপডেট করলে Prisma-ই ছুঁড়ে দিত।
    let screenshotId: bigint;

    try {
      // DB আগে — UNIQUE-এ আটকালে ডিস্কে অযথা ফাইল লিখব না
      const created = await this.prisma.screenshot.create({
        select: { id: true },
        data: {
          employeeId: device.employeeId,
          deviceId: device.id,
          clientUuid: meta.clientUuid,
          workDate,
          slotStart,
          capturedAt,
          monitorIndex: meta.monitorIndex,
          filePath: relPath,
          /**
           * ⭐ এখানে **সবসময় null**, থাম্বনেইল থাকলেও। মানটা বসে নিচে,
           *    ফাইলটা সত্যিই ডিস্কে পড়ার **পরে**।
           *
           * ⚠️ এখানেই পথটা বসিয়ে দিলে, আর তারপর লেখাটা ব্যর্থ হলে,
           *    `thumb_path` এমন একটা ফাইলের দিকে দেখাত যেটা নেই।
           *    গ্যালারির `thumbPath ?? filePath` fallback তখন **চলতই না**
           *    (মান তো null নয়), আর গ্রিড ভাঙা ছবিতে ভরে যেত।
           *    `thumb_path` তাই ইচ্ছার নয়, **ডিস্কের সত্যের** প্রতিচ্ছবি।
           */
          thumbPath: null,
          width: meta.width ?? null,
          height: meta.height ?? null,
          sizeBytes: file.size,
          activeApp: meta.activeApp ?? null,
          activeTitle: meta.activeTitle ?? null,
        },
      });
      screenshotId = created.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // client_uuid অথবা (device, slot, monitor) — দুটোর যেকোনোটায় ডুপ্লিকেট।
        // এজেন্ট আপলোড রিট্রাই করেছে, ভুল কিছু নয়।
        return { accepted: 0, duplicate: true, path: relPath, thumbPath: null };
      }
      throw err;
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, file.buffer);

    const thumbPath = await this.storeThumb(
      screenshotId,
      relPath,
      file.size,
      thumb,
    );

    return { accepted: 1, duplicate: false, path: relPath, thumbPath };
  }

  /**
   * A06 — থাম্বনেইলটা ডিস্কে বসিয়ে `thumb_path` হালনাগাদ করে।
   *
   * ⚠️ **এই ফাংশন কখনো ছুঁড়ে দেয় না।** পুরো শরীরটা একটা try/catch-এ, আর
   *    catch শুধু লগ লেখে। কারণটা A06-এর মূল শর্ত: *ছবিটা মূল্যবান,
   *    থাম্বনেইলটা সুবিধা মাত্র*। ডিস্ক ভরে যাওয়া, ফোল্ডারের পারমিশন,
   *    অ্যান্টিভাইরাসের লক — যে কারণেই থাম্বনেইল লেখা আটকাক, ফুল ছবিটা
   *    ততক্ষণে ডিস্কে ও DB-তে বসে গেছে। এখানে ছুঁড়ে দিলে এজেন্ট 500 পেত,
   *    রিট্রাই করত, আর পরের বার P2002 ডুপ্লিকেট — অর্থাৎ একটা নিখুঁত
   *    আপলোডকে ব্যর্থ বলে দেখানো হতো, স্রেফ একটা ছোট ছবি বানাতে না পেরে।
   *
   * @returns বসানো `thumb_path`, নয়তো `null` (গ্যালারি ফুল ছবিতে ফেরত যাবে)
   */
  private async storeThumb(
    screenshotId: bigint,
    relPath: string,
    fullSizeBytes: number,
    thumb: Express.Multer.File | undefined,
  ): Promise<string | null> {
    // পুরোনো এজেন্ট থাম্বনেইল পাঠায় না — এটা ভুল নয়, তাই লগও নয়
    if (!thumb) return null;

    try {
      const candidate: ThumbCandidate = {
        mimetype: thumb.mimetype,
        size: thumb.size,
        buffer: thumb.buffer,
      };

      const rejection = checkThumb(candidate, fullSizeBytes);
      if (rejection !== null) {
        // ⚠️ warn, error নয় — আপলোডটা সফল হয়েছে। কিন্তু নীরবেও ফেলা যায় না:
        //    এজেন্টের এনকোডার ভেঙে গেলে একমাত্র এই লাইনটাই বলবে।
        this.logger.warn(
          `Thumbnail rejected (${rejection}): ${relPath} — the full screenshot was stored fine`,
        );
        return null;
      }

      const thumbRel = thumbPathFor(relPath);
      if (thumbRel === null) {
        this.logger.error(`Could not derive the thumbnail path: ${relPath}`);
        return null;
      }

      const thumbAbs = join(this.root, thumbRel);
      await mkdir(dirname(thumbAbs), { recursive: true });
      await writeFile(thumbAbs, thumb.buffer);

      // ⭐ ফাইলটা ডিস্কে পড়ার পরেই কেবল DB জানল — এর উল্টোটা মানেই
      //    ভাঙা ছবির গ্রিড (উপরে `thumbPath: null`-এর নোট দেখুন)।
      await this.prisma.screenshot.update({
        where: { id: screenshotId },
        data: { thumbPath: thumbRel },
      });

      return thumbRel;
    } catch (error) {
      this.logger.warn(
        `Thumbnail not stored: ${relPath} — ${String(error)} · ` +
          `the full screenshot is fine, the gallery will show that`,
      );
      return null;
    }
  }
}
