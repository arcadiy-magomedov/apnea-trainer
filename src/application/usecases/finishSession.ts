import type {
  AppState,
  MicrocycleProfile,
  ProgressionAction,
  Session,
  SessionQuality,
} from '../../domain/models/types';
import { completeSession, syncRestDays } from '../../domain/apnea/courseEngine';
import {
  classifySession,
  evaluateTypeProgression,
} from '../../domain/apnea/qualityEngine';
import { updateMicrocycleProfile } from '../../domain/apnea/microcycleProfiles';
import { syncGoalAchievement } from './manageGoal';

function applyProgression(
  difficulty: number,
  action: ProgressionAction,
): number {
  if (action === 'progress') return difficulty + 1;
  if (action === 'deload') return Math.max(0, difficulty - 1);
  return difficulty;
}

export interface SessionCompletion {
  state: AppState;
  quality: SessionQuality | null;
  action: ProgressionAction | null;
  previousLevel: number | null;
  nextLevel: number | null;
  suggestRetest: boolean;
  profileChangedTo: MicrocycleProfile | null;
  profileQueuedFor: MicrocycleProfile | null;
}

export function finishRatedSession(
  state: AppState,
  session: Session,
  now: number,
): SessionCompletion {
  if (session.rpe === null) {
    throw new Error('A session quality rating is required before persistence');
  }
  if (state.sessions.some((existing) => existing.id === session.id)) {
    throw new Error('Session already saved');
  }

  const sessions = [...state.sessions, session];
  let courseState = completeSession(syncRestDays(state.courseState, now), now);
  let baselines = state.baselines;
  let quality: SessionQuality | null = null;
  let action: ProgressionAction | null = null;
  let previousLevel: number | null = null;
  let nextLevel: number | null = null;
  let suggestRetest = false;

  if (session.type === 'MAX') {
    if (session.rounds.length === 0) {
      throw new Error('MAX session requires one recorded round');
    }
    const bestRound = session.rounds.reduce(
      (best, round) =>
        round.achievedHoldSec > best.achievedHoldSec ? round : best,
      session.rounds[0],
    );

    baselines = [...baselines, {
      id: `baseline-${now}`,
      maxHoldSec: bestRound.achievedHoldSec,
      firstContractionSec: bestRound.firstContractionSec,
      measuredAt: now,
    }];
    courseState = { ...courseState, lastMaxTestAt: now };
  } else {
    const type = session.type;
    quality = classifySession(session, state.sessions);
    const decision = evaluateTypeProgression(sessions, type);
    action = decision.action;
    suggestRetest = decision.suggestRetest;
    previousLevel = courseState.difficultyByType[type];
    nextLevel = applyProgression(previousLevel, decision.action);
    courseState = {
      ...courseState,
      difficultyByType: {
        ...courseState.difficultyByType,
        [type]: nextLevel,
      },
    };
  }

  let nextState: AppState = { ...state, sessions, courseState, baselines };
  const previousProfile = state.courseState.microcycleProfile;
  const previousPendingProfile =
    state.courseState.pendingMicrocycleProfile;
  nextState = {
    ...nextState,
    courseState: updateMicrocycleProfile(nextState, now),
  };
  nextState = syncGoalAchievement(nextState, now);
  const profileChangedTo =
    nextState.courseState.microcycleProfile === previousProfile
      ? null
      : nextState.courseState.microcycleProfile;
  const profileQueuedFor =
    nextState.courseState.pendingMicrocycleProfile === previousPendingProfile
      ? null
      : nextState.courseState.pendingMicrocycleProfile;

  return {
    state: nextState,
    quality,
    action,
    previousLevel,
    nextLevel,
    suggestRetest,
    profileChangedTo,
    profileQueuedFor,
  };
}

export function finishSession(
  state: AppState,
  session: Session,
  now: number,
): AppState {
  return finishRatedSession(state, session, now).state;
}
