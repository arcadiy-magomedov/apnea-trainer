import type { AppState, Session, Baseline } from '../../domain/models/types';
import { completeSession } from '../../domain/apnea/courseEngine';
import { evaluateProgression } from '../../domain/apnea/adaptationEngine';

function applyProgression(difficulty: number, action: 'progress' | 'repeat' | 'deload'): number {
  if (action === 'progress') return difficulty + 1;
  if (action === 'deload') return Math.max(0, difficulty - 1);
  return difficulty;
}

export function finishSession(state: AppState, session: Session, now: number): AppState {
  const sessions = [...state.sessions, session];
  let courseState = completeSession(state.courseState, now);
  let baselines = state.baselines;

  if (session.type === 'MAX') {
    const best = session.rounds.reduce((m, r) => Math.max(m, r.achievedHoldSec), 0);
    const baseline: Baseline = {
      id: `baseline-${now}`,
      maxHoldSec: best,
      firstContractionSec: null,
      measuredAt: now,
    };
    baselines = [...baselines, baseline];
    courseState = { ...courseState, lastMaxTestAt: now };
  } else {
    const decision = evaluateProgression(sessions.filter((s) => s.type !== 'MAX'));
    courseState = {
      ...courseState,
      difficultyLevel: applyProgression(courseState.difficultyLevel, decision.action),
    };
  }

  return { ...state, sessions, courseState, baselines };
}
