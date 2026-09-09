import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import {
  DESIGN_APPS_SQL,
  DESIGN_ID_SQL_EXPR,
  designIdOf,
} from '../src/summary/design.rules';
import { FileTraceService } from '../src/targets/file-trace.service';
import { TargetsService } from '../src/targets/targets.service';
import {
  createEmployeeWithCode,
  createHarness,
  dhakaNoon,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐⭐ **দাবির পাশে মাপ** *(৯ সেপ্টেম্বর ২০২৬)* — টার্গেটের "শেষ"
 * চিহ্নটা কর্মীর **নিজের ক্লিক**, আর এতদিন তার পাশে কিছুই ছিল না।
 *
 * ⚠️⚠️ **যে জিনিসটা এই ফাইলটা পাহারা দেয়, সেটা একটা বাগ নয় — একটা
 * ঝুঁকি।** "এই জব-নম্বরের ফাইলে কত সময় গেছে" প্রশ্নটার উত্তর ডাটাবেসেই
 * বের করতে হয়, তাই `DESIGN_ID` নিয়মটা **দুই ভাষায়** লেখা আছে —
 * TypeScript-এ আর SQL-এ। এই রেপোর সবচেয়ে চেনা ব্যর্থতা ঠিক এটাই:
 * এক জায়গায় বদলে অন্য জায়গায় না বদলানো।
 *
 * ⭐ তাই নিচের প্রথম দুটো টেস্ট নকলটার দুটো ভাঙার পথ আটকায়:
 *   ক· দুটো নিয়ম একই তালিকায় **একই ফল** দেয় কি না
 *   খ· SQL-এর লেখাটা `migration.sql`-এর সূচকের সাথে **মেলে** কি না
 *      *(না মিললে কোনো এরর নেই — কেবল প্রতিটা পাতা ১.৫ সেকেন্ড)*
 */
let h: Harness;
let trace: FileTraceService;
let targets: TargetsService;

const HOUR_MS = 3600_000;
/** ⚠️ ঢাকা UTC+৬ — লেবেল থেকে আসল মুহূর্তে যেতে এটুকু বাদ */
const DHAKA_OFFSET_MS = 6 * HOUR_MS;

const INDEX = 'app_usage_design_id_idx';

beforeAll(async () => {
  h = await createHarness();
  trace = h.app.get(FileTraceService);
  targets = h.app.get(TargetsService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

const today = () => workDateOf(dhakaNoon());
const dayBefore = (label: Date, days: number): Date =>
  new Date(label.getTime() - days * 86_400_000);
const atDhakaHour = (dayLabel: Date, hour: number): Date =>
  new Date(dayLabel.getTime() - DHAKA_OFFSET_MS + hour * HOUR_MS);

async function designer(code = 'OX-FT1'): Promise<{
  employeeId: number;
  deviceId: number;
}> {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);

  await h.prisma.employee.update({
    where: { id: employeeId },
    data: { staffType: 'designer' },
  });

  const device = await h.prisma.device.create({
    data: {
      hostname: `PC-${code}`,
      windowsUsername: code.toLowerCase(),
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      status: 'active',
    },
  });

  return { employeeId, deviceId: device.id };
}

/** একটা `app_usage` সারি — শিরোনামটা যেমন দেওয়া হয়েছে, হুবহু */
async function saw(
  who: { employeeId: number; deviceId: number },
  day: Date,
  title: string,
  seconds: number,
  process = 'Illustrator.exe',
): Promise<void> {
  const startedAt = atDhakaHour(day, 11);

  await h.prisma.appUsage.create({
    data: {
      employeeId: who.employeeId,
      deviceId: who.deviceId,
      clientUuid: randomUUID(),
      workDate: day,
      startedAt,
      endedAt: new Date(startedAt.getTime() + seconds * 1000),
      durationSec: seconds,
      processName: process,
      windowTitle: title,
    },
  });
}

async function target(
  employeeId: number,
  jobNumber: number,
  asin: string,
  when: { assignedAt: Date; completedAt?: Date },
): Promise<number> {
  const owner = await h.prisma.user.findFirstOrThrow();

  const row = await h.prisma.designTarget.create({
    data: {
      asin,
      jobNumber,
      status: when.completedAt ? 'done' : 'assigned',
      assignedToId: employeeId,
      assignedAt: when.assignedAt,
      completedAt: when.completedAt ?? null,
      completedVia: when.completedAt ? 'manual' : null,
      addedById: owner.id,
    },
  });

  return row.id;
}

/**
 * ⭐⭐ **মাঠ থেকে তোলা কঠিন শিরোনামগুলো** — প্রতিটার পাশে কেন সেটা
 * এখানে আছে।
 *
 * ⚠️ এই তালিকাটাই দুটো নিয়মের বিচারক, তাই এখানে সহজ কেস রাখা হয়নি:
 * প্রতিটা সারি কোনো না কোনো **সীমানা**।
 */
const CORPUS: readonly string[] = [
  // ⭐ আসল ধাঁচ — পাঁচ অঙ্কের পুরোনো কাজের নম্বর
  '37933-Woodcock Bird Vintage Illustration T-Shirt.ai @ 54 % (RGB/Preview)',
  // ⚠️⚠️ সাত অঙ্ক, পাশাপাশি দুটো — সীমানা না থাকলে দুটোই `100004` হতো
  '1000042-Bird.ai',
  '1000043-Cat.ai',
  // ⚠️ আট অঙ্কের স্টক-আইডি — সীমানা-যাচাইয়ে বাদ পড়ে
  '10163372_181.eps',
  // ⚠️ এক অঙ্ক — "দুইয়ের কম নয়" নিয়মে বাদ
  '4 [Converted].eps',
  // ⚠️ দুই অঙ্কও বাদ
  '12-Something.ai',
  // ⭐ তিন অঙ্ক — ঠিক সীমানায়, তাই থাকে
  '123-Small Job.ai',
  // ⚠️ অঙ্ক দিয়ে শুরু নয়
  'Untitled-20* @ 66.67 % (RGB/Preview)',
  'Template.ai',
  // ⚠️⚠️ **জানা মিথ্যা-ইতিবাচক** — বছরটাকে নম্বর ধরে নেয়। দুটো নিয়মকেই
  //    একইভাবে ভুল করতে হবে, নইলে সংখ্যা দুটো আলাদা হয়ে যাবে।
  '2026 Calendar Design.ai',
  // ⚠️ সামনে ফাঁকা — TS-এ `.trim()`, SQL-এ `btrim()`
  '   1050968-Trim Me.ai',
  // ⭐ সাত অঙ্কের পর আন্ডারস্কোর — সীমানা অঙ্ক নয়, তাই নম্বরটা টেকে
  '1050918_OL5I.psd',
];

/**
 * ⭐⭐ **কেবল একটা ভাঙা নিয়মই যে নম্বরগুলো বানাতে পারে।**
 *
 * ⚠️ উপরের তালিকার কোনো শিরোনাম থেকেই এগুলো বেরোনোর কথা নয় —
 * বেরোলে বুঝতে হবে SQL-এর নিয়মটা সরে গেছে:
 *   · `100004`  — সীমানা-যাচাই না থাকলে `1000042` কেটে ছয় অঙ্ক
 *   · `1016337` — `10163372_181.eps` থেকে, `(?![0-9])` না থাকলে
 *   · `4` · `12` — "দুইয়ের কম নয়" নিয়মটা আলগা হলে
 */
const WRONG_IDS: readonly number[] = [100004, 1016337, 105091, 4, 12];

describe('ফাইলের চিহ্ন — SQL আর TypeScript একই নিয়ম', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।**
   *
   * ⚠️⚠️ `DESIGN_ID` (TypeScript) আর `DESIGN_ID_SQL` (Postgres) — একটা
   * বদলে অন্যটা না বদলালে ক্রেডিটের সংখ্যা আর ফাইলের চিহ্ন **নীরবে
   * আলাদা** হয়ে যাবে। কোনো এরর উঠবে না; কেবল দুটো পর্দা দুটো কথা বলবে।
   */
  it('⭐⭐⭐ কঠিন শিরোনামের তালিকায় দুটো নিয়ম হুবহু এক ফল দেয়', async () => {
    const who = await designer();
    const day = today();

    for (const title of CORPUS) await saw(who, day, title, 60);

    // ── TypeScript-এর উত্তর
    const fromTs = new Set<number>();
    for (const title of CORPUS) {
      const id = designIdOf('Illustrator.exe', title);
      if (id !== null) fromTs.add(Number.parseInt(id, 10));
    }

    /**
     * ── Postgres-এর উত্তর, **প্রোডাকশনের কোড দিয়েই**।
     *
     * ⚠️⚠️ জিজ্ঞেস করা হয় সঠিক নম্বরগুলো **আর** ভুল নিয়মে যেগুলো
     * বেরোত — দুটো একসাথে। তাই দুদিকেই ধরা পড়ে: সঠিকটা হারালেও, আর
     * ভুলটা এসে পড়লেও।
     */
    const probe = [...new Set([...fromTs, ...WRONG_IDS])];
    const fromSql = new Set((await trace.secondsFor(probe)).keys());

    expect([...fromSql].sort((a, b) => a - b)).toEqual(
      [...fromTs].sort((a, b) => a - b),
    );

    // ⚠️ তালিকাটা সত্যিই কিছু ছেঁকেছে কি না — নইলে দুটো খালি সেট
    //    মিলে গিয়ে টেস্টটা অকারণে সবুজ থাকত
    expect(fromTs.size).toBeGreaterThan(3);
    expect(fromTs.size).toBeLessThan(CORPUS.length);
  });

  /**
   * ⭐⭐⭐ **সূচকটা সত্যিই ব্যবহার হচ্ছে কি না।**
   *
   * ⚠️⚠️ কোয়েরির লেখা আর `migration.sql`-এর লেখা এক অক্ষর আলাদা হলেই
   * Postgres সূচকটা **ব্যবহার করা বন্ধ করে দেয়** — চুপচাপ, কোনো এরর
   * ছাড়া। মাঠে সেটার দাম ১.৪৭ সেকেন্ড প্রতি পাতা।
   *
   * ⚠️ `enable_seqscan = off` দরকার, কারণ টেস্টের টেবিল ছোট — Postgres
   * তখন খরচের হিসাবে সিকোয়েন্স স্ক্যানই বাছত, আর টেস্টটা কিছুই প্রমাণ
   * করত না। ⭐ বন্ধ করে দিলে প্রশ্নটা দাঁড়ায় স্রেফ *"সূচকটা এই
   * এক্সপ্রেশনে খাটে কি না"* — আর সেটাই আমরা জানতে চাই।
   */
  it('⭐⭐⭐ কোয়েরির লেখা সূচকের লেখার সাথে মেলে (EXPLAIN)', async () => {
    const who = await designer();
    await saw(who, today(), '1000042-Bird.ai', 60);

    const plan = await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');

      /**
       * ⚠️⚠️ **কোয়েরিটা ধ্রুবক দুটো থেকেই বানানো হয়, হাতে লেখা হয় না।**
       * হাতে লিখলে টেস্টটা নিজের লেখা যাচাই করত, কোডের লেখা নয় — আর
       * তখন `DESIGN_ID_SQL` বদলে গেলেও এটা সবুজ থাকত। ⭐ সাবোতাজে ঠিক
       * সেটাই ধরা পড়েছিল (৯ সেপ্টেম্বর)।
       */
      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT sum(duration_sec) FROM app_usage
         WHERE ${DESIGN_APPS_SQL} AND ${DESIGN_ID_SQL_EXPR} IN ('1000042')`,
      );

      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain(INDEX);

    /**
     * ⚠️⚠️ **সূচকের নাম দেখা যথেষ্ট নয় — `Index Cond` দেখতে হয়।**
     *
     * সূচকটা **আংশিক** (`WHERE lower(process_name) IN …`), তাই
     * এক্সপ্রেশনটা মিলুক বা না মিলুক Postgres ওটাকে স্রেফ একটা
     * **সারি-ছাঁকনি** হিসেবে ব্যবহার করতে পারে — আর তখন প্ল্যানে নামটা
     * থাকে, অথচ `substring(...)` হিপ থেকে আবার গোনা হয়।
     *
     * ⭐ এক্সপ্রেশনটা সত্যিই সূচকে বসেছে কি না, তার একমাত্র চিহ্ন
     * `Index Cond` — না মিললে ওখানে `Filter` লেখা থাকে।
     * ⚠️ প্রথমে এই টেস্টটা কেবল নামটা দেখত, আর সাবোতাজে **সবুজই থেকে
     * গিয়েছিল** (৯ সেপ্টেম্বর) — অর্থাৎ দাবিটা ফাঁকা ছিল।
     */
    expect(plan).toContain('Index Cond');
  });
});

describe('ফাইলের চিহ্ন — কত সময়', () => {
  it('⭐ একই নম্বরের সব সারি যোগ হয়, একাধিক দিন জুড়েও', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 300);
    await saw(who, day, '1000042-Bird.ai @ 200 %', 120);
    await saw(who, dayBefore(day, 1), '1000042-Bird.ai', 60);
    // ⚠️ অন্য নম্বর — মিশে যাওয়া চলবে না
    await saw(who, day, '1000043-Cat.ai', 999);

    const secs = await trace.secondsFor([1_000_042, 1_000_043]);

    expect(secs.get(1_000_042)).toBe(480);
    expect(secs.get(1_000_043)).toBe(999);
  });

  /**
   * ⭐⭐ **শ্বেততালিকাটা এখানেও খাটে** — ব্রাউজারের শিরোনাম গোনা হয় না।
   *
   * ⚠️⚠️ উল্টো হলে একদিন কারো ব্রাউজার-ট্যাবের নাম এই হিসাবে ঢুকে
   * পড়ত, আর সেটা ঠিক সেই কনটেন্ট-পড়া যা README-তে "কখনোই নয়" বলা।
   */
  it('⭐⭐ ডিজাইন-অ্যাপ ছাড়া অন্য অ্যাপের শিরোনাম গোনা হয় না', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 300, 'chrome.exe');
    await saw(who, day, '1000042-Bird.ai', 300, 'Photoshop.exe');

    const secs = await trace.secondsFor([1_000_042]);

    expect(secs.get(1_000_042)).toBe(300);
  });

  it('⭐ কখনো না-দেখা নম্বর ম্যাপে থাকে না — শূন্য বসে না', async () => {
    const who = await designer();
    await saw(who, today(), '1000042-Bird.ai', 300);

    const secs = await trace.secondsFor([1_000_042, 1_000_099]);

    expect(secs.has(1_000_099)).toBe(false);
  });
});

describe('ফাইলের চিহ্ন — তালিকায় তিনটে অবস্থা', () => {
  /**
   * ⭐⭐⭐ **তিনটে অবস্থা আলাদা থাকে** — আর মাঝেরটাই এই কাজের কারণ।
   */
  it('⭐⭐⭐ মাপা · কখনো খোলা হয়নি · বলা যায় না — তিনটে আলাদা', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 420);

    // ক· চিহ্ন আছে
    await target(who.employeeId, 1_000_042, 'B000000042', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });

    // খ· চিহ্ন নেই, অথচ জানার কথা ছিল
    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });

    // গ· শিরোনাম জমা শুরুর **আগে** শেষ হয়েছে — বলা যায় না
    const old = dayBefore(day, 5);
    await target(who.employeeId, 1_000_044, 'B000000044', {
      assignedAt: atDhakaHour(old, 8),
      completedAt: atDhakaHour(old, 17),
    });

    const page = await targets.list({});
    const byJob = new Map(page.rows.map((r) => [r.jobNumber, r.fileSec]));

    expect(byJob.get(1_000_042)).toBe(420);
    expect(byJob.get(1_000_043)).toBe(0);
    // ⚠️⚠️ এটাই আসল দাবি: **`0` নয়, `null`** — নইলে ২০২৫ সালের সারিগুলো
    //    নীরবে "কখনো খোলা হয়নি" বলে দাঁড়াত, অর্থাৎ মিথ্যা অভিযোগ
    expect(byJob.get(1_000_044)).toBeNull();

    expect(page.traceSince).toBe(day.toISOString().slice(0, 10));
  });

  /**
   * ⭐⭐⭐ **হাতে থাকা কাজে "no trace" বসে না।**
   *
   * ⚠️⚠️ প্রথম লেখায় বসত, আর সেটা ছিল একটা **অভিযোগ সেখানে যেখানে কোনো
   * দাবিই করা হয়নি** — সকালে বরাদ্দ পাওয়া ৩০টা সারির প্রতিটার পাশে।
   */
  it('⭐⭐⭐ হাতে থাকা, এখনো খোলা হয়নি — `0` নয়, `null`', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 60);
    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
    });

    const page = await targets.list({ status: 'assigned' });

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].fileSec).toBeNull();
  });

  /** ⭐ হাতে থাকা সারিতেও **মাপা** সময় দেখা যায় — ওটা খবর */
  it('⭐ হাতে থাকা সারিতে সময় থাকলে সেটা দেখা যায়', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000043-Cat.ai', 240);
    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
    });

    const page = await targets.list({ status: 'assigned' });

    expect(page.rows[0].fileSec).toBe(240);
  });

  /**
   * ⭐⭐ **একটাও ডিজাইন-শিরোনাম নেই, অথচ `app_usage` খালি নয়।**
   *
   * ⚠️ তখন `seenJobNumbers()` একটা **খালি তালিকা** ফেরত দেয়, আর সেটা
   * `notIn: []` হয়ে Prisma-য় যায় — পথটা আলাদা, তাই আলাদা দাবি।
   */
  it('⭐⭐ চেনা কোনো নম্বরই পর্দায় আসেনি — তবু তালিকা ভাঙে না', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, 'Untitled-20* @ 66.67 %', 300);
    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });

    const page = await targets.list({ stage: 'no_file' });

    expect(page.rows.map((r) => r.jobNumber)).toEqual([1_000_043]);
  });

  it('⭐ পুলে পড়ে থাকা সারির জব-নম্বরই নেই — চিহ্নও `null`', async () => {
    const who = await designer();
    await saw(who, today(), '1000042-Bird.ai', 300);

    const owner = await h.prisma.user.findFirstOrThrow();
    await h.prisma.designTarget.create({
      data: { asin: 'B000000077', status: 'pool', addedById: owner.id },
    });

    const page = await targets.list({ status: 'pool' });

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].fileSec).toBeNull();
  });
});

describe('ফাইলের চিহ্ন — "শেষ বলা, অথচ খোলা হয়নি" তালিকা', () => {
  /**
   * ⭐⭐⭐ **মালিকের চাওয়া তালিকাটা** *(৯ সেপ্টেম্বর: "kha banao")*।
   */
  it('⭐⭐⭐ চিহ্ন না থাকা সারিটাই আসে, চিহ্ন থাকাটা আসে না', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 420);

    await target(who.employeeId, 1_000_042, 'B000000042', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });
    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });

    const page = await targets.list({ stage: 'no_file' });

    expect(page.rows.map((r) => r.jobNumber)).toEqual([1_000_043]);
    expect(page.rows[0].fileSec).toBe(0);
  });

  /**
   * ⭐⭐ **শেষ না বলা সারি তালিকায় আসে না।**
   *
   * ⚠️ হাতে থাকা কাজের ফাইল এখনো খোলা না হওয়াটা স্বাভাবিক — ওটা
   * প্রশ্নের বিষয়ই নয়। তালিকাটা কেবল **দাবি করা** কাজ নিয়ে।
   */
  it('⭐⭐ হাতে থাকা (assigned) সারি তালিকায় আসে না', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 60);
    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
    });

    const page = await targets.list({ stage: 'no_file' });

    expect(page.rows).toHaveLength(0);
  });

  /**
   * ⭐⭐⭐ **সীমানাটাই তালিকাটাকে সৎ রাখে।**
   *
   * ⚠️⚠️ শিরোনাম জমা শুরুর আগে শেষ হওয়া সারি এখানে এলে মাঠের ২৭ হাজার
   * পুরোনো ইমপোর্ট করা সারি সবাই "প্রমাণ নেই" হয়ে দাঁড়াত — একটা তালিকা
   * যেটা পড়ার অযোগ্য, আর তার চেয়েও খারাপ, একটা মিথ্যা অভিযোগ।
   */
  it('⭐⭐⭐ শিরোনাম জমা শুরুর আগের সারি তালিকায় আসে না', async () => {
    const who = await designer();
    const day = today();

    await saw(who, day, '1000042-Bird.ai', 60);

    const old = dayBefore(day, 5);
    await target(who.employeeId, 1_000_055, 'B000000055', {
      assignedAt: atDhakaHour(old, 8),
      completedAt: atDhakaHour(old, 17),
    });

    const page = await targets.list({ stage: 'no_file' });

    expect(page.rows).toHaveLength(0);
  });

  /**
   * ⭐⭐ **একটাও শিরোনাম জমা না থাকলে তালিকাটা খালি** — "সবাই দোষী" নয়।
   */
  it('⭐⭐ `app_usage` পুরো খালি হলে কারো নামে কিছু বলা হয় না', async () => {
    const who = await designer();
    const day = today();

    await target(who.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });

    const page = await targets.list({ stage: 'no_file' });

    expect(page.traceSince).toBeNull();
    expect(page.rows).toHaveLength(0);
  });

  /**
   * ⭐⭐ **ডিজাইনার ধরে ছাঁকনি এখানেও খাটে** — একই তালিকা, একজনের।
   */
  it('⭐⭐ কর্মী-ছাঁকনির সাথে একসাথে কাজ করে', async () => {
    const a = await designer('OX-FT1');
    const b = await designer('OX-FT2');
    const day = today();

    await saw(a, day, '1000042-Bird.ai', 60);

    await target(a.employeeId, 1_000_043, 'B000000043', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });
    await target(b.employeeId, 1_000_044, 'B000000044', {
      assignedAt: atDhakaHour(day, 8),
      completedAt: atDhakaHour(day, 17),
    });

    const page = await targets.list({
      stage: 'no_file',
      staffId: b.employeeId,
    });

    expect(page.rows.map((r) => r.jobNumber)).toEqual([1_000_044]);
  });
});
