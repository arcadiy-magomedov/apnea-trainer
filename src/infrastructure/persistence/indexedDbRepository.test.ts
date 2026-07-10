import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { openDB } from 'idb';
import { createIndexedDbRepository } from './indexedDbRepository';
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
      position: 1,
      difficultyLevel: 2,
      template: defaultMicrocycle(),
      lastTrainedAt: 2_000,
      lastAdvanceAt: 3_000,
      lastMaxTestAt: 4_000,
    },
    sessions: [
      {
        id: 'legacy-session-1',
        type: 'CO2',
        rounds: [
          {
            index: 0,
            targetHoldSec: 60,
            achievedHoldSec: 55,
            restBeforeSec: 0,
            contractions: 2,
            tappedOut: false,
          },
        ],
        startedAt: 10_000,
        finishedAt: 12_000,
        completedRounds: 0,
        tapOuts: 0,
        rpe: 'normal',
        difficultyLevel: 2,
      },
    ],
  };
}

describe('IndexedDbRepository', () => {
  beforeEach(async () => {
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase('apnea-trainer');
      req.onsuccess = () => res();
      req.onerror = () => res();
    });
  });

  it('returns a fresh empty state when nothing is stored', async () => {
    const repo = createIndexedDbRepository();
    const state = await repo.getState();
    expect(state.version).toBe(2);
    expect(state.goal).toBeNull();
    expect(state.sessions).toEqual([]);
  });

  it('migrates a stored legacy v1 state when loading', async () => {
    const database = await openDB('apnea-trainer', 1, {
      upgrade(upgradeDb) {
        if (!upgradeDb.objectStoreNames.contains('app')) {
          upgradeDb.createObjectStore('app');
        }
      },
    });
    try {
      await database.put('app', v1State(), 'state');
    } finally {
      database.close();
    }

    const repo = createIndexedDbRepository();
    const state = await repo.getState();

    expect(state.version).toBe(2);
    expect(state.goal).toBeNull();
    expect(state.courseState.difficultyByType).toEqual({ CO2: 2, O2: 2 });
    expect(state.sessions[0]?.adjustment).toBeNull();
    expect(state.sessions[0]?.rounds[0]?.firstContractionSec).toBeNull();
  });

  it('round-trips a saved state', async () => {
    const repo = createIndexedDbRepository();
    const s = emptyAppState();
    s.settings.reminderTimes = ['19:00'];
    await repo.setState(s);
    const loaded = await repo.getState();
    expect(loaded.settings.reminderTimes).toEqual(['19:00']);
  });
});
