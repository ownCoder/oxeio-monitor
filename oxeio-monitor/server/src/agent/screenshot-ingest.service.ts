import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
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
export class ScreenshotIngestService implements OnModuleInit {
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
   * ⭐⭐ **G81 — চালুর সময়ই storage-এ লেখা যায় কি না দেখা।**
   *
   * ১৩ আগস্ট VPS-এ গ্যালারিতে *"10 this day"* দেখাত, অথচ দশটাই ভাঙা
   * আইকন। কারণ: হোস্টের `.data/storage` ফোল্ডারটা **root**-এর, আর
   * কনটেইনার চলে `node` (uid 1000) হয়ে। ⚠️ Dockerfile-এর
   * `chown -R node:node` ওখানে কাজেই আসে না — bind mount ইমেজের
   * ফোল্ডারটা **মালিকানাসহ** ঢেকে দেয়।
   *
   * ⚠️⚠️ কিন্তু আসল অপরাধটা ছিল **নীরবতা**। permission denied একটা
   * জোরালো ভুল, অথচ সার্ভার দিব্যি উঠে বসে থাকত আর প্রতিটা ছবি নীরবে
   * হারাত। storage-এ লেখা না গেলে এই পণ্যের **মূল কাজটাই অচল** — তখন
   * চালু থাকাটাই বিভ্রান্তি।
   *
   * তাই `SignedUrlService` দুর্বল সিক্রেটে যেমন থামে, ঠিক তেমন।
   *
   * ⭐ **probe লেখা হয় root-এর ভেতরে, শুধু `access()` নয়** — `access(W_OK)`
   * ফোল্ডারের বিট দেখে, কিন্তু read-only mount, ভরা ডিস্ক বা SELinux
   * লেবেলে সে **সফল বলেও** পরে লেখা আটকে যেতে পারে। সত্যিকারের লেখাই
   * একমাত্র সত্যিকারের প্রমাণ।
   */
  async onModuleInit(): Promise<void> {
    const probe = join(this.root, '.write-probe');
    try {
      await mkdir(this.root, { recursive: true });
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Screenshot storage is not writable: ${this.root} (${reason}). ` +
          'Screenshots would be silently lost. On Docker this is almost always ' +
          'the bind-mounted folder being owned by root while the container runs ' +
          'as uid 1000 — fix with: chown -R 1000:1000 .data/storage',
      );
    }
    this.logger.log(`Screenshot storage is writable: ${this.root}`);
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
        return this.resolveDuplicate(
          device,
          meta,
          slotStart,
          relPath,
          file,
          thumb,
        );
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
  /**
   * ⭐⭐ **G81 — "সারি আছে" আর "ফাইল আছে" এক কথা নয়।**
   *
   * সারি ও ফাইল দুই জায়গায় লেখা হয়, DB আগে ডিস্ক পরে। ডিস্কে লেখা
   * ব্যর্থ হলে সারিটা থেকে যায়, আর তখন যা ঘটত:
   *
   * ```
   * লেখা ব্যর্থ  →  এজেন্ট রিট্রাই  →  DB বলে "সারি তো আছে" (P2002)
   *              →  সার্ভার { accepted: 0, duplicate: true } ফেরত দেয়
   *              →  এজেন্ট আউটবক্স থেকে ছবিটা মুছে ফেলে
   * ```
   *
   * ⚠️⚠️ **duplicate পথটা সফলতা ধরে নিত** — যুক্তিসঙ্গত, কারণ ওটা লেখা
   * হয়েছিল "এজেন্ট একই ছবি দুবার পাঠিয়েছে" ভেবে। ফল: ছবিটা চিরতরে
   * হারাত, এজেন্ট নিশ্চিন্ত, সার্ভার নিশ্চিন্ত, আর মালিক দেখতেন ভাঙা
   * আইকন — যার সাথে আসল কারণের কোনো মিল নেই।
   *
   * ⭐ এখন ফাইলটা সত্যিই আছে কি না **দেখা হয়**, আর না থাকলে
   * **সারিয়ে দেওয়া হয়** — শুধু "ব্যর্থ" বললে এজেন্ট ছবিটা ধরে রাখত
   * বটে, কিন্তু প্রতিবার একই দেয়ালে ধাক্কা খেত। রিট্রাইটাকে মেরামতে
   * বদলে দেওয়াই আসল সমাধান।
   */
  private async resolveDuplicate(
    device: Device,
    meta: ScreenshotMetaDto,
    slotStart: Date,
    relPath: string,
    file: Express.Multer.File,
    thumb: Express.Multer.File | undefined,
  ): Promise<ScreenshotResult> {
    /**
     * ⚠️ দুটো UNIQUE-এর **যেকোনোটায়** আটকাতে পারে, তাই দুটোই খোঁজা হয়:
     * `client_uuid`, আর `(device, slot, monitor)`।
     */
    const existing = await this.prisma.screenshot.findFirst({
      where: {
        OR: [
          { clientUuid: meta.clientUuid },
          {
            deviceId: device.id,
            slotStart,
            monitorIndex: meta.monitorIndex,
          },
        ],
      },
      select: { id: true, filePath: true, thumbPath: true },
    });

    // ⚠️ সারিটা এর মধ্যে মুছে গেছে (retention জব, বা কেউ হাতে) — বিরল,
    //    কিন্তু তখন মেরামতের কিছু নেই। আগের আচরণেই ফিরি।
    if (!existing) {
      return { accepted: 0, duplicate: true, path: relPath, thumbPath: null };
    }

    /**
     * ⭐ **`existing.filePath`, `relPath` নয়** — দুটো আলাদা হতে পারে।
     * রিট্রাইয়ে `captured_at`-এর সেকেন্ড এক না হলে ফাইলের নামও বদলায়
     * (`hhmmss_m0.webp`)। নতুন পথে লিখলে সারিটা এক ফাইলের দিকে দেখাত আর
     * বাইট পড়ে থাকত অন্য ফাইলে — অর্থাৎ ঠিক যে অমিলটা সারাতে বসেছি,
     * সেটাই আবার তৈরি হতো।
     */
    const absPath = join(this.root, existing.filePath);
    try {
      await access(absPath);
      // ফাইল আছে — সত্যিকারের ডুপ্লিকেট, এজেন্ট নিশ্চিন্তে মুছে ফেলুক
      return {
        accepted: 0,
        duplicate: true,
        path: existing.filePath,
        thumbPath: existing.thumbPath,
      };
    } catch {
      // ফাইল নেই — সারিটা এতিম। নিচে মেরামত।
    }

    this.logger.warn(
      `Screenshot row ${existing.id} had no file on disk (${existing.filePath}) — healing from agent retry`,
    );

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, file.buffer);

    const thumbPath = await this.storeThumb(
      existing.id,
      existing.filePath,
      file.size,
      thumb,
    );

    /**
     * ⭐ `accepted: 1` — এজেন্টের দিক থেকে এটা সত্যিই গ্রহণ করা হয়েছে,
     * এইবারই প্রথম। `duplicate: false`-ও তাই: সারিটা পুরোনো হলেও
     * **বাইটগুলো নতুন**, আর এজেন্টের সিদ্ধান্ত (কিউ থেকে মোছা) নির্ভর
     * করে বাইট পৌঁছেছে কি না তার উপর — সারি ছিল কি না তার উপর নয়।
     */
    return {
      accepted: 1,
      duplicate: false,
      path: existing.filePath,
      thumbPath,
    };
  }

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
