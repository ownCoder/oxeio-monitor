import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TargetsService } from '../src/targets/targets.service';
import { createHarness, resetDatabase, hashPassword, loginReady, OWNER_EMAIL, OWNER_PASSWORD, type Harness } from './setup/harness';

let h: Harness;
let service: TargetsService;
let employeeId: number;
let actorId: number;
let ownerId: number;
let ids: number[];
const now = new Date('2026-10-07T10:00:00+06:00');
const reasons = ['not_found', 'events', 'copyright', 'others'] as const;

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
  const rows = await h.prisma.designTarget.createManyAndReturn({ data: Array.from({ length: 30 }, (_, n) => ({
    asin: `B${String(n).padStart(9, '0')}`, addedById: ownerId,
    assignedToId: employeeId, assignedAt: now, status: 'assigned' as const,
  })) });
  ids = rows.map(r => r.id);
});

async function addPool(count: number) {
  await h.prisma.designTarget.createMany({ data: Array.from({ length: count }, (_, n) => ({
    asin: `D${String(n).padStart(9, '0')}`, addedById: ownerId,
  })) });
}

describe('Reason-based immediate skip replacement', () => {
  it('shows only Page Not Found as automatic; all other reasons queue for manager review', async () => {
    await Promise.all(reasons.map((reason, n) => service.skip(employeeId, ids[n], reason, now, actorId)));
    const requests = await h.prisma.designSkipRequest.findMany({ orderBy: { id: 'asc' } });
    expect(requests).toHaveLength(4);
    expect(requests.find(r => r.reason === 'not_found')?.decision).toBe('automatic');
    expect(requests.filter(r => r.reason !== 'not_found').every(r => r.decision === 'pending')).toBe(true);
    expect(requests.every(r => r.replacementDue)).toBe(true);
    expect(await h.prisma.designTarget.count({ where: { id: { in: ids.slice(0, 4) }, status: 'skipped' } })).toBe(4);
    expect(await h.prisma.designTarget.count({ where: { skipReviewPending: true, status: 'skipped' } })).toBe(3);
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[0] } })).toMatchObject({ reviewedAt: now, skipReviewPending: false });
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ requested: 4, replacementOwed: 4 });
  });

  it('issues one random replacement per reason before manager review and never returns skipped originals to pool', async () => {
    await addPool(4);
    for (const [n, reason] of reasons.entries()) await service.skip(employeeId, ids[n], reason, now, actorId);
    const requests = await h.prisma.designSkipRequest.findMany({ orderBy: { id: 'asc' } });
    expect(requests.every(r => !r.replacementDue && r.replacementTargetId && r.replacementIssuedAt)).toBe(true);
    expect(new Set(requests.map(r => r.replacementTargetId)).size).toBe(4);
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId } })).toBe(30);
    expect(await h.prisma.designTarget.count({ where: { id: { in: ids.slice(0, 4) }, status: 'skipped' } })).toBe(4);
    expect(await h.prisma.designTarget.count({ where: { status: 'pool' } })).toBe(0);
    expect(await service.stats()).toMatchObject({ toReview: 3 });
  });

  it('swaps one replacement atomically when an owner extra grant put open work above 30', async () => {
    await h.prisma.designTarget.createMany({ data: Array.from({ length: 4 }, (_, n) => ({
      asin: `E${String(n).padStart(9, '0')}`, addedById: ownerId,
      assignedToId: employeeId, assignedAt: now, status: 'assigned' as const,
    })) });
    await addPool(1);
    await service.skip(employeeId, ids[0], 'others', now, actorId);
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId } })).toBe(34);
    expect(await h.prisma.designSkipRequest.findFirstOrThrow()).toMatchObject({ replacementDue: false, decision: 'pending' });
    expect(await h.prisma.designTarget.count({ where: { id: ids[0], status: 'skipped' } })).toBe(1);
  });

  it('keeps a durable 1:1 debt while pool is empty and fulfills it once when stock arrives', async () => {
    for (const [n, reason] of reasons.entries()) await service.skip(employeeId, ids[n], reason, now, actorId);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ replacementOwed: 4 });
    await addPool(4);
    await service.topUpAll(now);
    await service.topUpAll(now);
    expect(await service.skipAllowance(employeeId, now)).toMatchObject({ replacementOwed: 0 });
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned', assignedToId: employeeId } })).toBe(30);
    expect(await h.prisma.designTarget.count({ where: { id: { in: ids.slice(0, 4) }, status: 'skipped' } })).toBe(4);
  });

  it('does not duplicate a request on retry or accept another employee’s target', async () => {
    await service.skip(employeeId, ids[0], 'not_found', now, actorId);
    expect(await service.skip(employeeId, ids[0], 'not_found', now, actorId)).toEqual({ ok: false });
    expect(await service.skip(employeeId + 100, ids[1], 'others', now, actorId)).toEqual({ ok: false });
    expect(await h.prisma.designSkipRequest.count()).toBe(1);
    expect(await service.markDone(employeeId, ids[0], actorId, now)).toEqual({ ok: false });
  });

  it('keeps pending skips out of distribution and in manager review until decided', async () => {
    await service.skip(employeeId, ids[0], 'events', now, actorId);
    await addPool(1);
    await service.topUpAll(now);
    await service.returnUnworked(new Date('2026-10-07T00:00:00Z'));
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[0] } })).toMatchObject({ status: 'skipped', skipReviewPending: true });
    expect(await service.markReviewed(ids[0], ownerId, now)).toEqual({ ok: false });
    expect((await service.softDelete([ids[0]], ownerId, '127.0.0.1', 'events')).deleted).toBe(0);
    expect((await service.mine(employeeId)).find(r => r.id === ids[0])?.skipReviewPending).toBe(true);
    const page = await service.list({ stage: 'to_review', from: '2026-10-07', to: '2026-10-07' });
    expect(page.rows.find(r => r.id === ids[0])).toMatchObject({ status: 'skipped', skipReviewPending: true });
  });

  it('approval keeps the design skipped; rejection restores the original without revoking an issued replacement', async () => {
    await addPool(2);
    await service.skip(employeeId, ids[0], 'events', now, actorId);
    await service.skip(employeeId, ids[1], 'others', now, actorId);
    await service.decideSkip(ids[0], true, ownerId, now);
    await service.decideSkip(ids[1], false, ownerId, now);
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[0] } })).toMatchObject({ status: 'skipped', skipReviewPending: false, reviewedById: ownerId });
    expect(await h.prisma.designTarget.findUnique({ where: { id: ids[1] } })).toMatchObject({ status: 'assigned', skipReviewPending: false, dropReason: null });
    const requests = await h.prisma.designSkipRequest.findMany({ orderBy: { id: 'asc' } });
    expect(requests.map(r => r.decision)).toEqual(['approved', 'rejected']);
    expect(requests.every(r => r.replacementTargetId !== null && !r.replacementDue)).toBe(true);
  });

  it('allows only one racing manager decision and rejects staff on the HTTP route', async () => {
    await service.skip(employeeId, ids[0], 'copyright', now, actorId);
    const staff = await loginReady(h, 'skip@test.local', 'skip-password-123');
    await staff.http.post(`/api/v1/design-targets/${ids[0]}/skip-decision`).set('X-CSRF-Token', staff.csrf).send({ approve: true }).expect(403);
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await owner.http.post(`/api/v1/design-targets/${ids[0]}/skip-decision`).set('X-CSRF-Token', owner.csrf).send({ approve: 'yes' }).expect(400);
    const results = await Promise.allSettled([service.decideSkip(ids[0], true, ownerId, now), service.decideSkip(ids[0], false, ownerId, now)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await h.prisma.designSkipRequest.count({ where: { targetId: ids[0], decision: 'pending' } })).toBe(0);
  });
});
