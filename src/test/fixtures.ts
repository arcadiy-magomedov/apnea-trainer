import { emptyAppState } from '../domain/models/appState';
import type { AppState, Baseline, RoundResult, Session } from '../domain/models/types';

export function makeRound(over: Partial<RoundResult> = {}): RoundResult {
  return {
    index: 0,
    targetHoldSec: 60,
    achievedHoldSec: 60,
    restBeforeSec: 0,
    contractions: 0,
    firstContractionSec: null,
    tappedOut: false,
    ...over,
  };
}

export function makeSession(over: Partial<Session> = {}): Session {
  const rounds = over.rounds ?? [makeRound()];
  return {
    id: 'session-1',
    type: 'CO2',
    rounds,
    startedAt: 1_000,
    finishedAt: 2_000,
    completedRounds: rounds.filter(
      (round) => !round.tappedOut && round.achievedHoldSec >= round.targetHoldSec,
    ).length,
    tapOuts: rounds.filter((round) => round.tappedOut).length,
    rpe: 'normal',
    difficultyLevel: 0,
    adjustment: null,
    ...over,
  };
}

export function makeBaseline(over: Partial<Baseline> = {}): Baseline {
  return {
    id: 'baseline-1',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 1_000,
    ...over,
  };
}

export function makeState(over: Partial<AppState> = {}): AppState {
  return { ...emptyAppState(), ...over };
}
