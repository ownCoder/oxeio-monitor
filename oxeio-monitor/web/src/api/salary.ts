import { api } from './client';
import { qs } from './query';

export type PaymentStatus = 'not_recorded' | 'unpaid' | 'partial' | 'paid';

export interface SalaryRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  staffType: 'designer' | 'researcher' | 'manager' | null;
  monthlySalary: string | null;
  netPayable: string | null;
  payment: {
    status: PaymentStatus;
    paidAmount: string | null;
    paidOn: string | null;
    note: string | null;
    netPayableAtRecord: string | null;
    updatedAt: string | null;
  };
}

export interface SalaryOverview {
  yearMonth: string;
  closed: boolean;
  rows: SalaryRow[];
  missingSummary: string[];
  approximateHolidayDates: string[];
}

export interface RecordSalaryPayment {
  status: 'unpaid' | 'partial' | 'paid';
  paidAmount: string;
  paidOn?: string;
  note?: string;
}

export function getSalaryOverview(month: string, signal?: AbortSignal) {
  return api<SalaryOverview>(`/payroll/salary${qs({ month })}`, { signal });
}

export function recordSalaryPayment(month: string, employeeId: number, body: RecordSalaryPayment) {
  return api<{ ok: true }>(`/payroll/salary/${month}/${employeeId}/payment`, { method: 'PUT', body });
}
