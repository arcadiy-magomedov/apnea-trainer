import type {
  AppState,
  DayType,
  InSessionAdjustment,
  RoundResult,
  Session,
  SessionQuality,
} from '../../domain/models/types';
import { classifySession } from '../../domain/apnea/qualityEngine';
import { addCalendarDays, isSameCalendarDay, localDateKey, startOfDay } from '../../domain/apnea/time';
import { latestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';
import { completeSession, syncRestDays } from '../../domain/apnea/courseEngine';
import { startTodaySession } from '../usecases/startTodaySession';

export type CalendarEventQuality = SessionQuality | 'unavailable' | null;

export interface TrainingCalendarEvent {
  id: string;
  at: number;
  dayKey: string;
  dayType: DayType;
  status: 'completed' | 'planned';
  source: 'session' | 'assessment' | 'projection';
  quality: CalendarEventQuality;
  completedRounds: number | null;
  plannedRounds: number | null;
  tapOuts: number | null;
  bestHoldSec: number | null;
  difficultyLevel: number | null;
  firstContractionSec: number | null;
  adjustment: InSessionAdjustment | null;
  postponed: boolean;
}

function bestHold(session: Session): number | null {
  if (session.rounds.length === 0) return null;
  return session.rounds.reduce(
    (best, round) => Math.max(best, round.achievedHoldSec),
    0,
  );
}

function qualityFor(
  session: Session,
  priorSessions: readonly Session[],
): CalendarEventQuality {
  if (session.type === 'MAX') return null;
  if (session.rpe === null) return 'unavailable';
  return classifySession(session, priorSessions);
}

function firstContractionFromBestRound(session: Session): number | null {
  if (session.rounds.length === 0) return null;
  const bestRound = session.rounds.reduce((best, round) =>
    round.achievedHoldSec > best.achievedHoldSec ? round : best,
  );
  return bestRound.firstContractionSec;
}

export function completedCalendarEvents(state: AppState): TrainingCalendarEvent[] {
  // 1. Sort a copy of sessions by finishedAt — chronological order determines greedy
  //    baseline claim priority: earlier sessions take precedence (do not mutate state).
  const sessions = [...state.sessions].sort((a, b) => a.finishedAt - b.finishedAt);

  // Build a mutable map of baselines for one-to-one consumption during pairing
  const unconsumedBaselines = new Map(state.baselines.map((b) => [b.id, b]));

  const events: TrainingCalendarEvent[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const priorSessions = sessions.slice(0, i);

    let firstContractionSec: number | null;

    if (session.type === 'MAX') {
      // 2 & 3. Pair with best matching unconsumed baseline on same day with matching hold
      const hold = bestHold(session);
      const dayKey = localDateKey(session.finishedAt);

      let bestMatchId: string | null = null;
      let bestMatchDistance = Infinity;

      for (const [id, baseline] of unconsumedBaselines) {
        if (
          localDateKey(baseline.measuredAt) === dayKey &&
          baseline.maxHoldSec === hold &&
          baseline.measuredAt >= session.finishedAt
        ) {
          const distance = baseline.measuredAt - session.finishedAt;
          if (distance < bestMatchDistance) {
            bestMatchDistance = distance;
            bestMatchId = id;
          }
        }
      }

      if (bestMatchId !== null) {
        // 10. Use baseline's firstContractionSec for the paired MAX session
        firstContractionSec = unconsumedBaselines.get(bestMatchId)!.firstContractionSec;
        unconsumedBaselines.delete(bestMatchId);
      } else {
        firstContractionSec = firstContractionFromBestRound(session);
      }
    } else {
      firstContractionSec = firstContractionFromBestRound(session);
    }

    // 4. Emit one event per session
    events.push({
      id: `session-${session.id}`,
      at: session.finishedAt,
      dayKey: localDateKey(session.finishedAt),
      dayType: session.type,
      status: 'completed',
      source: 'session',
      quality: qualityFor(session, priorSessions),
      completedRounds: session.completedRounds,
      plannedRounds: session.rounds.length,
      tapOuts: session.tapOuts,
      bestHoldSec: bestHold(session),
      difficultyLevel: session.difficultyLevel,
      firstContractionSec,
      adjustment: session.adjustment,
      postponed: false,
    });
  }

  // 5. Emit one assessment event per unconsumed baseline
  for (const baseline of unconsumedBaselines.values()) {
    events.push({
      id: `assessment-${baseline.id}`,
      at: baseline.measuredAt,
      dayKey: localDateKey(baseline.measuredAt),
      dayType: 'MAX',
      status: 'completed',
      source: 'assessment',
      quality: null,
      completedRounds: null,
      plannedRounds: null,
      tapOuts: null,
      bestHoldSec: baseline.maxHoldSec,
      difficultyLevel: null,
      firstContractionSec: baseline.firstContractionSec,
      adjustment: null,
      postponed: false,
    });
  }

  // 6. Sort by at, then id for stability
  events.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id.localeCompare(b.id)));

  return events;
}

// ─── Planned calendar projection ────────────────────────────────────────────

const PROJECTION_DAYS = 42;

function projectionRounds(
  plan: NonNullable<ReturnType<typeof startTodaySession>['plan']>,
): RoundResult[] {
  return plan.rounds.map((round) => ({
    index: round.index,
    targetHoldSec: round.targetHoldSec,
    achievedHoldSec: round.targetHoldSec,
    restBeforeSec: round.restBeforeSec,
    contractions: 0,
    firstContractionSec: null,
    tappedOut: false,
  }));
}

export function plannedCalendarEvents(
  state: AppState,
  now: number,
  days: number = PROJECTION_DAYS,
): TrainingCalendarEvent[] {
  if (latestAssessedMaxSec(state) <= 0) return [];

  // Deep-clone projection state — never mutate input.
  const projected: AppState = JSON.parse(JSON.stringify(state));

  const events: TrainingCalendarEvent[] = [];
  const origin = startOfDay(now);

  for (let offset = 0; offset < days; offset++) {
    const at = addCalendarDays(origin, offset);

    // Sync REST slots for the projected date.
    projected.courseState = syncRestDays(projected.courseState, at);

    // If offset 0 and a real session already exists on this local day, skip today.
    if (offset === 0) {
      const hasSessionToday = state.sessions.some((s) =>
        isSameCalendarDay(s.finishedAt, at),
      );
      if (hasSessionToday) continue;
    }

    // Resolve what today's session would be.
    const today = startTodaySession(projected, at);
    const { plan } = today;

    // Emit one planned event.
    events.push({
      id: `planned-${localDateKey(at)}-${today.decision.dayType}`,
      at,
      dayKey: localDateKey(at),
      dayType: today.decision.dayType,
      status: 'planned',
      source: 'projection',
      quality: null,
      completedRounds: null,
      plannedRounds: plan?.rounds.length ?? null,
      tapOuts: null,
      bestHoldSec: plan?.rounds.reduce((best, round) => Math.max(best, round.targetHoldSec), 0) ?? null,
      difficultyLevel: today.decision.dayType === 'CO2' || today.decision.dayType === 'O2'
        ? today.appliedDifficulty
        : null,
      firstContractionSec: null,
      adjustment: null,
      postponed: today.assessmentSchedule.postponed,
    });

    // Advance projection state if trainable.
    if (plan && !today.decision.blocked) {
      if (today.decision.dayType === 'MAX') {
        // For MAX, set lastMaxTestAt; do not create a fake training session.
        projected.courseState.lastMaxTestAt = at;
        projected.courseState = completeSession(projected.courseState, at);
      } else {
        // For CO2/O2, append a projection-only Session to retain assessment recovery behavior.
        const projSession: Session = {
          id: `proj-${localDateKey(at)}`,
          type: today.decision.dayType as 'CO2' | 'O2',
          rounds: projectionRounds(plan),
          startedAt: at,
          finishedAt: at,
          completedRounds: plan.rounds.length,
          tapOuts: 0,
          rpe: null,
          difficultyLevel: today.appliedDifficulty,
          adjustment: null,
        };
        projected.sessions.push(projSession);
        projected.courseState = completeSession(projected.courseState, at);
      }
    }
  }

  return events;
}
