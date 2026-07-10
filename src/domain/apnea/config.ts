export const APNEA_DEFAULTS = {
  co2: { rounds: 8, holdPct: 0.55, restStartSec: 120, restStepSec: 15, restFloorSec: 15 },
  o2: { rounds: 8, restSec: 120, holdStartPct: 0.40, holdEndPct: 0.80 },
  breatheUpSec: 120,
  difficulty: { co2RestReducePerLevelSec: 5, o2StartPctPerLevel: 0.02 },
  detraining: { deloadDays: 7, retestDays: 14 },
  quality: {
    coldStartEarlyRatio: 0.50,
    extremeEarlyRatio: 0.25,
    personalSampleMin: 5,
    personalHistorySessions: 6,
    personalMedianFactor: 0.80,
    personalThresholdMin: 0.25,
    personalThresholdMax: 0.70,
    adjustmentRestStepSec: 15,
    profileLockDays: 7,
  },
  goal: {
    priorWeeklyGainFractionOfStart: 0.05,
    minRatePerDay: 0.05,
    blendK: 3,
    maxObservedPoints: 6,
    onTrackBandSec: 5,
    forecastHorizonDays: 3650,
    assessMinDays: 7,
    assessDefaultDays: 14,
    assessMaxDays: 21,
    implausibleFactor: 2.0,
  },
  recalibrationDays: 14,
  o2SafetyCapPct: 0.80,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
