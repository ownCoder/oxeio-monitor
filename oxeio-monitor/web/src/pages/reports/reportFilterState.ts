import type { GroupBy } from '../../api/reports';

export type ReportTab = 'attendance' | 'summary' | 'productivity' | 'payroll';
export type ReportFilterKey = 'date' | 'staff' | 'group' | 'limit' | 'month';

export function activeReportFilters(input: {
  tab: ReportTab;
  from: string;
  to: string;
  defaultFrom: string;
  defaultTo: string;
  employeeId: number | null;
  groupBy: GroupBy;
  limit: number;
  defaultLimit: number;
  month: string;
  currentMonth: string;
}): ReportFilterKey[] {
  if (input.tab === 'payroll') {
    return input.month === input.currentMonth ? [] : ['month'];
  }

  const filters: ReportFilterKey[] = [];
  if (input.from !== input.defaultFrom || input.to !== input.defaultTo) filters.push('date');
  if (input.employeeId !== null) filters.push('staff');
  if (input.tab === 'summary' && input.groupBy !== 'month') filters.push('group');
  if (input.tab === 'productivity' && input.limit !== input.defaultLimit) filters.push('limit');
  return filters;
}
