import type { Baseline } from '../models/types';

export function computeBaseline(
  attemptsSec: number[],
  firstContractionSec: number | null,
  id: string,
  measuredAt: number,
): Baseline {
  if (attemptsSec.length === 0) {
    throw new Error('computeBaseline requires at least one attempt');
  }
  return {
    id,
    maxHoldSec: Math.max(...attemptsSec),
    firstContractionSec,
    measuredAt,
  };
}
