import { describe, expect, it } from 'vitest';
import type { TargetRow } from '../src/api/targets';
import { targetsCsv } from '../src/pages/targets/export';

const target = (overrides: Partial<TargetRow> = {}) => ({
  asin: 'B000000001', jobNumber: 100001, status: 'assigned', skipReviewPending: false,
  assignedTo: { fullName: 'Designer' }, addedBy: { fullName: 'Researcher' },
  addedAt: '2026-09-28T04:00:00.000Z', completedAt: null, skipRequestedAt: null, dropReason: null,
  ...overrides,
} as TargetRow);

describe('Design Pool CSV', () => {
  it('exports only supplied page rows, with a UTF-8 BOM and stable columns', () => {
    const csv = targetsCsv([target()]);
    expect(csv.startsWith('\uFEFF"ASIN","Job number"')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"B000000001","100001","assigned","Designer"');
  });
  it('quotes names and neutralizes formulas', () => {
    const csv = targetsCsv([target({ assignedTo: { fullName: '=HYPERLINK("x")' } as TargetRow['assignedTo'], addedBy: { fullName: 'Name, "quoted"' } as TargetRow['addedBy'] })]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"Name, ""quoted"""');
  });
  it('labels pending review instead of reporting it as a normal assignment', () => {
    expect(targetsCsv([target({ skipReviewPending: true })])).toContain('"pending_skip_review"');
  });
});
