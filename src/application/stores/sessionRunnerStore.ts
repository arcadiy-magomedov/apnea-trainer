import { createStore } from 'zustand/vanilla';
import type {
  InSessionAdjustment,
  RoundResult,
  Session,
  SessionPlan,
} from '../../domain/models/types';
import { applyEarlyContractionAdjustment, applyTapOut } from '../../domain/apnea/adaptationEngine';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';
import { roundCompleted, shouldAutoEase } from '../../domain/apnea/qualityEngine';

export type RunnerPhase = 'breatheUp' | 'hold' | 'recover' | 'done';

export interface SessionRunnerStore {
  plan: SessionPlan | null;
  difficultyLevel: number;
  earlyThresholds: number[];
  roundIndex: number;
  phase: RunnerPhase;
  startedAt: number;
  results: RoundResult[];
  adjustment: InSessionAdjustment | null;
  start(plan: SessionPlan, difficultyLevel: number, earlyThresholds: number[]): void;
  setPhase(phase: RunnerPhase): void;
  recordRound(
    achievedHoldSec: number,
    contractions: number,
    firstContractionSec: number | null,
    tappedOut: boolean,
  ): void;
  finishDraft(): Session;
}

function validateRoundInputs(
  achievedHoldSec: number,
  contractions: number,
  firstContractionSec: number | null,
): void {
  if (!Number.isFinite(achievedHoldSec) || achievedHoldSec < 0) {
    throw new Error('Achieved hold must be a finite non-negative number.');
  }

  if (!Number.isInteger(contractions) || contractions < 0) {
    throw new Error('Contractions must be a non-negative integer.');
  }

  if (firstContractionSec !== null) {
    if (!Number.isFinite(firstContractionSec) || firstContractionSec < 0) {
      throw new Error('First contraction onset must be a finite non-negative number.');
    }

    if (firstContractionSec > achievedHoldSec) {
      throw new Error('First contraction onset cannot be later than the achieved hold.');
    }
  }

  const hasOnset = firstContractionSec !== null;
  if ((contractions > 0) !== hasOnset) {
    throw new Error('First contraction onset and positive contraction count must be recorded together.');
  }
}

function getTapOutMaxRestDelta(planBefore: SessionPlan, planAfter: SessionPlan, roundIndex: number): number {
  let maxDelta = 0;

  for (let index = roundIndex + 1; index < planBefore.rounds.length; index += 1) {
    const roundBefore = planBefore.rounds[index];
    const roundAfter = planAfter.rounds[index];

    if (!roundBefore || !roundAfter) {
      continue;
    }

    maxDelta = Math.max(maxDelta, roundAfter.restBeforeSec - roundBefore.restBeforeSec);
  }

  return maxDelta;
}

function toThresholdMap(earlyThresholds: readonly number[]): Record<number, number> {
  return Object.fromEntries(
    earlyThresholds.map((threshold, index) => [index, threshold]),
  ) as Record<number, number>;
}

export function createSessionRunnerStore(now: () => number) {
  return createStore<SessionRunnerStore>((set, get) => ({
    plan: null,
    difficultyLevel: 0,
    earlyThresholds: [],
    roundIndex: 0,
    phase: 'breatheUp',
    startedAt: 0,
    results: [],
    adjustment: null,
    start(plan, difficultyLevel, earlyThresholds) {
      set({
        plan,
        difficultyLevel,
        earlyThresholds: [...earlyThresholds],
        roundIndex: 0,
        phase: 'breatheUp',
        startedAt: now(),
        results: [],
        adjustment: null,
      });
    },
    setPhase(phase) {
      set({ phase });
    },
    recordRound(achievedHoldSec, contractions, firstContractionSec, tappedOut) {
      const state = get();
      if (!state.plan) {
        throw new Error('Cannot record a round before session start.');
      }

      const round = state.plan.rounds[state.roundIndex];
      if (!round) {
        throw new Error('Cannot record a round outside active plan.');
      }

      validateRoundInputs(achievedHoldSec, contractions, firstContractionSec);

      const result: RoundResult = {
        index: round.index,
        targetHoldSec: round.targetHoldSec,
        achievedHoldSec,
        restBeforeSec: round.restBeforeSec,
        contractions,
        firstContractionSec,
        tappedOut,
      };
      const results = [...state.results, result];

      let plan = state.plan;
      let adjustment = state.adjustment;

      if (tappedOut) {
        const nextPlan = applyTapOut(state.plan, state.roundIndex);
        const priorRestAddedSec = state.adjustment?.restAddedSec ?? 0;

        plan = nextPlan;
        adjustment = {
          reason: 'tap-out',
          triggeredAtRoundIndex: round.index,
          restAddedSec: priorRestAddedSec + getTapOutMaxRestDelta(state.plan, nextPlan, state.roundIndex),
          holdCapSec: state.plan.type === 'O2' ? round.targetHoldSec : null,
        };
      } else if (
        state.adjustment === null
        && state.plan.type !== 'MAX'
        && shouldAutoEase(results, toThresholdMap(state.earlyThresholds))
      ) {
        plan = applyEarlyContractionAdjustment(state.plan, state.roundIndex);
        adjustment = {
          reason: 'early-contractions',
          triggeredAtRoundIndex: round.index,
          restAddedSec: APNEA_DEFAULTS.quality.adjustmentRestStepSec,
          holdCapSec: state.plan.type === 'O2' ? round.targetHoldSec : null,
        };
      }

      set({
        results,
        plan,
        adjustment,
        roundIndex: state.roundIndex + 1,
      });
    },
    finishDraft() {
      const state = get();
      if (!state.plan) {
        throw new Error('Cannot finish draft before session start.');
      }

      const completedRounds = state.plan.type === 'MAX'
        ? state.results.filter((round) => !round.tappedOut).length
        : state.results.filter(roundCompleted).length;
      const tapOuts = state.results.filter((round) => round.tappedOut).length;
      const session: Session = {
        id: `session-${state.startedAt}`,
        type: state.plan.type,
        rounds: state.results,
        startedAt: state.startedAt,
        finishedAt: now(),
        completedRounds,
        tapOuts,
        rpe: null,
        difficultyLevel: state.difficultyLevel,
        adjustment: state.adjustment,
      };

      set({ phase: 'done' });
      return session;
    },
  }));
}
