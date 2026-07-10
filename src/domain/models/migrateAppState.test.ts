import { describe, expect, it } from 'vitest';
import { defaultMicrocycle, emptyAppState } from './appState';
import { migrateAppState } from './migrateAppState';
import type { Baseline, Goal, MicrocycleProfile, MicrocycleTemplate, RoundResult, Session, Settings } from './types';
import { makeBaseline, makeSession } from '../../test/fixtures';

type LegacyCourseState = {
  position: number;
  difficultyLevel: number;
  template: MicrocycleTemplate;
  lastTrainedAt: number | null;
  lastAdvanceAt: number | null;
  lastMaxTestAt: number | null;
};

type LegacyRoundResult = Omit<RoundResult, 'firstContractionSec'>;
type LegacySession = Omit<Session, 'adjustment' | 'rounds'> & { rounds: LegacyRoundResult[] };

type LegacyAppState = {
  version: 1;
  settings: Settings;
  baselines: Baseline[];
  courseState: LegacyCourseState;
  sessions: LegacySession[];
};

function legacySession(overrides: Partial<LegacySession> = {}): LegacySession {
  return {
    id: 'legacy-session-1',
    type: 'CO2',
    rounds: [
      {
        index: 0,
        targetHoldSec: 60,
        achievedHoldSec: 48,
        restBeforeSec: 0,
        contractions: 2,
        tappedOut: false,
      },
    ],
    startedAt: 10_000,
    finishedAt: 12_000,
    completedRounds: 0,
    tapOuts: 0,
    rpe: 'hard',
    difficultyLevel: 2,
    ...overrides,
  };
}

function v1State(overrides: Partial<LegacyAppState> = {}): LegacyAppState {
  return {
    version: 1,
    settings: emptyAppState().settings,
    baselines: [
      {
        id: 'baseline-1',
        maxHoldSec: 180,
        firstContractionSec: 95,
        measuredAt: 1_000,
      },
    ],
    courseState: {
      position: 2,
      difficultyLevel: 3,
      template: defaultMicrocycle(),
      lastTrainedAt: 3_000,
      lastAdvanceAt: 4_000,
      lastMaxTestAt: 5_000,
    },
    sessions: [legacySession()],
    ...overrides,
  };
}

describe('migrateAppState', () => {
  it('migrates a v1 state to v2', () => {
    const migrated = migrateAppState(v1State());

    expect(migrated.version).toBe(2);
    expect(migrated.goal).toBeNull();
    expect(migrated.courseState.difficultyByType).toEqual({ CO2: 3, O2: 3 });
    expect(migrated.courseState.microcycleProfile).toBe('balanced');
    expect(migrated.courseState.pendingMicrocycleProfile).toBeNull();
    expect(migrated.courseState.profileLockedUntil).toBeNull();
    expect(migrated.sessions[0]?.adjustment).toBeNull();
    expect(migrated.sessions[0]?.rounds[0]?.firstContractionSec).toBeNull();
  });

  it('returns a valid v2 state unchanged apart from validation and baseline normalization', () => {
    const state = emptyAppState();
    const session = makeSession({
      id: 'session-keep',
      adjustment: {
        reason: 'early-contractions',
        triggeredAtRoundIndex: 0,
        restAddedSec: 15,
        holdCapSec: 50,
      },
    });
    state.baselines = [
      makeBaseline({ id: 'baseline-1', measuredAt: 1_000 }),
      makeBaseline({ id: 'baseline-2', measuredAt: 2_000 }),
    ];
    state.sessions = [session];

    const migrated = migrateAppState(state);

    expect(migrated).toEqual(state);
    expect(migrated.sessions).toEqual([session]);
  });

  it('keeps only the latest duplicate baseline by id and sorts baselines chronologically', () => {
    const migrated = migrateAppState(v1State({
      baselines: [
        makeBaseline({ id: 'baseline-1', maxHoldSec: 170, measuredAt: 3_000 }),
        makeBaseline({ id: 'baseline-2', maxHoldSec: 190, measuredAt: 2_000 }),
        makeBaseline({ id: 'baseline-1', maxHoldSec: 210, measuredAt: 4_000 }),
        makeBaseline({ id: 'baseline-3', maxHoldSec: 160, measuredAt: 1_000 }),
      ],
    }));

    expect(migrated.baselines).toEqual([
      makeBaseline({ id: 'baseline-3', maxHoldSec: 160, measuredAt: 1_000 }),
      makeBaseline({ id: 'baseline-2', maxHoldSec: 190, measuredAt: 2_000 }),
      makeBaseline({ id: 'baseline-1', maxHoldSec: 210, measuredAt: 4_000 }),
    ]);
  });

  it('rejects unsupported versions and states missing required base fields', () => {
    expect(() => migrateAppState({
      version: 99,
      settings: {},
      baselines: [],
      courseState: {},
      sessions: [],
    })).toThrow('Unsupported app state version: 99');

    expect(() => migrateAppState({
      version: 1,
      settings: {},
      baselines: [],
      sessions: [],
    })).toThrow('App state is missing required base fields: courseState');
  });

  it('rejects non-objects and invalid v2 required fields', () => {
    const missingGoal = {
      ...emptyAppState(),
      goal: undefined,
    };
    delete (missingGoal as { goal?: Goal | null }).goal;

    expect(() => migrateAppState(null)).toThrow('App state must be an object');
    expect(() => migrateAppState({
      ...emptyAppState(),
      courseState: {
        ...emptyAppState().courseState,
        microcycleProfile: 'extreme' as MicrocycleProfile,
      },
    })).toThrow('Invalid v2 app state: courseState.microcycleProfile must be co2-heavy, balanced, or o2-heavy');
    expect(() => migrateAppState({
      ...emptyAppState(),
      courseState: {
        ...emptyAppState().courseState,
        template: { days: [] },
      },
    })).toThrow('Invalid v2 app state: courseState.template.days must contain at least one day');
    expect(() => migrateAppState(missingGoal)).toThrow('Invalid v2 app state: goal field is required');
    expect(() => migrateAppState({
      ...emptyAppState(),
      sessions: [
        {
          ...makeSession(),
          adjustment: undefined,
        },
      ],
    })).toThrow('Invalid v2 app state: sessions[0].adjustment field is required');
    expect(() => migrateAppState({
      ...emptyAppState(),
      sessions: [
        {
          ...makeSession(),
          rounds: [
            {
              ...makeSession().rounds[0],
              firstContractionSec: undefined,
            },
          ],
        },
      ],
    })).toThrow('Invalid v2 app state: sessions[0].rounds[0].firstContractionSec field is required');
  });
});
