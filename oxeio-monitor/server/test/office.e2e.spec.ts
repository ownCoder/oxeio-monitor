import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OfficeService } from '../src/office/office.service';
import type { SessionUser } from '../src/auth/types';
import {
  createHarness,
  resetDatabase,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  type Harness,
} from './setup/harness';
let h: Harness,
  office: OfficeService,
  owner: SessionUser,
  alice: SessionUser,
  bob: SessionUser,
  targetId: number;
beforeAll(async () => {
  h = await createHarness();
  office = h.app.get(OfficeService);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const o = await h.prisma.user.findFirstOrThrow({ where: { role: 'owner' } });
  owner = {
    userId: o.id,
    email: o.email,
    role: 'owner',
    employeeId: null,
    mustChangePw: false,
    issuedAt: 0,
  };
  async function person(code: string) {
    const employee = await h.prisma.employee.create({
      data: { empCode: code, fullName: code, staffType: 'designer' },
    });
    const user = await h.prisma.user.create({
      data: {
        email: `${code}@test.local`,
        fullName: code,
        passwordHash: o.passwordHash,
        role: 'employee',
        employeeId: employee.id,
        mustChangePw: false,
      },
    });
    return {
      ...owner,
      userId: user.id,
      email: user.email,
      role: 'employee' as const,
      employeeId: employee.id,
    };
  }
  alice = await person('ALICE');
  bob = await person('BOB');
  targetId = (
    await h.prisma.designTarget.create({
      data: {
        asin: 'B000000001',
        addedById: owner.userId,
        assignedToId: alice.employeeId,
        status: 'assigned',
        jobNumber: 1000010,
      },
    })
  ).id;
});
describe('office workflow isolation and history', () => {
  it('staff help requests do not change assignment, skips or payroll and are private', async () => {
    const content = {
      category: 'tool',
      detail: 'App cannot open file',
      state: 'open',
      response: '',
    };
    const row = await office.save(alice, {
      kind: 'blocker',
      title: 'Need help',
      employeeId: alice.employeeId!,
      targetId,
      content,
    });
    expect((await office.list(bob, { kind: 'blocker' })).total).toBe(0);
    await expect(office.get(bob, row.id)).rejects.toThrow('not found');
    await expect(
      office.save(bob, {
        kind: 'blocker',
        title: 'Wrong owner',
        employeeId: bob.employeeId!,
        targetId,
        content,
      }),
    ).rejects.toThrow('not assigned');
    await expect(
      office.save(alice, {
        kind: 'blocker',
        title: 'Self resolve',
        employeeId: alice.employeeId!,
        targetId,
        content: { ...content, state: 'resolved' },
      }),
    ).rejects.toThrow('Managers resolve');
    const target = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id: targetId },
    });
    expect(target.status).toBe('assigned');
    expect(target.assignedToId).toBe(alice.employeeId);
    expect(await h.prisma.designSkipRequest.count()).toBe(0);
    expect(await h.prisma.timeAdjustment.count()).toBe(0);
expect(await office.today(alice)).toEqual({openHelp:1,assigned:1});
expect(await office.today(bob)).toEqual({openHelp:0,assigned:0});
  });
  it('version checks prevent lost updates; content and audit roll back together', async () => {
    const row = await office.save(owner, {
      kind: 'sop',
      title: 'Guide',
      content: { body: 'First' },
    });
    const results = await Promise.allSettled([
      office.save(
        owner,
        { kind: 'sop', title: 'Guide', version: 1, content: { body: 'A' } },
        row.id,
      ),
      office.save(
        owner,
        { kind: 'sop', title: 'Guide', version: 1, content: { body: 'B' } },
        row.id,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await h.prisma.officeEvent.count({ where: { entryId: row.id } }),
    ).toBe(2);
    expect((await office.get(owner, row.id)).version).toBe(2);
  });
  it('SOP acknowledgement is version-specific, idempotent and stale-safe', async () => {
    const row = await office.save(owner, {
      kind: 'sop',
      title: 'Guide',
      content: { body: 'Read this' },
    });
    await office.ack(alice, row.id, 1);
    await office.ack(alice, row.id, 1);
    expect(await h.prisma.officeAcknowledgement.count()).toBe(1);
    await office.save(
      owner,
      { kind: 'sop', title: 'Guide', version: 1, content: { body: 'Changed' } },
      row.id,
    );
    await expect(office.ack(alice, row.id, 1)).rejects.toThrow('current');
    expect((await office.get(bob, row.id)).acknowledgements).toHaveLength(0);
  });
  it('technical checks retain reviewed checklist version and reject changed templates', async () => {
    const template = await office.save(owner, {
      kind: 'checklist_template',
      title: 'PNG',
      content: {
        items: ['Correct output'],
        format: 'png',
        width: 4500,
        height: 5400,
      },
    });
    const draft = {
      kind: 'submission' as const,
      title: 'Preflight',
      employeeId: alice.employeeId!,
      targetId,
      content: {
        checklistId: template.id,
        checklistVersion: 1,
        checked: [true],
        fileName: '1000010-design.png',
        format: 'png',
        width: 4500,
        height: 5400,
        note: '',
      },
    };
    const row = await office.save(alice, draft);
    expect((row.content as { warnings: unknown[] }).warnings).toEqual([]);
    await office.save(
      owner,
      {
        kind: 'checklist_template',
        title: 'PNG',
        version: 1,
        content: {
          items: ['New check'],
          format: 'png',
          width: 4500,
          height: 5400,
        },
      },
      template.id,
    );
    await expect(office.save(alice, draft)).rejects.toThrow(
      'Checklist changed',
    );
    expect((await office.get(alice, row.id)).content).toMatchObject({
      items: ['Correct output'],
      checklistVersion: 1,
    });
  });
  it('brief visibility follows current assignment and managers maintain coaching records', async () => {
    const row = await office.save(owner, {
      kind: 'brief',
      title: 'Design brief',
      targetId,
      content: { output: 'PNG with source' },
    });
    expect((await office.list(alice, { kind: 'brief' })).total).toBe(1);
    await h.prisma.designTarget.update({
      where: { id: targetId },
      data: { assignedToId: bob.employeeId },
    });
    await expect(office.get(alice, row.id)).rejects.toThrow('not found');
    expect((await office.list(bob, { kind: 'brief' })).total).toBe(1);
    await expect(
      office.save(alice, {
        kind: 'coaching',
        title: 'Self rating',
        employeeId: alice.employeeId!,
        content: {
          skills: [{ name: 'Typography', level: 5 }],
          goal: 'Practice',
        },
      }),
    ).rejects.toThrow('managers');
  });
  it('asset handovers are audited, duplicate tags rejected, archive can restore', async () => {
    const content = { tag: 'PC-01', state: 'in_use', note: 'Issued' };
    const row = await office.save(owner, {
      kind: 'asset',
      title: 'Office PC',
      employeeId: alice.employeeId!,
      content,
    });
    await expect(
      office.save(owner, { kind: 'asset', title: 'Duplicate', content }),
    ).rejects.toThrow('already registered');
    const moved = await office.save(
      owner,
      {
        kind: 'asset',
        title: 'Office PC',
        employeeId: bob.employeeId!,
        version: 1,
        content: { ...content, note: 'Handed over' },
      },
      row.id,
    );
    expect((await office.list(alice, { kind: 'asset' })).total).toBe(0);
    expect((await office.get(bob, row.id)).events).toHaveLength(2);
    const archived = await office.archive(owner, row.id, {
      version: moved.version,
      archived: true,
    });
    expect((await office.list(owner, { kind: 'asset' })).total).toBe(0);
    expect(
      (await office.list(owner, { kind: 'asset', archived: 'yes' })).total,
    ).toBe(1);
    await office.archive(owner, row.id, {
      version: archived.version,
      archived: false,
    });
    expect((await office.list(owner, { kind: 'asset' })).total).toBe(1);
  });
  it('HTTP authentication and strict DTO fields protect the office API', async () => {
    await h.http().get('/api/v1/office').expect(401);
    const { http, csrf } = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await http
      .post('/api/v1/office')
      .set('X-CSRF-Token', csrf)
      .send({
        kind: 'sop',
        title: 'Guide',
        content: { body: 'Instructions' },
        salary: 1,
      })
      .expect(400);
    await http
      .post('/api/v1/office')
      .set('X-CSRF-Token', csrf)
      .send({ kind: 'sop', title: 'Guide', content: { body: 'Instructions' } })
      .expect(201);
  });
});
