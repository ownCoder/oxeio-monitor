import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workDateOf } from '../src/agent/util/dhaka-time';
import { TargetEvidenceService } from '../src/production/target-evidence.service';
import type { SessionUser } from '../src/auth/types';
import { createEmployeeWithCode, createHarness, dhakaNoon, hashPassword, loginReady, resetDatabase, type Harness } from './setup/harness';

let h: Harness;
let evidence: TargetEvidenceService;
let owner: SessionUser;
beforeAll(async () => { h = await createHarness(); evidence = h.app.get(TargetEvidenceService); });
afterAll(async () => { await h.close(); });
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const user = await h.prisma.user.findFirstOrThrow({ where: { role: 'owner' } });
  owner = { userId: user.id, email: user.email, role: 'owner', employeeId: null, mustChangePw: false, issuedAt: 0 };
});
async function person(code: string) {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);
  const device = await h.prisma.device.create({ data: { hostname: code, windowsUsername: code, employeeId, machineGuid: randomUUID(), tokenHash: randomUUID(), status: 'active' } });
  return { employeeId, deviceId: device.id };
}
async function fixture() {
  const a = await person('EV-1'), b = await person('EV-2');
  const target = await h.prisma.designTarget.create({ data: { asin: 'BEVIDENCE1', jobNumber: 1000123, addedById: owner.userId, assignedToId: a.employeeId, status: 'assigned' } });
  const start = new Date(dhakaNoon().getTime() - 3600000), day = workDateOf(start);
  async function trace(who: typeof a, process: string, title: string, state: 'active' | 'idle' = 'active') {
    await h.prisma.appUsage.create({ data: { ...who, clientUuid: randomUUID(), workDate: day, startedAt: start, endedAt: new Date(start.getTime() + 60000), durationSec: 60, processName: process, windowTitle: title, segmentState: state } });
  }
  await trace(a, 'Illustrator.exe', '1000123-design.ai');
  await trace(a, 'Photoshop.exe', '1000123-design.psd');
  await trace(a, 'Illustrator.exe', '1000123-idle.ai', 'idle');
  await trace(a, 'Chrome.exe', '1000123-browser');
  await trace(a, 'Illustrator.exe', '10001234-stock.ai');
  await trace(b, 'Illustrator.exe', '1000123-design.ai');
  for (const who of [a, b]) await h.prisma.screenshot.create({ data: { ...who, clientUuid: randomUUID(), workDate: day, slotStart: start, capturedAt: start, filePath: 'test/no-image.webp', activeApp: 'Illustrator.exe', activeTitle: '1000123-design.ai' } });
  for (const who of [a, b]) await h.prisma.officeEntry.create({ data: { kind: 'blocker', title: `Help ${who.employeeId}`, content: { state: 'open', note: 'Test' }, employeeId: who.employeeId, targetId: target.id, createdBy: owner.userId } });
  return { a, b, target };
}
describe('design evidence privacy and matching', () => {
  it('counts each person once per overlap and matches only the complete job number in design apps', async () => {
    const { target } = await fixture();
    const result = await evidence.read(owner, target.id, '127.0.0.1');
    expect(result.foregroundSec).toBe(120);
    expect(result.observations).toBe(3);
    expect(result.screenshotTotal).toBe(2);
    expect(result.officeEntries).toHaveLength(2);
    expect(result.screenshots[0].thumbUrl).toContain('/api/v1/screenshots/');
    expect(JSON.stringify(result)).not.toContain('design.ai');
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'view_screenshot', targetType: 'design_target' } });
    expect(audit).not.toBeNull();
  });
  it('keeps an assigned employee or researcher within their own observations and office records', async () => {
    const { a, target } = await fixture();
    for (const role of ['employee', 'researcher'] as const) {
      const result = await evidence.read({ ...owner, role, employeeId: a.employeeId }, target.id, '127.0.0.1');
      expect(result.scope).toBe('self');
      expect(result.foregroundSec).toBe(60);
      expect(result.screenshots).toHaveLength(1);
      expect(result.officeEntries).toHaveLength(1);
      expect(result.byPerson.every(p => p.employeeId === a.employeeId)).toBe(true);
    }
  });
  it('denies unassigned staff and requires a session for the route', async () => {
    const { b, target } = await fixture();
    for (const role of ['employee', 'researcher'] as const) await expect(evidence.read({ ...owner, role, employeeId: b.employeeId }, target.id, '127.0.0.1')).rejects.toMatchObject({ status: 403 });
    await h.http().get(`/api/v1/production/targets/${target.id}/evidence`).expect(401);
  });
  it('serves the assigned employee through the authenticated route but denies development administration', async () => {
    const { a, target } = await fixture();
    await h.prisma.user.create({ data: {
      email: 'evidence@test.local', fullName: 'Evidence staff', role: 'employee', employeeId: a.employeeId,
      mustChangePw: false, passwordHash: await hashPassword('test-password-123'),
    } });
    const staff = await loginReady(h, 'evidence@test.local', 'test-password-123');
    const response = await staff.http.get(`/api/v1/production/targets/${target.id}/evidence`).expect(200);
    expect(response.body.scope).toBe('self');
    expect(response.body.screenshotTotal).toBe(1);
    await staff.http.get('/api/v1/me/telegram-ai/data?topic=development').expect(403);
  });
});
