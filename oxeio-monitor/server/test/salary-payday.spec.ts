import { describe, expect, it } from 'vitest';

import { salaryDueOn } from '../src/payroll/salary-payday';

describe('salary payday', () => {
  it('schedules the prior month salary on the next month’s fifth', () => {
    expect(salaryDueOn('2026-09')).toBe('2026-10-05');
  });

  it('rolls December salary to 5 January', () => {
    expect(salaryDueOn('2026-12')).toBe('2027-01-05');
  });
});
