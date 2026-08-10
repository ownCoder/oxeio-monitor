import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
  iso,
  minutesAgo,
  resetDatabase,
  type EnrolledDevice,
  type Harness,
} from './setup/harness';

let h: Harness;
let code: string;
let device: EnrolledDevice;

const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

/** এজেন্টের প্রতিটি রিকোয়েস্টে যা সবসময় থাকে: টোকেন + নিজের ঘড়ির সময় */
function asAgent<T extends { set(field: string, val: string): T }>(
  req: T,
  token: string,
): T {
  return req
    .set('Authorization', `Bearer ${token}`)
    .set('X-Client-Time', iso(new Date()));
}

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma);
  ({ code } = await createEmployeeWithCode(h.prisma));
  device = await enrollDevice(h, code);
});

describe('enrollment (H05)', () => {
  it('ভুল কোডে 401', async () => {
    await h
      .http()
      .post('/api/v1/agent/enroll')
      .send({
        enrollmentCode: 'WRONGCODE',
        hostname: 'PC-08',
        windowsUsername: 'x',
        machineGuid: 'guid-x',
      })
      .expect(401);
  });

  it('সঠিক কোডে টোকেন ও কনফিগ আসে', async () => {
    expect(device.token.length).toBeGreaterThan(20);
    expect(device.configVersion).toBeTruthy();
  });

  it('কোড একবারই ব্যবহার করা যায়', async () => {
    await h
      .http()
      .post('/api/v1/agent/enroll')
      .send({
        enrollmentCode: code,
        hostname: 'PC-07',
        windowsUsername: 'rakib',
        machineGuid: 'guid-test-001',
      })
      .expect(401);
  });

  it('টোকেন plaintext-এ জমা হয় না (I02)', async () => {
    const row = await h.prisma.device.findFirstOrThrow({
      where: { id: device.deviceId },
    });
    expect(row.tokenHash).not.toBe(device.token);
    expect(row.tokenHash).toHaveLength(64); // sha256 hex
  });
});

describe('device auth', () => {
  it('টোকেন ছাড়া 401', async () => {
    await h.http().get('/api/v1/agent/config').expect(401);
  });

  it('ভুল টোকেনে 401', async () => {
    await h
      .http()
      .get('/api/v1/agent/config')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
  });

  it('সঠিক টোকেনে কনফিগ আসে, ক্যাপচার উইন্ডো সহ', async () => {
    const res = await asAgent(
      h.http().get('/api/v1/agent/config'),
      device.token,
    ).expect(200);

    expect(res.body.config.screenshotFrom).toBe('07:00');
    expect(res.body.config.screenshotTo).toBe('23:00');
    expect(res.body.config.idleThresholdSec).toBe(60);
  });

  it('revoke করা ডিভাইস 403 পায় (H06)', async () => {
    await h.prisma.device.update({
      where: { id: device.deviceId },
      data: { status: 'revoked' },
    });

    const res = await asAgent(
      h.http().get('/api/v1/agent/config'),
      device.token,
    ).expect(403);
    expect(res.body.command).toBe('revoke');
  });
});

describe('heartbeat', () => {
  it('কনফিগ ভার্সন মিললে কোনো কমান্ড নেই', async () => {
    const res = await asAgent(
      h.http().post('/api/v1/agent/heartbeat'),
      device.token,
    )
      .send({
        state: 'active',
        activeSecToday: 1200,
        queueDepth: 0,
        configVersion: device.configVersion,
      })
      .expect(200);

    expect(res.body.commands).toEqual([]);
  });

  /**
   * ⭐ এজেন্ট নিজে মাসের হিসাব জানে না — রিবুটের পর তার কাউন্টার শূন্য থেকে
   * শুরু হয়। সংখ্যাটা সার্ভার না দিলে tray-তে "০ ঘ / ২০৮ঘ" দেখাত, আর স্টাফ
   * ভাবত তার মাসের কাজ মুছে গেছে।
   */
  it('heartbeat-এ মাসিক অগ্রগতি ফেরত আসে', async () => {
    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: iso(minutesAgo(30)),
            endedAt: iso(minutesAgo(20)),
            durationSec: 600,
          },
        ],
      })
      .expect(200);

    const res = await asAgent(
      h.http().post('/api/v1/agent/heartbeat'),
      device.token,
    )
      .send({ state: 'active', activeSecToday: 600, queueDepth: 0 })
      .expect(200);

    expect(res.body.progress).toBeTruthy();
    expect(res.body.progress.todayActiveSec).toBe(600);
    expect(res.body.progress.monthActiveSec).toBe(600);
    expect(res.body.progress.monthlyTargetHours).toBe(208);
  });

  it('ভার্সন না মিললে reload_config', async () => {
    const res = await asAgent(
      h.http().post('/api/v1/agent/heartbeat'),
      device.token,
    )
      .send({ state: 'active', activeSecToday: 1, configVersion: 'stale' })
      .expect(200);

    expect(res.body.commands).toContain('reload_config');
  });

  it('last_seen_at হালনাগাদ হয় (G01-এর ভিত্তি)', async () => {
    const before = await h.prisma.device.findFirstOrThrow({
      where: { id: device.deviceId },
    });
    await new Promise((r) => setTimeout(r, 20));

    await asAgent(h.http().post('/api/v1/agent/heartbeat'), device.token)
      .send({ state: 'active', activeSecToday: 5 })
      .expect(200);

    const after = await h.prisma.device.findFirstOrThrow({
      where: { id: device.deviceId },
    });
    expect(after.lastSeenAt!.getTime()).toBeGreaterThan(
      before.lastSeenAt!.getTime(),
    );
  });
});

describe('segments — dedupe ও যাচাই (§ ২.১-ঘ)', () => {
  const segment = (over: Record<string, unknown> = {}) => ({
    clientUuid: randomUUID(),
    state: 'active',
    startedAt: iso(minutesAgo(30)),
    endedAt: iso(minutesAgo(20)),
    durationSec: 600,
    ...over,
  });

  it('client_uuid না থাকলে 422', async () => {
    const { clientUuid, ...withoutUuid } = segment();
    void clientUuid;

    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({ segments: [withoutUuid] })
      .expect(422);
  });

  it('একই ব্যাচ দুবার পাঠালে দ্বিতীয়বার সব duplicate', async () => {
    const batch = {
      segments: [
        segment({ inputScore: 72 }),
        segment({
          state: 'idle',
          startedAt: iso(minutesAgo(20)),
          endedAt: iso(minutesAgo(18)),
          durationSec: 120,
        }),
      ],
    };

    const first = await asAgent(
      h.http().post('/api/v1/agent/segments'),
      device.token,
    )
      .send(batch)
      .expect(200);
    expect(first.body).toMatchObject({ accepted: 2, duplicates: 0 });

    const second = await asAgent(
      h.http().post('/api/v1/agent/segments'),
      device.token,
    )
      .send(batch)
      .expect(200);
    expect(second.body).toMatchObject({ accepted: 0, duplicates: 2 });
  });

  it('counts_as_work শুধু active-এ সত্যি', async () => {
    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({
        segments: [
          segment(),
          segment({
            state: 'idle',
            startedAt: iso(minutesAgo(15)),
            endedAt: iso(minutesAgo(10)),
            durationSec: 300,
          }),
          segment({
            state: 'locked',
            startedAt: iso(minutesAgo(10)),
            endedAt: iso(minutesAgo(9)),
            durationSec: 60,
          }),
        ],
      })
      .expect(200);

    const rows = await h.prisma.activitySegment.findMany({
      orderBy: { startedAt: 'asc' },
    });
    expect(rows.map((r) => [r.state, r.countsAsWork])).toEqual([
      ['active', true],
      ['idle', false],
      ['locked', false],
    ]);
  });

  it('৫০০-র বেশি রেকর্ড হলে 400', async () => {
    const segments = Array.from({ length: 501 }, () => segment());
    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({ segments })
      .expect(400);
  });
});

describe('মধ্যরাতে ভাগ (§ ২.১-ক)', () => {
  it('২৩:৫০ → ০০:১০ একটি সেগমেন্ট দুই তারিখে ভাগ হয়', async () => {
    const res = await asAgent(
      h.http().post('/api/v1/agent/segments'),
      device.token,
    )
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            // ১৭:৫০Z = ঢাকায় ২৩:৫০ · ১৮:১০Z = পরদিন ০০:১০
            startedAt: '2026-08-08T17:50:00.000Z',
            endedAt: '2026-08-08T18:10:00.000Z',
            durationSec: 1200,
          },
        ],
      })
      .expect(200);

    expect(res.body).toMatchObject({ accepted: 2, split: 1 });

    const rows = await h.prisma.activitySegment.findMany({
      orderBy: { startedAt: 'asc' },
    });
    expect(rows.map((r) => r.workDate.toISOString().slice(0, 10))).toEqual([
      '2026-08-08',
      '2026-08-09',
    ]);
    // ভাগ হলেও মোট সময় অটুট থাকে
    expect(rows[0].durationSec + rows[1].durationSec).toBe(1200);
    // দুই টুকরোর client_uuid আলাদা, নইলে UNIQUE-এ আটকাত
    expect(rows[0].clientUuid).not.toBe(rows[1].clientUuid);

    const split = await h.prisma.event.findFirst({
      where: { type: 'segment_split' },
    });
    expect(split).not.toBeNull();
  });

  it('ভাগ হওয়া রেকর্ড আবার পাঠালেও ডুপ্লিকেট হয় না', async () => {
    const batch = {
      segments: [
        {
          clientUuid: randomUUID(),
          state: 'active',
          startedAt: '2026-08-08T17:50:00.000Z',
          endedAt: '2026-08-08T18:10:00.000Z',
          durationSec: 1200,
        },
      ],
    };

    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send(batch)
      .expect(200);
    const again = await asAgent(
      h.http().post('/api/v1/agent/segments'),
      device.token,
    )
      .send(batch)
      .expect(200);

    expect(again.body).toMatchObject({ accepted: 0, duplicates: 2 });
    expect(await h.prisma.activitySegment.count()).toBe(2);
  });
});

describe('clock drift (§ ২)', () => {
  it('এজেন্টের ঘড়ি পিছিয়ে থাকলে সার্ভার সময় সংশোধন করে', async () => {
    const clientNow = minutesAgo(10); // PC-র ঘড়ি ১০ মিনিট পিছিয়ে
    const clientStart = new Date(clientNow.getTime() - 5 * 60_000);

    await h
      .http()
      .post('/api/v1/agent/segments')
      .set('Authorization', `Bearer ${device.token}`)
      .set('X-Client-Time', iso(clientNow))
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: iso(clientStart),
            endedAt: iso(clientNow),
            durationSec: 300,
          },
        ],
      })
      .expect(200);

    const row = await h.prisma.activitySegment.findFirstOrThrow();
    // সংশোধনের পর শেষ সময়টা "এখন"-এর কাছাকাছি হওয়ার কথা, ১০ মিনিট আগে নয়
    const gapSec = Math.abs((Date.now() - row.endedAt.getTime()) / 1000);
    expect(gapSec).toBeLessThan(60);

    const dev = await h.prisma.device.findFirstOrThrow({
      where: { id: device.deviceId },
    });
    expect(dev.lastDriftSec).toBeGreaterThan(500);
  });

  it('drift ৫ মিনিটের বেশি হলে একটাই অ্যালার্ট তৈরি হয়', async () => {
    const clientNow = minutesAgo(30);

    for (let i = 0; i < 3; i++) {
      await h
        .http()
        .post('/api/v1/agent/heartbeat')
        .set('Authorization', `Bearer ${device.token}`)
        .set('X-Client-Time', iso(clientNow))
        .send({ state: 'active', activeSecToday: 10 })
        .expect(200);
    }

    // ৩ বার পাঠালেও ৬ ঘণ্টায় একটাই — নইলে দিনে হাজারখানেক অ্যালার্ট হতো
    const alerts = await h.prisma.alert.findMany({
      where: { type: 'clock_drift' },
    });
    expect(alerts).toHaveLength(1);
  });
});

describe('work session', () => {
  it('logoff সেশন বন্ধ করে', async () => {
    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: iso(minutesAgo(30)),
            endedAt: iso(minutesAgo(20)),
            durationSec: 600,
          },
        ],
      })
      .expect(200);

    await asAgent(h.http().post('/api/v1/agent/events'), device.token)
      .send({
        events: [
          { clientUuid: randomUUID(), type: 'logoff', occurredAt: iso(new Date()) },
        ],
      })
      .expect(200);

    const session = await h.prisma.workSession.findFirstOrThrow();
    expect(session.endedAt).not.toBeNull();
    expect(session.endReason).toBe('logoff');
  });

  /**
   * G43 — অফলাইন queue রিপ্লেতে পুরোনো ব্যাচ নতুনের **পরে** আসে।
   * আগে এতে চলতি সেশন অতীতের সময়ে বন্ধ হয়ে ended_at < started_at হয়ে যেত।
   */
  it('ক্রম উল্টে এলেও সেশনের সীমা ভাঙে না', async () => {
    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: iso(minutesAgo(30)),
            endedAt: iso(minutesAgo(20)),
            durationSec: 600,
          },
        ],
      })
      .expect(200);

    // এখন অনেক পুরোনো (গতকালের) ব্যাচ এল
    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: '2026-08-08T17:50:00.000Z',
            endedAt: '2026-08-08T18:10:00.000Z',
            durationSec: 1200,
          },
        ],
      })
      .expect(200);

    await asAgent(h.http().post('/api/v1/agent/events'), device.token)
      .send({
        events: [
          { clientUuid: randomUUID(), type: 'logoff', occurredAt: iso(new Date()) },
        ],
      })
      .expect(200);

    const sessions = await h.prisma.workSession.findMany();
    for (const s of sessions) {
      expect(s.endedAt).not.toBeNull();
      expect(s.endedAt!.getTime()).toBeGreaterThan(s.startedAt.getTime());
    }

    // প্রতিটি সেগমেন্ট তার সেশনের সীমার ভেতরে থাকতে হবে
    const segments = await h.prisma.activitySegment.findMany();
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const seg of segments) {
      const s = byId.get(seg.sessionId)!;
      expect(seg.startedAt.getTime()).toBeGreaterThanOrEqual(
        s.startedAt.getTime(),
      );
      expect(seg.endedAt.getTime()).toBeLessThanOrEqual(s.endedAt!.getTime());
    }

    // গতকালের সেশন আজকের logoff দিয়ে নয়, নিজের মধ্যরাতেই বন্ধ হবে
    const yesterday = sessions.find(
      (s) => s.workDate.toISOString().slice(0, 10) === '2026-08-08',
    )!;
    expect(yesterday.endReason).toBe('day_rollover');
    expect(yesterday.endedAt!.toISOString()).toBe('2026-08-08T18:00:00.000Z');
  });
});

describe('app usage ও events', () => {
  it('app usage জমা হয়, ডোমেইনসহ', async () => {
    const res = await asAgent(
      h.http().post('/api/v1/agent/app-usage'),
      device.token,
    )
      .send({
        items: [
          {
            clientUuid: randomUUID(),
            startedAt: iso(minutesAgo(9)),
            endedAt: iso(minutesAgo(4)),
            durationSec: 300,
            processName: 'chrome.exe',
            appName: 'Google Chrome',
            windowTitle: 'GitHub',
            domain: 'github.com',
            isBrowser: true,
          },
        ],
      })
      .expect(200);

    expect(res.body.accepted).toBe(1);
    const row = await h.prisma.appUsage.findFirstOrThrow();
    expect(row.domain).toBe('github.com');
    // ক্যাটাগরি মেলানো Phase 4-এ
    expect(row.categoryId).toBeNull();
  });

  it('event জমা হয়', async () => {
    const res = await asAgent(
      h.http().post('/api/v1/agent/events'),
      device.token,
    )
      .send({
        events: [
          {
            clientUuid: randomUUID(),
            type: 'lock',
            occurredAt: iso(minutesAgo(3)),
          },
        ],
      })
      .expect(200);

    expect(res.body.accepted).toBe(1);
  });
});

describe('screenshots', () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    clientUuid: randomUUID(),
    slotStart: iso(minutesAgo(5)),
    capturedAt: iso(minutesAgo(4)),
    monitorIndex: 0,
    width: 1920,
    height: 1080,
    activeApp: 'code.exe',
    activeTitle: 'main.ts',
    ...over,
  });

  it('webp ছাড়া অন্য ফরম্যাট 400 (ADR-007)', async () => {
    await asAgent(h.http().post('/api/v1/agent/screenshots'), device.token)
      .field('meta', JSON.stringify(meta()))
      .attach('file', WEBP, { filename: 'shot.png', contentType: 'image/png' })
      .expect(400);
  });

  it('webp গ্রহণ করে ও তারিখ-ভিত্তিক পাথে রাখে', async () => {
    const res = await asAgent(
      h.http().post('/api/v1/agent/screenshots'),
      device.token,
    )
      .field('meta', JSON.stringify(meta()))
      .attach('file', WEBP, { filename: 'shot.webp', contentType: 'image/webp' })
      .expect(201);

    expect(res.body.accepted).toBe(1);
    // retention জব যেন শুধু ফোল্ডার ধরে মুছতে পারে (ADR-006)
    expect(res.body.path).toMatch(
      /^screenshots\/\d{4}\/\d{2}\/\d{2}\/emp-\d{3}\/\d{6}_m0\.webp$/,
    );
  });

  it('একই স্লট ও মনিটরের ছবি দুবার এলে duplicate', async () => {
    const m = JSON.stringify(meta());

    await asAgent(h.http().post('/api/v1/agent/screenshots'), device.token)
      .field('meta', m)
      .attach('file', WEBP, { filename: 'shot.webp', contentType: 'image/webp' })
      .expect(201);

    const res = await asAgent(
      h.http().post('/api/v1/agent/screenshots'),
      device.token,
    )
      .field('meta', m)
      .attach('file', WEBP, { filename: 'shot.webp', contentType: 'image/webp' })
      .expect(201);

    expect(res.body).toMatchObject({ accepted: 0, duplicate: true });
    expect(await h.prisma.screenshot.count()).toBe(1);
  });
});

describe('auto-update (G34)', () => {
  it('নতুন ভার্সন না থাকলে 204', async () => {
    await asAgent(
      h.http().get('/api/v1/agent/update?current=1.0.0'),
      device.token,
    ).expect(204);
  });

  it('নতুন ভার্সন থাকলে hash সহ তথ্য দেয়', async () => {
    await h.prisma.agentVersion.create({
      data: {
        version: '1.2.0',
        msiPath: 'agent/oXeioAgent-1.2.0.msi',
        sha256: 'a'.repeat(64),
        rolloutStage: 'all',
      },
    });

    const res = await asAgent(
      h.http().get('/api/v1/agent/update?current=1.0.0'),
      device.token,
    ).expect(200);

    expect(res.body).toMatchObject({ version: '1.2.0', mandatory: false });
    expect(res.body.sha256).toHaveLength(64);
  });

  it('rollout থামানো থাকলে কিছুই দেয় না', async () => {
    await h.prisma.agentVersion.create({
      data: {
        version: '1.3.0',
        msiPath: 'agent/bad.msi',
        sha256: 'b'.repeat(64),
        rolloutStage: 'halted',
      },
    });

    await asAgent(
      h.http().get('/api/v1/agent/update?current=1.0.0'),
      device.token,
    ).expect(204);
  });

  it('১.১০.০ কে ১.৯.০ এর চেয়ে নতুন ধরে (স্ট্রিং তুলনা নয়)', async () => {
    await h.prisma.agentVersion.create({
      data: {
        version: '1.10.0',
        msiPath: 'agent/x.msi',
        sha256: 'c'.repeat(64),
        rolloutStage: 'all',
      },
    });

    const res = await asAgent(
      h.http().get('/api/v1/agent/update?current=1.9.0'),
      device.token,
    ).expect(200);
    expect(res.body.version).toBe('1.10.0');
  });
});
