import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TargetsService } from '../src/targets/targets.service';
import type { Prisma } from '@prisma/client';
import { createHarness, resetDatabase, dhakaNoon, type Harness } from './setup/harness';
let h: Harness;
let service: TargetsService;
beforeAll(async () => { h = await createHarness(); service = h.app.get(TargetsService); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await resetDatabase(h.prisma, h.app); });
async function target(status: 'done' | 'assigned' = 'done') {
  const owner = await h.prisma.user.findFirstOrThrow();
  const old = new Date(dhakaNoon().getTime() - 2 * 86400000);
  const row = await h.prisma.designTarget.create({ data: {
    asin: 'B012345678', addedById: owner.id, status,
    completedAt: status === 'done' ? old : null,
    completedById: status === 'done' ? owner.id : null,
    completedVia: status === 'done' ? 'manual' : null,
  } });
  return { row, owner, old };
}
describe('A03–A05 target lifecycle regressions', () => {
  it('repeated Done preserves the completion date and attribution', async () => {
    const { row, owner, old } = await target();
    await expect(service.update(row.id, 'done', dhakaNoon(), owner.id)).resolves.toEqual({ ok: true });
    const after = await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.completedAt).toEqual(old);
    expect(after.completedById).toBe(row.completedById);
    expect(await service.update(999999, 'done', dhakaNoon(), owner.id)).toEqual({ ok: false });
  });
  it('returning to the pool clears every dependent production stage', async () => {
    const { row, owner, old } = await target();
    await h.prisma.designTarget.update({ where: { id: row.id }, data: {
      checkedAt: old, checkedById: owner.id, errorFoundAt: old,
      fixedAt: old, fixedById: owner.id, uploadedAt: old, liveAt: old, liveAsin: 'B987654321',
    } });
    await service.update(row.id, 'pool', dhakaNoon(), owner.id);
    const after = await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('pool');
    for (const key of ['assignedToId', 'assignedAt', 'startedAt', 'completedAt', 'completedById', 'completedVia', 'checkedAt', 'checkedById', 'errorFoundAt', 'fixedAt', 'fixedById', 'uploadedAt', 'liveAt', 'liveAsin'] as const) {
      expect(after[key], key).toBeNull();
    }
  });
  it('does not overwrite completion committed while the delete waits for a row lock', async () => {
    const { row, owner } = await target('assigned');
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((r) => { ready = r; });
    const gate = new Promise<void>((r) => { release = r; });
    const completion = h.prisma.$transaction(async (tx) => {
      await tx.designTarget.update({ where: { id: row.id }, data: { status: 'done', completedAt: dhakaNoon() } });
      ready();
      await gate;
    }, { timeout: 15000 });
    await locked;
    const deletion = service.softDelete([row.id], owner.id, '127.0.0.1', 'not_found');
    // Observe PostgreSQL blocking the actual DELETE-status update, not a guessed delay.
    try {
      let waiting = false;
      for (let i = 0; i < 60; i++) {
        const rows = await h.prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query LIKE '%design_targets%') AS waiting`;
        if (rows[0]?.waiting) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await completion;
    expect(await deletion).toEqual({ deleted: 0, keptDone: 1 });
    expect((await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('done');
    expect(await h.prisma.auditLog.count({ where: { action: 'design_deleted' } })).toBe(0);
  });
});

// Run a real service write while another transaction holds the same row.
async function whileLocked<T>(
  mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
  act: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  let release!: () => void;
  let ready!: () => void;
  const locked = new Promise<void>(resolve => { ready = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const transaction = h.prisma.$transaction(async tx => {
    await mutate(tx);
    ready();
    await gate;
  }, { timeout: 15000 });
  await locked;
  const result = Promise.allSettled([act()]);
  try {
    let waiting = false;
    for (let i = 0; i < 60; i++) {
      const rows = await h.prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE '%design_targets%') AS waiting`;
      if (rows[0]?.waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(waiting).toBe(true);
  } finally { release(); await transaction; }
  return (await result)[0]!;
}

describe('B01–B02 atomic lifecycle transitions', () => {
  async function assigned() {
    const { row } = await target('assigned');
    const employee = await h.prisma.employee.create({ data: {
      empCode: 'AUD-1', fullName: 'Audit designer', staffType: 'designer',
    } });
    await h.prisma.designTarget.update({ where: { id: row.id }, data: {
      assignedToId: employee.id, assignedAt: dhakaNoon(), jobNumber: 1000001,
    } });
    return { id: row.id, employeeId: employee.id };
  }

  it('keeps assignment when a start commits while pool return is waiting', async () => {
    const row = await assigned();
    const result = await whileLocked(
      tx => tx.designTarget.update({ where: { id: row.id }, data: { startedAt: dhakaNoon() } }),
      () => service.returnUnworked(dhakaNoon()),
    );
    expect(result).toEqual({ status: 'fulfilled', value: { returned: 0 } });
    expect(await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'assigned', assignedToId: row.employeeId, startedAt: dhakaNoon() });
  });

  it('does not stamp a pooled row when return wins before the start write', async () => {
    const row = await assigned();
    const result = await whileLocked(
      tx => tx.designTarget.update({ where: { id: row.id }, data: { status: 'pool', assignedToId: null } }),
      () => service.markStartedByJobNumbers(row.employeeId, new Map([['1000001', dhakaNoon()]])),
    );
    expect(result).toEqual({ status: 'fulfilled', value: 0 });
    expect((await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } })).startedAt).toBeNull();
  });

  it.each(['checked', 'fixed', 'uploaded', 'live'] as const)(
    'rejects %s after a concurrent reset removes prerequisites', async stage => {
      const { row, owner } = await target();
      await h.prisma.designTarget.update({ where: { id: row.id }, data: {
        errorFoundAt: dhakaNoon(), uploadedAt: stage === 'live' ? dhakaNoon() : null,
      } });
      const result = await whileLocked(
        tx => tx.designTarget.update({ where: { id: row.id }, data: {
          status: 'pool', completedAt: null, errorFoundAt: null, uploadedAt: null,
        } }),
        () => stage === 'checked' ? service.markChecked(row.id, false, owner.id, dhakaNoon())
          : stage === 'fixed' ? service.markFixed(row.id, owner.id, dhakaNoon())
          : stage === 'uploaded' ? service.markUploaded(row.id, dhakaNoon())
          : service.markLive(row.id, 'B987654321', dhakaNoon()),
      );
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.getStatus()).toBe(400);
      const after = await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } });
      expect(after[`${stage}At`]).toBeNull();
    },
  );

  it('preserves the first upload time when a duplicate waits for its commit', async () => {
    const { row, old } = await target();
    const result = await whileLocked(
      tx => tx.designTarget.update({ where: { id: row.id }, data: { uploadedAt: old } }),
      () => service.markUploaded(row.id, dhakaNoon()),
    );
    expect(result).toEqual({ status: 'fulfilled', value: { ok: true } });
    expect((await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } })).uploadedAt).toEqual(old);
  });
});
