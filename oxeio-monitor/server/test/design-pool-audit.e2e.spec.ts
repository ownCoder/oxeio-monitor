import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TargetsService } from '../src/targets/targets.service';
import { createHarness, resetDatabase, hashPassword, loginReady, dhakaNoon, OWNER_EMAIL, OWNER_PASSWORD, MANAGER_EMAIL, MANAGER_PASSWORD, type Harness } from './setup/harness';

let h: Harness;
let ownerId: number;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  ownerId = (await h.prisma.user.findFirstOrThrow({ where: { role: 'owner' } })).id;
});
const service = () => h.app.get(TargetsService);
const row = () => h.prisma.designTarget.create({ data: { asin: 'B000000001', addedById: ownerId } });

describe('Design Pool audit regressions', () => {
  it('filters progress, skip reason and added date before paging, then sorts stably', async () => {
    const at = (date: string) => new Date(`${date}T12:00:00+06:00`);
    const make = (asin: string, addedAt: string, data: { status?: 'assigned' | 'skipped' | 'deleted'; startedAt?: Date; dropReason?: 'copyright' | 'not_found' } = {}) =>
      h.prisma.designTarget.create({ data: { asin, addedById: ownerId, addedAt: at(addedAt), ...data } });
    await make('B000000011', '2026-10-01');
    await make('B000000012', '2026-10-02', { status: 'assigned' });
    const started = await make('B000000013', '2026-10-03', { status: 'assigned', startedAt: at('2026-10-03') });
    const skipped = await make('B000000014', '2026-10-04', { status: 'skipped', dropReason: 'copyright' });
    await make('B000000015', '2026-10-05', { status: 'deleted', dropReason: 'not_found' });
    expect((await service().list({ poolProgress: 'started' })).rows.map(r => r.id)).toEqual([started.id]);
    expect((await service().list({ poolProgress: 'not_started' })).total).toBe(1);
    expect((await service().list({ poolReason: 'copyright' })).rows.map(r => r.id)).toEqual([skipped.id]);
    expect((await service().list({ addedFrom: '2026-10-03', addedTo: '2026-10-04', poolSort: 'added_oldest' })).rows.map(r => r.asin)).toEqual(['B000000013', 'B000000014']);
    await expect(service().list({ addedFrom: '2026-10-05', addedTo: '2026-10-04' })).rejects.toThrow('Added from date');
  });
  it('rejects reversed date ranges with a useful error', async () => {
    await expect(service().list({ from: '2026-09-28', to: '2026-09-27' })).rejects.toThrow('From date');
  });
  it.each(['researcher', 'employee'] as const)('blocks both delete routes for a researcher using portal role %s', async role => {
    const target = await row();
    const employee = await h.prisma.employee.create({ data: { empCode: 'POOL-R', fullName: 'Researcher', staffType: 'researcher' } });
    await h.prisma.user.create({ data: { email: 'pool-r@test.local', fullName: 'Researcher', role, employeeId: employee.id, passwordHash: await hashPassword('pool-password-123'), mustChangePw: false } });
    const r = await loginReady(h, 'pool-r@test.local', 'pool-password-123');
    await r.http.get('/api/v1/design-targets').expect(role === 'researcher' ? 200 : 403);
    await r.http.post('/api/v1/design-targets/delete').set('X-CSRF-Token', r.csrf).send({ ids: [target.id], reason: 'not_found' }).expect(403);
    await r.http.delete(`/api/v1/design-targets/${target.id}?reason=not_found`).set('X-CSRF-Token', r.csrf).expect(403);
    expect((await h.prisma.designTarget.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('pool');
  });

  it.each([[OWNER_EMAIL, OWNER_PASSWORD], [MANAGER_EMAIL, MANAGER_PASSWORD]])('retains authorized bulk delete for %s', async (email, password) => {
    const target = await row();
    const user = await loginReady(h, email, password);
    const result = await user.http.post('/api/v1/design-targets/delete').set('X-CSRF-Token', user.csrf).send({ ids: [target.id], reason: 'not_found' }).expect(201);
    expect(result.body.deleted).toBe(1);
  });

  it('blocks uploading an unfixed error, then allows upload after the fix', async () => {
    const target = await row();
    await h.prisma.designTarget.update({ where: { id: target.id }, data: { status: 'done', completedAt: dhakaNoon(), checkedAt: dhakaNoon(), errorFoundAt: dhakaNoon() } });
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await owner.http.post(`/api/v1/design-targets/${target.id}/uploaded`).set('X-CSRF-Token', owner.csrf).send({}).expect(400);
    expect((await h.prisma.designTarget.findUniqueOrThrow({ where: { id: target.id } })).uploadedAt).toBeNull();
    await service().markFixed(target.id, ownerId, dhakaNoon());
    await owner.http.post(`/api/v1/design-targets/${target.id}/uploaded`).set('X-CSRF-Token', owner.csrf).send({}).expect(201);
  });

  it('does not advance a skipped target with stale completion fields', async () => {
    const target = await row();
    await h.prisma.designTarget.update({ where: { id: target.id }, data: { status: 'skipped', completedAt: dhakaNoon() } });
    await expect(service().markUploaded(target.id, dhakaNoon(), ownerId)).rejects.toThrow('Only completed designs');
    for (const stage of ['to_check', 'to_fix', 'to_upload', 'to_live', 'no_file'] as const) {
      expect((await service().list({ stage })).total).toBe(0);
    }
    expect(await service().stats()).toMatchObject({ toCheck: 0, toFix: 0, toUpload: 0, toLive: 0 });
  });

  it('keeps completion-date results after a later upload/live, across Dhaka midnight', async () => {
    const target = await row();
    await h.prisma.designTarget.update({ where: { id: target.id }, data: { status: 'done', completedAt: new Date('2026-09-27T23:59:59+06:00'), uploadedAt: new Date('2026-09-28T00:00:00+06:00'), liveAt: new Date('2026-09-29T12:00:00+06:00') } });
    expect((await service().list({ status: 'done', from: '2026-09-27', to: '2026-09-27' })).rows.map(r => r.id)).toContain(target.id);
    expect((await service().list({ status: 'done', from: '2026-09-28', to: '2026-09-28' })).total).toBe(0);
  });
});
