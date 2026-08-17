import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';

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
  todayWindow,
  type Harness,
} from './setup/harness';

/**
 * **B14 · G35 · ADR-011e** — সিস্টেমের দোষে হারানো ঘণ্টা owner ফেরত দেন।
 *
 * ⚠️⚠️ পড়ার দিকটা মাসের পর মাস সম্পূর্ণ ছিল (`progress.service`,
 * `summary.service`, `payroll.math`, `reports`) — শুধু **লেখার পথ ছিল না**,
 * তাই যোগফলটা চিরকাল ০ থাকত আর কোথাও কোনো ভুল দেখাত না। এই টেস্টগুলো
 * সেই পথটার পাহারা।
 */
let h: Harness;
let employeeId: number;

/** ঢাকার আজকের তারিখ — ⚠️ UTC নয় (G62 · § ৩ঘ) */
const todayDhaka = (): string =>
  new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);

  const policy = await h.prisma.workPolicy.create({
    data: { name: 'test', monthlyTargetHours: 208, isActive: true },
  });

  const employee = await h.prisma.employee.create({
    data: { empCode: 'OX-77', fullName: 'Adjust Test', policyId: policy.id },
  });

  employeeId = employee.id;
});

const body = (over: Record<string, unknown> = {}) => ({
  workDate: todayDhaka(),
  deltaSec: 7200,
  cause: 'agent_down',
  reason: 'Agent was down all morning after the power cut',
  ...over,
});

describe('ঘণ্টা ফেরত দেওয়া', () => {
  it('owner সংশোধন বসাতে পারে', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body());

    expect(res.status).toBe(201);
    expect(res.body.deltaSec).toBe(7200);
    expect(res.body.active).toBe(true);
    // ⚠️ BigInt স্ট্রিং হয়ে আসা চাই — নইলে JSON.stringify ৫০০ দিত
    expect(typeof res.body.id).toBe('string');
  });

  /**
   * ⭐⭐ এটাই মডিউলটার আসল কারণ: সংশোধন **কাঁচা সেগমেন্ট ছোঁয় না**, কিন্তু
   * tray-র সংখ্যায় সাথে সাথে যোগ হয় (`progress.service` সরাসরি
   * `time_adjustments` পড়ে)।
   */
  it('heartbeat-এর pace-এ সাথে সাথেই যোগ হয়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    /**
     * ⚠️⚠️ **কর্মীকে একটা ট্র্যাকিং-বেসলাইন দিতে হয়, নইলে টেস্টটা যা মাপতে
     * চায় তা মাপে না।**
     *
     * এই টেস্টের দাবি: সংশোধনের `deltaSec` **সরাসরি** pace-এ যোগ হয়, তাই
     * ডেল্টা ঠিক ৩৬০০। কিন্তু `trackingStartedOn` আসে কর্মীর **প্রথম**
     * `daily_summary` সারি থেকে (`progress.service` → `firstSeen`)। বেসলাইন
     * না থাকলে সংশোধন POST করার সময় `AdjustmentsService.refresh()` **আজকের**
     * তারিখে প্রথম সারিটা বানিয়ে দেয় — আর তখন elapsed-উইন্ডো আজ থেকে শুরু
     * হয়ে **খালি** হয়ে যায়, expected ৪৬০৮০০ → ০-তে নামে। ফলে ডেল্টায়
     * ৩৬০০ নয়, গোটা মাসের প্রত্যাশাটাই চলে আসত (মেপে দেখা: before=−460800,
     * after=3600)। সংখ্যাটা রোজ বাড়ত বলে CI-ও রোজ লাল হতো।
     *
     * ⭐ মাসের শুরুতে একটা `daily_summary` বসিয়ে দিলে `firstSeen` **স্থির**
     * থাকে (আজকের নতুন সারিও min বদলায় না), তাই একমাত্র যা বদলায় তা
     * `creditedSec` — ঠিক ৩৬০০। এটাই বাস্তবের ছবি: আসল কর্মীর সবসময়ই
     * আগের দিনের ট্র্যাকিং থাকে।
     */
    const dhakaNow = new Date(Date.now() + 6 * 3600_000);
    const monthStart = new Date(
      Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth(), 1),
    );
    await h.prisma.dailySummary.create({
      data: { employeeId, workDate: monthStart, workedSec: 0 },
    });

    const before = await h.app
      .get<{ forEmployee: (id: number) => Promise<{ paceSec: number }> }>(
        (await import('../src/agent/progress.service')).ProgressService,
      )
      .forEmployee(employeeId);

    await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body({ deltaSec: 3600 }))
      .expect(201);

    const after = await h.app
      .get<{ forEmployee: (id: number) => Promise<{ paceSec: number }> }>(
        (await import('../src/agent/progress.service')).ProgressService,
      )
      .forEmployee(employeeId);

    expect(after.paceSec - before.paceSec).toBe(3600);
  });

  it('কাঁচা সেগমেন্ট অটুট থাকে', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    const before = await h.prisma.activitySegment.count();

    await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body())
      .expect(201);

    expect(await h.prisma.activitySegment.count()).toBe(before);
  });

  it('ঋণাত্মক সংশোধনও বসে (কেটে নেওয়া)', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body({ deltaSec: -1800, cause: 'other' }));

    expect(res.status).toBe(201);
    expect(res.body.deltaSec).toBe(-1800);
  });
});

describe('যা মেনে নেওয়া হয় না', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['শূন্য delta', { deltaSec: 0 }],
    ['২৪ ঘণ্টার বেশি', { deltaSec: 86_401 }],
    ['−২৪ ঘণ্টার বেশি', { deltaSec: -86_401 }],
    ['কারণ ছাড়া', { reason: '' }],
    ['খুব ছোট কারণ', { reason: 'ok' }],
    ['অচেনা cause', { cause: 'because' }],
    ['ভুল তারিখ', { workDate: '12-08-2026' }],
  ];

  for (const [name, over] of bad) {
    it(`${name} → ৪০০`, async () => {
      const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

      const res = await s.http
        .post(`/api/v1/employees/${employeeId}/time-adjustments`)
        .set('X-CSRF-Token', s.csrf)
        .send(body(over));

      expect(res.status).toBe(400);
    });
  }

  /**
   * ⚠️ `deltaSec` একটা `Int`। কেউ সেকেন্ডের জায়গায় মিলিসেকেন্ড বসালে
   * (৭২,০০,০০০) সেটা নীরবে ঢুকে মাসে ২,০০০ ঘণ্টা যোগ করত।
   */
  it('মিলিসেকেন্ড বসালে ধরা পড়ে', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body({ deltaSec: 7_200_000 }));

    expect(res.status).toBe(400);
  });

  it('ভবিষ্যতের দিন → ৪০০', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body({ workDate: later }));

    expect(res.status).toBe(400);
  });

  it('অচেনা কর্মী → ৪০৪', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post('/api/v1/employees/999999/time-adjustments')
      .set('X-CSRF-Token', s.csrf)
      .send(body());

    expect(res.status).toBe(404);
  });
});

describe('বাতিল করা', () => {
  it('revoke-এ গোনা বন্ধ হয়, সারি থেকে যায়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const created = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body())
      .expect(201);

    const res = await s.http
      .post(`/api/v1/time-adjustments/${created.body.id}/revoke`)
      .set('X-CSRF-Token', s.csrf)
      .send({ reason: 'Counted twice by mistake' });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(res.body.revokeReason).toBe('Counted twice by mistake');

    // ⚠️ ডিলিট নয় — সারিটা থেকে যায়, নইলে ইতিহাস হারাত
    expect(await h.prisma.timeAdjustment.count()).toBe(1);
  });

  it('দুবার বাতিল করা যায় না', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const created = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body())
      .expect(201);

    await s.http
      .post(`/api/v1/time-adjustments/${created.body.id}/revoke`)
      .set('X-CSRF-Token', s.csrf)
      .send({ reason: 'first' })
      .expect(200);

    const again = await s.http
      .post(`/api/v1/time-adjustments/${created.body.id}/revoke`)
      .set('X-CSRF-Token', s.csrf)
      .send({ reason: 'second' });

    expect(again.status).toBe(400);
  });
});

describe('কে দেখতে পায় (J08)', () => {
  it('ম্যানেজার দেখতে পায়, বসাতে পারে না', async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await owner.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', owner.csrf)
      .send(body())
      .expect(201);

    const m = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    const read = await m.http.get(
      `/api/v1/employees/${employeeId}/time-adjustments`,
    );
    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);

    const write = await m.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', m.csrf)
      .send(body());
    expect(write.status).toBe(403);
  });

  it('লগইন ছাড়া বন্ধ', async () => {
    const res = await h
      .http()
      .get(`/api/v1/employees/${employeeId}/time-adjustments`);

    expect(res.status).toBe(401);
  });
});

describe('অডিট', () => {
  it('বসানো ও বাতিল — দুটোই আলাদা action-এ বসে', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const created = await s.http
      .post(`/api/v1/employees/${employeeId}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body())
      .expect(201);

    await s.http
      .post(`/api/v1/time-adjustments/${created.body.id}/revoke`)
      .set('X-CSRF-Token', s.csrf)
      .send({ reason: 'wrong day' })
      .expect(200);

    const rows = await h.prisma.auditLog.findMany({
      where: { targetId: String(employeeId) },
    });

    const actions = rows.map((r) => r.action);
    expect(actions).toContain('time_adjustment');
    expect(actions).toContain('time_adjustment_revoke');

    // ⭐ কারণটা audit-এও থাকা চাই — সারি বাতিল হলেও কেন হয়েছিল তা থেকে যায়
    expect(JSON.stringify(rows)).toContain('power cut');
  });
});

describe('সেগমেন্টের সাথে মিলিয়ে', () => {
  /**
   * ⭐ `credited = worked + adjustment` — payroll ও pace দুটোই এই যোগের
   * উপর দাঁড়ানো (§ ২.১-ঙ · G35)।
   *
   * ⚠️ সেগমেন্টটা **আসল ingest পথ দিয়ে** ঢোকানো হয়, হাতে সারি বসিয়ে নয়:
   * `activity_segments`-এর `sessionId` ও `deviceId` দুটোই বাধ্যতামূলক, আর
   * হাতে বসাতে গেলে সেশন-সীমানার নিয়মগুলো (§ ২.১-ক) এড়িয়ে যাওয়া হতো।
   */
  it('worked সময়ের সাথে যোগ হয়, বদলে দেয় না', async () => {
    const { employeeId: withDevice, code } = await createEmployeeWithCode(
      h.prisma,
      'OX-78',
    );
    const device = await enrollDevice(h, code);
    const worked = todayWindow(1800);

    await h
      .http()
      .post('/api/v1/agent/segments')
      .set('Authorization', `Bearer ${device.token}`)
      .set('X-Client-Time', new Date().toISOString())
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: worked.startedAt.toISOString(),
            endedAt: worked.endedAt.toISOString(),
            durationSec: worked.durationSec,
          },
        ],
      })
      .expect(200);

    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    await s.http
      .post(`/api/v1/employees/${withDevice}/time-adjustments`)
      .set('X-CSRF-Token', s.csrf)
      .send(body({ deltaSec: 1800 }))
      .expect(201);

    const summary = await h.prisma.dailySummary.findFirst({
      where: { employeeId: withDevice },
    });

    // ⭐ দুটোই বসা চাই: কাঁচা কাজ আর সংশোধন — একটা আরেকটাকে বদলায় না
    //
    // ⚠️⚠️ `worked.durationSec`, হার্ডকোড `1800` নয়। `todayWindow()`
    //    মধ্যরাতের কাছে জানালাটা **ঢাকার আজকের দিনে ক্ল্যাম্প** করে, তাই
    //    ০০:০১-এ চললে সেটা ১৮০০ সে. নয়, বড়জোর ৫৮ সে. দেয় (harness § টীকা)।
    //    যা পাঠানো হয়েছে ঠিক সেটাই মেলানো হয়, নইলে টেস্টটা রোজ মধ্যরাতে
    //    ~২ মিনিটের জানালায় লাল হতো (CI ঠিক ওই সময়েই চলেছিল — § ৩ব)।
    expect(summary?.activeSec).toBe(worked.durationSec);
    expect(summary?.adjustmentSec).toBe(1800);
  });
});
