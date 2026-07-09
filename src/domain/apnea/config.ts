export const APNEA_DEFAULTS = {
  co2: { rounds: 8, holdPct: 0.55, restStartSec: 120, restStepSec: 15, restFloorSec: 15 },
  o2: { rounds: 8, restSec: 120, holdStartPct: 0.40, holdEndPct: 0.80 },
  breatheUpSec: 120,
  difficulty: { co2RestReducePerLevelSec: 5, o2StartPctPerLevel: 0.02 },
  detraining: { deloadDays: 7, retestDays: 14 },
  recalibrationDays: 14,
  o2SafetyCapPct: 0.80,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
