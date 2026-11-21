import { describe, expect, it } from 'vitest';

import { activeReportFilters } from '../src/pages/reports/reportFilterState';

const defaults = {
  tab: 'attendance' as const,
  from: '2026-11-01',
  to: '2026-11-21',
  defaultFrom: '2026-11-01',
  defaultTo: '2026-11-21',
  employeeId: null,
  groupBy: 'month' as const,
  limit: 25,
  defaultLimit: 25,
  month: '2026-11',
  currentMonth: '2026-11',
};

describe('report active-filter state', () => {
  it('does not label the default report view as filtered', () => {
    expect(activeReportFilters(defaults)).toEqual([]);
  });

  it('counts shared and current-tab controls only', () => {
    expect(activeReportFilters({ ...defaults, tab: 'summary', from: '2026-11-15', employeeId: 12, groupBy: 'week' })).toEqual(['date', 'staff', 'group']);
    expect(activeReportFilters({ ...defaults, tab: 'productivity', groupBy: 'week', limit: 100 })).toEqual(['limit']);
  });

  it('keeps payroll month independent from hidden report filters', () => {
    expect(activeReportFilters({ ...defaults, tab: 'payroll', from: '2026-01-01', employeeId: 12, month: '2026-10' })).toEqual(['month']);
  });
});
