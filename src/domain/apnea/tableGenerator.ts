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

export function generateO2Table(maxHoldSec: number, difficultyLevel: number): SessionPlan {
  const o = APNEA_DEFAULTS.o2;
  const endPct = APNEA_DEFAULTS.o2SafetyCapPct;
  const startPct = Math.min(
    endPct - 0.05,
    o.holdStartPct + difficultyLevel * APNEA_DEFAULTS.difficulty.o2StartPctPerLevel,
  );
  const rounds: RoundPlan[] = [];
  for (let i = 0; i < o.rounds; i++) {
    const pct = startPct + (endPct - startPct) * (i / (o.rounds - 1));
    rounds.push({
      index: i,
      targetHoldSec: Math.min(
        Math.round(maxHoldSec * endPct),
        Math.round(maxHoldSec * pct),
      ),
      restBeforeSec: i === 0 ? 0 : o.restSec,
    });
  }
  return { type: 'O2', rounds };
}

import type { DayType } from '../models/types';

export function generateMaxTable(maxHoldSec: number): SessionPlan {
  return { type: 'MAX', rounds: [{ index: 0, targetHoldSec: maxHoldSec, restBeforeSec: 0 }] };
}

export function generatePlanForDay(
  day: DayType,
  maxHoldSec: number,
  difficultyLevel: number,
): SessionPlan | null {
  switch (day) {
    case 'CO2': return generateCo2Table(maxHoldSec, difficultyLevel);
    case 'O2': return generateO2Table(maxHoldSec, difficultyLevel);
    case 'MAX': return generateMaxTable(maxHoldSec);
    case 'REST': return null;
  }
}
