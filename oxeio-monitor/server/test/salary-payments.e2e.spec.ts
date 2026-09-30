import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness, loginReady, MANAGER_EMAIL, MANAGER_PASSWORD,
  OWNER_EMAIL, OWNER_PASSWORD, resetDatabase, type Harness, type Session,
} from './setup/harness';

const month = '2026-08';
let h: Harness;
let owner: Session;
let manager: Session;
let aliceId: number;
let bobId: number;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
  manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
  const alice = await h.prisma.employee.create({ data: { empCode: 'SAL-A', fullName: 'Alice Sample', monthlySalary: '20000.00' } });
  const bob = await h.prisma.employee.create({ data: { empCode: 'SAL-B', fullName: 'Bob Sample', monthlySalary: '15000.00' } });
  aliceId = alice.id;
  bobId = bob.id;
  await h.prisma.monthlySummary.create({ data: {
    employeeId: aliceId, yearMonth: month, expectedWorkdays: 26, monthWorkdays: 26,
    targetSec: 26 * 8 * 3600, creditedSec: 26 * 8 * 3600, observedWorkdays: 26,
  } });
});

function payment(employeeId: number, status: 'unpaid' | 'partial' | 'paid', amount: string, paidOn?: string) {
  return owner.http.put(`/api/v1/payroll/salary/${month}/${employeeId}/payment`)
    .set('X-CSRF-Token', owner.csrf)
    .send({ status, paidAmount: amount, ...(paidOn ? { paidOn } : {}) });
}

describe('owner salary payment tracking', () => {
  it('lists all staff, preserves unknown historical status, and exposes missing rollups', async () => {
    const res = await owner.http.get(`/api/v1/payroll/salary?month=${month}`).expect(200);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.find((r: { employeeId: number }) => r.employeeId === aliceId)).toMatchObject({
      monthlySalary: '20000.00', netPayable: '20000.00', payment: { status: 'not_recorded' },
    });
    expect(res.body.rows.find((r: { employeeId: number }) => r.employeeId === bobId)).toMatchObject({
      monthlySalary: '15000.00', netPayable: null, payment: { status: 'not_recorded' },
    });
    expect(res.body.missingSummary).toContain('Bob Sample');
    expect(await h.prisma.auditLog.count({ where: { action: 'payroll_view' } })).toBeGreaterThan(0);
  });

  it('records paid, partial and unpaid corrections with an atomic audit trail', async () => {
    await h.prisma.monthClosure.create({ data: { yearMonth: month, closedBy: OWNER_EMAIL } });
    await payment(aliceId, 'partial', '8000.00', '2026-08-31').expect(200);
    let res = await owner.http.get(`/api/v1/payroll/salary?month=${month}`).expect(200);
    expect(res.body.rows[0].payment).toMatchObject({ status: 'partial', paidAmount: '8000', paidOn: '2026-08-31' });
    await payment(aliceId, 'paid', '20000.00', '2026-08-31').expect(200);
    await payment(aliceId, 'unpaid', '0.00').expect(200);
    res = await owner.http.get(`/api/v1/payroll/salary?month=${month}`).expect(200);
    expect(res.body.rows[0].payment).toMatchObject({ status: 'unpaid', paidAmount: '0', paidOn: null });
    expect(await h.prisma.salaryPayment.count({ where: { employeeId: aliceId, yearMonth: month } })).toBe(1);
    const audits = await h.prisma.auditLog.findMany({ where: { action: 'salary_payment_update' }, orderBy: { id: 'asc' } });
    expect(audits).toHaveLength(3);
    expect(audits[2].meta).toMatchObject({ previous: { status: 'paid' }, next: { status: 'unpaid' } });
  });

  it('allows open-month records but requires exact amount and a calculated payable', async () => {
    await payment(aliceId, 'paid', '19999.00', '2026-08-31').expect(400);
    await payment(aliceId, 'partial', '20000.00', '2026-08-31').expect(400);
    await payment(bobId, 'paid', '15000.00', '2026-08-31').expect(400);
    await payment(aliceId, 'paid', '20000.00', '2026-02-30').expect(400);
    expect(await h.prisma.salaryPayment.count()).toBe(0);
    await payment(aliceId, 'paid', '20000.00', '2026-08-31').expect(200);
    expect((await h.prisma.salaryPayment.findFirstOrThrow({ where: { employeeId: aliceId } })).netPayableAtRecord?.toString()).toBe('20000');
  });

  it('keeps managers and unauthenticated users away from every salary endpoint', async () => {
    await h.http().get(`/api/v1/payroll/salary?month=${month}`).expect(401);
    await manager.http.get(`/api/v1/payroll/salary?month=${month}`).expect(403);
    await manager.http.put(`/api/v1/payroll/salary/${month}/${aliceId}/payment`)
      .set('X-CSRF-Token', manager.csrf).send({ status: 'unpaid', paidAmount: '0.00' }).expect(403);
    expect(await h.prisma.salaryPayment.count()).toBe(0);
  });
});
