import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isOfferedTo } from '../src/agent/rollout';
import { UpdateService } from '../src/agent/update.service';
import {
  createHarness,
  dhakaNoon,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * **H04 · G59** — এজেন্টের নতুন ভার্সন বিলি করার পথ।
 *
 * ⚠️⚠️ `agent_versions` টেবিলটা এতদিন **শুধু পড়া হতো**। পুরো auto-update
 * ব্যবস্থা তৈরি — ধাপে ধাপে অফার, canary, sha256 যাচাই, `halted` দিয়ে
 * থামানো — কিন্তু ওই টেবিলে সারি বসানোর কোনো পথ কোথাও ছিল না। ফলে
 * আজকের MSI ০.২.০ ১৫টা PC-তে পৌঁছানোর একমাত্র উপায় ছিল প্রতিটা মেশিনে
 * হাতে গিয়ে বসানো।
 */
let h: Harness;
let owner: Session;
let root: string;

const MSI = Buffer.from('not really an msi, but bytes are bytes');
const SHA = createHash('sha256').update(MSI).digest('hex');

/** storage রুটের ভেতরে একটা নকল MSI */
async function putMsi(rel: string, body = MSI): Promise<void> {
  const abs = resolve(root, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body);
}

const publish = (body: Record<string, unknown>) =>
  owner.http
    .post('/api/v1/agent-versions')
    .set('X-CSRF-Token', owner.csrf)
    .send(body);

beforeAll(async () => {
  h = await createHarness();
  root = resolve(
    process.env.STORAGE_ROOT ?? join(process.cwd(), '..', '.data', 'storage'),
  );
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
});

describe('POST /agent-versions — বিলির জন্য নথিভুক্ত করা', () => {
  it('ফাইল থেকে sha256 নিজেই হিসাব করে', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const res = await publish({ version: '0.2.0', msiPath: rel });

    expect(res.status).toBe(201);
    // ⭐ হাতে হ্যাশ দিতে হয়নি — এজেন্ট এই সংখ্যাটাই মিলিয়ে দেখবে
    expect(res.body.sha256).toBe(SHA);
    expect(res.body.sizeBytes).toBe(MSI.length);
    // ⚠️ ডিফল্ট canary — একবারে সবাইকে দেওয়াটা আলাদা সিদ্ধান্ত
    expect(res.body.rolloutStage).toBe('canary');
  });

  /**
   * ⚠️ হাতে বসানো হ্যাশে একটা অক্ষর ভুল হলে ১৫টা PC ফাইলটা নামাত,
   * sha256 না মেলায় বাতিল করত, আবার নামাত — চিরকাল।
   */
  it('হাতে দেওয়া ভুল sha256-এ ৪০০', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const res = await publish({
      version: '0.2.0',
      msiPath: rel,
      sha256: 'a'.repeat(64),
    });

    expect(res.status).toBe(400);
    expect(await h.prisma.agentVersion.count()).toBe(0);
  });

  it('ঠিক sha256 দিলে চলে', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const res = await publish({ version: '0.2.0', msiPath: rel, sha256: SHA });
    expect(res.status).toBe(201);
  });

  it('ফাইলটা ডিস্কে না থাকলে ৪০০', async () => {
    const res = await publish({ version: '0.2.0', msiPath: 'updates/nope.msi' });

    expect(res.status).toBe(400);
    expect(await h.prisma.agentVersion.count()).toBe(0);
  });

  /**
   * ⚠️ `update.service.ts`-এর `openMsi()` storage রুটের বাইরের পাথ
   * প্রত্যাখ্যান করে। এখানে না দেখলে ভুলটা ধরা পড়ত ডাউনলোডের সময় —
   * বিলি করার অনেক পরে, ১৫টা PC ব্যর্থ ডাউনলোড করার পর।
   */
  it('storage রুটের বাইরের পাথে ৪০০', async () => {
    const res = await publish({
      version: '0.2.0',
      msiPath: '../../outside.msi',
    });
    expect(res.status).toBe(400);
  });

  /**
   * ⭐ পুরোনো বা সমান ভার্সন বিলি করলে `isNewer()` মিথ্যা হতো, অর্থাৎ
   * কোনো এজেন্টকে কোনোদিন অফার করা হতো না — আর owner ভাবতেন বিলি
   * হয়ে গেছে। নীরব ব্যর্থতা, তাই এখানেই আটকানো।
   */
  it('পুরোনো ভার্সন বিলি করা যায় না', async () => {
    const a = `updates/${randomUUID()}.msi`;
    const b = `updates/${randomUUID()}.msi`;
    await putMsi(a);
    await putMsi(b);

    expect((await publish({ version: '0.3.0', msiPath: a })).status).toBe(201);

    const older = await publish({ version: '0.2.0', msiPath: b });
    expect(older.status).toBe(400);
  });

  it('একই ভার্সন দুবার — ৪০৯', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    expect((await publish({ version: '0.2.0', msiPath: rel })).status).toBe(201);
    expect((await publish({ version: '0.2.0', msiPath: rel })).status).toBe(409);
  });

  it('ভার্সনের ফরম্যাট ভুল হলে ৪০০', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    for (const version of ['0.2', 'v0.2.0', 'latest']) {
      const res = await publish({ version, msiPath: rel });
      expect(res.status, version).toBe(400);
    }
  });

  it('ম্যানেজার পারে না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    const res = await manager.http
      .post('/api/v1/agent-versions')
      .set('X-CSRF-Token', manager.csrf)
      .send({ version: '0.2.0', msiPath: 'updates/x.msi' });

    expect(res.status).toBe(403);
  });

  it('audit_log-এ ওঠে', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);
    await h.prisma.auditLog.deleteMany({});

    await publish({ version: '0.2.0', msiPath: rel });

    const [row] = await h.prisma.auditLog.findMany({
      where: { action: 'publish_agent_version' },
    });
    expect(row.targetId).toBe('0.2.0');
  });
});

describe('POST /agent-versions/:version/stage', () => {
  beforeEach(async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);
    await publish({ version: '0.2.0', msiPath: rel });
  });

  it('ধাপ বদলানো যায়', async () => {
    const res = await owner.http
      .post('/api/v1/agent-versions/0.2.0/stage')
      .set('X-CSRF-Token', owner.csrf)
      .send({ rolloutStage: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.rolloutStage).toBe('all');
  });

  /**
   * ⭐ **সবচেয়ে জরুরি বোতাম।** খারাপ আপডেট বেরিয়ে গেলে স্বয়ংক্রিয়
   * rollback নেই (G69) — যারা পেয়ে গেছে তাদের হাতে ঠিক করতে হবে।
   * কিন্তু এখানে থামালে বাকিরা বেঁচে যায়, আর সেটা সেকেন্ডের কাজ।
   */
  it('halted করলে আর কাউকে অফার হয় না', async () => {
    await owner.http
      .post('/api/v1/agent-versions/0.2.0/stage')
      .set('X-CSRF-Token', owner.csrf)
      .send({ rolloutStage: 'halted' })
      .expect(200);

    const row = await h.prisma.agentVersion.findUniqueOrThrow({
      where: { version: '0.2.0' },
    });
    expect(row.rolloutStage).toBe('halted');
  });

  it('অচেনা ভার্সনে ৪০৪', async () => {
    const res = await owner.http
      .post('/api/v1/agent-versions/9.9.9/stage')
      .set('X-CSRF-Token', owner.csrf)
      .send({ rolloutStage: 'all' });

    expect(res.status).toBe(404);
  });

  it('আগে-পরে দুটোই audit_log-এ', async () => {
    await h.prisma.auditLog.deleteMany({});

    await owner.http
      .post('/api/v1/agent-versions/0.2.0/stage')
      .set('X-CSRF-Token', owner.csrf)
      .send({ rolloutStage: 'all' })
      .expect(200);

    const [row] = await h.prisma.auditLog.findMany({
      where: { action: 'change_agent_rollout' },
    });
    const meta = row.meta as { from: string; to: string };
    expect(meta.from).toBe('canary');
    expect(meta.to).toBe('all');
  });
});

describe('GET /agent-versions', () => {
  it('ফাইল হারিয়ে গেলে সেটা বলে দেয়', async () => {
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);
    await publish({ version: '0.2.0', msiPath: rel });

    // ⚠️ সারি বসানোর পর কেউ ফাইলটা মুছে ফেললে — তালিকায় সেটা দেখা
    //    দরকার, নইলে এজেন্ট নামাতে গিয়ে ৪০৪ পেত আর owner জানতেনই না
    await h.prisma.agentVersion.update({
      where: { version: '0.2.0' },
      data: { msiPath: 'updates/vanished.msi' },
    });

    const res = await owner.http.get('/api/v1/agent-versions').expect(200);

    expect(res.body[0].fileMissing).toBe(true);
    expect(res.body[0].sizeBytes).toBeNull();
  });
});


/**
 * ⭐⭐⭐ **canary-র বালতি খালি হলে ভার্সনটা চিরকাল আটকে থাকত**
 * *(৭ সেপ্টেম্বর ২০২৬, G168)*।
 *
 * ⚠️⚠️ নিয়মটার ইউনিট টেস্ট আছে `rollout.spec.ts`-এ। **এই ব্লকটা কলারের**,
 * আর সেটাই এখানে বেশি জরুরি: এই রেপোতে *"চুক্তি লেখা আছে, কলার লেখা
 * হয়নি"* ভুলটা **দশবার** হয়েছে (G141 · G144 · G146 · G149 · G156 ·
 * G159 · G167)। নিয়ম সবুজ অথচ কেউ ডাকে না — সেটাই এখানকার চেনা পাপ।
 */
describe('G168 — প্রকাশের সময় pilot আপনিই বসে', () => {
  /** ওই মেশিনগুলোর কেউই canary-তে পড়ে না, এমন একটা ভার্সন */
  const emptyCanaryVersion = (guids: readonly string[]): string => {
    for (let i = 0; i < 500; i += 1) {
      const v = `9.0.${i}`;
      if (guids.every((g) => !isOfferedTo('canary', g, v))) return v;
    }
    throw new Error('no version with an empty canary bucket');
  };

  const filledCanaryVersion = (guids: readonly string[]): string => {
    for (let i = 0; i < 500; i += 1) {
      const v = `9.0.${i}`;
      if (guids.some((g) => isOfferedTo('canary', g, v))) return v;
    }
    throw new Error('no version with a filled canary bucket');
  };

  async function makeDevice(
    tag: string,
    status: 'active' | 'revoked' = 'active',
  ): Promise<{ id: number; machineGuid: string }> {
    const machineGuid = `guid-${tag}`;
    const d = await h.prisma.device.create({
      data: {
        hostname: `PC-${tag}`,
        windowsUsername: tag,
        machineGuid,
        tokenHash: randomUUID(),
        status,
        // ⚠️ G140 — স্পেকে `new Date()` নয়; হারনেসের ঘড়ি
        lastSeenAt: dhakaNoon(),
      },
    });
    return { id: d.id, machineGuid };
  }

  const fleet = async () => [
    await makeDevice('a'),
    await makeDevice('b'),
    await makeDevice('c'),
  ];

  /** ⭐⭐⭐ এই ব্লকের মূল টেস্ট */
  it('⭐ বালতি খালি হলে প্রকাশেই একজন pilot বসে', async () => {
    const devices = await fleet();
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = emptyCanaryVersion(devices.map((d) => d.machineGuid));
    const res = await publish({ version, msiPath: rel }).expect(201);

    expect(res.body.pilotDeviceId).not.toBeNull();
    expect(devices.some((d) => d.id === res.body.pilotDeviceId)).toBe(true);
  });

  /** ⚠️ কেউ এমনিতেই পড়লে হস্তক্ষেপ নয় */
  it('⭐ কেউ বালতিতে পড়লে pilot বসে না', async () => {
    const devices = await fleet();
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = filledCanaryVersion(devices.map((d) => d.machineGuid));
    const res = await publish({ version, msiPath: rel }).expect(201);

    expect(res.body.pilotDeviceId).toBeNull();
  });

  /** ⚠️ `all`-এ সবাই এমনিতেই পাচ্ছে — pilot অর্থহীন */
  it('all-এ প্রকাশ করলে pilot বসে না', async () => {
    const devices = await fleet();
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = emptyCanaryVersion(devices.map((d) => d.machineGuid));
    const res = await publish({
      version,
      msiPath: rel,
      rolloutStage: 'all',
    }).expect(201);

    expect(res.body.pilotDeviceId).toBeNull();
  });

  /**
   * ⚠️⚠️ **বাতিল করা PC গিনিপিগ হতে পারে না** — সে তো আপডেটই পায় না
   * (`isOfferedTo`-র আগেই `update.service` তাকে ছেঁকে দেয়), তাই তার
   * কাছ থেকে কোনো প্রমাণ আসবে না আর অচলাবস্থাটা রয়েই যেত।
   */
  it('⭐ বাতিল করা PC pilot হয় না', async () => {
    const revoked = await makeDevice('rev', 'revoked');
    const alive = await makeDevice('live');
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = emptyCanaryVersion([revoked.machineGuid, alive.machineGuid]);
    const res = await publish({ version, msiPath: rel }).expect(201);

    expect(res.body.pilotDeviceId).toBe(alive.id);
  });

  /**
   * ⚠️⚠️ **হাতে ধাপ বদলালেও একই ফাঁদ** — মালিক `all` থেকে `canary`-তে
   * নামালে বালতি আবার খালি হতে পারে।
   */
  it('⭐ হাতে canary-তে নামালেও pilot বসে', async () => {
    const devices = await fleet();
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = emptyCanaryVersion(devices.map((d) => d.machineGuid));
    await publish({ version, msiPath: rel, rolloutStage: 'all' }).expect(201);

    const res = await owner.http
      .post(`/api/v1/agent-versions/${version}/stage`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ rolloutStage: 'canary' })
      .expect(200);

    expect(res.body.pilotDeviceId).not.toBeNull();
    expect(devices.some((d) => d.id === res.body.pilotDeviceId)).toBe(true);
  });

  /**
   * ⚠️⚠️ **মালিকের বাছাই কখনো বদলানো হয় না।** তিনি একটা মেশিন বেছে
   * দিলে সেটাই থাকে — নিজে থেকে বসানোটা কেবল **ফাঁকা ঘর** ভরার জন্য।
   */
  it('⭐ মালিকের বেছে দেওয়া pilot চাপা পড়ে না', async () => {
    const devices = await fleet();
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = emptyCanaryVersion(devices.map((d) => d.machineGuid));
    await publish({ version, msiPath: rel, rolloutStage: 'all' }).expect(201);

    const chosen = devices[devices.length - 1];

    const res = await owner.http
      .post(`/api/v1/agent-versions/${version}/stage`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ rolloutStage: 'canary', pilotDeviceId: chosen.id })
      .expect(200);

    expect(res.body.pilotDeviceId).toBe(chosen.id);
  });

  /**
   * ⭐⭐⭐ **আসল দাবিটা এটাই** — pilot বসেছে কি না তা নয়, **অফারটা
   * সত্যিই যাচ্ছে** কি না। বালতি খালি ছিল, তবু এখন একজন অফার পান।
   *
   * ⚠️ এই টেস্টটা না থাকলে pilot কলামে একটা সংখ্যা বসেই সন্তুষ্ট থাকা
   *    যেত, অথচ `UpdateService` সেটা পড়ে কি না কেউ যাচাই করত না।
   */
  it('⭐⭐ এবং সেই মেশিনটা সত্যিই আপডেটের অফার পায়', async () => {
    const devices = await fleet();
    const rel = `updates/${randomUUID()}.msi`;
    await putMsi(rel);

    const version = emptyCanaryVersion(devices.map((d) => d.machineGuid));
    const res = await publish({ version, msiPath: rel }).expect(201);

    const pilot = devices.find((d) => d.id === res.body.pilotDeviceId)!;
    const updates = h.app.get(UpdateService);

    // ⚠️ pilot — অফার পান
    expect(
      await updates.offerFor('0.0.1', pilot.machineGuid, pilot.id),
    ).not.toBeNull();

    // ⚠️ বাকিরা — এখনো নয়, কারণ ধাপটা এখনো canary
    for (const other of devices.filter((d) => d.id !== pilot.id)) {
      expect(
        await updates.offerFor('0.0.1', other.machineGuid, other.id),
      ).toBeNull();
    }
  });
});
