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
 * **"Seen all" — একসাথে সব খোলা অ্যালার্ট acknowledge।**
 *
 * ⚠️⚠️ মালিকের অভিযোগ থেকে: G01 ("এজেন্ট চুপ") ১২টা PC-তে বারবার এলে
 * ১১৮টা ওয়ার্নিং জমে, আর এক-এক করে "Seen" চাপা যন্ত্রণা।
 *
 * ⭐ এই ফাইলটা দুটো জিনিস পাহারা দেয়: বাল্ক-ack **সত্যিই** সব খোলা সারি
 * ছোঁয়, আর **আগে দেখা** সারির ইতিহাস (কে প্রথম দেখেছিল) অটুট রাখে।
 */
let h: Harness;
let owner: Session;

async function seedAlert(overrides: Record<string, unknown> = {}) {
  return h.prisma.alert.create({
    data: {
      type: 'agent_down',
      severity: 'warning',
      title: 'Agent silent — TEST',
      channelsSent: ['log'],
      ...overrides,
    },
  });
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

const ackAll = () =>
  owner.http
    .post('/api/v1/alerts/acknowledge-all')
    .set('X-CSRF-Token', owner.csrf);

describe('POST /alerts/acknowledge-all', () => {
  /** ⭐⭐ মূল দাবি — সব খোলা সারি এক ক্লিকে seen হয়। */
  it('সব খোলা অ্যালার্ট একসাথে acknowledge হয়', async () => {
    await seedAlert();
    await seedAlert();
    await seedAlert();

    const res = await ackAll().expect(200);
    expect(res.body.count).toBe(3);

    const open = await h.prisma.alert.count({ where: { acknowledgedAt: null } });
    expect(open).toBe(0);
  });

  /**
   * ⚠️⚠️ **আগে দেখা সারি ছোঁয়া হয় না।** নইলে "কে প্রথম দেখেছিল" ইতিহাসটা
   * এই এক ক্লিকে মুছে যেত — আর ঘণ্টা-সংশোধনের প্রমাণও নড়ে যেত।
   */
  it('আগে acknowledge করা সারির ইতিহাস অটুট থাকে', async () => {
    // ⚠️ সরাসরি একটা **আগে-দেখা** সারি বসানো — কে ও কখন দেখেছিল, নির্দিষ্ট
    //    করে। (কন্ট্রোলার owner-only, তাই ম্যানেজার দিয়ে ack করানো যায় না।)
    const seenBy = await h.prisma.user.findFirstOrThrow({
      where: { email: MANAGER_EMAIL },
    });
    const seenAt = new Date('2026-08-01T04:00:00.000Z');
    const already = await seedAlert({
      acknowledgedById: seenBy.id,
      acknowledgedAt: seenAt,
    });

    await seedAlert(); // একটা এখনো খোলা

    const res = await ackAll().expect(200);
    // শুধু বাকি একটাই গোনা হয়, আগেরটা নয়
    expect(res.body.count).toBe(1);

    const after = await h.prisma.alert.findUniqueOrThrow({
      where: { id: already.id },
    });
    expect(after.acknowledgedById).toBe(seenBy.id); // owner-এ বদলায়নি
    expect(after.acknowledgedAt?.getTime()).toBe(seenAt.getTime());
  });

  it('কিছু খোলা না থাকলে count শূন্য, এরর নয়', async () => {
    const res = await ackAll().expect(200);
    expect(res.body.count).toBe(0);
  });

  /** ⚠️ owner-only — ম্যানেজারও নয় (কন্ট্রোলারের `@Roles(owner)`) */
  it('ম্যানেজার পারেন না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await manager.http
      .post('/api/v1/alerts/acknowledge-all')
      .set('X-CSRF-Token', manager.csrf)
      .expect(403);
  });

  /**
   * ⚠️ রুট-মেলানোর ফাঁদ: `acknowledge-all` যেন `:id/acknowledge`-এর
   * `:id` হিসেবে না পড়ে। পড়লে এটা "acknowledge-all নামের অ্যালার্ট খুঁজে
   * পাওয়া গেল না" ৪০৪/৪০০ দিত। ২০০ + count মানে সঠিক রুটে গেছে।
   */
  it('acknowledge-all আলাদা রুট, :id হিসেবে পড়ে না', async () => {
    await seedAlert();
    const res = await ackAll().expect(200);
    expect(res.body).toHaveProperty('count');
  });
});
