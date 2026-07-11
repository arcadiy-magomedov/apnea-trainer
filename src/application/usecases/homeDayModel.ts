import type { AppState, DayType, Session } from '../../domain/models/types';
import { addCalendarDays, isSameCalendarDay } from '../../domain/apnea/time';
import {
  startTodaySession,
  type StartTodayResult,
} from './startTodaySession';

export interface NextTrainingDay {
  at: number;
  dayType: Exclude<DayType, 'REST'>;
}

export interface HomeDayModel {
  today: StartTodayResult;
  doneToday: Session | null;
  nextTraining: NextTrainingDay | null;
}

export function homeDayModel(state: AppState, now: number): HomeDayModel {
  const today = startTodaySession(state, now);
  const doneToday = state.sessions
    .filter((session) => isSameCalendarDay(session.finishedAt, now))
    .sort((left, right) => left.finishedAt - right.finishedAt)
    .at(-1) ?? null;
  let nextTraining: NextTrainingDay | null = null;

  for (let offset = 1; offset <= 14; offset += 1) {
    const at = addCalendarDays(now, offset);
    const candidate = startTodaySession(state, at);
    if (
      !candidate.needsBaseline
      && candidate.decision.dayType !== 'REST'
      && !candidate.decision.blocked
    ) {
      nextTraining = {
        at,
        dayType: candidate.decision.dayType,
      };
      break;
    }
  }

  return { today, doneToday, nextTraining };
}
