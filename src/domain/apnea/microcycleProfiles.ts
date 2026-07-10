import type {
  AppState,
  CourseState,
  MicrocycleProfile,
  MicrocycleTemplate,
  Session,
} from '../models/types';
import { APNEA_DEFAULTS, DAY_MS } from './config';
import { classifySession } from './qualityEngine';

const TEMPLATES: Record<MicrocycleProfile, MicrocycleTemplate> = {
  'co2-heavy': {
    days: ['CO2', 'REST', 'CO2', 'REST', 'CO2', 'O2', 'REST'],
  },
  balanced: {
    days: ['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST'],
  },
  'o2-heavy': {
    days: ['O2', 'REST', 'O2', 'REST', 'O2', 'CO2', 'REST'],
  },
};

export function profileTemplate(profile: MicrocycleProfile): MicrocycleTemplate {
  return { days: [...TEMPLATES[profile].days] };
}

function classifiedRecent(sessions: Session[]) {
  const ordered = sessions
    .filter((session) => session.type !== 'MAX')
    .sort((a, b) => a.finishedAt - b.finishedAt);
  return ordered.map((session, index) => ({
    session,
    quality: classifySession(session, ordered.slice(0, index)),
  }));
}

function desiredProfile(state: AppState, now: number): MicrocycleProfile {
  const recent = classifiedRecent(state.sessions);
  const last4 = recent.slice(-4);
  const latestAssessmentAt = state.baselines
    .reduce((latest, baseline) => Math.max(latest, baseline.measuredAt), 0);
  const o2Sessions = recent.filter(({ session }) => session.type === 'O2');
  const last3O2 = o2Sessions.slice(-3);

  const o2Eligible =
    last3O2.length === 3
    && last3O2.every(({ quality }) => quality === 'clean')
    && last4.every(({ quality, session }) =>
      quality === 'clean' && session.adjustment === null)
    && latestAssessmentAt > 0
    && now - latestAssessmentAt <= 21 * DAY_MS;
  if (o2Eligible) return 'o2-heavy';

  const last3 = recent.slice(-3);
  const earlyStrainCount = last3.filter(({ quality, session }) =>
    session.adjustment?.reason === 'early-contractions'
    || (
      quality === 'strained'
      && session.rpe !== 'hard'
      && session.adjustment?.reason !== 'tap-out'
    ),
  ).length;
  if (earlyStrainCount >= 2) return 'co2-heavy';

  return 'balanced';
}

export function applyPendingProfileAtBoundary(
  course: CourseState,
  now: number,
): CourseState {
  if (
    course.pendingMicrocycleProfile === null
    || course.position % course.template.days.length !== 0
    || (
      course.profileLockedUntil !== null
      && now < course.profileLockedUntil
    )
  ) {
    return course;
  }

  const profile = course.pendingMicrocycleProfile;
  return {
    ...course,
    template: profileTemplate(profile),
    microcycleProfile: profile,
    pendingMicrocycleProfile: null,
    profileLockedUntil: now + APNEA_DEFAULTS.quality.profileLockDays * DAY_MS,
  };
}

export function updateMicrocycleProfile(
  state: AppState,
  now: number,
): CourseState {
  const desired = desiredProfile(state, now);
  const course = state.courseState;
  const latest = state.sessions.at(-1);
  const safetyDemotion =
    course.microcycleProfile === 'o2-heavy'
    && latest?.type === 'O2'
    && (
      latest.adjustment !== null
      || classifySession(latest, state.sessions.slice(0, -1)) !== 'clean'
    );

  if (safetyDemotion) {
    return {
      ...course,
      template: profileTemplate('balanced'),
      microcycleProfile: 'balanced',
      pendingMicrocycleProfile: null,
    };
  }

  if (desired === course.microcycleProfile) {
    return { ...course, pendingMicrocycleProfile: null };
  }
  if (course.profileLockedUntil !== null && now < course.profileLockedUntil) {
    return { ...course, pendingMicrocycleProfile: desired };
  }

  return applyPendingProfileAtBoundary({
    ...course,
    pendingMicrocycleProfile: desired,
  }, now);
}
