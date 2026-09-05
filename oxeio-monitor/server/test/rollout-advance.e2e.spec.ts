import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RolloutAdvanceJob } from '../src/agent/rollout-advance.job';
import { ROLLOUT_SOAK_HOURS } from '../src/agent/rollout';
import { createHarness, realNow, resetDatabase, type Harness } from './setup/harness';

/**
 * ⭐⭐⭐ **H04 — রোলআউট নিজে থেকে এগোয়, জোড়ার মুখ পর্যন্ত**
 * *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * মালিক: *"update gula office staff ra pacche na. every single pc te
 * manually install korte hocche."*
 *
 * ⚠️ নিয়মগুলো নিজে `rollout-advance.spec.ts`-এ পরীক্ষিত (খাঁটি ফাংশন, DB
 * ছাড়াই)। **এখানকার প্রশ্ন আলাদা:** কোয়েরিটা কি ঠিক সারিগুলো টানে, কলামটা
 * কি আদৌ পড়া হয়, আর ধাপ বদলালে সেটা কি সত্যিই ডাটাবেসে বসে?
 *
 * ⚠️⚠️ এই প্রকল্পে ঠিক এই ছাঁদে দশবারের বেশি বাগ হয়েছে — **চুক্তি লেখা আছে,
 * কলার লেখা হয়নি**। আর এখানে ফলটা হতো বিশেষভাবে নীরব: ধাপ বাড়ত না, কেউ
 * আপডেট পেত না, আর কোনো এররও উঠত না।
 */
let h: Harness;
let job: RolloutAdvanceJob;

const HOUR_MS = 3600_000;

beforeAll(async () => {
  h = await createHarness();
  job = h.app.get(RolloutAdvanceJob);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

/**
 * ⚠️ **আসল ঘড়ি, পিন করা সময় নয়** (G140-র বৈধ ব্যবহার): `lastSeenAt` ও
 * `agentVersionSince` DB-তে বসে, আর জব ওগুলোর সাথে `now` মেলায়। দুই দিকে
 * দুই ঘড়ি মেশালে "৬ ঘণ্টা" শর্তটা যান্ত্রিকভাবেই ভুল হতো।
 */
const ago = (ms: number) => new Date(realNow().getTime() - ms);

async function publish(
  version: string,
  stage: 'canary' | 'partial' | 'all' | 'halted',
  releasedAt = realNow(),
): Promise<void> {
  await h.prisma.agentVersion.create({
    data: {
      version,
      msiPath: `updates/oXeioAgent-${version}.msi`,
      sha256: 'a'.repeat(64),
      rolloutStage: stage,
      releasedAt,
    },
  });
}

async function device(opts: {
  tag: string;
  agentVersion?: string | null;
  sinceMs?: number | null;
  seenMs?: number | null;
  status?: 'active' | 'revoked';
}): Promise<number> {
  const d = await h.prisma.device.create({
    data: {
      hostname: `PC-${opts.tag}`,
      windowsUsername: `user-${opts.tag}`,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      status: opts.status ?? 'active',
      agentVersion: opts.agentVersion ?? null,
      agentVersionSince: opts.sinceMs == null ? null : ago(opts.sinceMs),
      lastSeenAt: opts.seenMs == null ? null : ago(opts.seenMs),
    },
  });
  return d.id;
}

/** ছ-ঘণ্টার বেশি এই বিল্ডে, এইমাত্র সাড়া দিয়েছে */
const proven = (tag: string, version: string) =>
  device({
    tag,
    agentVersion: version,
    sinceMs: (ROLLOUT_SOAK_HOURS + 1) * HOUR_MS,
    seenMs: 60_000,
  });

const stageOf = async (version: string) =>
  (await h.prisma.agentVersion.findUniqueOrThrow({ where: { version } }))
    .rolloutStage;

describe('রোলআউট নিজে থেকে এগোয়', () => {
  it('সুস্থ canary — ধাপ partial-এ ওঠে', async () => {
    await publish('0.4.11', 'canary');
    await proven('a', '0.4.11');

    const result = await job.runOnce();

    expect(result).toMatchObject({ version: '0.4.11', from: 'canary', to: 'partial' });
    expect(await stageOf('0.4.11')).toBe('partial');
  });

  it('partial — পরের ধাপে all', async () => {
    await publish('0.4.11', 'partial');
    await proven('a', '0.4.11');

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('all');
  });

  /**
   * ⭐⭐ **এক টিকে এক ধাপ** — canary থেকে সরাসরি all-এ লাফ দেয় না।
   *
   * ⚠️ লাফ দিলে partial ধাপটার কোনো মানেই থাকত না, আর ৫০%-এ থেমে দেখার
   *    সুযোগটাই হারাত।
   */
  it('⭐ এক টিকে এক ধাপ — canary → all লাফ নয়', async () => {
    await publish('0.4.11', 'canary');
    await proven('a', '0.4.11');

    await job.runOnce();
    expect(await stageOf('0.4.11')).toBe('partial');
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।**
   *
   * ⚠️⚠️ `halted` মানে মালিক জরুরি ব্রেক চেপেছেন — সাধারণত এই কারণেই যে
   * বিল্ডটা মাঠে কিছু ভেঙেছে। যন্ত্র ওটা খুলতে পারলে ভাঙা বিল্ডটা **নিজে
   * থেকেই** বাকি সব PC-তে চলে যেত, আর মালিকের হাতে থামানোর কোনো উপায়
   * থাকত না। ⭐ ঝুঁকিটা নতুন: আগে ধাপ বাড়ত কেবল মানুষের ক্লিকে।
   */
  it('⭐ `halted` কখনো খোলে না — সুস্থ মেশিন থাকলেও', async () => {
    await publish('0.4.11', 'halted');
    await proven('a', '0.4.11');

    const result = await job.runOnce();

    expect(result.to).toBeNull();
    expect(await stageOf('0.4.11')).toBe('halted');
  });

  /**
   * ⭐⭐ **কেউ ইনস্টল না করলে ধাপ বাড়ে না** — canary-র পুরো মানেটাই এটা।
   *
   * ⚠️ শর্তটা "প্রকাশের ছ-ঘণ্টা পর" হলে এই টেস্টটাই ব্যর্থ হতো: ভার্সনটা
   *    অনেক আগে প্রকাশিত, অথচ **একটাও মেশিন সেটা চালাচ্ছে না**।
   */
  it('⭐ কোনো মেশিন এই বিল্ডে নেই — পুরোনো রিলিজ হলেও ধাপ বাড়ে না', async () => {
    await publish('0.4.11', 'canary', ago(30 * HOUR_MS));
    await device({ tag: 'old', agentVersion: '0.4.10', sinceMs: 40 * HOUR_MS, seenMs: 60_000 });

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('canary');
  });

  /**
   * ⭐⭐⭐ **ভাঙা বিল্ড নিজে থেকে ছড়ায় না।**
   *
   * ⚠️⚠️ মেশিনটা ছ-ঘণ্টার বেশি এই বিল্ডে আছে, কিন্তু **চুপ হয়ে গেছে** —
   * ঠিক যা ঘটত যদি নতুন বিল্ড এজেন্টকে ক্র্যাশ করাত। শুধু soak দেখলে এটা
   * "প্রমাণ" হয়ে যেত, আর সবচেয়ে খারাপ বিল্ডটাই সবার কাছে পৌঁছে যেত।
   */
  it('⭐ এজেন্ট চুপ হয়ে গেছে — ধাপ বাড়ে না', async () => {
    await publish('0.4.11', 'canary');
    await device({
      tag: 'dead',
      agentVersion: '0.4.11',
      sinceMs: (ROLLOUT_SOAK_HOURS + 2) * HOUR_MS,
      seenMs: 5 * HOUR_MS,
    });

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('canary');
  });

  it('সবে বসানো হয়েছে — অপেক্ষা করে', async () => {
    await publish('0.4.11', 'canary');
    await device({
      tag: 'fresh',
      agentVersion: '0.4.11',
      sinceMs: 10 * 60_000,
      seenMs: 60_000,
    });

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('canary');
  });

  /**
   * ⚠️ **মাইগ্রেশনের দিনের আচরণ।** পুরোনো সব সারিতে `agent_version_since`
   *    খালি; "জানি না"-কে "অনেকদিন ধরে চলছে" ধরলে ঠিক ওই দিনই চলতি
   *    ভার্সনটা এক লাফে সবার কাছে চলে যেত — কারো কিছু না করেই।
   */
  it('⭐ `agent_version_since` খালি — প্রমাণ নয়', async () => {
    await publish('0.4.11', 'canary');
    await device({ tag: 'unknown', agentVersion: '0.4.11', sinceMs: null, seenMs: 60_000 });

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('canary');
  });

  /** ⚠️ বাতিল করা PC-র heartbeat কোনো প্রমাণ নয় */
  it('revoked ডিভাইস প্রমাণ দেয় না', async () => {
    await publish('0.4.11', 'canary');
    await device({
      tag: 'revoked',
      agentVersion: '0.4.11',
      sinceMs: (ROLLOUT_SOAK_HOURS + 1) * HOUR_MS,
      seenMs: 60_000,
      status: 'revoked',
    });

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('canary');
  });

  /**
   * ⭐⭐ **জব ঠিক সেই ভার্সনটাই ধরে যেটা `offerFor()` বিলি করে** — সবচেয়ে
   * নতুন non-halted। ⚠️ পুরোনো একটার ধাপ বাড়ালে বদলটা হতো নীরব ও
   * অর্থহীন: কেউ ওটা অফারই পায় না।
   */
  it('⭐ পুরোনো ভার্সন ছোঁয়া হয় না', async () => {
    await publish('0.4.10', 'canary', ago(40 * HOUR_MS));
    await publish('0.4.11', 'canary', ago(20 * HOUR_MS));
    await proven('a', '0.4.11');

    await job.runOnce();

    expect(await stageOf('0.4.11')).toBe('partial');
    expect(await stageOf('0.4.10')).toBe('canary');
  });

  /**
   * ⭐⭐ **খাতায় লেখা থাকে, আর সেটা ঐচ্ছিক নয়।** ধাপ বদলানো এতদিন সবসময়
   * একজন মানুষের কাজ ছিল, তাই খাতায় নাম থাকত। যন্ত্র করলে খাতাটা ফাঁকা
   * যেত — আর কেউ দেখত "কাল ৭%, আজ ১০০%", কে বা কী করল তার উত্তর নেই।
   *
   * ⚠️ `change_agent_rollout` নয়, আলাদা action — "একজন মানুষ সিদ্ধান্ত
   *    নিয়েছেন" আর "শর্ত পূরণ হয়েছে" দুটো আলাদা দায়।
   */
  it('⭐ অডিটে আলাদা করে লেখা থাকে, আর userId খালি', async () => {
    await publish('0.4.11', 'canary');
    await proven('a', '0.4.11');

    await job.runOnce();

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'agent_version.rollout_auto' },
    });

    expect(row.userId).toBeNull();
    expect(row.targetId).toBe('0.4.11');
    expect(row.meta).toMatchObject({ from: 'canary', to: 'partial' });
  });

  /**
   * ⭐⭐⭐ **মাইগ্রেশনের পরদিন কী ঘটবে — আর কেন backfill লাগল।**
   *
   * ⚠️⚠️ কলামটা ভরে কেবল **ভার্সন বদলালে**। কিন্তু যে ১২টা PC এখন
   * ০.৪.৯/০.৪.১০ চালাচ্ছে, তাদের ভার্সন আর বদলাবে না — তাই ঘরটা চিরকাল
   * NULL থাকত, জব কোনো প্রমাণ পেত না, আর **চলতি ভার্সনটা চিরকাল
   * canary-তেই আটকে থাকত**। অর্থাৎ ঠিক যে সমস্যাটা সারানো হচ্ছে, সেটাই
   * মাইগ্রেশনের পরেও রয়ে যেত — শুধু নতুন মোড়কে।
   *
   * ⭐ তাই মাইগ্রেশনে একটা `UPDATE ... SET now()` — ঘড়িটা deploy থেকে
   * শুরু হয়। ⚠️ মানটা আসল শুরুর সময় নয়, একটা **নিচের সীমা**, আর ভুলটা
   * নিরাপদ দিকেই: ছ-ঘণ্টা অপেক্ষা করতেই হবে, কম নয়।
   *
   * ⚠️ এই টেস্টটা backfill-এর **আচরণটা** পাহারা দেয়, SQL নয়: deploy-এর
   * ঠিক পরে (ঘড়ি সবে শুরু) কিছুই ঘটে না, আর ছ-ঘণ্টা পর ঠিক **এক ধাপ**।
   */
  it('⭐ backfill-এর পর — সাথে সাথে নয়, ছ-ঘণ্টা পর এক ধাপ', async () => {
    await publish('0.4.10', 'canary');

    // deploy-এর মুহূর্ত: ঘড়ি সবে বসেছে
    const id = await device({
      tag: 'backfilled',
      agentVersion: '0.4.10',
      sinceMs: 1000,
      seenMs: 60_000,
    });

    await job.runOnce();
    expect(await stageOf('0.4.10')).toBe('canary');

    // ছ-ঘণ্টা পার — ঘড়িটা পিছিয়ে দিয়ে সেটাই দেখানো
    await h.prisma.device.update({
      where: { id },
      data: { agentVersionSince: ago((ROLLOUT_SOAK_HOURS + 1) * HOUR_MS) },
    });

    await job.runOnce();
    expect(await stageOf('0.4.10')).toBe('partial');
  });

  it('কোনো ভার্সনই প্রকাশ না হলে চুপচাপ ফেরে', async () => {
    const result = await job.runOnce();
    expect(result).toMatchObject({ version: null, to: null, skipped: false });
  });
});
