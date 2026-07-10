import { describe, it, expect } from 'vitest';
import { exportJson, importJson } from './jsonBackup';
import { defaultMicrocycle, emptyAppState } from '../../domain/models/appState';
import type { Baseline, MicrocycleTemplate, RoundResult, Session, Settings } from '../../domain/models/types';

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

function v1State(): LegacyAppState {
  return {
    version: 1,
    settings: emptyAppState().settings,
    baselines: [
      {
        id: 'baseline-1',
        maxHoldSec: 180,
        firstContractionSec: 90,
        measuredAt: 1_000,
      },
    ],
    courseState: {
      position: 2,
      difficultyLevel: 4,
      template: defaultMicrocycle(),
      lastTrainedAt: 3_000,
      lastAdvanceAt: 4_000,
      lastMaxTestAt: 5_000,
    },
    sessions: [
      {
        id: 'legacy-session-1',
        type: 'CO2',
        rounds: [
          {
            index: 0,
            targetHoldSec: 60,
            achievedHoldSec: 50,
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
        difficultyLevel: 4,
      },
    ],
  };
}

describe('json backup', () => {
  it('exports then imports to an equal state', () => {
    const s = emptyAppState();
    s.settings.voiceCues = false;
    const round = importJson(exportJson(s));
    expect(round).toEqual(s);
  });

  it('imports a valid v1 backup and splits difficulty by training type', () => {
    const imported = importJson(JSON.stringify(v1State()));

    expect(imported.version).toBe(2);
    expect(imported.goal).toBeNull();
    expect(imported.courseState.difficultyByType).toEqual({ CO2: 4, O2: 4 });
    expect(imported.sessions[0]?.adjustment).toBeNull();
    expect(imported.sessions[0]?.rounds[0]?.firstContractionSec).toBeNull();
  });

  it('rejects malformed json', () => {
    expect(() => importJson('not json')).toThrow('Invalid backup: not valid JSON');
  });

  it('rejects an unsupported version', () => {
    expect(() => importJson(JSON.stringify({
      version: 99,
      settings: {},
      baselines: [],
      courseState: {},
      sessions: [],
    }))).toThrow('Invalid backup: Unsupported app state version: 99');
  });

  it('rejects a state missing required fields', () => {
    expect(() => importJson(JSON.stringify({ version: 1 }))).toThrow(
      'Invalid backup: App state is missing required base fields: settings, baselines, courseState, sessions',
    );
  });
});
