import { unionSec } from '../summary/summary.math';

export interface EvidenceTrace {
  employeeId: number;
  fullName: string;
  empCode: string;
  deviceId: number;
  processName: string;
  workDate: Date;
  startedAt: Date;
  endedAt: Date;
}

/** File foreground observations, not payroll credit or proof of quality. */
export function summarizeEvidence(rows: readonly EvidenceTrace[]) {
  const people = new Map<number, EvidenceTrace[]>();
  for (const row of rows) {
    const own = people.get(row.employeeId) ?? [];
    own.push(row);
    people.set(row.employeeId, own);
  }
  const byPerson = [...people.entries()].map(([employeeId, own]) => ({
    employeeId, fullName: own[0].fullName, empCode: own[0].empCode,
    foregroundSec: unionSec(own), observations: own.length,
  })).sort((a, b) => b.foregroundSec - a.foregroundSec || a.empCode.localeCompare(b.empCode));
  return {
    foregroundSec: byPerson.reduce((sum, person) => sum + person.foregroundSec, 0),
    byPerson,
    firstSeenAt: rows.length ? new Date(Math.min(...rows.map(r => r.startedAt.getTime()))).toISOString() : null,
    lastSeenAt: rows.length ? new Date(Math.max(...rows.map(r => r.endedAt.getTime()))).toISOString() : null,
  };
}
