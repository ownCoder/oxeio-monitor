import { describe, expect, it } from 'vitest';
import { summarizeEstimates } from '../src/production/estimate.math';

describe('estimate comparison', () => {
  it('uses per-design medians and keeps sample counts visible', () => {
    expect(summarizeEstimates([
      { workType: 'graphic', estimatedMinutes: 60, observedSec: 7200 },
      { workType: 'graphic', estimatedMinutes: 90, observedSec: 5400 },
      { workType: 'graphic', estimatedMinutes: 120, observedSec: 3600 },
      { workType: 'typography', estimatedMinutes: 30, observedSec: 1800 },
    ])).toEqual([
      { workType: 'graphic', samples: 3, medianEstimateMinutes: 90, medianObservedMinutes: 90, medianVariancePct: 0, overEstimate: 1 },
      { workType: 'typography', samples: 1, medianEstimateMinutes: 30, medianObservedMinutes: 30, medianVariancePct: 0, overEstimate: 0 },
    ]);
  });
});
