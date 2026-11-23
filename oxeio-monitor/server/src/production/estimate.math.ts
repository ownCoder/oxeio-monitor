export interface EstimateSample {
  workType: string;
  estimatedMinutes: number;
  observedSec: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeEstimates(samples: readonly EstimateSample[]) {
  const groups = new Map<string, EstimateSample[]>();
  for (const sample of samples) groups.set(sample.workType, [...(groups.get(sample.workType) ?? []), sample]);
  return [...groups.entries()].map(([workType, rows]) => ({
    workType,
    samples: rows.length,
    medianEstimateMinutes: Math.round(median(rows.map(row => row.estimatedMinutes))),
    medianObservedMinutes: Math.round(median(rows.map(row => row.observedSec / 60))),
    medianVariancePct: Math.round(median(rows.map(row => ((row.observedSec / 60 - row.estimatedMinutes) / row.estimatedMinutes) * 100))),
    overEstimate: rows.filter(row => row.observedSec > row.estimatedMinutes * 60).length,
  })).sort((a, b) => b.samples - a.samples || a.workType.localeCompare(b.workType));
}
