import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workDateOf } from '../src/agent/util/dhaka-time';
import { captureWindow, galleryWindow } from '../src/screenshots/gallery.filters';
import {
  createEmployeeWithCode,
  createHarness,
  dhakaNoon,
  hashPassword,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

let h: Harness;
let owner: Session;
let alice: { employeeId: number; deviceId: number };
let bob: { employeeId: number; deviceId: number };

function day(offset: number) {
  return workDateOf(dhakaNoon(offset)).toISOString().slice(0, 10);
}

async function staff(code: string, role: 'employee' | 'researcher' = 'employee') {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);
  const device = await h.prisma.device.create({
    data: {
      hostname: `PC-${code}`,
      windowsUsername: 'tester',
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      status: 'active',
    },
  });
  await h.prisma.user.create({
    data: {
      email: `${code.toLowerCase()}@test.local`,
      fullName: code,
      passwordHash: await hashPassword('sample-password-123'),
      role,
      employeeId,
      mustChangePw: false,
    },
  });
  return { employeeId, deviceId: device.id };
}

async function shot(
  who: { employeeId: number; deviceId: number },
  offset: number,
  dhakaHour: number,
  monitorIndex: number,
  activeApp: string,
) {
  const when = dhakaNoon(offset);
  when.setUTCHours(dhakaHour - 6, 15, 0, 0);
  const uuid = randomUUID();
  return h.prisma.screenshot.create({
    data: {
      employeeId: who.employeeId,
      deviceId: who.deviceId,
      clientUuid: uuid,
      workDate: workDateOf(when),
      slotStart: when,
      capturedAt: when,
      monitorIndex,
      activeApp,
      filePath: `sample/${uuid}.webp`,
    },
  });
}

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
  alice = await staff('OX-A');
  bob = await staff('OX-B', 'researcher');
});

describe('screenshot gallery filters', () => {
  it('validates Dhaka date range and six-hour capture windows at midnight', () => {
    expect(galleryWindow('2026-09-28', '2026-09-29')?.days).toHaveLength(2);
    expect(galleryWindow('2026-09-28', '2026-10-05')).toBeNull();
    expect(galleryWindow('2026-09-30', '2026-09-29')).toBeNull();
    expect(galleryWindow('2026-02-30', '2026-03-01')).toBeNull();
    const day = galleryWindow('2026-09-29', '2026-09-29')!.from;
    expect(captureWindow(day, '00-06').capturedAt.gte.toISOString()).toBe('2026-09-28T18:00:00.000Z');
    expect(captureWindow(day, '18-24').capturedAt.lt.toISOString()).toBe('2026-09-29T18:00:00.000Z');
  });

  it('combines range, time, app, monitor, staff and pagination before count', async () => {
    await shot(alice, -1, 5, 0, 'Chrome');
    const wanted = await shot(alice, -1, 14, 1, 'Photoshop');
    await shot(alice, 0, 14, 1, 'Photoshop');
    await shot(alice, -1, 14, 0, 'Photoshop');
    await shot(alice, -1, 13, 1, 'Chrome');
    await shot(bob, -1, 14, 1, 'Photoshop');
    const range = `fromDate=${day(-1)}&toDate=${day(0)}&timeBand=12-18&app=photo&monitorIndex=1&employeeId=${alice.employeeId}`;
    const res = await owner.http.get(`/api/v1/screenshots?${range}`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].id).toBe(wanted.id.toString());
    expect(res.body.items.every((r: { employeeId: number }) => r.employeeId === alice.employeeId)).toBe(true);
    const audit = await h.prisma.auditLog.findFirstOrThrow({where:{action:'view_screenshot'},orderBy:{id:'desc'}});
    expect(audit.meta).toMatchObject({
      date: day(-1),
      filters: { toDate: day(0), timeBand: '12-18', app: 'photo', monitorIndex: 1 },
    });
    const today = await owner.http.get(`/api/v1/screenshots?date=${day(0)}&employeeId=${alice.employeeId}`).expect(200);
    expect(today.body.total).toBe(1);
  });

  it('keeps employee and researcher access limited to their own screenshots', async () => {
    await shot(alice, 0, 9, 0, 'Chrome');
    await shot(bob, 0, 9, 0, 'Chrome');
    const session = await loginReady(h, 'ox-b@test.local', 'sample-password-123');
    const own = await session.http.get(`/api/v1/screenshots?fromDate=${day(0)}&toDate=${day(0)}&app=chrome`).expect(200);
    expect(own.body.total).toBe(1);
    expect(own.body.items[0].employeeId).toBe(bob.employeeId);
    await session.http.get(`/api/v1/screenshots?date=${day(0)}&employeeId=${alice.employeeId}&timeBand=06-12`).expect(403);
  });

  it('rejects partial, oversized, ambiguous or malformed filters', async () => {
    for (const query of [
      `fromDate=${day(-1)}`,
      `fromDate=${day(-7)}&toDate=${day(0)}`,
      `fromDate=${day(0)}&toDate=${day(-1)}`,
      `date=${day(0)}&fromDate=${day(0)}&toDate=${day(0)}`,
      `date=${day(0)}&timeBand=overnight`,
      `date=${day(0)}&monitorIndex=-1`,
      `date=${day(0)}&app=${'a'.repeat(81)}`,
    ]) {
      await owner.http.get(`/api/v1/screenshots?${query}`).expect(400);
    }
  });
});
