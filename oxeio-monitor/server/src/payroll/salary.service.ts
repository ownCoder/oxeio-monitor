import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { salaryForMonth } from './payroll.math';
import { salaryDueOn } from './salary-payday';
import { PayrollService } from './payroll.service';
import type { RecordSalaryPaymentDto } from './salary.dto';

export interface SalaryOverviewRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  staffType: 'designer' | 'researcher' | 'manager' | null;
  monthlySalary: string | null;
  netPayable: string | null;
  payment: {
    status: 'not_recorded' | 'unpaid' | 'partial' | 'paid';
    paidAmount: string | null;
    paidOn: string | null;
    note: string | null;
    netPayableAtRecord: string | null;
    updatedAt: string | null;
  };
}

export interface SalaryOverview {
  yearMonth: string;
  dueOn: string;
  closed: boolean;
  rows: SalaryOverviewRow[];
  missingSummary: string[];
  approximateHolidayDates: string[];
}

function checkMonth(yearMonth: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new BadRequestException('The month must be in YYYY-MM format');
  }
}

function paymentDay(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('paidOn must be a real date in YYYY-MM-DD format');
  }
  if (date > workDateOf(new Date())) throw new BadRequestException('Payment date cannot be in the future');
  return date;
}

@Injectable()
export class SalaryService {
  constructor(private readonly prisma: PrismaService, private readonly payroll: PayrollService) {}

  async overview(yearMonth: string, actorUserId: number, ip: string): Promise<SalaryOverview> {
    checkMonth(yearMonth);
    // PayrollService owns all salary math and writes the owner-only view audit.
    const sheet = await this.payroll.sheet(yearMonth, actorUserId, ip);
    const monthStart = new Date(`${yearMonth}-01T00:00:00.000Z`);
    const employees = await this.prisma.employee.findMany({
      where: { OR: [{ status: EmployeeStatus.active }, { leftOn: { gte: monthStart } }] },
      select: {
        id: true, empCode: true, fullName: true, staffType: true, monthlySalary: true,
        salaryPeriods: {
          where: { throughMonth: { gte: yearMonth } },
          select: { throughMonth: true, monthlySalary: true },
        },
      },
      orderBy: { empCode: 'asc' },
    });
    const [payments, closure] = await Promise.all([
      this.prisma.salaryPayment.findMany({ where: { yearMonth, employeeId: { in: employees.map(e => e.id) } } }),
      this.prisma.monthClosure.findUnique({ where: { yearMonth }, select: { yearMonth: true } }),
    ]);
    const payrollRows = new Map(sheet.rows.map(row => [row.employeeId, row]));
    const paymentsByEmployee = new Map(payments.map(payment => [payment.employeeId, payment]));
    return {
      yearMonth,
      dueOn: salaryDueOn(yearMonth),
      closed: !!closure,
      missingSummary: sheet.missingSummary,
      approximateHolidayDates: sheet.approximateHolidayDates,
      rows: employees.map(employee => {
        const row = payrollRows.get(employee.id);
        const payment = paymentsByEmployee.get(employee.id);
        const fallbackSalary = salaryForMonth(
          yearMonth,
          employee.monthlySalary === null ? null : String(employee.monthlySalary),
          employee.salaryPeriods.map(s => ({ throughMonth: s.throughMonth, monthlySalary: String(s.monthlySalary) })),
        );
        return {
          employeeId: employee.id,
          empCode: employee.empCode,
          fullName: employee.fullName,
          staffType: employee.staffType,
          monthlySalary: row?.monthlySalary ?? (fallbackSalary === null ? null : new Prisma.Decimal(fallbackSalary).toFixed(2)),
          netPayable: row?.netPayable ?? null,
          payment: payment ? {
            status: payment.status as 'unpaid' | 'partial' | 'paid',
            paidAmount: String(payment.paidAmount),
            paidOn: payment.paidOn?.toISOString().slice(0, 10) ?? null,
            note: payment.note,
            netPayableAtRecord: payment.netPayableAtRecord === null ? null : String(payment.netPayableAtRecord),
            updatedAt: payment.updatedAt.toISOString(),
          } : {
            status: 'not_recorded' as const,
            paidAmount: null,
            paidOn: null,
            note: null,
            netPayableAtRecord: null,
            updatedAt: null,
          },
        };
      }),
    };
  }

  async recordPayment(
    yearMonth: string,
    employeeId: number,
    body: RecordSalaryPaymentDto,
    actorUserId: number,
    ip: string,
  ): Promise<{ ok: true }> {
    checkMonth(yearMonth);
    if (!Number.isInteger(employeeId) || employeeId < 1) throw new BadRequestException('Invalid employee');
    const overview = await this.overview(yearMonth, actorUserId, ip);
    const row = overview.rows.find(item => item.employeeId === employeeId);
    if (!row) throw new NotFoundException('Staff member is not on this month’s salary list');

    const amount = new Prisma.Decimal(body.paidAmount);
    const due = row.netPayable === null ? null : new Prisma.Decimal(row.netPayable);
    const day = paymentDay(body.paidOn);
    if (body.status === 'unpaid') {
      if (!amount.isZero() || day !== null) throw new BadRequestException('Unpaid must have zero amount and no payment date');
    } else {
      if (due === null) throw new BadRequestException('Net payable is not calculated for this staff member');
      if (!day) throw new BadRequestException('A payment date is required');
      if (body.status === 'partial' && (amount.lte(0) || amount.gte(due))) {
        throw new BadRequestException('Partial amount must be greater than zero and less than net payable');
      }
      if (body.status === 'paid' && !amount.eq(due)) {
        throw new BadRequestException('Paid amount must equal the current net payable');
      }
    }
    const data = {
      status: body.status,
      paidAmount: amount,
      paidOn: day,
      note: body.note?.trim() || null,
      netPayableAtRecord: due,
      recordedById: actorUserId,
    };
    await this.prisma.$transaction(async tx => {
      const previous = await tx.salaryPayment.findUnique({ where: { employeeId_yearMonth: { employeeId, yearMonth } } });
      await tx.salaryPayment.upsert({
        where: { employeeId_yearMonth: { employeeId, yearMonth } },
        create: { employeeId, yearMonth, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'salary_payment_update',
          targetType: 'salary_payment',
          targetId: `${yearMonth}:${employeeId}`,
          ipAddress: ip,
          meta: {
            previous: previous ? { status: previous.status, paidAmount: String(previous.paidAmount), paidOn: previous.paidOn?.toISOString().slice(0, 10) ?? null } : null,
            next: { status: body.status, paidAmount: String(amount), paidOn: day?.toISOString().slice(0, 10) ?? null },
            netPayableAtRecord: due === null ? null : String(due),
          },
        },
      });
    });
    return { ok: true };
  }
}
