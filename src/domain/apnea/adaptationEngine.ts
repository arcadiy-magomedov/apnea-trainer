import type { SessionPlan, RoundPlan } from '../models/types';
import { APNEA_DEFAULTS } from './config';

export function applyTapOut(plan: SessionPlan, failedRoundIndex: number): SessionPlan {
  const step = APNEA_DEFAULTS.co2.restStepSec;
  const cap = plan.rounds[failedRoundIndex]?.targetHoldSec ?? Infinity;
  const rounds: RoundPlan[] = plan.rounds.map((r) => {
    if (r.index <= failedRoundIndex) return { ...r };
    if (plan.type === 'CO2') {
      return {
        ...r,
        restBeforeSec: Math.min(APNEA_DEFAULTS.co2.restStartSec, r.restBeforeSec + step),
      };
    }
    if (plan.type === 'O2') {
      return { ...r, targetHoldSec: Math.min(r.targetHoldSec, cap) };
    }
    return { ...r };
  });
  return { type: plan.type, rounds };
}

export function applyEarlyContractionAdjustment(
  plan: SessionPlan,
  triggerRoundIndex: number,
): SessionPlan {
  if (plan.type === 'MAX') return plan;

  const restStepSec = APNEA_DEFAULTS.quality.adjustmentRestStepSec;
  const triggerRound = plan.rounds.find((round) => round.index === triggerRoundIndex);
  if (!triggerRound) {
    return {
      type: plan.type,
      rounds: plan.rounds.map((round) => ({ ...round })),
    };
  }
  const triggerTargetSec = triggerRound.targetHoldSec;

  return {
    type: plan.type,
    rounds: plan.rounds.map((round) => {
      if (round.index <= triggerRoundIndex) {
        return { ...round };
      }

      const adjusted: RoundPlan = {
        ...round,
        restBeforeSec: round.restBeforeSec + restStepSec,
      };

      if (plan.type === 'O2') {
        adjusted.targetHoldSec = Math.min(round.targetHoldSec, triggerTargetSec);
      }

      return adjusted;
    }),
  };
}
