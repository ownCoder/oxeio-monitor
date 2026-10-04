import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Harness } from './setup/harness';

/**
 * WORK_TIMEZONE end to end — the whole app booted on America/Sao_Paulo.
 *
 * `work-timezone.spec.ts` covers the pure functions. This file covers what
 * only shows up with Nest, Prisma and Postgres together: the raw SQL that
 * cuts days with `AT TIME ZONE`, the config the agent and the dashboard
 * read, and the one place that still added 6 hours by hand
 * (`workDateStr` in targets.service.ts — Undo near midnight was refused
 * as "not today's work").
 *
 * The env is stubbed before the app modules are imported, because the
 * offset is read once at import time.
 */

const HOUR_MS = 3_600_000;
const SP_OFFSET_MS = -3 * HOUR_MS;

let h: Harness;
let mod: {
  time: typeof import('../src/agent/util/dhaka-time');
  harness: typeof import('./setup/harness');
  targets: typeof import('../src/targets/targets.service');
  dashboard: typeof import('../src/dashboard/dashboard.service');
  reports: typeof import('../src/reports/reports.service');
  agentConfig: typeof import('../src/agent/agent-config.service');
};

beforeAll(async () => {
  vi.stubEnv('WORK_TIMEZONE', 'America/Sao_Paulo');
  vi.resetModules();
  mod = {
    time: await import('../src/agent/util/dhaka-time'),
    harness: await import('./setup/harness'),
    targets: await import('../src/targets/targets.service'),
    dashboard: await import('../src/dashboard/dashboard.service'),
    reports: await import('../src/reports/reports.service'),
    agentConfig: await import('../src/agent/agent-config.service'),
  };
  h = await mod.harness.createHarness();
  await mod.harness.resetDatabase(h.prisma, h.app);
});

afterAll(async () => {
  await h?.close();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** `dayLabel` is a work date (UTC midnight label); `hour` is São Paulo time */
const atLocalHour = (dayLabel: Date, hour: number): Date =>
  new Date(dayLabel.getTime() - SP_OFFSET_MS + hour * HOUR_MS);

let asinCounter = 0;
async function designDone(
  completedAt: Date,
  assignedToId: number | null = null,
): Promise<number> {
  const owner = await h.prisma.user.findFirstOrThrow();
  asinCounter += 1;
  const row = await h.prisma.designTarget.create({
    data: {
      asin: `B${String(asinCounter).padStart(9, '0')}`,
      addedById: owner.id,
      status: 'done',
      completedAt,
      assignedToId,
    },
  });
  return row.id;
}

describe('WORK_TIMEZONE=America/Sao_Paulo, whole app', () => {
  it('the dashboard and the agent are told −180', async () => {
    const res = await h.http().get('/api/v1/auth/time-zone').expect(200);
    expect(res.body).toEqual({
      timeZone: 'America/Sao_Paulo',
      utcOffsetMinutes: -180,
    });

    const { config } = await h.app
      .get(mod.agentConfig.AgentConfigService)
      .build(null);
    expect(config.timezone).toBe('America/Sao_Paulo');
    expect(config.utcOffsetMinutes).toBe(-180);
  });

  it('Undo at 23:45 local accepts a design finished at 23:30 the same local day', async () => {
    const { employeeId } = await mod.harness.createEmployeeWithCode(
      h.prisma,
      'OX-TZ1',
    );
    const day = new Date('2026-08-11T00:00:00Z');
    // 23:30 local = 02:30 UTC the next day — the UTC date is already 12 Aug
    const id = await designDone(atLocalHour(day, 23.5), employeeId);

    const result = await h.app
      .get(mod.targets.TargetsService)
      .undoMine(employeeId, id, atLocalHour(day, 23.75), {
        userId: (await h.prisma.user.findFirstOrThrow()).id,
        ip: null,
      });

    expect(result).toEqual({ ok: true });
    const row = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id },
    });
    expect(row.completedAt).toBeNull();
  });

  it('the 7-day trend puts 23:30 and 00:30 local on their own days', async () => {
    await h.prisma.designTarget.deleteMany();
    const today = mod.time.workDateOf(mod.harness.dhakaNoon());
    const yesterday = new Date(today.getTime() - 86_400_000);

    await designDone(atLocalHour(yesterday, 23.5));
    await designDone(atLocalHour(today, 0.5));

    const { days } = await h.app
      .get(mod.dashboard.DashboardService)
      .teamTrend();
    expect(days.at(-2)!.designsFinished).toBe(1);
    expect(days.at(-1)!.designsFinished).toBe(1);
  });

  it('the attendance report counts designs by the local day (SQL AT TIME ZONE)', async () => {
    await h.prisma.designTarget.deleteMany();
    const { employeeId } = await mod.harness.createEmployeeWithCode(
      h.prisma,
      'OX-TZ2',
    );
    await h.prisma.employee.update({
      where: { id: employeeId },
      data: { staffType: 'designer' },
    });
    const d1 = new Date('2026-08-10T00:00:00Z');
    const d2 = new Date('2026-08-11T00:00:00Z');
    // 22:00 local on the 10th = 01:00 UTC on the 11th
    await designDone(atLocalHour(d1, 22), employeeId);
    // 01:00 local on the 11th = 04:00 UTC on the 11th
    await designDone(atLocalHour(d2, 1), employeeId);

    const report = await h.app
      .get(mod.reports.ReportsService)
      .attendance({ from: '2026-08-10', to: '2026-08-11', employeeId });
    const byDate = Object.fromEntries(
      report.rows.map((r) => [r.date, r.designsDone]),
    );

    expect(byDate['2026-08-10']).toBe(1);
    expect(byDate['2026-08-11']).toBe(1);
  });
});
