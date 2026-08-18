import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness,
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
 * **MSI নামানো — হাতে বসানোর জন্য** *(১৮ আগস্ট)*।
 *
 * ⚠️⚠️ কেন দরকার হলো: ০.৪.১-এর **আগের** এজেন্টে tray-তে "Install update"
 * মেনুটাই নেই। ফ্লিটের ১১টা PC ০.৩.৭/০.৩.৮-এ, তাই সার্ভার অফার পাঠালেও
 * ওখানে কিছুই দেখা যায় না — একবার হাতে বসাতেই হবে। অথচ MSI-টা **হাতে
 * পাওয়ার কোনো পথই ছিল না**: `/agent/update/download` শুধু ডিভাইস-টোকেনে
 * খোলে, আর owner-এর কাছে টোকেন থাকে না।
 */
let h: Harness;
let owner: Session;

const CONTENT = Buffer.from('not-a-real-msi-but-bytes-are-bytes');
const SHA = createHash('sha256').update(CONTENT).digest('hex');

async function publishVersion(version: string, relPath: string) {
  // ⚠️ ফাইলটা সত্যিই ডিস্কে থাকতে হবে — publish নিজেই hash মিলিয়ে দেখে
  const root = process.env.STORAGE_ROOT!;
  await mkdir(join(root, 'updates'), { recursive: true });
  await writeFile(join(root, relPath), CONTENT);

  await owner.http
    .post('/api/v1/agent-versions')
    .set('X-CSRF-Token', owner.csrf)
    .send({ version, msiPath: relPath, sha256: SHA })
    .expect(201);
}

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
});

describe('GET /agent-versions/:version/download', () => {
  it('owner MSI নামাতে পারেন, আর বাইটগুলো অবিকল', async () => {
    await publishVersion('9.9.9', 'updates/oXeioAgent-9.9.9.msi');

    const res = await owner.http
      .get('/api/v1/agent-versions/9.9.9/download')
      // ⚠️ `responseType('blob')` ছাড়া superagent অচেনা content-type-এর
      //    বডি বাফারই করে না — `res.body` খালি অবজেক্ট হয়ে আসত, আর
      //    টেস্টটা ভুল কারণে ফেল করত।
      .responseType('blob')
      .expect(200);

    expect(Buffer.from(res.body as Buffer).equals(CONTENT)).toBe(true);
    expect(res.headers['content-disposition']).toContain('oXeioAgent-9.9.9.msi');
  });

  /** ⭐ ইনস্টলার হাতে হাতে ঘোরার আগে "কে কোনটা নামাল" জানা দরকার */
  it('নামানোটা audit_log-এ ওঠে', async () => {
    await publishVersion('9.9.9', 'updates/oXeioAgent-9.9.9.msi');
    await owner.http.get('/api/v1/agent-versions/9.9.9/download').expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'agent_version.download' },
    });
    expect(row.targetId).toBe('9.9.9');
  });

  /**
   * ⚠️ ম্যানেজারও নয় — গোটা কন্ট্রোলারই owner-only। ১৫টা PC-তে কী
   * সফটওয়্যার চলবে সেটা মালিকের সিদ্ধান্ত, আর ইনস্টলার বিলি করাটাও
   * ওই সিদ্ধান্তেরই অংশ।
   */
  it('ম্যানেজার পারেন না', async () => {
    await publishVersion('9.9.9', 'updates/oXeioAgent-9.9.9.msi');

    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await manager.http.get('/api/v1/agent-versions/9.9.9/download').expect(403);
  });

  it('অচেনা ভার্সনে ৪০৪', async () => {
    await owner.http.get('/api/v1/agent-versions/1.2.3/download').expect(404);
  });

  /**
   * ⚠️⚠️ ফাইলটা storage-এর **ভেতরেই** থাকতে হবে। এই পাহারাটা
   * `UpdateService.openMsi()`-তে বসানো, আর সেটাই এখানে পুনর্ব্যবহার করা
   * হয়েছে — নিজে path জোড়া লাগালে পাহারাটা দুই জায়গায় থাকত, আর একদিন
   * একটায় ঠিক হতো অন্যটায় নয়।
   */
  it('storage-এর বাইরের পাথ ধরা পড়ে', async () => {
    await h.prisma.agentVersion.create({
      data: {
        version: '9.9.8',
        msiPath: '../../../etc/passwd',
        sha256: SHA,
        rolloutStage: 'canary',
      },
    });

    await owner.http.get('/api/v1/agent-versions/9.9.8/download').expect(404);
  });
});
