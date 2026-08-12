import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { RetentionJob } from '../src/summary/retention.job';
import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * **K01** — ৯০ দিনের পুরোনো ছবি মোছার জব।
 *
 * ⭐ **এই টেস্টগুলো কেন দরকার ছিল:** জবটা লেখা ছিল, `@Cron` বসানোও ছিল,
 * কিন্তু জবের শরীরটা কোনোদিন চালিয়ে দেখা হয়নি — একটাও টেস্ট ছিল না।
 * অথচ নীতিমালায় স্টাফকে **লিখিতভাবে** বলা আছে "৯০ দিন পর ছবি নিজে
 * থেকেই মুছে যাবে"। ওটা না ঘটলে প্রতিশ্রুতিভঙ্গ, আর ধরা পড়ত কেবল
 * ডিস্ক ভরে গেলে — অর্থাৎ বছরখানেক পরে।
 *
 * ⚠️ এই ফাইল **সত্যিকারের ফাইল** লেখে ও মোছে (`STORAGE_ROOT` →
 * `server/test/.tmp-test-storage`, vitest.config.ts-এ বাঁধা)। মকড fs
 * দিয়ে করলে ঠিক যে জিনিসগুলো ভুল হতে পারে — পাথের হিসাব, ফোল্ডার খালি
 * হওয়া, ENOENT — সেগুলোর একটাও পরীক্ষা হতো না।
 */
let h: Harness;
let job: RetentionJob;
let employeeId: number;
let deviceId: number;
let root: string;

/** ছবির সারি + ডিস্কে সত্যিকারের ফাইল (ফুল + থাম্ব) */
async function makeShot(opts: {
  daysAgo: number;
  deletedAt?: Date | null;
  /** ফাইলটা ডিস্কে সত্যিই বসবে কি না — অসম্পূর্ণ আগের রান নকল করতে */
  writeFiles?: boolean;
  /** পাথ ওভাররাইড — `..` ঢুকিয়ে unsafe কেস বানাতে */
  filePath?: string;
}): Promise<{ id: bigint; filePath: string; thumbPath: string }> {
  /**
   * ⚠️⚠️ **`work_date` ঢাকার হিসাবে বসাতে হয়, UTC-তে নয়।**
   *
   * জবের কাটঅফ `retentionCutoff()` = `workDateOf(now) − ৯০ দিন`, অর্থাৎ
   * **ঢাকার** কর্মদিবস ধরে। ফিক্সচারটা আগে `Date.now()` থেকে UTC তারিখ
   * নিত — আর রাত ১২টা থেকে ভোর ৬টার মধ্যে (ঢাকা UTC+৬) UTC তারিখ একদিন
   * পিছিয়ে থাকে। ফলে `daysAgo: 90` আসলে ৯১ ঢাকা-দিন আগের সারি বানাত, আর
   * সীমানার টেস্টটা **প্রতি রাতে ওই ছয় ঘণ্টায় ফেল করত**।
   *
   * ⭐ ধরা পড়েছে ঠিক তাই — রাত ১২:৩০-এ চালাতে গিয়ে। দিনের বেলা চালালে
   * চিরকাল সবুজ থাকত।
   */
  const when = new Date(Date.now() - opts.daysAgo * 86_400_000);
  const day = workDateOf(when).toISOString().slice(0, 10);
  const uuid = randomUUID();

  const filePath = opts.filePath ?? `${day.replace(/-/g, '/')}/emp-001/${uuid}.webp`;
  const thumbPath = `${day.replace(/-/g, '/')}/emp-001/thumb/${uuid}.webp`;

  if (opts.writeFiles !== false) {
    for (const rel of [filePath, thumbPath]) {
      const abs = resolve(root, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, 'x');
    }
  }

  const row = await h.prisma.screenshot.create({
    data: {
      employeeId,
      deviceId,
      clientUuid: uuid,
      workDate: new Date(`${day}T00:00:00Z`),
      slotStart: when,
      capturedAt: when,
      filePath,
      thumbPath,
      deletedAt: opts.deletedAt ?? null,
    },
  });

  return { id: row.id, filePath, thumbPath };
}

const exists = async (rel: string): Promise<boolean> => {
  try {
    await access(resolve(root, rel));
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  h = await createHarness();
  job = h.app.get(RetentionJob);
  root = resolve(process.env.STORAGE_ROOT ?? join(process.cwd(), '..', '.data', 'storage'));
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const { code } = await createEmployeeWithCode(h.prisma);
  const device = await enrollDevice(h, code);
  employeeId = device.employeeId;
  deviceId = device.deviceId;
});

describe('retention জব — শরীরটা সত্যিই চলে', () => {
  it('৯০ দিনের পুরোনো ছবি: সারি ও ডিস্কের দুটো ফাইলই যায়', async () => {
    const old = await makeShot({ daysAgo: 120 });

    const result = await job.runOnce();

    expect(result.skipped).toBe(false);
    expect(result.marked).toBe(1);
    // ⭐ A06 — **দুটো** ফাইল: ফুল ছবি আর থাম্বনেইল। শুধু ফুলটা মুছলে
    //    এই সংখ্যা ১ হতো, আর thumb/ ফোল্ডার চিরকাল ডিস্কে থাকত।
    expect(result.filesDeleted).toBe(2);
    expect(result.rowsDeleted).toBe(1);
    expect(result.failed).toBe(0);

    expect(await exists(old.filePath)).toBe(false);
    expect(await exists(old.thumbPath)).toBe(false);
    expect(await h.prisma.screenshot.findUnique({ where: { id: old.id } })).toBeNull();
  });

  it('সাম্প্রতিক ছবি ছোঁয়াও হয় না', async () => {
    const fresh = await makeShot({ daysAgo: 10 });

    const result = await job.runOnce();

    expect(result.marked).toBe(0);
    expect(result.rowsDeleted).toBe(0);
    expect(await exists(fresh.filePath)).toBe(true);

    const row = await h.prisma.screenshot.findUnique({ where: { id: fresh.id } });
    expect(row?.deletedAt).toBeNull();
  });

  /**
   * ⚠️ সীমানার ঠিক এপাশ-ওপাশ। `retentionCutoff` ঢাকার আজকের তারিখ থেকে
   * ৯০ দিন পিছোয়, আর শর্তটা `workDate < cutoff` — তাই ঠিক ৯০ দিন আগের
   * ছবিটা **থেকে যায়**, ৯১ দিনেরটা যায়। `<=` লিখলে প্রতিশ্রুত ৯০ দিনের
   * বদলে ৮৯ দিন পাওয়া যেত, আর কেউ টেরই পেত না।
   */
  it('ঠিক ৯০ দিনেরটা থাকে, ৯১ দিনেরটা যায়', async () => {
    const ninety = await makeShot({ daysAgo: 90 });
    const ninetyOne = await makeShot({ daysAgo: 91 });

    await job.runOnce();

    expect(await h.prisma.screenshot.findUnique({ where: { id: ninety.id } })).not.toBeNull();
    expect(await h.prisma.screenshot.findUnique({ where: { id: ninetyOne.id } })).toBeNull();
  });

  /**
   * ⭐ জবটার নকশার মূল দাবি — মাঝপথে প্রসেস মরে গেলে পড়ে থাকে মার্ক-করা
   * সারি, আর পরের রান সেখান থেকেই শেষ করে। এখানে সেই অবস্থাটা হাতে
   * বানানো: `deleted_at` বসানো, কিন্তু ফাইল আগেই মুছে গেছে।
   */
  it('আগের অসম্পূর্ণ রানের বাকি কাজ শেষ করে (ফাইল নেই = সফল)', async () => {
    const half = await makeShot({
      daysAgo: 120,
      deletedAt: new Date(),
      writeFiles: false,
    });

    const result = await job.runOnce();

    // মার্ক আগেই করা ছিল, তাই এই রানে নতুন করে কিছু মার্ক হয়নি
    expect(result.marked).toBe(0);
    expect(result.filesMissing).toBe(2);
    expect(result.filesDeleted).toBe(0);
    expect(result.rowsDeleted).toBe(1);
    expect(await h.prisma.screenshot.findUnique({ where: { id: half.id } })).toBeNull();
  });

  it('দ্বিতীয়বার চালালে কিছুই বদলায় না (idempotent)', async () => {
    await makeShot({ daysAgo: 120 });

    const first = await job.runOnce();
    const second = await job.runOnce();

    expect(first.rowsDeleted).toBe(1);
    expect(second.marked).toBe(0);
    expect(second.rowsDeleted).toBe(0);
    expect(second.filesDeleted).toBe(0);
    expect(second.failed).toBe(0);
  });

  /**
   * ⭐⭐ সবচেয়ে জরুরি টেস্ট। `file_path` ডাটাবেসের কলাম; একটা `..` ঢুকে
   * পড়লে জবটা storage-এর বাইরের ফাইল `unlink` করত। সারিটা **রেখে দেওয়া
   * হয়** ইচ্ছাকৃতভাবে — মুছে দিলে প্রতিবেদনটাই হারাত।
   */
  it('storage রুটের বাইরের পাথ ছোঁয় না, সারিটাও রেখে দেয়', async () => {
    const evilRel = '../outside-the-root.webp';
    const evilAbs = resolve(root, evilRel);
    await writeFile(evilAbs, 'do-not-delete-me');

    try {
      const bad = await makeShot({
        daysAgo: 120,
        filePath: evilRel,
        writeFiles: false,
      });

      const result = await job.runOnce();

      expect(result.unsafePaths).toBe(1);
      expect(result.rowsDeleted).toBe(0);
      // ফাইলটা এখনো ওখানেই
      await expect(access(evilAbs)).resolves.toBeUndefined();
      // সারিটাও — পরের রানে আবার চেঁচাবে
      expect(await h.prisma.screenshot.findUnique({ where: { id: bad.id } })).not.toBeNull();
    } finally {
      // ⚠️ এই একটা ফাইল ইচ্ছাকৃতভাবে `STORAGE_ROOT`-এর **বাইরে** লেখা হয়,
      //    তাই `.tmp-test-storage/` মোছার সাথে যায় না — আর ওই ফোল্ডারটাই
      //    গিটে ignore করা। নিজে না মুছলে `server/`-এ পড়ে থাকত।
      await unlink(evilAbs).catch(() => {});
    }
  });

  /**
   * ⚠️ পাথ `…/YYYY/MM/DD/emp-001/`, আর থাম্ব `…/emp-001/thumb/`। গভীরতম
   * ফোল্ডার আগে না মুছলে `emp-001` চিরকাল ENOTEMPTY-তে আটকে থাকত।
   */
  it('খালি হয়ে যাওয়া ফোল্ডারও সরিয়ে দেয়', async () => {
    const old = await makeShot({ daysAgo: 120 });
    const dayDir = dirname(dirname(old.filePath)); // …/YYYY/MM/DD

    await job.runOnce();

    expect(await exists(dirname(old.thumbPath))).toBe(false);
    expect(await exists(dirname(old.filePath))).toBe(false);
    expect(await exists(dayDir)).toBe(false);
  });
});

describe('POST /ops/retention/run', () => {
  it('owner হাতে চালাতে পারে', async () => {
    const old = await makeShot({ daysAgo: 120 });
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post('/api/v1/ops/retention/run')
      .set('X-CSRF-Token', s.csrf)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(false);
    expect(res.body.marked).toBe(1);
    expect(res.body.rowsDeleted).toBe(1);
    expect(await h.prisma.screenshot.findUnique({ where: { id: old.id } })).toBeNull();
  });

  /**
   * ⚠️ CSRF টোকেন **দিয়েই** পাঠানো হচ্ছে — নইলে ৪০৩ আসত CSRF থেকে, আর
   * টেস্টটা পাস করত ভুল কারণে; role guard-টা কোনোদিন পরীক্ষাই হতো না।
   */
  it('ম্যানেজার পারে না — গোটা কন্ট্রোলারই owner-only', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    const res = await s.http
      .post('/api/v1/ops/retention/run')
      .set('X-CSRF-Token', s.csrf)
      .send({});

    expect(res.status).toBe(403);
  });

  it('লগইন ছাড়া পারা যায় না', async () => {
    const res = await h.http().post('/api/v1/ops/retention/run').send({});
    expect(res.status).toBe(401);
  });
});
