import type {
  ProgressionDecision,
  RoundResult,
  Session,
  SessionQuality,
  TrainingSessionType,
} from '../models/types';
import { APNEA_DEFAULTS } from './config';

type ThresholdsByRound = Readonly<Record<number, number>>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sameTypeSessions(sessions: readonly Session[], type: TrainingSessionType): Session[] {
  return sessions
    .filter((session) => session.type === type)
    .slice()
    .sort((a, b) => a.finishedAt - b.finishedAt);
}

function validRatios(rounds: readonly RoundResult[]): number[] {
  return rounds
    .map(contractionOnsetRatio)
    .filter((ratio): ratio is number => ratio !== null);
}

export function contractionOnsetRatio(round: RoundResult): number | null {
  if (round.targetHoldSec <= 0) return null;
  if (round.firstContractionSec === null || round.firstContractionSec < 0) return null;
  return round.firstContractionSec / round.targetHoldSec;
}

export function effectiveEarlyThreshold(
  sessions: readonly Session[],
  type: TrainingSessionType,
  roundIndex: number,
): number {
  const quality = APNEA_DEFAULTS.quality;
  const recentSessions = sameTypeSessions(sessions, type).slice(-quality.personalHistorySessions);
  const ratios = recentSessions
    .map((session) => session.rounds.find((round) => round.index === roundIndex))
    .flatMap((round) => (round ? validRatios([round]) : []));

  if (ratios.length < quality.personalSampleMin) {
    return quality.coldStartEarlyRatio;
  }

  return clamp(
    median(ratios)! * quality.personalMedianFactor,
    quality.personalThresholdMin,
    quality.personalThresholdMax,
  );
}

export function medianContractionOnsetRatio(
  sessions: readonly Session[],
  type: TrainingSessionType,
): number | null {
  const recentSessions = sameTypeSessions(sessions, type).slice(-APNEA_DEFAULTS.quality.personalHistorySessions);
  return median(validRatios(recentSessions.flatMap((session) => session.rounds)));
}

export function isEarlyRound(round: RoundResult, threshold: number): boolean {
  const ratio = contractionOnsetRatio(round);
  return ratio !== null && ratio < threshold;
}

export function shouldAutoEase(
  results: readonly RoundResult[],
  thresholds: ThresholdsByRound,
): boolean {
  if (results.length === 0) return false;

  const lastRound = results[results.length - 1];
  const lastRatio = contractionOnsetRatio(lastRound);
  if (lastRatio !== null && lastRatio < APNEA_DEFAULTS.quality.extremeEarlyRatio) {
    return true;
  }

  if (results.length < 2) return false;

  return results.slice(-2).every((round) => {
    const threshold = thresholds[round.index];
    return threshold !== undefined && isEarlyRound(round, threshold);
  });
}

export function roundCompleted(round: RoundResult): boolean {
  return !round.tappedOut && round.achievedHoldSec >= round.targetHoldSec;
}

export function classifySession(
  session: Session,
  priorSessions: readonly Session[] = [],
): SessionQuality | null {
  if (session.type === 'MAX' || session.rpe === null) {
    return null;
  }

  const sessionType = session.type;

  if (
    session.rpe === 'failed'
    || session.tapOuts > 0
    || session.rounds.some((round) => !roundCompleted(round))
  ) {
    return 'failed';
  }

  const earlyRound = session.rounds.some((round) => (
    isEarlyRound(round, effectiveEarlyThreshold(priorSessions, sessionType, round.index))
  ));

  if (session.rpe === 'hard' || session.adjustment !== null || earlyRound) {
    return 'strained';
  }

  return 'clean';
}

export function evaluateTypeProgression(
  sessions: readonly Session[],
  type: TrainingSessionType,
): ProgressionDecision {
  const ordered = sameTypeSessions(sessions, type);
  if (ordered.length === 0) {
    return { action: 'repeat', suggestRetest: false };
  }

  const currentLevel = ordered[ordered.length - 1].difficultyLevel;
  let suffixStart = ordered.length - 1;
  while (suffixStart > 0 && ordered[suffixStart - 1].difficultyLevel === currentLevel) {
    suffixStart -= 1;
  }

  const qualities = ordered
    .slice(suffixStart)
    .map((session, index) => classifySession(session, ordered.slice(0, suffixStart + index)));

  const last3 = qualities.slice(-3);
  if (last3.length === 3 && last3.every((quality) => quality === 'failed')) {
    return { action: 'deload', suggestRetest: true };
  }

  const last2 = qualities.slice(-2);
  if (last2.length === 2 && last2.every((quality) => quality === 'strained')) {
    return { action: 'deload', suggestRetest: false };
  }

  if (last2.length === 2 && last2.every((quality) => quality === 'clean')) {
    return { action: 'progress', suggestRetest: false };
  }

  return { action: 'repeat', suggestRetest: false };
}
