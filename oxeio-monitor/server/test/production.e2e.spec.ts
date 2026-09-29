import { PrismaService } from '../src/prisma/prisma.service';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ProductionService } from '../src/production/production.service';
import { ProductResultsService } from '../src/production/product-results.service';
import { ActionDigestService } from '../src/production/action-digest.service';
import { targetWrite } from '../src/targets/target-history.context';
import { TargetsService } from '../src/targets/targets.service';
import type { SessionUser } from '../src/auth/types';
import {
  createHarness,
  resetDatabase,
  dhakaNoon,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  hashPassword,
  type Harness,
} from './setup/harness';
let h: Harness, production: ProductionService, products: ProductResultsService;
let owner: SessionUser;
beforeAll(async () => {
  h = await createHarness();
  production = h.app.get(ProductionService);
  products = h.app.get(ProductResultsService);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const user = await h.prisma.user.findFirstOrThrow({
    where: { role: 'owner' },
  });
  owner = {
    userId: user.id,
    email: user.email,
    role: user.role,
    employeeId: null,
    mustChangePw: false,
    issuedAt: 0,
  };
});
async function target(asin = 'B012345678') {
  return h.prisma.designTarget.create({
    data: { asin, addedById: owner.userId },
  });
}
async function staff(code: string) {
  return h.prisma.employee.create({
    data: { empCode: code, fullName: code, staffType: 'designer' },
  });
}
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
describe('durable target workspace', () => {
  it('commits completion-cap rejection evidence without changing the target', async () => {
    const a = await staff('CAP');
    await h.prisma.employee.update({
      where: { id: a.id },
      data: { dailyDesignTarget: 1 },
    });
    const finished = await target('B000000001'),
      pending = await target('B000000002');
    await h.prisma.designTarget.update({
      where: { id: finished.id },
      data: { status: 'done', assignedToId: a.id, completedAt: dhakaNoon() },
    });
    await h.prisma.designTarget.update({
      where: { id: pending.id },
      data: { status: 'assigned', assignedToId: a.id },
    });
    await expect(
      h.app
        .get(TargetsService)
        .markDone(a.id, pending.id, owner.userId, dhakaNoon()),
    ).rejects.toThrow(/already marked/);
    expect(
      await h.prisma.auditLog.count({
        where: {
          action: 'completion_cap_blocked',
          targetId: String(pending.id),
        },
      }),
    ).toBe(1);
    expect(
      (
        await h.prisma.designTarget.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).completedAt,
    ).toBeNull();
  });
  it('records committed before/after with actor and no events for a rollback or no-op update', async () => {
    const row = await target();
    await production.plan(owner, row.id, 2, '2026-09-30', 'Urgent launch');
    const events = await h.prisma.designTargetEvent.findMany({
      where: { targetId: row.id },
      orderBy: { id: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[1].actorUserId).toBe(owner.userId);
    expect(events[1].source).toBe('planning');
    expect(events[1].beforeState).toMatchObject({ priority: 0 });
    expect(events[1].afterState).toMatchObject({ priority: 2 });
    await expect(
      targetWrite(
        h.app.get(PrismaService),
        owner.userId,
        'test',
        async (tx) => {
          await tx.designTarget.update({
            where: { id: row.id },
            data: { priority: 1 },
          });
          throw new Error('rollback');
        },
      ),
    ).rejects.toThrow('rollback');
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: { priority: 2 },
    });
    expect(
      await h.prisma.designTargetEvent.count({ where: { targetId: row.id } }),
    ).toBe(2);
  });
  it('paginates stable history without duplicate cursor records', async () => {
    const row = await target();
    for (let n = 0; n < 52; n++)
      await production.plan(owner, row.id, n % 3, null, `Reason ${n}`);
    const first = await production.history(owner, row.id);
    const second = await production.history(owner, row.id, first.nextBefore!);
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(3);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(
      53,
    );
  });
  it('reassigns only unstarted work and records the previous assignee', async () => {
    const a = await staff('A'),
      b = await staff('B'),
      row = await target();
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: { status: 'assigned', assignedToId: a.id },
    });
    await production.reassign(owner, row.id, b.id, 'Balance queue');
    const event = await h.prisma.designTargetEvent.findFirstOrThrow({
      orderBy: { id: 'desc' },
    });
    expect(event.beforeState).toMatchObject({ assigned_to_id: a.id });
    expect(event.afterState).toMatchObject({ assigned_to_id: b.id });
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: { startedAt: dhakaNoon() },
    });
    await expect(
      production.reassign(owner, row.id, a.id, 'Too late'),
    ).rejects.toThrow(/unstarted/);
  });
  it('serializes concurrent identical previews and bounds version comments', async () => {
    const row = await target();
    const uploaded = await Promise.all([
      production.upload(owner, row.id, 'a.png', png, 'First'),
      production.upload(owner, row.id, 'b.png', png, 'Same'),
    ]);
    expect(uploaded[0]).toEqual(uploaded[1]);
    expect(uploaded[0].version).toBe(1);
    await expect(
      production.upload(
        owner,
        row.id,
        'script.svg',
        Buffer.from('<svg/>').toString('base64'),
        '',
      ),
    ).rejects.toThrow(/PNG/);
    await expect(
      production.comment(owner, uploaded[0].id, 'Wrong pin', 0.4),
    ).rejects.toThrow(/coordinates/);
    await expect(production.comment(owner, uploaded[0].id, 'Null coordinate', null, 0.5)).rejects.toThrow(/coordinates/);
    const comment = await production.comment(
      owner,
      uploaded[0].id,
      'Move this',
      0.3,
      0.7,
    );
    await production.resolve(owner, comment.id, true);
    await production.resolve(owner, comment.id, true);
    expect(
      (await production.previews(owner, row.id))[0].comments[0].resolvedAt,
    ).not.toBeNull();
    await production.resolve(owner, comment.id, false);
    expect(
      (await production.previews(owner, row.id))[0].comments[0].resolvedAt,
    ).toBeNull();
  });
  it('uses current assignment for staff access, and requires reviewers to close others comments', async () => {
    const a = await staff('A'),
      b = await staff('B'),
      row = await target();
    const actor = {
      ...owner,
      role: 'employee' as const,
      employeeId: a.id,
      userId: 999,
    };
    await expect(production.history(actor, row.id)).rejects.toThrow(/assigned/);
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: { status: 'assigned', assignedToId: a.id },
    });
    const proof = await production.upload(owner, row.id, 'a.png', png, '');
    const comment = await production.comment(owner, proof.id, 'Review');
    await expect(production.resolve(actor, comment.id, true)).rejects.toThrow(
      /reviewer/,
    );
    await expect(production.history(actor, row.id)).resolves.toMatchObject({
      target: { id: row.id },
    });
    await production.reassign(owner, row.id, b.id, 'Balance queue');
    await expect(production.previewImage(actor, proof.id)).rejects.toThrow(
      /assigned/,
    );
  });
  it('shows queue totals, priority and unknown ages without inventing timestamps', async () => {
    const a = await staff('A');
    for (let n = 0; n < 21; n++)
      await h.prisma.designTarget.create({
        data: {
          asin: `B${String(n).padStart(9, '0')}`,
          addedById: owner.userId,
          status: 'assigned',
          assignedToId: a.id,
          priority: n === 20 ? 2 : 0,
        },
      });
    const page = await production.queue('unstarted', 1, a.id);
    expect(page.total).toBe(21);
    expect(page.rows).toHaveLength(20);
    expect(page.rows[0].priority).toBe(2);
    expect(page.rows[0].waitingHours).toBeNull();
    expect((await production.queue('unstarted', 2)).rows).toHaveLength(1);
    expect((await production.workload())[0].unstarted).toBe(21);
    const policy = await h.prisma.workPolicy.findFirstOrThrow();
    await h.prisma.workPolicy.update({ where: { id: policy.id }, data: { dailyDesignTarget: 25 } });
    await h.prisma.employee.update({ where: { id: a.id }, data: { policyId: policy.id, dailyDesignTarget: null } });
    expect((await production.workload())[0].dailyDesignTarget).toBe(25);

  });
  it('counts first observed check once and computes elapsed median with samples', async () => {
    const row = await target();
    const complete = new Date('2026-09-25T06:00:00Z'),
      uploaded = new Date('2026-09-25T08:00:00Z');
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: {
        completedAt: complete,
        uploadedAt: uploaded,
        checkedAt: complete,
        errorFoundAt: complete,
      },
    });
    // Only one event action per atomic change; above is classified as checked.
    await h.prisma.designTargetEvent.updateMany({
      where: { targetId: row.id, action: 'checked' },
      data: { recordedAt: complete },
    });
    const result = await production.quality('2026-09-25', '2026-09-25');
    expect(result.reviewed).toBe(1);
    expect(result.rework).toBe(1);
    expect(result.firstPassRate).toBe(0);
    expect(result.completeToUploadHours).toBe(2);
    expect(result.uploadSamples).toBe(1);
    expect(result.liveSamples).toBe(0);
  });
});
describe('monthly own-product results', () => {
  const csv =
    'period,live_asin,units,royalty,currency\n2026-09,B987654321,12,34.50,USD';
  it('matches live ASIN only, requires unmatched acceptance and prevents concurrent duplicate totals', async () => {
    const row = await target('B987654321');
    expect((await products.preview(csv)).rows[0].match).toBe('unmatched');
    await expect(
      products.import(owner.userId, csv, 'Month', false),
    ).rejects.toThrow(/unmatched/);
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: { liveAsin: 'B987654321' },
    });
    const both = await Promise.allSettled([
      products.import(owner.userId, csv, 'First', false),
      products.import(owner.userId, csv, 'Duplicate', false),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await h.prisma.productSale.count()).toBe(1);
    expect(await h.prisma.salesImport.count()).toBe(1);
    const result = await products.results();
    expect(result.currencies).toEqual([
      { currency: 'USD', units: 12, royalty: '34.50' },
    ]);
    expect(result.rows[0].targetId).toBe(row.id);
  });
  it('keeps currencies separate, validates links and audits estimated cost', async () => {
    await products.import(
      owner.userId,
      csv + '\n2026-09,B987654321,1,-2.00,EUR',
      'Currencies',
      true,
    );
    const result = await products.results();
    expect(result.currencies).toHaveLength(2);
    const row = await target();
    await expect(
      products.link(owner.userId, result.rows[0].id, row.id),
    ).rejects.toThrow(/exact live/);
    await h.prisma.designTarget.update({
      where: { id: row.id },
      data: { liveAsin: 'B987654321' },
    });
    await products.link(owner.userId, result.rows[0].id, row.id);
    await products.cost(owner.userId, row.id, '5.25', 'USD', 'Estimate basis');
    expect(
      await h.prisma.auditLog.count({
        where: { action: 'set_product_cost_estimate' },
      }),
    ).toBe(1);
  });
  it('enforces owner-only money endpoints and validates DTOs through HTTP', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await manager.http.get('/api/v1/production/sales').expect(403);
    await manager.http.get('/api/v1/production/monitor').expect(403);
    await manager.http
      .post('/api/v1/production/sales/preview')
      .set('X-CSRF-Token', manager.csrf)
      .send({ csv })
      .expect(403);
    const session = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await session.http.get('/api/v1/production/queue?page=-1').expect(400);
    await session.http
      .get('/api/v1/production/quality?from=2026-02-30&to=2026-03-02')
      .expect(400);
    await session.http.get('/api/v1/production/monitor').expect(200);
    const a = await staff('HTTP');
    await h.prisma.user.create({
      data: {
        email: 'staff@test.local',
        fullName: 'Staff',
        role: 'employee',
        employeeId: a.id,
        mustChangePw: false,
        passwordHash: await hashPassword('test-password-123'),
      },
    });
    const employee = await loginReady(
      h,
      'staff@test.local',
      'test-password-123',
    );
    await employee.http.get('/api/v1/production/board').expect(403);
    const row = await target();
    await employee.http
      .get(`/api/v1/production/targets/${row.id}/history`)
      .expect(403);
  });
  it('defaults digest off and deduplicates quiet daily runs across restarts', async () => {
    const fake = {
      resolve: vi.fn().mockResolvedValue({ chatId: '1234' }),
      send: vi.fn().mockResolvedValue('sent'),
    };
    const service = new ActionDigestService(
      h.app.get(PrismaService),
      fake as never,
    );
    expect(await service.runOnce(dhakaNoon())).toEqual({ outcome: 'disabled' });
    await service.save(owner.userId, true, 48);
    expect(await service.runOnce(dhakaNoon())).toEqual({ outcome: 'quiet' });
    expect(
      await new ActionDigestService(
        h.app.get(PrismaService),
        fake as never,
      ).runOnce(dhakaNoon()),
    ).toEqual({ outcome: 'already_processed' });
    expect(fake.send).not.toHaveBeenCalled();
    fake.resolve.mockResolvedValue({ chatId: '-1001234' });
    await expect(service.save(owner.userId, true, 48)).rejects.toThrow(
      /private owner/,
    );
  });
});
