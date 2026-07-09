import type { SessionPlan, RoundPlan } from '../models/types';
import { APNEA_DEFAULTS } from './config';

export function generateCo2Table(maxHoldSec: number, difficultyLevel: number): SessionPlan {
  const c = APNEA_DEFAULTS.co2;
  const hold = Math.round(maxHoldSec * c.holdPct);
  const reduce = difficultyLevel * APNEA_DEFAULTS.difficulty.co2RestReducePerLevelSec;
  const rounds: RoundPlan[] = [];
  for (let i = 0; i < c.rounds; i++) {
    const restBeforeSec = i === 0
      ? 0
      : Math.max(c.restFloorSec, c.restStartSec - (i - 1) * c.restStepSec - reduce);
    rounds.push({ index: i, targetHoldSec: hold, restBeforeSec });
  }
  return { type: 'CO2', rounds };
}
