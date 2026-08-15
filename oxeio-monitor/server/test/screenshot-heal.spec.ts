import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import { Prisma, type Device } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ClockDriftService,
  Drift,
} from '../src/agent/clock-drift.service';
import type { ScreenshotMetaDto } from '../src/agent/dto';
import { ScreenshotIngestService } from '../src/agent/screenshot-ingest.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * **G81 — "সারি আছে" আর "ফাইল আছে" এক কথা নয়।**
 *
 * ⚠️⚠️ এই ফাইলটা লেখা হয়েছে একটা মাঠের বাগ থেকে, আর বাগটা ছিল **সম্পূর্ণ
 * নীরব**। VPS-এ গ্যালারিতে *"10 this day"* দেখাত, অথচ দশটাই ভাঙা আইকন —
 * সারি আছে, ফাইল নেই।
 *
 * ঘটনাটা ছিল এই:
 *
 * ```
 * ডিস্কে লেখা ব্যর্থ  →  এজেন্ট রিট্রাই  →  DB বলে "সারি তো আছে" (P2002)
 *                    →  সার্ভার { accepted: 0, duplicate: true } ফেরত দেয়
 *                    →  এজেন্ট আউটবক্স থেকে ছবিটা মুছে ফেলে  →  চিরতরে হারাল
 * ```
 *
 * ⭐ DB ছাড়াই টেস্ট করা যায়, কারণ এখানকার প্রশ্ন দুটোই I/O-র: **ফাইলটা
 * ডিস্কে আছে কি না**, আর **না থাকলে বসানো হয় কি না**। তাই Prisma নকল, কিন্তু
 * ফাইল-সিস্টেম আসল — নইলে টেস্টটা ঠিক সেই জিনিসটাই মাপত না যেটা ভেঙেছিল।
 */

const DRIFT: Drift = { skewMs: 0, corrected: false } as unknown as Drift;

const DEVICE = { id: 61, employeeId: 3 } as unknown as Device;

const META: ScreenshotMetaDto = {
  clientUuid: '11111111-2222-3333-4444-555555555555',
  capturedAt: '2026-08-13T13:29:54.000Z',
  slotStart: '2026-08-13T13:25:00.000Z',
  monitorIndex: 0,
  width: 1920,
  height: 1080,
} as unknown as ScreenshotMetaDto;

function webp(bytes = 1234): Express.Multer.File {
  return {
    mimetype: 'image/webp',
    size: bytes,
    buffer: Buffer.alloc(bytes, 7),
  } as unknown as Express.Multer.File;
}

/** P2002 — Prisma-র UNIQUE ভাঙার এররটা হুবহু, কারণ কোড সেটাই চেনে */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'oxeio-shot-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeService(prisma: Partial<PrismaService>): ScreenshotIngestService {
  const config = {
    get: (key: string) => (key === 'STORAGE_ROOT' ? root : undefined),
  } as unknown as ConfigService;

  // ঘড়ির সংশোধন এখানে অপ্রাসঙ্গিক — যা এল তাই ফেরত
  const clock = {
    correct: (value: string) => new Date(value),
  } as unknown as ClockDriftService;

  return new ScreenshotIngestService(prisma as PrismaService, clock, config);
}

describe('G81 · চালুর সময় storage-এ লেখা যায় কি না', () => {
  it('লেখা গেলে চুপচাপ উঠে যায়', async () => {
    const svc = makeService({});
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('ফোল্ডার না থাকলে বানিয়ে নেয় — এটা ব্যর্থতা নয়', async () => {
    const nested = join(root, 'a', 'b', 'c');
    const config = {
      get: (key: string) => (key === 'STORAGE_ROOT' ? nested : undefined),
    } as unknown as ConfigService;
    const svc = new ScreenshotIngestService(
      {} as PrismaService,
      {} as ClockDriftService,
      config,
    );

    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    await expect(stat(nested)).resolves.toBeTruthy();
  });

  /**
   * ⭐⭐ এটাই এই ফাইলের সবচেয়ে জরুরি টেস্ট। ঠিক এই অবস্থাতেই সার্ভার আগে
   * **দিব্যি উঠে বসে থাকত** আর প্রতিটা ছবি নীরবে হারাত।
   *
   * ⚠️ read-only ফোল্ডার বানিয়ে মাপা হয়, `access()` নকল করে নয় — কারণ
   * `access(W_OK)` সফল বলেও পরে লেখা আটকাতে পারে, আর সেই ফাঁকটাই তো
   * সারাতে বসা।
   */
  // ⚠️ Windows-এ **বাদ**, আর কারণটা টেস্টের নয়, OS-এর: `chmod 0o555` ওখানে
  //    ফোল্ডারকে read-only করে না (POSIX বিট বলে কিছু নেই), তাই লেখা সফল
  //    হয় আর টেস্ট লাল দেখায়। ⭐ CI Linux-এ চলে, সেখানে এটা আসল পাহারা।
  //    না বাদ দিলে উইন্ডোজে `npm run test:nodb` সবসময় একটা লাল দেখাত, আর
  //    "একটা তো সবসময় লাল থাকেই" — এভাবেই আসল লাল চোখ এড়িয়ে যায়।
  it.skipIf(process.platform === 'win32')(
    'লেখা না গেলে জোরে থামে, আর বার্তায় সারানোর পথ থাকে',
    async () => {
      const locked = join(root, 'locked');
      await mkdir(locked, { recursive: true });
      // dr-xr-xr-x — ঢোকা যায়, লেখা যায় না
      await import('node:fs/promises').then((fs) => fs.chmod(locked, 0o555));

      const config = {
        get: (key: string) => (key === 'STORAGE_ROOT' ? locked : undefined),
      } as unknown as ConfigService;
      const svc = new ScreenshotIngestService(
        {} as PrismaService,
        {} as ClockDriftService,
        config,
      );

      await expect(svc.onModuleInit()).rejects.toThrow(
        /Screenshot storage is not writable/,
      );
      // ⭐ বার্তাটা শুধু "ভেঙেছে" নয়, **কী করতে হবে** বলে — নইলে ডকারের
      //    uid-এর ফাঁদটা কেউ ধরতে পারত না
      await expect(svc.onModuleInit()).rejects.toThrow(/chown -R 1000:1000/);
    },
  );
});

describe('G81 · duplicate পথ — সারি আছে, ফাইল নেই', () => {
  /**
   * সত্যিকারের ডুপ্লিকেট: সারিও আছে, ফাইলও আছে। এজেন্ট নিশ্চিন্তে
   * কিউ থেকে মুছে ফেলুক — এটাই আগের আচরণ, আর এটাই ঠিক।
   */
  it('ফাইল ডিস্কে থাকলে সত্যিকারের duplicate বলে', async () => {
    const existingPath = 'screenshots/2026/08/13/emp-003/192954_m0.webp';
    await mkdir(join(root, 'screenshots/2026/08/13/emp-003'), {
      recursive: true,
    });
    await writeFile(join(root, existingPath), Buffer.from('already here'));

    const findFirst = vi.fn().mockResolvedValue({
      id: 500n,
      filePath: existingPath,
      thumbPath: 'screenshots/2026/08/13/emp-003/192954_m0.thumb.webp',
    });
    const svc = makeService({
      screenshot: {
        create: vi.fn().mockRejectedValue(uniqueViolation()),
        findFirst,
      },
    } as unknown as Partial<PrismaService>);

    const result = await svc.ingest(DEVICE, DRIFT, META, webp());

    expect(result).toEqual({
      accepted: 0,
      duplicate: true,
      path: existingPath,
      thumbPath: 'screenshots/2026/08/13/emp-003/192954_m0.thumb.webp',
    });
    // ফাইলটা ছোঁয়াই হয়নি
    await expect(readFile(join(root, existingPath), 'utf8')).resolves.toBe(
      'already here',
    );
  });

  /**
   * ⭐⭐ মূল টেস্ট — এটা সংশোধনের **আগে ব্যর্থ হতো**।
   */
  it('ফাইল না থাকলে বাইটগুলো বসিয়ে দেয়, আর সফল বলে', async () => {
    const existingPath = 'screenshots/2026/08/13/emp-003/192954_m0.webp';

    const svc = makeService({
      screenshot: {
        create: vi.fn().mockRejectedValue(uniqueViolation()),
        findFirst: vi.fn().mockResolvedValue({
          id: 500n,
          filePath: existingPath,
          thumbPath: null,
        }),
      },
    } as unknown as Partial<PrismaService>);

    const result = await svc.ingest(DEVICE, DRIFT, META, webp(99));

    // ⭐ accepted: 1 — এজেন্টের দিক থেকে বাইটগুলো **এইবারই** পৌঁছাল
    expect(result.accepted).toBe(1);
    expect(result.duplicate).toBe(false);
    expect(result.path).toBe(existingPath);

    const written = await readFile(join(root, existingPath));
    expect(written).toHaveLength(99);
  });

  /**
   * ⚠️⚠️ সবচেয়ে সূক্ষ্ম টেস্ট। রিট্রাইয়ে `captured_at`-এর সেকেন্ড এক না
   * হলে হিসাব করা ফাইলের নামও বদলায়। নতুন পথে লিখলে সারিটা এক ফাইলের
   * দিকে দেখাত আর বাইট পড়ে থাকত অন্য ফাইলে — অর্থাৎ ঠিক যে অমিলটা
   * সারাতে বসা, সেটাই আবার তৈরি হতো।
   */
  it('সারির নিজের পথে লেখে, নতুন করে হিসাব করা পথে নয়', async () => {
    const rowPath = 'screenshots/2026/08/13/emp-003/000001_m0.webp';

    const svc = makeService({
      screenshot: {
        create: vi.fn().mockRejectedValue(uniqueViolation()),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 7n, filePath: rowPath, thumbPath: null }),
      },
    } as unknown as Partial<PrismaService>);

    const result = await svc.ingest(DEVICE, DRIFT, META, webp());

    expect(result.path).toBe(rowPath);
    await expect(stat(join(root, rowPath))).resolves.toBeTruthy();
  });

  /**
   * ⚠️ সারিটা এর মধ্যে মুছে গেছে (retention জব, বা কেউ হাতে)। বিরল, কিন্তু
   * তখন মেরামতের কিছু নেই — আর সবচেয়ে জরুরি, **ছুঁড়ে দেওয়া চলবে না**,
   * নইলে এজেন্ট ৫০০ পেয়ে একই ছবি চিরকাল রিট্রাই করত।
   */
  it('সারিটাই না পেলে আগের আচরণে ফেরে, ছোঁড়ে না', async () => {
    const svc = makeService({
      screenshot: {
        create: vi.fn().mockRejectedValue(uniqueViolation()),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Partial<PrismaService>);

    const result = await svc.ingest(DEVICE, DRIFT, META, webp());

    expect(result.accepted).toBe(0);
    expect(result.duplicate).toBe(true);
  });

  /** P2002 ছাড়া অন্য এরর যেন গিলে ফেলা না হয় */
  it('অন্য কোনো DB এরর চাপা পড়ে না', async () => {
    const svc = makeService({
      screenshot: {
        create: vi.fn().mockRejectedValue(new Error('connection lost')),
        findFirst: vi.fn(),
      },
    } as unknown as Partial<PrismaService>);

    await expect(svc.ingest(DEVICE, DRIFT, META, webp())).rejects.toThrow(
      'connection lost',
    );
  });
});
