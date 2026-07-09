import { createStore } from 'zustand/vanilla';
import type { SessionPlan, RoundResult, Rpe, Session } from '../../domain/models/types';
import { applyTapOut } from '../../domain/apnea/adaptationEngine';

export type RunnerPhase = 'breatheUp' | 'hold' | 'recover' | 'done';

export interface SessionRunnerStore {
  plan: SessionPlan | null;
  difficultyLevel: number;
  roundIndex: number;
  phase: RunnerPhase;
  startedAt: number;
  results: RoundResult[];
  start(plan: SessionPlan, difficultyLevel: number): void;
  setPhase(phase: RunnerPhase): void;
  recordRound(achievedHoldSec: number, contractions: number, tappedOut: boolean): void;
  finish(rpe: Rpe): Session;
}

export function createSessionRunnerStore(now: () => number) {
  return createStore<SessionRunnerStore>((set, get) => ({
    plan: null,
    difficultyLevel: 0,
    roundIndex: 0,
    phase: 'breatheUp',
    startedAt: 0,
    results: [],
    start(plan, difficultyLevel) {
      set({ plan, difficultyLevel, roundIndex: 0, phase: 'breatheUp', startedAt: now(), results: [] });
    },
    setPhase(phase) { set({ phase }); },
    recordRound(achievedHoldSec, contractions, tappedOut) {
      const s = get();
      if (!s.plan) return;
      const round = s.plan.rounds[s.roundIndex];
      const result: RoundResult = {
        index: round.index,
        targetHoldSec: round.targetHoldSec,
        achievedHoldSec,
        restBeforeSec: round.restBeforeSec,
        contractions,
        tappedOut,
      };
      const plan = tappedOut ? applyTapOut(s.plan, s.roundIndex) : s.plan;
      set({ results: [...s.results, result], plan, roundIndex: s.roundIndex + 1 });
    },
    finish(rpe) {
      const s = get();
      const completedRounds = s.results.filter((r) => !r.tappedOut).length;
      const tapOuts = s.results.filter((r) => r.tappedOut).length;
      const session: Session = {
        id: `session-${s.startedAt}`,
        type: s.plan?.type ?? 'CO2',
        rounds: s.results,
        startedAt: s.startedAt,
        finishedAt: now(),
        completedRounds,
        tapOuts,
        rpe,
        difficultyLevel: s.difficultyLevel,
      };
      set({ phase: 'done' });
      return session;
    },
  }));
}
