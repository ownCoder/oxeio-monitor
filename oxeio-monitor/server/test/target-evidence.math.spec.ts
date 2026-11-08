import { describe, expect, it } from 'vitest';
import { summarizeEvidence, type EvidenceTrace } from '../src/production/target-evidence.math';
const row = (employeeId: number, from: number, to: number, deviceId = 1): EvidenceTrace => ({
  employeeId, empCode: `OX-${employeeId}`, fullName: `Person ${employeeId}`, deviceId,
  processName: 'illustrator.exe', workDate: new Date('2026-11-08'),
  startedAt: new Date(from * 1000), endedAt: new Date(to * 1000),
});
describe('file foreground evidence time', () => {
  it('merges overlapping device observations for one person', () => {
    const result = summarizeEvidence([row(1, 0, 60), row(1, 30, 90, 2), row(1, 90, 120)]);
    expect(result.foregroundSec).toBe(120);
    expect(result.byPerson[0].observations).toBe(3);
  });
  it('keeps the time contributed by different staff distinct', () => {
    expect(summarizeEvidence([row(1, 0, 60), row(2, 0, 60)]).foregroundSec).toBe(120);
  });
  it('does not invent observations when no matching trace exists', () => {
    expect(summarizeEvidence([])).toEqual({ foregroundSec: 0, byPerson: [], firstSeenAt: null, lastSeenAt: null });
  });
});
