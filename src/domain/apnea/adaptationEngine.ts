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

import type { Session, ProgressionDecision } from '../models/types';

function isClean(s: Session): boolean {
  return s.tapOuts === 0
    && s.completedRounds === s.rounds.length
    && (s.rpe === 'easy' || s.rpe === 'normal');
}
function isFailed(s: Session): boolean {
  return s.tapOuts > 0 || s.rpe === 'failed';
}

export function evaluateProgression(orderedSessions: Session[]): ProgressionDecision {
  const n = orderedSessions.length;
  const last3 = orderedSessions.slice(Math.max(0, n - 3));
  if (last3.length === 3 && last3.every(isFailed)) {
    return { action: 'deload', suggestRetest: true };
  }
  const last = orderedSessions[n - 1];
  if (last && isFailed(last)) {
    return { action: 'repeat', suggestRetest: false };
  }
  const last2 = orderedSessions.slice(Math.max(0, n - 2));
  if (last2.length === 2 && last2.every(isClean)) {
    return { action: 'progress', suggestRetest: false };
  }
  return { action: 'repeat', suggestRetest: false };
}
