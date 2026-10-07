import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TargetsService } from '../src/targets/targets.service';
import { createHarness, resetDatabase, hashPassword, loginReady, OWNER_EMAIL, OWNER_PASSWORD, type Harness } from './setup/harness';

let h: Harness;
let service: TargetsService;
let employeeId: number;
let actorId: number;
let ownerId: number;
let ids: number[];
const now = new Date('2026-09-27T10:00:00+06:00');

beforeAll(async () => { h = await createHarness(); service = h.app.get(TargetsService); });
afterAll(async () => { await h.close(); });
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  ownerId = (await h.prisma.user.findFirstOrThrow({ where: { role: 'owner' } })).id;
  employeeId = (await h.prisma.employee.create({ data: {
    empCode: 'SKIP-TEST', fullName: 'Skip Test', staffType: 'designer', dailyDesignTarget: 25,
  } })).id;
  actorId = (await h.prisma.user.create({ data: {
    email: 'skip@test.local', fullName: 'Skip Test', role: 'employee', employeeId,
    passwordHash: await hashPassword('skip-password-123'), mustChangePw: false,
  } })).id;
  // 30 assignments and no pool: skip requests cannot change the fixture underneath a test.
  const rows = await h.prisma.designTarget.createManyAndReturn({ data: Array.from({ length: 30 }, (_, n) => ({
    asin: `B${String(n).padStart(9, '0')}`, addedById: ownerId,
    assignedToId: employeeId, assignedAt: now, status: 'assigned' as const,
  })) });
  ids = rows.map(r => r.id);
});

async function requestFour(at = now) {
  for (const id of ids.slice(0, 4)) expect(await service.skip(employeeId, id, 'copyright', at, actorId)).toEqual({ ok: true });
}

describe('Daily skip review gate', () => {
  it('allows only three automatic requests under concurrent calls and logs every request', async () => {
    await Promise.all(ids.slice(0, 4).map(id => service.skip(employeeId, id, 'copyright', now, actorId)));
    const requests = await h.prisma.designSkipRequest.findMany();
    expect(requests).toHaveLength(4);
    expect(requests.filter(r => r.decision === 'automatic')).toHaveLength(3);
    expect(requests.filter(r => r.decision === 'pending')).toHaveLength(1);
    expect(requests.every(r => r.actorUserId === actorId && r.requestedAt.getTime() === now.getTime())).toBe(true);
    expect(await h.prisma.designTarget.count({ where: { skipReviewPending: true, status: 'assigned' } })).toBe(1);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ limit: 3, requested: 4, remaining: 0, replacementOwed: 3 });
  });

  it('issues exactly one random pool replacement per automatic skip, while skipped designs stay skipped', async () => {
    await h.prisma.designTarget.createMany({ data: Array.from({ length: 3 }, (_, n) => ({
      asin: `D${String(n).padStart(9, '0')}`, addedById: ownerId,
    })) });
    for (const id of ids.slice(0, 3)) await service.skip(employeeId, id, 'not_found', now, actorId);
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId } })).toBe(30);
    expect(await h.prisma.designTarget.count({ where: { id: { in: ids.slice(0, 3) }, status: 'skipped' } })).toBe(3);
    expect(await h.prisma.designTarget.count({ where: { status: 'pool' } })).toBe(0);
    const requests = await h.prisma.designSkipRequest.findMany({ orderBy: { id: 'asc' } });
    expect(requests).toHaveLength(3);
    expect(requests.every(r => !r.replacementDue && r.replacementTargetId && r.replacementIssuedAt)).toBe(true);
    expect(new Set(requests.map(r => r.replacementTargetId)).size).toBe(3);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ replacementOwed: 0 });
  });

  it('keeps a replacement owed while the pool is empty, then fills it once', async () => {
    await service.skip(employeeId, ids[0], 'events', now, actorId);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ replacementOwed: 1 });
    await h.prisma.designTarget.create({ data: { asin: 'D000000001', addedById: ownerId } });
    await service.topUpAll(now);
    await service.topUpAll(now);
    const request = await h.prisma.designSkipRequest.findFirstOrThrow();
    expect(request).toMatchObject({ replacementDue: false });
    expect(request.replacementTargetId).not.toBeNull();
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId } })).toBe(30);
  });

  it('does not spend allowance on retries or another employee’s target', async () => {
    await requestFour();
    expect(await service.skip(employeeId, ids[3], 'events', now, actorId)).toEqual({ ok: false });
    expect(await service.skip(employeeId + 100, ids[4], 'events', now, actorId)).toEqual({ ok: false });
    expect(await h.prisma.designSkipRequest.count()).toBe(4);
    expect(await service.markDone(employeeId, ids[3], actorId, now)).toEqual({ ok: false });
  });

  it('keeps pending assignments through midnight return and distribution, with no pending replacement', async () => {
    await requestFour();
    await h.prisma.designTarget.createMany({ data: Array.from({ length: 50 }, (_, n) => ({ asin: `C${String(n).padStart(9, '0')}`, addedById: ownerId })) });
    const before = await h.prisma.designTarget.count({ where: { assignedToId: employeeId } });
    await service.topUpAll(now);
    // Only the first three automatic skips free slots; the fourth still occupies one.
    expect(await h.prisma.designTarget.count({ where: { assignedToId: employeeId } })).toBe(before + 3);
    await service.topUpAll(now);
    expect(await h.prisma.designTarget.count({ where: { assignedToId: employeeId } })).toBe(before + 3);
    await service.returnUnworked(new Date('2026-09-27T00:00:00Z'));
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[3] } })).toMatchObject({ status: 'assigned', skipReviewPending: true, assignedToId: employeeId });
    await service.distribute(new Date('2026-09-28T08:00:00+06:00'));
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId } })).toBe(30);
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId, skipReviewPending: false } })).toBe(29);
  });

  it('rejects to the same designer and keeps consumed allowance and history after un-skip', async () => {
    await requestFour();
    expect(await h.prisma.designSkipRequest.count({ where: { replacementDue: true } })).toBe(3);
    await service.decideSkip(ids[3], false, ownerId, now);
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[3] } })).toMatchObject({ status: 'assigned', skipReviewPending: false, assignedToId: employeeId, dropReason: null });
    await service.skip(employeeId, ids[3], 'events', now, actorId);
    expect(await h.prisma.designSkipRequest.count({ where: { targetId: ids[3] } })).toBe(2);
    expect(await h.prisma.designSkipRequest.count({ where: { targetId: ids[3], replacementDue: true } })).toBe(0);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ requested: 5, remaining: 0 });
    await service.update(ids[0], 'pool', now, ownerId);
    expect(await h.prisma.designSkipRequest.count({ where: { targetId: ids[0] } })).toBe(1);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ requested: 5 });
  });

  it('records exactly one reviewer decision when approvals race', async () => {
    await requestFour();
    const results = await Promise.allSettled([service.decideSkip(ids[3], true, ownerId, now), service.decideSkip(ids[3], false, ownerId, now)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const row = await h.prisma.designSkipRequest.findFirstOrThrow({ where: { targetId: ids[3] } });
    expect(row.reviewerUserId).toBe(ownerId);
    expect(row.decidedAt).toEqual(now);
    expect(['approved', 'rejected']).toContain(row.decision);
    expect(row.replacementDue).toBe(row.decision === 'approved');
  });

  it('resets allowance at Dhaka midnight without releasing pending work', async () => {
    const before = new Date('2026-09-27T23:59:59+06:00');
    await requestFour(before);
    const after = new Date('2026-09-28T00:00:00+06:00');
    expect(await service.skipAllowance(employeeId, after)).toMatchObject({ requested: 0, remaining: 3 });
    await service.skip(employeeId, ids[4], 'not_found', after, actorId);
    expect(await h.prisma.designSkipRequest.findFirst({ where: { targetId: ids[4] } })).toMatchObject({ decision: 'automatic' });
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[3] } })).toMatchObject({ skipReviewPending: true });
  });

  it('blocks alternate status/review/delete routes and exposes the real request date', async () => {
    await requestFour();
    expect(await service.update(ids[3], 'pool', now, ownerId)).toEqual({ ok: false });
    expect(await service.markReviewed(ids[3], ownerId, now)).toEqual({ ok: false });
    expect((await service.softDelete([ids[3]], ownerId, '127.0.0.1', 'events')).deleted).toBe(0);
    const page = await service.list({ stage: 'to_review', from: '2026-09-27', to: '2026-09-27' });
    expect(page.total).toBe(4);
    expect(page.rows.find(r => r.id === ids[3])).toMatchObject({ skipReviewPending: true, skipRequestedAt: now.toISOString() });
    expect(await service.stats()).toMatchObject({ toReview: 4 });
    expect((await service.mine(employeeId)).find(r => r.id === ids[3])?.skipReviewPending).toBe(true);
  });

  it('permits owner review but refuses a designer on the actual HTTP route', async () => {
    await requestFour();
    const staff = await loginReady(h, 'skip@test.local', 'skip-password-123');
    await staff.http.post(`/api/v1/design-targets/${ids[3]}/skip-decision`).set('X-CSRF-Token', staff.csrf).send({ approve: true }).expect(403);
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await owner.http.post(`/api/v1/design-targets/${ids[3]}/skip-decision`).set('X-CSRF-Token', owner.csrf).send({ approve: 'yes' }).expect(400);
    await owner.http.post(`/api/v1/design-targets/${ids[3]}/skip-decision`).set('X-CSRF-Token', owner.csrf).send({ approve: true }).expect(201);
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[3] } })).toMatchObject({ status: 'skipped', skipReviewPending: false, reviewedById: ownerId });
  });
});
