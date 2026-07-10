# Adaptive Quality Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add schema v2, assessment-only max semantics, first-contraction tracking, safe in-session auto-easing, independent CO₂/O₂ progression, adaptive weekly profiles, and a required post-session quality rating.

**Architecture:** Keep all classification, thresholds, plan adjustment, progression, and profile selection in pure domain modules. Application use-cases assemble those decisions and persistence adapters perform one reusable v1→v2 migration. The runner only holds an in-memory draft; Summary applies the single quality rating and then persists the completed session.

**Tech Stack:** React 19, TypeScript 6, Zustand, Vitest, Testing Library, IndexedDB via `idb`.

**Plan sequence:** This is plan 1 of 2. Complete it before `2026-07-09-apnea-trainer-goal-forecast.md`.

**Git constraint:** Do not commit or push unless the user explicitly approves it. Each task ends with an uncommitted diff check instead of a commit.

---

## File Structure

### New files

- `src/test/fixtures.ts` — typed test builders for v2 rounds, sessions, and states.
- `src/domain/models/migrateAppState.ts` — the single v1→v2 migration and structural validation entry point.
- `src/domain/models/migrateAppState.test.ts` — migration coverage shared by storage/import adapters.
- `src/domain/apnea/assessmentHistory.ts` — standardized assessment history and latest/best assessed max helpers.
- `src/domain/apnea/assessmentHistory.test.ts` — assessment-only max semantics.
- `src/domain/apnea/qualityEngine.ts` — onset thresholds, early-round detection, session classification, and type-specific progression.
- `src/domain/apnea/qualityEngine.test.ts` — cold-start, personalization, classification, and progression tests.
- `src/domain/apnea/microcycleProfiles.ts` — profile templates, eligibility, queueing, and boundary application.
- `src/domain/apnea/microcycleProfiles.test.ts` — CO₂-heavy/O₂-heavy gates and stability tests.
- `src/ui/screens/SummaryScreen.test.tsx` — required-rating and persistence-flow tests.
- `src/ui/screens/StatsScreen.test.tsx` — split-level/profile presentation tests.

### Modified files

- `src/domain/models/types.ts:1-92` — v2 model, split difficulty, contraction timing, and adjustment metadata.
- `src/domain/models/appState.ts:1-30` — v2 defaults and balanced profile.
- `src/domain/models/appState.test.ts:1-24` — v2 default assertions.
- `src/domain/apnea/config.ts:1-11` — quality/profile tuning constants.
- `src/domain/apnea/adaptationEngine.ts:1-49` — early-contraction easing in addition to tap-out easing.
- `src/domain/apnea/adaptationEngine.tapout.test.ts:1-31` — preserve tap-out behavior and add early-ease coverage.
- Delete `src/domain/apnea/adaptationEngine.progression.test.ts` after its global progression rules are replaced by `qualityEngine` tests.
- `src/domain/apnea/courseEngine.ts:1-66` — apply queued profiles at seven-slot boundaries.
- `src/domain/apnea/courseEngine.test.ts:1-91` — profile-boundary and rest-index invariants.
- `src/domain/index.ts:1-9` — export new domain modules.
- `src/infrastructure/persistence/indexedDbRepository.ts:1-41` — migrate stored data on read.
- `src/infrastructure/persistence/indexedDbRepository.test.ts:1-37` — v1 storage migration.
- `src/infrastructure/persistence/jsonBackup.ts:1-24` — migrate imported backups.
- `src/infrastructure/persistence/jsonBackup.test.ts:1-26` — v1 import and v2 round trip.
- `src/application/stats.ts:1-42` — assessed max and quality summary helpers.
- `src/application/stats.test.ts:1-46` — exclude ordinary training holds from personal best.
- `src/application/usecases/startTodaySession.ts:1-24` — latest assessed max, type-specific level, and threshold context.
- `src/application/usecases/startTodaySession.test.ts:1-34` — CO₂/O₂ level independence and threshold output.
- `src/application/usecases/finishSession.ts:1-35` — rated completion result, MAX baseline, type-specific progression, and profile update.
- `src/application/usecases/finishSession.test.ts:1-91` — independent levels and classification decisions.
- `src/application/stores/sessionRunnerStore.ts:1-66` — contraction timestamp, one auto-ease, and unrated draft.
- `src/application/stores/sessionRunnerStore.test.ts:1-38` — draft and adjustment behavior.
- `src/application/stores/appStore.ts:1-44` — return completion details to Summary.
- `src/application/stores/appStore.test.ts:1-56` — persist only rated sessions.
- `src/ui/screens/HomeScreen.tsx:1-87` — pass quality thresholds into Runner and show assessed PB.
- `src/ui/screens/HomeScreen.test.tsx:1-72` — v2 fixtures and assessed-PB behavior.
- `src/ui/screens/RunnerScreen.tsx:1-270` — first-contraction label, auto-ease banner, and no pre-Summary persistence.
- `src/ui/screens/RunnerScreen.test.tsx:1-223` — first tap timing, adjustment banner, and delayed persistence.
- `src/ui/screens/SummaryScreen.tsx:1-24` — one required quality choice and completion explanation.
- `src/ui/screens/StatsScreen.tsx:1-33` — split levels, profile, and latest quality.
- `src/ui/screens/ProgramScreen.tsx:1-48` — active and pending weekly profile.
- `src/ui/screens/ProgramScreen.test.tsx:1-86` — v2 fixtures and pending-profile copy.

---

### Task 1: Introduce the v2 Domain Model and Typed Test Fixtures

**Files:**
- Create: `src/test/fixtures.ts`
- Modify: `src/domain/models/types.ts:1-92`
- Modify: `src/domain/models/appState.ts:1-30`
- Modify: `src/domain/models/appState.test.ts:1-24`

- [x] **Step 1: Write the failing v2 default-state test**

Replace the first `emptyAppState` test in `src/domain/models/appState.test.ts` with:

```ts
it('creates a complete v2 state with split difficulty and no goal', () => {
  const s = emptyAppState();

  expect(s.version).toBe(2);
  expect(s.goal).toBeNull();
  expect(s.courseState.difficultyByType).toEqual({ CO2: 0, O2: 0 });
  expect(s.courseState.microcycleProfile).toBe('balanced');
  expect(s.courseState.pendingMicrocycleProfile).toBeNull();
  expect(s.courseState.profileLockedUntil).toBeNull();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- src/domain/models/appState.test.ts
```

Expected: FAIL because the current state is version 1 and has `difficultyLevel`.

- [x] **Step 3: Replace the domain interfaces with the v2 shape**

In `src/domain/models/types.ts`, keep the existing aliases and replace the affected interfaces with:

```ts
export type SessionType = 'CO2' | 'O2' | 'MAX';
export type TrainingSessionType = Exclude<SessionType, 'MAX'>;
export type DayType = 'CO2' | 'O2' | 'REST' | 'MAX';
export type Rpe = 'easy' | 'normal' | 'hard' | 'failed';
export type SessionQuality = 'clean' | 'strained' | 'failed';
export type ProgressionAction = 'progress' | 'repeat' | 'deload';
export type MicrocycleProfile = 'co2-heavy' | 'balanced' | 'o2-heavy';

export interface Goal {
  id: string;
  targetHoldSec: number;
  createdAt: number;
  startMaxSec: number;
  achievedAt: number | null;
}

export interface RoundResult {
  index: number;
  targetHoldSec: number;
  achievedHoldSec: number;
  restBeforeSec: number;
  contractions: number;
  firstContractionSec: number | null;
  tappedOut: boolean;
}

export interface InSessionAdjustment {
  reason: 'early-contractions' | 'tap-out';
  triggeredAtRoundIndex: number;
  restAddedSec: number;
  holdCapSec: number | null;
}

export interface Session {
  id: string;
  type: SessionType;
  rounds: RoundResult[];
  startedAt: number;
  finishedAt: number;
  completedRounds: number;
  tapOuts: number;
  rpe: Rpe | null;
  difficultyLevel: number;
  adjustment: InSessionAdjustment | null;
}

export interface DifficultyByType {
  CO2: number;
  O2: number;
}

export interface CourseState {
  position: number;
  difficultyByType: DifficultyByType;
  template: MicrocycleTemplate;
  microcycleProfile: MicrocycleProfile;
  pendingMicrocycleProfile: MicrocycleProfile | null;
  profileLockedUntil: number | null;
  lastTrainedAt: number | null;
  lastAdvanceAt: number | null;
  lastMaxTestAt: number | null;
}

export interface AppState {
  version: 2;
  settings: Settings;
  baselines: Baseline[];
  courseState: CourseState;
  sessions: Session[];
  goal: Goal | null;
}
```

Keep `Baseline`, `RoundPlan`, `SessionPlan`, `MicrocycleTemplate`, `Settings`,
`TodayDecision`, and `ProgressionDecision` otherwise unchanged.

- [x] **Step 4: Update the empty state**

Replace `emptyAppState()` in `src/domain/models/appState.ts` with:

```ts
export function emptyAppState(): AppState {
  return {
    version: 2,
    settings: {
      units: 'metric',
      voiceCues: true,
      beepCues: true,
      vibrationCues: true,
      theme: 'ocean',
      reminderTimes: [],
      onboarded: false,
    },
    baselines: [],
    courseState: {
      position: 0,
      difficultyByType: { CO2: 0, O2: 0 },
      template: defaultMicrocycle(),
      microcycleProfile: 'balanced',
      pendingMicrocycleProfile: null,
      profileLockedUntil: null,
      lastTrainedAt: null,
      lastAdvanceAt: null,
      lastMaxTestAt: null,
    },
    sessions: [],
    goal: null,
  };
}
```

- [x] **Step 5: Add typed builders used by all later tests**

Create `src/test/fixtures.ts`:

```ts
import { emptyAppState } from '../domain/models/appState';
import type {
  AppState,
  Baseline,
  RoundResult,
  Session,
} from '../domain/models/types';

export function makeRound(over: Partial<RoundResult> = {}): RoundResult {
  return {
    index: 0,
    targetHoldSec: 60,
    achievedHoldSec: 60,
    restBeforeSec: 0,
    contractions: 0,
    firstContractionSec: null,
    tappedOut: false,
    ...over,
  };
}

export function makeSession(over: Partial<Session> = {}): Session {
  const rounds = over.rounds ?? [makeRound()];
  return {
    id: 'session-1',
    type: 'CO2',
    rounds,
    startedAt: 1_000,
    finishedAt: 2_000,
    completedRounds: rounds.filter(
      (round) => !round.tappedOut && round.achievedHoldSec >= round.targetHoldSec,
    ).length,
    tapOuts: rounds.filter((round) => round.tappedOut).length,
    rpe: 'normal',
    difficultyLevel: 0,
    adjustment: null,
    ...over,
  };
}

export function makeBaseline(over: Partial<Baseline> = {}): Baseline {
  return {
    id: 'baseline-1',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 1_000,
    ...over,
  };
}

export function makeState(over: Partial<AppState> = {}): AppState {
  return { ...emptyAppState(), ...over };
}
```

- [x] **Step 6: Update existing source constructors to satisfy the new required fields**

Until Task 6 adds real timing and adjustment behavior, add these defaults in
`src/application/stores/sessionRunnerStore.ts`:

```ts
const result: RoundResult = {
  index: round.index,
  targetHoldSec: round.targetHoldSec,
  achievedHoldSec,
  restBeforeSec: round.restBeforeSec,
  contractions,
  firstContractionSec: null,
  tappedOut,
};
```

and:

```ts
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
  adjustment: null,
};
```

Update session literals in these test files to use `makeRound()` and
`makeSession()` instead of duplicating the old v1 shape:

```text
src/application/stats.test.ts
src/application/stores/appStore.test.ts
src/application/usecases/finishSession.test.ts
src/domain/apnea/adaptationEngine.progression.test.ts
src/ui/screens/HomeScreen.test.tsx
src/ui/screens/ProgramScreen.test.tsx
```

Use the correct relative import and this replacement pattern:

```ts
// src/domain/apnea/*.test.ts, src/application/stores/*.test.ts,
// src/application/usecases/*.test.ts, and src/ui/screens/*.test.tsx
import { makeRound, makeSession } from '../../test/fixtures';

// src/application/stats.test.ts uses:
import { makeRound, makeSession } from '../test/fixtures';

const session = makeSession({
  type: 'CO2',
  rounds: [makeRound({ targetHoldSec: 110, achievedHoldSec: 110 })],
});
```

- [x] **Step 7: Run the model test**

Run:

```powershell
npm test -- src/domain/models/appState.test.ts
```

Expected: PASS. Full type-check follows Task 7 after all v1 field consumers have
been migrated together.

- [x] **Step 8: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 2: Add One Reusable v1→v2 Migration

**Files:**
- Create: `src/domain/models/migrateAppState.ts`
- Create: `src/domain/models/migrateAppState.test.ts`
- Modify: `src/infrastructure/persistence/indexedDbRepository.ts:1-41`
- Modify: `src/infrastructure/persistence/indexedDbRepository.test.ts:1-37`
- Modify: `src/infrastructure/persistence/jsonBackup.ts:1-24`
- Modify: `src/infrastructure/persistence/jsonBackup.test.ts:1-26`

- [x] **Step 1: Write migration tests**

Create `src/domain/models/migrateAppState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateAppState } from './migrateAppState';

function v1State() {
  return {
    version: 1,
    settings: {
      units: 'metric',
      voiceCues: true,
      beepCues: true,
      vibrationCues: true,
      theme: 'ocean',
      reminderTimes: [],
      onboarded: true,
    },
    baselines: [] as Array<{
      id: string;
      maxHoldSec: number;
      firstContractionSec: number | null;
      measuredAt: number;
    }>,
    courseState: {
      position: 0,
      difficultyLevel: 3,
      template: { days: ['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST'] },
      lastTrainedAt: null,
      lastAdvanceAt: null,
      lastMaxTestAt: null,
    },
    sessions: [{
      id: 'old',
      type: 'CO2',
      rounds: [{
        index: 0,
        targetHoldSec: 60,
        achievedHoldSec: 60,
        restBeforeSec: 0,
        contractions: 2,
        tappedOut: false,
      }],
      startedAt: 1,
      finishedAt: 2,
      completedRounds: 1,
      tapOuts: 0,
      rpe: 'normal',
      difficultyLevel: 3,
    }],
  };
}

describe('migrateAppState', () => {
  it('migrates v1 difficulty and historical session fields into v2', () => {
    const state = migrateAppState(v1State());

    expect(state.version).toBe(2);
    expect(state.goal).toBeNull();
    expect(state.courseState.difficultyByType).toEqual({ CO2: 3, O2: 3 });
    expect(state.courseState.microcycleProfile).toBe('balanced');
    expect(state.sessions[0].adjustment).toBeNull();
    expect(state.sessions[0].rounds[0].firstContractionSec).toBeNull();
  });

  it('returns a valid v2 state unchanged', () => {
    const migrated = migrateAppState(migrateAppState(v1State()));
    expect(migrated.version).toBe(2);
    expect(migrated.sessions).toHaveLength(1);
  });

  it('keeps only the latest baseline for a duplicated id', () => {
    const legacy = v1State();
    legacy.baselines = [
      { id: 'same', maxHoldSec: 180, firstContractionSec: null, measuredAt: 1 },
      { id: 'same', maxHoldSec: 190, firstContractionSec: null, measuredAt: 2 },
    ];
    const migrated = migrateAppState(legacy);
    expect(migrated.baselines).toEqual([
      { id: 'same', maxHoldSec: 190, firstContractionSec: null, measuredAt: 2 },
    ]);
  });

  it('rejects unsupported or structurally invalid data', () => {
    expect(() => migrateAppState({ version: 99 })).toThrow(/version/i);
    expect(() => migrateAppState({ version: 1 })).toThrow(/required fields/i);
  });
});
```

- [x] **Step 2: Run the migration test to verify it fails**

Run:

```powershell
npm test -- src/domain/models/migrateAppState.test.ts
```

Expected: FAIL because `migrateAppState` does not exist.

- [x] **Step 3: Implement the migration**

Create `src/domain/models/migrateAppState.ts`:

```ts
import type { AppState, Session } from './types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertBaseShape(value: UnknownRecord): void {
  if (
    !isRecord(value.settings)
    || !Array.isArray(value.baselines)
    || !isRecord(value.courseState)
    || !Array.isArray(value.sessions)
  ) {
    throw new Error('Invalid state: missing required fields');
  }
}

function assertV2Shape(
  value: UnknownRecord,
): asserts value is UnknownRecord & AppState {
  const course = value.courseState;
  const validBaselines =
    Array.isArray(value.baselines)
    && value.baselines.every((baseline) =>
      isRecord(baseline)
      && typeof baseline.id === 'string'
      && isFiniteNumber(baseline.maxHoldSec)
      && isFiniteNumber(baseline.measuredAt)
      && (
        baseline.firstContractionSec === null
        || isFiniteNumber(baseline.firstContractionSec)
      ));
  const validSessions =
    Array.isArray(value.sessions)
    && value.sessions.every((session) =>
      isRecord(session)
      && 'adjustment' in session
      && Array.isArray(session.rounds)
      && session.rounds.every((round) =>
        isRecord(round) && 'firstContractionSec' in round));

  if (
    !isRecord(course)
    || !isRecord(course.difficultyByType)
    || !isFiniteNumber(course.difficultyByType.CO2)
    || !isFiniteNumber(course.difficultyByType.O2)
    || !['co2-heavy', 'balanced', 'o2-heavy'].includes(
      String(course.microcycleProfile),
    )
    || !('pendingMicrocycleProfile' in course)
    || !('profileLockedUntil' in course)
    || value.goal === undefined
    || !validBaselines
    || !validSessions
  ) {
    throw new Error('Invalid state: incomplete version 2 fields');
  }
}

function dedupeBaselines(
  baselines: AppState['baselines'],
): AppState['baselines'] {
  const byId = new Map<string, AppState['baselines'][number]>();
  for (const baseline of baselines) {
    const current = byId.get(baseline.id);
    if (!current || baseline.measuredAt >= current.measuredAt) {
      byId.set(baseline.id, baseline);
    }
  }
  return [...byId.values()].sort((a, b) => a.measuredAt - b.measuredAt);
}

export function migrateAppState(value: unknown): AppState {
  if (!isRecord(value)) {
    throw new Error('Invalid state: expected an object');
  }
  assertBaseShape(value);

  if (value.version === 2) {
    assertV2Shape(value);
    return { ...value, baselines: dedupeBaselines(value.baselines) };
  }

  if (value.version !== 1) {
    throw new Error(`Unsupported state version: ${String(value.version)}`);
  }

  const legacy = value as UnknownRecord & {
    settings: AppState['settings'];
    baselines: AppState['baselines'];
    courseState: Omit<AppState['courseState'],
      'difficultyByType' | 'microcycleProfile' | 'pendingMicrocycleProfile'
      | 'profileLockedUntil'
    > & { difficultyLevel: number };
    sessions: Array<Omit<Session, 'adjustment' | 'rounds'> & {
      adjustment?: never;
      rounds: Array<Omit<Session['rounds'][number], 'firstContractionSec'>>;
    }>;
  };

  const { difficultyLevel, ...legacyCourse } = legacy.courseState;

  return {
    version: 2,
    settings: legacy.settings,
    baselines: dedupeBaselines(legacy.baselines),
    courseState: {
      ...legacyCourse,
      difficultyByType: { CO2: difficultyLevel, O2: difficultyLevel },
      microcycleProfile: 'balanced',
      pendingMicrocycleProfile: null,
      profileLockedUntil: null,
    },
    sessions: legacy.sessions.map((session) => ({
      ...session,
      adjustment: null,
      rounds: session.rounds.map((round) => ({
        ...round,
        firstContractionSec: null,
      })),
    })),
    goal: null,
  };
}
```

- [x] **Step 4: Run the migration tests**

Run:

```powershell
npm test -- src/domain/models/migrateAppState.test.ts
```

Expected: PASS.

- [x] **Step 5: Wire migration into IndexedDB reads**

Change `getState()` in `src/infrastructure/persistence/indexedDbRepository.ts`:

```ts
import { migrateAppState } from '../../domain/models/migrateAppState';

async getState(): Promise<AppState> {
  const database = await db();
  try {
    const stored = await database.get(STORE, KEY);
    return stored === undefined ? emptyAppState() : migrateAppState(stored);
  } finally {
    database.close();
  }
},
```

Add this test to `indexedDbRepository.test.ts`:

```ts
it('migrates a stored v1 state on read', async () => {
  const repo = createIndexedDbRepository();
  await repo.getState();
  const current = emptyAppState();
  const legacy = {
    ...current,
    version: 1,
    goal: undefined,
    courseState: {
      position: 0,
      difficultyLevel: 2,
      template: current.courseState.template,
      lastTrainedAt: null,
      lastAdvanceAt: null,
      lastMaxTestAt: null,
    },
    sessions: [],
  };

  const database = await openDB('apnea-trainer', 1);
  await database.put('app', legacy, 'state');
  database.close();

  const loaded = await repo.getState();
  expect(loaded.version).toBe(2);
  expect(loaded.courseState.difficultyByType).toEqual({ CO2: 2, O2: 2 });
});
```

Import `openDB` from `idb` in that test.

- [x] **Step 6: Wire migration into JSON import**

Replace `importJson()` in `src/infrastructure/persistence/jsonBackup.ts`:

```ts
import { migrateAppState } from '../../domain/models/migrateAppState';

export function importJson(text: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid backup: not valid JSON');
  }

  try {
    return migrateAppState(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Invalid backup: ${message}`);
  }
}
```

Update `jsonBackup.test.ts` so a v1 backup is accepted and a version 99 backup is
still rejected:

```ts
it('migrates a valid v1 backup', () => {
  const current = emptyAppState();
  const legacy = {
    ...current,
    version: 1,
    goal: undefined,
    courseState: {
      position: 0,
      difficultyLevel: 4,
      template: current.courseState.template,
      lastTrainedAt: null,
      lastAdvanceAt: null,
      lastMaxTestAt: null,
    },
    sessions: [],
  };

  const restored = importJson(JSON.stringify(legacy));
  expect(restored.version).toBe(2);
  expect(restored.courseState.difficultyByType).toEqual({ CO2: 4, O2: 4 });
});
```

- [x] **Step 7: Run persistence tests**

Run:

```powershell
npm test -- src/domain/models/migrateAppState.test.ts src/infrastructure/persistence/indexedDbRepository.test.ts src/infrastructure/persistence/jsonBackup.test.ts
```

Expected: PASS.

- [x] **Step 8: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 3: Make Standardized Assessments the Only Max Source

**Files:**
- Create: `src/domain/apnea/assessmentHistory.ts`
- Create: `src/domain/apnea/assessmentHistory.test.ts`
- Modify: `src/application/stats.ts:1-42`
- Modify: `src/application/stats.test.ts:1-46`
- Modify: `src/domain/index.ts:1-9`

- [x] **Step 1: Write assessment-history tests**

Create `src/domain/apnea/assessmentHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assessmentHistory, bestAssessedMaxSec, latestAssessedMaxSec } from './assessmentHistory';
import { makeBaseline, makeRound, makeSession, makeState } from '../../test/fixtures';

describe('assessment history', () => {
  it('uses baselines only and sorts them by measuredAt', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'later', measuredAt: 2_000, maxHoldSec: 190 }),
        makeBaseline({ id: 'earlier', measuredAt: 1_000, maxHoldSec: 180 }),
      ],
      sessions: [
        makeSession({
          type: 'MAX',
          rounds: [makeRound({ achievedHoldSec: 220 })],
        }),
      ],
    });

    expect(assessmentHistory(state).map((point) => point.sec)).toEqual([180, 190]);
  });

  it('distinguishes latest assessed max from assessed personal best', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'pb', measuredAt: 1_000, maxHoldSec: 210 }),
        makeBaseline({ id: 'latest', measuredAt: 2_000, maxHoldSec: 195 }),
      ],
    });

    expect(latestAssessedMaxSec(state)).toBe(195);
    expect(bestAssessedMaxSec(state)).toBe(210);
  });

  it('returns zero when no assessment exists', () => {
    expect(latestAssessedMaxSec(makeState())).toBe(0);
    expect(bestAssessedMaxSec(makeState())).toBe(0);
  });

  it('uses the highest result when latest assessments share a timestamp', () => {
    const state = makeState({
      baselines: [
        makeBaseline({ id: 'high', measuredAt: 2_000, maxHoldSec: 200 }),
        makeBaseline({ id: 'low', measuredAt: 2_000, maxHoldSec: 190 }),
      ],
    });
    expect(latestAssessedMaxSec(state)).toBe(200);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- src/domain/apnea/assessmentHistory.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement assessment helpers**

Create `src/domain/apnea/assessmentHistory.ts`:

```ts
import type { AppState } from '../models/types';

export interface MaxPoint {
  id: string;
  at: number;
  sec: number;
}

export function assessmentHistory(state: AppState): MaxPoint[] {
  return state.baselines
    .map((baseline) => ({
      id: baseline.id,
      at: baseline.measuredAt,
      sec: baseline.maxHoldSec,
    }))
    .sort((left, right) => left.at - right.at);
}

export function latestAssessedMaxSec(state: AppState): number {
  const points = assessmentHistory(state);
  const latestAt = points.at(-1)?.at;
  if (latestAt === undefined) return 0;
  return points
    .filter((point) => point.at === latestAt)
    .reduce((highest, point) => Math.max(highest, point.sec), 0);
}

export function bestAssessedMaxSec(state: AppState): number {
  return assessmentHistory(state).reduce(
    (best, point) => Math.max(best, point.sec),
    0,
  );
}
```

Export it from `src/domain/index.ts`:

```ts
export * from './apnea/assessmentHistory';
```

- [x] **Step 4: Change application stats to assessed personal best**

Replace `personalBestSec()` in `src/application/stats.ts`:

```ts
import { bestAssessedMaxSec } from '../domain/apnea/assessmentHistory';

export function personalBestSec(state: AppState): number {
  return bestAssessedMaxSec(state);
}
```

Replace the first stats test with:

```ts
it('personalBest uses standardized assessments and ignores training holds', () => {
  const state = emptyAppState();
  state.baselines = [
    { id: 'b', maxHoldSec: 180, firstContractionSec: null, measuredAt: 0 },
  ];
  state.sessions = [
    makeSession({
      type: 'CO2',
      rounds: [makeRound({ targetHoldSec: 110, achievedHoldSec: 205 })],
    }),
  ];

  expect(personalBestSec(state)).toBe(180);
});
```

- [x] **Step 5: Run assessment and stats tests**

Run:

```powershell
npm test -- src/domain/apnea/assessmentHistory.test.ts src/application/stats.test.ts
```

Expected: PASS.

- [x] **Step 6: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 4: Implement First-Contraction Thresholds and Session Classification

**Files:**
- Create: `src/domain/apnea/qualityEngine.ts`
- Create: `src/domain/apnea/qualityEngine.test.ts`
- Modify: `src/domain/apnea/config.ts:1-11`
- Modify: `src/domain/index.ts:1-10`

- [x] **Step 1: Add failing cold-start and personalization tests**

Create `src/domain/apnea/qualityEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifySession,
  effectiveEarlyThreshold,
  evaluateTypeProgression,
  medianContractionOnsetRatio,
  shouldAutoEase,
} from './qualityEngine';
import { makeRound, makeSession } from '../../test/fixtures';

describe('effectiveEarlyThreshold', () => {
  it('uses the cold-start threshold before five personal samples exist', () => {
    expect(effectiveEarlyThreshold([], 'CO2', 0)).toBe(0.5);
  });

  it('uses 80% of the personal median after five samples', () => {
    const sessions = [0.70, 0.75, 0.80, 0.85, 0.90].map((ratio, index) =>
      makeSession({
        id: `s-${index}`,
        type: 'CO2',
        rounds: [makeRound({
          index: 0,
          targetHoldSec: 100,
          firstContractionSec: ratio * 100,
        })],
      }),
    );

    expect(effectiveEarlyThreshold(sessions, 'CO2', 0)).toBeCloseTo(0.64);
  });

  it('resists one outlier and clamps personalized thresholds', () => {
    const sessions = [0.70, 0.72, 0.74, 0.76, 1.0].map((ratio, index) =>
      makeSession({
        id: `outlier-${index}`,
        type: 'CO2',
        rounds: [makeRound({
          index: 0,
          targetHoldSec: 100,
          firstContractionSec: ratio * 100,
        })],
      }),
    );
    expect(effectiveEarlyThreshold(sessions, 'CO2', 0)).toBeCloseTo(0.592);

    const veryEarly = sessions.map((session, index) => makeSession({
      ...session,
      id: `early-${index}`,
      rounds: [makeRound({
        targetHoldSec: 100,
        firstContractionSec: 10,
      })],
    }));
    expect(effectiveEarlyThreshold(veryEarly, 'CO2', 0)).toBe(0.25);

    const veryLate = sessions.map((session, index) => makeSession({
      ...session,
      id: `late-${index}`,
      rounds: [makeRound({
        targetHoldSec: 100,
        firstContractionSec: 100,
      })],
    }));
    expect(effectiveEarlyThreshold(veryLate, 'CO2', 0)).toBe(0.70);
  });

  it('summarizes valid onset ratios across recent sessions', () => {
    const sessions = [50, 70, 60].map((firstContractionSec, index) =>
      makeSession({
        id: `m-${index}`,
        type: 'CO2',
        rounds: [makeRound({
          targetHoldSec: 100,
          firstContractionSec,
        })],
      }),
    );
    expect(medianContractionOnsetRatio(sessions, 'CO2')).toBe(0.6);
  });
});

describe('shouldAutoEase', () => {
  it('ignores one ordinary early round', () => {
    const results = [
      makeRound({ index: 0, targetHoldSec: 100, firstContractionSec: 40 }),
    ];
    expect(shouldAutoEase(results, [0.5])).toBe(false);
  });

  it('triggers after two consecutive early rounds', () => {
    const results = [
      makeRound({ index: 0, targetHoldSec: 100, firstContractionSec: 40 }),
      makeRound({ index: 1, targetHoldSec: 100, firstContractionSec: 45 }),
    ];
    expect(shouldAutoEase(results, [0.5, 0.5])).toBe(true);
  });

  it('triggers after one extremely early round', () => {
    const results = [
      makeRound({ index: 0, targetHoldSec: 100, firstContractionSec: 20 }),
    ];
    expect(shouldAutoEase(results, [0.5])).toBe(true);
  });
});

describe('session classification and progression', () => {
  it('leaves an unrated historical session unclassified', () => {
    expect(classifySession(makeSession({ rpe: null }), [])).toBeNull();
  });

  it('classifies completed adjusted work as strained', () => {
    const session = makeSession({
      adjustment: {
        reason: 'early-contractions',
        triggeredAtRoundIndex: 1,
        restAddedSec: 15,
        holdCapSec: null,
      },
    });
    expect(classifySession(session, [])).toBe('strained');
  });

  it('classifies an early manual end as failed', () => {
    const session = makeSession({
      rounds: [makeRound({ targetHoldSec: 60, achievedHoldSec: 40 })],
      completedRounds: 0,
    });
    expect(classifySession(session, [])).toBe('failed');
  });

  it('progresses only after two clean sessions of the requested type', () => {
    const sessions = [
      makeSession({ id: 'co2-a', type: 'CO2', rpe: 'easy' }),
      makeSession({ id: 'o2-a', type: 'O2', rpe: 'easy' }),
      makeSession({ id: 'co2-b', type: 'CO2', rpe: 'normal' }),
    ];
    expect(evaluateTypeProgression(sessions, 'CO2').action).toBe('progress');
    expect(evaluateTypeProgression(sessions, 'O2').action).toBe('repeat');
  });

  it('deloads after two strained sessions of the same type', () => {
    const strained = (id: string) => makeSession({ id, rpe: 'hard' });
    expect(evaluateTypeProgression([strained('a'), strained('b')], 'CO2').action)
      .toBe('deload');
  });

  it('requires a fresh two-session streak after the level changes', () => {
    const sessions = [
      makeSession({ id: 'old', difficultyLevel: 0, rpe: 'easy' }),
      makeSession({ id: 'new', difficultyLevel: 1, rpe: 'easy' }),
    ];
    expect(evaluateTypeProgression(sessions, 'CO2').action).toBe('repeat');
  });
});
```

- [x] **Step 2: Run the quality tests to verify they fail**

Run:

```powershell
npm test -- src/domain/apnea/qualityEngine.test.ts
```

Expected: FAIL because the quality engine and configuration do not exist.

- [x] **Step 3: Add quality configuration**

Extend `APNEA_DEFAULTS` in `src/domain/apnea/config.ts`:

```ts
quality: {
  coldStartEarlyRatio: 0.50,
  extremeEarlyRatio: 0.25,
  personalSampleMin: 5,
  personalHistorySessions: 6,
  personalMedianFactor: 0.80,
  personalThresholdMin: 0.25,
  personalThresholdMax: 0.70,
  adjustmentRestStepSec: 15,
  profileLockDays: 7,
},
```

- [x] **Step 4: Implement the quality engine**

Create `src/domain/apnea/qualityEngine.ts`:

```ts
import { APNEA_DEFAULTS } from './config';
import type {
  ProgressionDecision,
  RoundResult,
  Session,
  SessionQuality,
  TrainingSessionType,
} from '../models/types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function contractionOnsetRatio(round: RoundResult): number | null {
  if (
    round.targetHoldSec <= 0
    || round.firstContractionSec === null
    || round.firstContractionSec < 0
  ) {
    return null;
  }
  return round.firstContractionSec / round.targetHoldSec;
}

export function effectiveEarlyThreshold(
  sessions: Session[],
  type: TrainingSessionType,
  roundIndex: number,
): number {
  const q = APNEA_DEFAULTS.quality;
  const samples = [...sessions]
    .filter((session) => session.type === type)
    .sort((left, right) => left.finishedAt - right.finishedAt)
    .slice(-q.personalHistorySessions)
    .map((session) => session.rounds.find((round) => round.index === roundIndex))
    .filter((round): round is RoundResult => round !== undefined)
    .map(contractionOnsetRatio)
    .filter((ratio): ratio is number => ratio !== null);

  if (samples.length < q.personalSampleMin) {
    return q.coldStartEarlyRatio;
  }

  return clamp(
    median(samples) * q.personalMedianFactor,
    q.personalThresholdMin,
    q.personalThresholdMax,
  );
}

export function medianContractionOnsetRatio(
  sessions: Session[],
  type: TrainingSessionType,
): number | null {
  const ratios = [...sessions]
    .filter((session) => session.type === type)
    .sort((left, right) => left.finishedAt - right.finishedAt)
    .slice(-APNEA_DEFAULTS.quality.personalHistorySessions)
    .flatMap((session) => session.rounds)
    .map(contractionOnsetRatio)
    .filter((ratio): ratio is number => ratio !== null);
  return ratios.length === 0 ? null : median(ratios);
}

export function isEarlyRound(round: RoundResult, threshold: number): boolean {
  const ratio = contractionOnsetRatio(round);
  return ratio !== null && ratio < threshold;
}

export function shouldAutoEase(
  results: RoundResult[],
  thresholds: number[],
): boolean {
  const last = results.at(-1);
  if (!last) return false;

  const lastRatio = contractionOnsetRatio(last);
  if (
    lastRatio !== null
    && lastRatio < APNEA_DEFAULTS.quality.extremeEarlyRatio
  ) {
    return true;
  }

  const previous = results.at(-2);
  if (!previous) return false;

  return isEarlyRound(previous, thresholds[previous.index])
    && isEarlyRound(last, thresholds[last.index]);
}

export function roundCompleted(round: RoundResult): boolean {
  return !round.tappedOut && round.achievedHoldSec >= round.targetHoldSec;
}

export function classifySession(
  session: Session,
  priorSessions: Session[],
): SessionQuality | null {
  if (session.type === 'MAX' || session.rpe === null) return null;
  if (
    session.rpe === 'failed'
    || session.rounds.some((round) => !roundCompleted(round))
    || session.tapOuts > 0
  ) {
    return 'failed';
  }

  const hasEarlyRound = session.rounds.some((round) =>
    isEarlyRound(
      round,
      effectiveEarlyThreshold(priorSessions, session.type, round.index),
    ),
  );

  if (session.rpe === 'hard' || session.adjustment !== null || hasEarlyRound) {
    return 'strained';
  }

  return 'clean';
}

export function evaluateTypeProgression(
  sessions: Session[],
  type: TrainingSessionType,
): ProgressionDecision {
  const typed = sessions
    .filter((session) => session.type === type)
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const latestLevel = typed.at(-1)?.difficultyLevel;
  const currentLevelStart = latestLevel === undefined
    ? typed.length
    : typed.findLastIndex(
        (session) => session.difficultyLevel !== latestLevel,
      ) + 1;
  const currentLevelRun = latestLevel === undefined
    ? []
    : typed.slice(currentLevelStart);

  const classified = currentLevelRun
    .map((session, index) => classifySession(
      session,
      typed.slice(0, currentLevelStart + index),
    ))
    .filter((quality): quality is SessionQuality => quality !== null);

  const last3 = classified.slice(-3);
  if (last3.length === 3 && last3.every((quality) => quality === 'failed')) {
    return { action: 'deload', suggestRetest: true };
  }

  const last2 = classified.slice(-2);
  if (last2.length === 2 && last2.every((quality) => quality === 'strained')) {
    return { action: 'deload', suggestRetest: false };
  }
  if (last2.length === 2 && last2.every((quality) => quality === 'clean')) {
    return { action: 'progress', suggestRetest: false };
  }

  return { action: 'repeat', suggestRetest: false };
}
```

Export the module from `src/domain/index.ts`.

- [x] **Step 5: Run quality tests**

Run:

```powershell
npm test -- src/domain/apnea/qualityEngine.test.ts
```

Expected: PASS.

- [x] **Step 6: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 5: Add Safe Early-Contraction Plan Easing

**Files:**
- Modify: `src/domain/apnea/adaptationEngine.ts:1-49`
- Modify: `src/domain/apnea/adaptationEngine.tapout.test.ts:1-31`

- [x] **Step 1: Write failing CO₂ and O₂ early-ease tests**

Append to `adaptationEngine.tapout.test.ts`:

```ts
import { applyEarlyContractionAdjustment } from './adaptationEngine';

it('CO2 early adjustment adds 15 seconds to every remaining recovery', () => {
  const plan = generateCo2Table(200, 0);
  const adjusted = applyEarlyContractionAdjustment(plan, 2);

  expect(adjusted.rounds.slice(0, 3)).toEqual(plan.rounds.slice(0, 3));
  expect(adjusted.rounds[3].restBeforeSec).toBe(plan.rounds[3].restBeforeSec + 15);
  expect(adjusted.rounds[7].targetHoldSec).toBe(plan.rounds[7].targetHoldSec);
});

it('O2 early adjustment adds recovery and freezes future hold increases', () => {
  const plan = generateO2Table(200, 0);
  const adjusted = applyEarlyContractionAdjustment(plan, 3);
  const cap = plan.rounds[3].targetHoldSec;

  expect(adjusted.rounds.slice(4).every((round) => round.targetHoldSec <= cap)).toBe(true);
  expect(adjusted.rounds[4].restBeforeSec).toBe(plan.rounds[4].restBeforeSec + 15);
});

it('never applies a contraction adjustment to a MAX plan', () => {
  const plan = { type: 'MAX' as const, rounds: [
    { index: 0, targetHoldSec: 200, restBeforeSec: 0 },
  ] };
  expect(applyEarlyContractionAdjustment(plan, 0)).toBe(plan);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npm test -- src/domain/apnea/adaptationEngine.tapout.test.ts
```

Expected: FAIL because `applyEarlyContractionAdjustment` does not exist.

- [x] **Step 3: Implement immutable early-contraction easing**

Add to `src/domain/apnea/adaptationEngine.ts`:

```ts
export function applyEarlyContractionAdjustment(
  plan: SessionPlan,
  triggerRoundIndex: number,
): SessionPlan {
  if (plan.type === 'MAX') return plan;

  const restStep = APNEA_DEFAULTS.quality.adjustmentRestStepSec;
  const holdCap = plan.rounds[triggerRoundIndex]?.targetHoldSec ?? Infinity;

  return {
    type: plan.type,
    rounds: plan.rounds.map((round) => {
      if (round.index <= triggerRoundIndex) return { ...round };
      return {
        ...round,
        restBeforeSec: round.restBeforeSec + restStep,
        targetHoldSec: plan.type === 'O2'
          ? Math.min(round.targetHoldSec, holdCap)
          : round.targetHoldSec,
      };
    }),
  };
}
```

- [x] **Step 4: Run adaptation tests**

Run:

```powershell
npm test -- src/domain/apnea/adaptationEngine.tapout.test.ts
```

Expected: PASS, including all pre-existing tap-out tests.

- [x] **Step 5: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 6: Upgrade the Runner Store to Record Timing and Build an Unrated Draft

**Files:**
- Modify: `src/application/stores/sessionRunnerStore.ts:1-66`
- Modify: `src/application/stores/sessionRunnerStore.test.ts:1-38`

- [x] **Step 1: Replace runner-store tests with v2 behavior**

Add these cases to `sessionRunnerStore.test.ts`:

```ts
it('records first-contraction time and builds an unrated draft', () => {
  const store = createSessionRunnerStore(() => 5_000);
  store.getState().start(generateCo2Table(200, 0), 0, Array(8).fill(0.5));
  store.getState().recordRound(110, 2, 65, false);

  const session = store.getState().finishDraft();
  expect(session.rounds[0].firstContractionSec).toBe(65);
  expect(session.rpe).toBeNull();
  expect(session.completedRounds).toBe(1);
});

it('does not count an early manual end as a completed round', () => {
  const store = createSessionRunnerStore(() => 5_000);
  store.getState().start(generateCo2Table(200, 0), 0, Array(8).fill(0.5));
  store.getState().recordRound(80, 1, 40, false);

  expect(store.getState().finishDraft().completedRounds).toBe(0);
});

it('applies at most one automatic early-contraction adjustment', () => {
  const store = createSessionRunnerStore(() => 5_000);
  store.getState().start(generateCo2Table(200, 0), 0, Array(8).fill(0.5));
  store.getState().recordRound(110, 1, 40, false);
  store.getState().recordRound(110, 1, 40, false);
  const firstPlan = store.getState().plan;
  store.getState().recordRound(110, 1, 20, false);

  expect(store.getState().adjustment?.reason).toBe('early-contractions');
  expect(store.getState().plan).toEqual(firstPlan);
});

it('replaces an early adjustment with stronger tap-out metadata', () => {
  const store = createSessionRunnerStore(() => 5_000);
  store.getState().start(generateCo2Table(200, 0), 0, Array(8).fill(0.5));
  store.getState().recordRound(110, 1, 40, false);
  store.getState().recordRound(110, 1, 40, false);
  store.getState().recordRound(50, 2, 20, true);

  expect(store.getState().adjustment?.reason).toBe('tap-out');
});

it('does not claim recovery was added by an O2 tap-out when none was added', () => {
  const store = createSessionRunnerStore(() => 5_000);
  store.getState().start(generateO2Table(200, 0), 0, Array(8).fill(0.5));
  store.getState().recordRound(50, 1, 20, true);

  expect(store.getState().adjustment?.restAddedSec).toBe(0);
});

it('rejects finishing a draft before a session has started', () => {
  const store = createSessionRunnerStore(() => 5_000);
  expect(() => store.getState().finishDraft()).toThrow(/before session start/i);
});

it('rejects impossible elapsed and contraction values', () => {
  const store = createSessionRunnerStore(() => 5_000);
  store.getState().start(generateCo2Table(200, 0), 0, Array(8).fill(0.5));
  expect(() => store.getState().recordRound(-1, 0, null, false))
    .toThrow(/achieved hold/i);
  expect(() => store.getState().recordRound(10, 1, 20, false))
    .toThrow(/first contraction/i);
  expect(() => store.getState().recordRound(10, -1, null, false))
    .toThrow(/contraction count/i);
  expect(() => store.getState().recordRound(10, 1, null, false))
    .toThrow(/first contraction/i);
});
```

- [x] **Step 2: Run the runner-store tests to verify they fail**

Run:

```powershell
npm test -- src/application/stores/sessionRunnerStore.test.ts
```

Expected: FAIL because the store lacks thresholds, adjustment state, and
`finishDraft`.

- [x] **Step 3: Replace the runner-store interface and affected methods**

Use this shape in `sessionRunnerStore.ts`:

```ts
import { createStore } from 'zustand/vanilla';
import type {
  InSessionAdjustment,
  RoundResult,
  Session,
  SessionPlan,
} from '../../domain/models/types';
import {
  applyEarlyContractionAdjustment,
  applyTapOut,
} from '../../domain/apnea/adaptationEngine';
import {
  roundCompleted,
  shouldAutoEase,
} from '../../domain/apnea/qualityEngine';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';

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
```

Replace `start`, `recordRound`, and `finish` with:

```ts
start(plan, difficultyLevel, earlyThresholds) {
  set({
    plan,
    difficultyLevel,
    earlyThresholds,
    roundIndex: 0,
    phase: 'breatheUp',
    startedAt: now(),
    results: [],
    adjustment: null,
  });
},

recordRound(achievedHoldSec, contractions, firstContractionSec, tappedOut) {
  const current = get();
  if (!current.plan) throw new Error('Cannot record a round before session start');

  const round = current.plan.rounds[current.roundIndex];
  if (!round) throw new Error('Cannot record a round outside the active plan');
  if (!Number.isFinite(achievedHoldSec) || achievedHoldSec < 0) {
    throw new Error('Achieved hold time must be a finite non-negative duration');
  }
  if (!Number.isInteger(contractions) || contractions < 0) {
    throw new Error('Contraction count must be a non-negative integer');
  }
  if (
    (contractions === 0 && firstContractionSec !== null)
    || (contractions > 0 && firstContractionSec === null)
  ) {
    throw new Error(
      'First contraction time and contraction count must be recorded together',
    );
  }
  if (
    firstContractionSec !== null
    && (
      !Number.isFinite(firstContractionSec)
      || firstContractionSec < 0
      || firstContractionSec > achievedHoldSec
    )
  ) {
    throw new Error(
      'First contraction time must fall within the achieved hold duration',
    );
  }

  const result: RoundResult = {
    index: round.index,
    targetHoldSec: round.targetHoldSec,
    achievedHoldSec,
    restBeforeSec: round.restBeforeSec,
    contractions,
    firstContractionSec,
    tappedOut,
  };
  const results = [...current.results, result];

  let plan = current.plan;
  let adjustment = current.adjustment;

  if (tappedOut) {
    const beforeTapOut = plan;
    plan = applyTapOut(beforeTapOut, round.index);
    const nextBefore = beforeTapOut.rounds.find(
      (candidate) => candidate.index > round.index,
    );
    const nextAfter = plan.rounds.find(
      (candidate) => candidate.index > round.index,
    );
    const tapOutRestAdded = nextBefore && nextAfter
      ? Math.max(0, nextAfter.restBeforeSec - nextBefore.restBeforeSec)
      : 0;
    const priorRestAdded = adjustment?.reason === 'early-contractions'
      ? adjustment.restAddedSec
      : 0;
    adjustment = {
      reason: 'tap-out',
      triggeredAtRoundIndex: round.index,
      restAddedSec: priorRestAdded + tapOutRestAdded,
      holdCapSec: plan.type === 'O2' ? round.targetHoldSec : null,
    };
  } else if (
    adjustment === null
    && plan.type !== 'MAX'
    && shouldAutoEase(results, current.earlyThresholds)
  ) {
    plan = applyEarlyContractionAdjustment(plan, round.index);
    adjustment = {
      reason: 'early-contractions',
      triggeredAtRoundIndex: round.index,
      restAddedSec: APNEA_DEFAULTS.quality.adjustmentRestStepSec,
      holdCapSec: plan.type === 'O2' ? round.targetHoldSec : null,
    };
  }

  set({
    results,
    plan,
    adjustment,
    roundIndex: current.roundIndex + 1,
  });
},

finishDraft() {
  const current = get();
  if (!current.plan) {
    throw new Error('Cannot finish a draft before session start');
  }
  const type = current.plan.type;
  const completedRounds = type === 'MAX'
    ? current.results.filter((round) => !round.tappedOut).length
    : current.results.filter(roundCompleted).length;

  const session: Session = {
    id: `session-${current.startedAt}`,
    type,
    rounds: current.results,
    startedAt: current.startedAt,
    finishedAt: now(),
    completedRounds,
    tapOuts: current.results.filter((round) => round.tappedOut).length,
    rpe: null,
    difficultyLevel: current.difficultyLevel,
    adjustment: current.adjustment,
  };
  set({ phase: 'done' });
  return session;
},
```

Initialize `earlyThresholds: []` and `adjustment: null` in the store's initial
state.

- [x] **Step 4: Run runner-store tests**

Run:

```powershell
npm test -- src/application/stores/sessionRunnerStore.test.ts
```

Expected: PASS.

- [x] **Step 5: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 7: Split CO₂/O₂ Progression in Application Use-cases

**Files:**
- Modify: `src/application/usecases/startTodaySession.ts:1-24`
- Modify: `src/application/usecases/startTodaySession.test.ts:1-34`
- Modify: `src/application/usecases/finishSession.ts:1-35`
- Modify: `src/application/usecases/finishSession.test.ts:1-91`
- Modify: `src/application/stores/appStore.ts:1-44`
- Modify: `src/application/stores/appStore.test.ts:1-56`

- [x] **Step 1: Replace global-difficulty tests with type-specific progression tests**

Replace the existing "progresses difficulty" and "deloads difficulty" tests in
`finishSession.test.ts` with the following, using `makeSession()` and
`makeRound()`:

```ts
it('progresses CO2 without changing O2', () => {
  let state = emptyAppState();
  state = finishSession(state, makeSession({
    id: 'a',
    type: 'CO2',
    rpe: 'easy',
  }), 1_000);
  state = finishSession(state, makeSession({
    id: 'b',
    type: 'CO2',
    rpe: 'normal',
    finishedAt: 2_000,
  }), 2_000);

  expect(state.courseState.difficultyByType).toEqual({ CO2: 1, O2: 0 });
});

it('deloads only O2 after two strained O2 sessions', () => {
  let state = emptyAppState();
  state.courseState.difficultyByType = { CO2: 4, O2: 3 };
  state = finishSession(state, makeSession({
    id: 'a',
    type: 'O2',
    rpe: 'hard',
  }), 1_000);
  state = finishSession(state, makeSession({
    id: 'b',
    type: 'O2',
    rpe: 'hard',
    finishedAt: 2_000,
  }), 2_000);

  expect(state.courseState.difficultyByType).toEqual({ CO2: 4, O2: 2 });
});

it('records MAX once as a baseline with first-contraction time', () => {
  const state = finishSession(emptyAppState(), makeSession({
    type: 'MAX',
    rounds: [makeRound({
      targetHoldSec: 180,
      achievedHoldSec: 205,
      firstContractionSec: 95,
    })],
  }), 3_000);

  expect(state.baselines).toEqual([{
    id: 'baseline-3000',
    maxHoldSec: 205,
    firstContractionSec: 95,
    measuredAt: 3_000,
  }]);
});

it('returns a retest suggestion after three failed sessions at one level', () => {
  let state = emptyAppState();
  state = finishSession(state, makeSession({
    id: 'failed-1',
    rpe: 'failed',
  }), 1_000);
  state = finishSession(state, makeSession({
    id: 'failed-2',
    rpe: 'failed',
    finishedAt: 2_000,
  }), 2_000);
  const completion = finishRatedSession(state, makeSession({
    id: 'failed-3',
    rpe: 'failed',
    finishedAt: 3_000,
  }), 3_000);

  expect(completion.action).toBe('deload');
  expect(completion.suggestRetest).toBe(true);
});
```

Import `finishRatedSession` alongside `finishSession` in this test file.

Add to `startTodaySession.test.ts`:

```ts
it('uses the prescribed type level and returns per-round early thresholds', () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 200,
    firstContractionSec: null,
    measuredAt: 0,
  }];
  state.courseState.difficultyByType = { CO2: 3, O2: 1 };

  const result = startTodaySession(state, D('2026-07-09T10:00:00'));

  expect(result.appliedDifficulty).toBe(3);
  expect(result.earlyContractionThresholds).toEqual(Array(8).fill(0.5));
});

it('generates training from the latest assessment rather than the older best', () => {
  const state = emptyAppState();
  state.baselines = [
    {
      id: 'best',
      maxHoldSec: 240,
      firstContractionSec: null,
      measuredAt: 1,
    },
    {
      id: 'latest',
      maxHoldSec: 200,
      firstContractionSec: null,
      measuredAt: 2,
    },
  ];

  const result = startTodaySession(state, D('2026-07-09T10:00:00'));
  expect(result.plan).toEqual(generatePlanForDay('CO2', 200, 0));
});
```

Import `generatePlanForDay` from `../../domain/apnea/tableGenerator` in the
start-session test.

Also replace the existing inactivity-deload setup:

```ts
s.courseState.difficultyLevel = 3;
```

with:

```ts
s.courseState.difficultyByType.CO2 = 3;
```

- [x] **Step 2: Run the use-case tests to verify they fail**

Run:

```powershell
npm test -- src/application/usecases/finishSession.test.ts src/application/usecases/startTodaySession.test.ts
```

Expected: FAIL because progression is still global and thresholds are absent.

- [x] **Step 3: Extend `StartTodayResult` and use type-specific difficulty**

In `startTodaySession.ts`:

```ts
import { latestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';
import { effectiveEarlyThreshold } from '../../domain/apnea/qualityEngine';

export interface StartTodayResult {
  plan: SessionPlan | null;
  decision: TodayDecision;
  needsBaseline: boolean;
  appliedDifficulty: number;
  earlyContractionThresholds: number[];
}

const maxHold = latestAssessedMaxSec(state);
const needsBaseline = maxHold <= 0;
const trainingType = decision.dayType === 'CO2' || decision.dayType === 'O2'
  ? decision.dayType
  : null;
const baseDifficulty = trainingType === null
  ? 0
  : state.courseState.difficultyByType[trainingType];
const appliedDifficulty = decision.deload
  ? Math.max(0, baseDifficulty - 1)
  : baseDifficulty;
const plan = needsBaseline || decision.blocked
  ? null
  : generatePlanForDay(decision.dayType, maxHold, appliedDifficulty);
const earlyContractionThresholds = plan && trainingType
  ? plan.rounds.map((round) =>
      effectiveEarlyThreshold(
        state.sessions,
        trainingType,
        round.index,
      ),
    )
  : [];

return {
  plan,
  decision,
  needsBaseline,
  appliedDifficulty,
  earlyContractionThresholds,
};
```

- [x] **Step 4: Add detailed completion while preserving the existing wrapper**

Replace `finishSession.ts` with:

```ts
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

  return {
    state: { ...state, sessions, courseState, baselines },
    quality,
    action,
    previousLevel,
    nextLevel,
    suggestRetest,
    profileChangedTo: null,
    profileQueuedFor: null,
  };
}

export function finishSession(
  state: AppState,
  session: Session,
  now: number,
): AppState {
  return finishRatedSession(state, session, now).state;
}
```

- [x] **Step 5: Return completion details from the app store**

Change `AppStore.completeSession`:

```ts
completeSession(session: Session): Promise<SessionCompletion>;
```

Make `commit` update Zustand only after durable persistence succeeds:

```ts
async function commit(next: AppState) {
  await repo.setState(next);
  set({ state: next });
}
```

Then change the completion implementation:

```ts
async completeSession(session) {
  const result = finishRatedSession(
    get().state,
    session,
    now(),
  );
  await commit(result.state);
  return result;
},
```

Import `finishRatedSession` and `SessionCompletion`.

Add this store test, importing `makeSession` from `../../test/fixtures`:

```ts
it('does not advance in-memory state when persistence fails', async () => {
  const failingRepo = memoryRepo();
  failingRepo.setState = async () => {
    throw new Error('storage unavailable');
  };
  const store = createAppStore(failingRepo, () => 2_000);
  await store.getState().hydrate();

  await expect(
    store.getState().completeSession(makeSession({ rpe: 'normal' })),
  ).rejects.toThrow(/storage unavailable/i);
  expect(store.getState().state.sessions).toEqual([]);
  expect(store.getState().state.courseState.position).toBe(0);
});
```

- [x] **Step 6: Run use-case and store tests**

Run:

```powershell
npm test -- src/application/usecases/finishSession.test.ts src/application/usecases/startTodaySession.test.ts src/application/stores/appStore.test.ts
```

Expected: PASS.

- [x] **Step 7: Remove the superseded global progression implementation**

Delete `src/domain/apnea/adaptationEngine.progression.test.ts`. In
`src/domain/apnea/adaptationEngine.ts`, remove `isClean`, `isFailed`, and
`evaluateProgression`, plus the now-unused `Session` and `ProgressionDecision`
imports. The file must export only `applyTapOut` and
`applyEarlyContractionAdjustment`.

- [x] **Step 8: Run adaptation, quality, and completion tests together**

Run:

```powershell
npm test -- src/domain/apnea/adaptationEngine.tapout.test.ts src/domain/apnea/qualityEngine.test.ts src/application/usecases/finishSession.test.ts
```

Expected: PASS with no remaining import of `evaluateProgression`.

- [x] **Step 9: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 8: Add Stable Adaptive Weekly Profiles

**Files:**
- Create: `src/domain/apnea/microcycleProfiles.ts`
- Create: `src/domain/apnea/microcycleProfiles.test.ts`
- Modify: `src/domain/apnea/courseEngine.ts:1-66`
- Modify: `src/domain/apnea/courseEngine.test.ts:1-91`
- Modify: `src/application/usecases/finishSession.ts`
- Modify: `src/domain/index.ts`

- [x] **Step 1: Write profile-template and gate tests**

Create `src/domain/apnea/microcycleProfiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyPendingProfileAtBoundary,
  profileTemplate,
  updateMicrocycleProfile,
} from './microcycleProfiles';
import { makeBaseline, makeSession, makeState } from '../../test/fixtures';

describe('profile templates', () => {
  it('keeps four training days, three rest days, and no consecutive O2 days', () => {
    const days = profileTemplate('o2-heavy').days;
    expect(days.filter((day) => day === 'O2')).toHaveLength(3);
    expect(days.filter((day) => day === 'REST')).toHaveLength(3);
    expect(days.some((day, index) => day === 'O2' && days[index + 1] === 'O2'))
      .toBe(false);
  });

  it('keeps recovery slots fixed across every profile', () => {
    for (const profile of ['co2-heavy', 'balanced', 'o2-heavy'] as const) {
      const restIndexes = profileTemplate(profile).days
        .flatMap((day, index) => day === 'REST' ? [index] : []);
      expect(restIndexes).toEqual([1, 3, 6]);
    }
  });
});

describe('profile selection', () => {
  it('queues O2-heavy after three clean O2 sessions and fresh MAX', () => {
    const now = 10 * 86_400_000;
    const state = makeState({
      baselines: [makeBaseline({ measuredAt: now - 5 * 86_400_000 })],
      sessions: ['a', 'b', 'c'].map((id, index) => makeSession({
        id,
        type: 'O2',
        rpe: 'normal',
        finishedAt: now - (3 - index) * 86_400_000,
      })),
    });
    state.courseState.position = 1;

    const next = updateMicrocycleProfile(state, now);
    expect(next.pendingMicrocycleProfile).toBe('o2-heavy');
  });

  it('does not promote O2-heavy from a stale MAX assessment', () => {
    const now = 30 * 86_400_000;
    const state = makeState({
      baselines: [makeBaseline({ measuredAt: now - 22 * 86_400_000 })],
      sessions: ['a', 'b', 'c'].map((id, index) => makeSession({
        id,
        type: 'O2',
        rpe: 'normal',
        finishedAt: now - (3 - index) * 86_400_000,
      })),
    });
    state.courseState.position = 1;

    expect(updateMicrocycleProfile(state, now).pendingMicrocycleProfile)
      .toBeNull();
  });

  it('queues CO2-heavy only for repeated early-onset strain', () => {
    const earlyAdjustment = {
      reason: 'early-contractions' as const,
      triggeredAtRoundIndex: 2,
      restAddedSec: 15,
      holdCapSec: null,
    };
    const state = makeState({
      sessions: [
        makeSession({ id: 'a', adjustment: earlyAdjustment }),
        makeSession({ id: 'b', adjustment: earlyAdjustment }),
      ],
    });
    state.courseState.position = 1;

    const next = updateMicrocycleProfile(state, 10_000);
    expect(next.pendingMicrocycleProfile).toBe('co2-heavy');
  });

  it('immediately demotes O2-heavy after an adjusted O2 session', () => {
    const state = makeState();
    state.courseState.microcycleProfile = 'o2-heavy';
    state.courseState.template = profileTemplate('o2-heavy');
    state.sessions = [makeSession({
      type: 'O2',
      adjustment: {
        reason: 'early-contractions',
        triggeredAtRoundIndex: 2,
        restAddedSec: 15,
        holdCapSec: 120,
      },
    })];

    const next = updateMicrocycleProfile(state, 10_000);
    expect(next.microcycleProfile).toBe('balanced');
    expect(next.pendingMicrocycleProfile).toBeNull();
  });

  it('applies a queued promotion only at a seven-slot boundary', () => {
    const course = makeState().courseState;
    course.pendingMicrocycleProfile = 'co2-heavy';
    course.position = 6;
    expect(applyPendingProfileAtBoundary(course, 10_000).microcycleProfile)
      .toBe('balanced');

    course.position = 7;
    expect(applyPendingProfileAtBoundary(course, 10_000).microcycleProfile)
      .toBe('co2-heavy');
  });

  it('updates the queued choice during a lock without applying it early', () => {
    const state = makeState({
      sessions: [
        makeSession({ id: 'a', adjustment: {
          reason: 'early-contractions',
          triggeredAtRoundIndex: 1,
          restAddedSec: 15,
          holdCapSec: null,
        } }),
        makeSession({ id: 'b', adjustment: {
          reason: 'early-contractions',
          triggeredAtRoundIndex: 1,
          restAddedSec: 15,
          holdCapSec: null,
        } }),
      ],
    });
    state.courseState.pendingMicrocycleProfile = 'o2-heavy';
    state.courseState.profileLockedUntil = 20_000;
    state.courseState.position = 7;

    const next = updateMicrocycleProfile(state, 10_000);
    expect(next.microcycleProfile).toBe('balanced');
    expect(next.pendingMicrocycleProfile).toBe('co2-heavy');
  });
});
```

- [x] **Step 2: Run the profile tests to verify they fail**

Run:

```powershell
npm test -- src/domain/apnea/microcycleProfiles.test.ts
```

Expected: FAIL because the profile module does not exist.

- [x] **Step 3: Implement profile templates and decisions**

Create `src/domain/apnea/microcycleProfiles.ts`:

```ts
import type {
  AppState,
  CourseState,
  MicrocycleProfile,
  MicrocycleTemplate,
  Session,
} from '../models/types';
import { DAY_MS, APNEA_DEFAULTS } from './config';
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
```

Export it from `src/domain/index.ts`.

- [x] **Step 4: Apply queued profiles while rest days and sessions advance**

In `courseEngine.ts`, import `applyPendingProfileAtBoundary`.

At the end of `syncRestDays`, return:

```ts
return applyPendingProfileAtBoundary({
  ...c,
  position,
  lastAdvanceAt,
}, now);
```

At the end of `completeSession`, wrap the new course state:

```ts
return applyPendingProfileAtBoundary({
  ...c,
  position: c.position + 1,
  lastTrainedAt: now,
  lastAdvanceAt: startOfDay(now) + DAY_MS,
}, now);
```

- [x] **Step 5: Integrate profile reevaluation into rated completion**

In `finishRatedSession`, build the next state, then update its course:

```ts
let nextState: AppState = { ...state, sessions, courseState, baselines };
const previousProfile = state.courseState.microcycleProfile;
const previousPendingProfile =
  state.courseState.pendingMicrocycleProfile;
nextState = {
  ...nextState,
  courseState: updateMicrocycleProfile(nextState, now),
};
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
```

Import `updateMicrocycleProfile`.

- [x] **Step 6: Add course boundary tests**

Append to `courseEngine.test.ts`:

```ts
it('applies a queued profile when rest synchronization crosses a cycle boundary', () => {
  const c = course({
    position: 6,
    pendingMicrocycleProfile: 'co2-heavy',
    lastAdvanceAt: D('2026-07-08T00:00:00'),
  });
  const synced = syncRestDays(c, D('2026-07-09T10:00:00'));

  expect(synced.position).toBe(7);
  expect(synced.microcycleProfile).toBe('co2-heavy');
});
```

- [x] **Step 7: Run profile, course, and completion tests**

Run:

```powershell
npm test -- src/domain/apnea/microcycleProfiles.test.ts src/domain/apnea/courseEngine.test.ts src/application/usecases/finishSession.test.ts
```

Expected: PASS.

- [x] **Step 8: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 9: Move Persistence Behind the Required Summary Rating

**Files:**
- Modify: `src/ui/screens/HomeScreen.tsx:1-87`
- Modify: `src/ui/screens/RunnerScreen.tsx:1-270`
- Modify: `src/ui/screens/RunnerScreen.test.tsx:1-223`
- Modify: `src/ui/screens/SummaryScreen.tsx:1-24`
- Create: `src/ui/screens/SummaryScreen.test.tsx`

- [x] **Step 1: Write the failing delayed-persistence runner test**

Replace the current "persists once and navigates" test in `RunnerScreen.test.tsx`:

```ts
it('navigates with an unrated draft and persists only after Summary rating', async () => {
  vi.useFakeTimers();
  const setState = vi.fn(async () => {});
  renderRunner({ setState });

  await startSession();
  await advanceToHold();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /end hold/i }));
  });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i }))
    .toBeInTheDocument();
  expect(setState).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /normal effort/i }));
  });
  await flushAsyncWork();

  expect(setState).toHaveBeenCalledOnce();
});
```

Add:

```ts
it('records the first contraction time once and shows it during the hold', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(10_000);
  renderRunner({ clock });

  await startSession();
  await advanceToHold();
  clock.advance(30_000);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /contraction/i }));
  });
  clock.advance(10_000);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /contraction/i }));
  });

  expect(screen.getByText(/first contraction · 0:30/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /contraction · 2/i }))
    .toBeInTheDocument();
});

it('shows why recovery changed after two early-contraction rounds', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(10_000);
  const plan: SessionPlan = {
    type: 'CO2',
    rounds: [
      { index: 0, targetHoldSec: 60, restBeforeSec: 0 },
      { index: 1, targetHoldSec: 60, restBeforeSec: 45 },
      { index: 2, targetHoldSec: 60, restBeforeSec: 45 },
    ],
  };
  renderRunner({ plan, clock });

  await startSession();
  await advanceToHold();
  for (let round = 0; round < 2; round += 1) {
    clock.advance(20_000);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /contraction/i }));
    });
    clock.advance(40_000);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /end hold/i }));
    });
    await flushAsyncWork();
    if (round === 0) {
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /start next hold/i }),
        );
      });
      await flushAsyncWork();
    }
  }

  expect(screen.getByText(/recovery increased by 15s/i)).toBeInTheDocument();
  expect(screen.getByText('1:00')).toBeInTheDocument();
});
```

- [x] **Step 2: Write Summary tests**

Create `src/ui/screens/SummaryScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SummaryScreen } from './SummaryScreen';
import { makeSession } from '../../test/fixtures';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';

function renderSummary(setState = vi.fn(async (_state: AppState) => {})) {
  const session = makeSession({ rpe: null });
  const repository = {
    getState: vi.fn(async () => emptyAppState()),
    setState,
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{
          pathname: '/summary',
          state: { session },
        }]}>
          <Routes>
            <Route path="/summary" element={<SummaryScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return setState;
}

describe('SummaryScreen', () => {
  it('requires one quality choice before persistence', async () => {
    const setState = renderSummary();
    expect(setState).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: /normal effort/i }),
    );

    await waitFor(() => expect(setState).toHaveBeenCalledOnce());
    expect(screen.getByText(/session quality/i)).toBeInTheDocument();
  });

  it('ignores repeated rating clicks while persistence is in flight', async () => {
    let release!: () => void;
    const setState = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    renderSummary(setState);
    const rating = screen.getByRole('button', { name: /normal effort/i });
    await userEvent.dblClick(rating);
    expect(setState).toHaveBeenCalledOnce();
    release();
    await waitFor(() => expect(screen.getByText(/session quality/i)).toBeInTheDocument());
  });

  it('surfaces a persistence error and allows another rating attempt', async () => {
    const setState = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    renderSummary(setState);
    await userEvent.click(
      screen.getByRole('button', { name: /normal effort/i }),
    );

    expect(await screen.findByText(/storage unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /normal effort/i }))
      .toBeEnabled();
  });
});
```

- [x] **Step 3: Run UI tests to verify they fail**

Run:

```powershell
npm test -- src/ui/screens/RunnerScreen.test.tsx src/ui/screens/SummaryScreen.test.tsx
```

Expected: FAIL because Runner persists before Summary and Summary has no rating.

- [x] **Step 4: Pass threshold context from Home to Runner**

Change `launch()` in `HomeScreen.tsx`:

```ts
function launch() {
  navigate('/runner', {
    state: {
      plan: today.plan,
      difficultyLevel: today.appliedDifficulty,
      earlyContractionThresholds: today.earlyContractionThresholds,
    },
  });
}
```

- [x] **Step 5: Record first contraction and navigate with an unrated draft**

Extend `RunnerNavState`:

```ts
interface RunnerNavState {
  plan: SessionPlan;
  difficultyLevel: number;
  earlyContractionThresholds: number[];
}
```

Read these runner-store selectors:

```ts
const adjustment = useRunnerStore((s) => s.adjustment);
const finishDraft = useRunnerStore((s) => s.finishDraft);
```

Add local state:

```ts
const [firstContractionSec, setFirstContractionSec] = useState<number | null>(null);
```

Start the store with thresholds:

```ts
start(
  navPlan,
  nav?.difficultyLevel ?? 0,
  nav?.earlyContractionThresholds ?? navPlan.rounds.map(() => 0.5),
);
```

Reset first-contraction state whenever a hold begins:

```ts
setFirstContractionSec(null);
```

Replace round recording:

```ts
function endHold() {
  recordRound(
    achievedHoldSec(),
    contractions,
    firstContractionSec,
    false,
  );
  setContractions(0);
  setPendingRecoverAdvance(true);
}
```

and keep tap-out on the same deferred path:

```ts
function tapOut() {
  recordRound(
    achievedHoldSec(),
    contractions,
    firstContractionSec,
    true,
  );
  setContractions(0);
  setPendingRecoverAdvance(true);
}
```

Do not call `timer.endHold()` directly from either handler. The existing
`pendingRecoverAdvance` effect advances after the Zustand plan update has
rerendered the hook, so the next recovery uses the adjusted duration.

Add:

```ts
function markContraction() {
  const elapsed = achievedHoldSec();
  setContractions((count) => count + 1);
  setFirstContractionSec((current) => current ?? elapsed);
}
```

Use `markContraction` for the button and render:

```tsx
{firstContractionSec !== null && (
  <div className="text-xs text-[color:var(--text-dim)]">
    First contraction · {formatMMSS(firstContractionSec)}
  </div>
)}
```

Replace the current done effect with:

```ts
useEffect(() => {
  if (timer.phase !== 'done' || hasFinished.current) return;
  hasFinished.current = true;
  const session = finishDraft();
  navigate('/summary', { state: { session } });
}, [finishDraft, navigate, timer.phase]);
```

Remove `completeSession` from Runner entirely.

- [x] **Step 6: Show the auto-ease explanation**

Render above the bottom controls:

```tsx
{adjustment?.reason === 'early-contractions' && (
  <Card className="border-[color:var(--warn)]">
    <p className="text-sm text-[color:var(--warn)]">
      {plan.type === 'O2'
        ? `Next hold increases paused; recovery increased by ${adjustment.restAddedSec}s.`
        : `Recovery increased by ${adjustment.restAddedSec}s — contractions started earlier than your normal.`}
    </p>
  </Card>
)}
```

Import `Card`.

- [x] **Step 7: Replace Summary with a required rating flow**

Replace `SummaryScreen.tsx` with:

```tsx
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Rpe, Session } from '../../domain/models/types';
import type { SessionCompletion } from '../../application/usecases/finishSession';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useAppStore } from '../app/stores';

const RATINGS: Array<{ value: Rpe; label: string }> = [
  { value: 'easy', label: 'Easy and controlled' },
  { value: 'normal', label: 'Normal effort' },
  { value: 'hard', label: 'Hard or lost relaxation' },
  { value: 'failed', label: 'Could not complete the plan' },
];

export function SummaryScreen() {
  const navigate = useNavigate();
  const completeSession = useAppStore((state) => state.completeSession);
  const session = (useLocation().state as { session: Session } | null)?.session;
  const [completion, setCompletion] = useState<SessionCompletion | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  if (!session) {
    return (
      <p className="p-6">
        No session data. <Button onClick={() => navigate('/')}>Home</Button>
      </p>
    );
  }

  const best = session.rounds.reduce(
    (value, round) => Math.max(value, round.achievedHoldSec),
    0,
  );

  async function rate(rpe: Rpe) {
    if (savingRef.current || completion !== null) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await completeSession({ ...session, rpe });
      setCompletion(result);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save the session',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <h2 className="text-2xl font-bold">Session complete</h2>
      <Card>
        <div className="flex justify-between text-sm">
          <span>Completed rounds</span>
          <span>{session.completedRounds}/{session.rounds.length}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Best hold</span>
          <span>{formatMMSS(best)}</span>
        </div>
      </Card>

      {completion === null ? (
        <Card>
          <div className="mb-3 font-semibold">How did the session feel?</div>
          <div className="grid gap-2">
            {RATINGS.map((rating) => (
              <Button
                key={rating.value}
                variant="ghost"
                disabled={saving}
                onClick={() => void rate(rating.value)}
              >
                {rating.label}
              </Button>
            ))}
          </div>
          {saveError && (
            <p role="alert" className="mt-3 text-sm text-[color:var(--danger)]">
              {saveError}
            </p>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <div className="font-semibold">Session quality</div>
            <p className="text-sm text-[color:var(--text-dim)]">
              {completion.quality === 'clean'
                ? 'Clean session: all prescribed work stayed controlled.'
                : completion.quality === 'strained'
                  ? session.adjustment?.reason === 'early-contractions'
                    ? 'Contractions began earlier than your personal range.'
                    : 'The session was completed under high strain.'
                  : completion.quality === 'failed'
                    ? 'The planned work was incomplete or included a tap-out.'
                    : 'MAX assessment recorded.'}
            </p>
            {completion.previousLevel !== null
              && completion.nextLevel !== null
              && completion.action !== null && (
              <p className="mt-1 text-sm">
                {completion.action === 'progress'
                  ? `${session.type} level increased from ${completion.previousLevel} to ${completion.nextLevel} after two clean sessions.`
                  : completion.action === 'deload'
                    ? completion.nextLevel < completion.previousLevel
                      ? `${session.type} level reduced from ${completion.previousLevel} to ${completion.nextLevel} after repeated strain or failure.`
                      : `${session.type} level stays at 0, the minimum, after repeated strain or failure.`
                    : `${session.type} level stays at ${completion.nextLevel} until the quality signal is clearer.`}
              </p>
            )}
            {completion.suggestRetest && (
              <p className="mt-1 text-sm text-[color:var(--warn)]">
                Three failed sessions in a row. Schedule a new MAX assessment
                after recovery.
              </p>
            )}
            {completion.profileChangedTo && (
              <p className="mt-1 text-sm">
                Weekly profile changed to {completion.profileChangedTo}.
              </p>
            )}
            {completion.profileQueuedFor && (
              <p className="mt-1 text-sm">
                Next microcycle: {completion.profileQueuedFor}.
              </p>
            )}
          </Card>
          <Button onClick={() => navigate('/')}>Done</Button>
        </>
      )}
    </div>
  );
}
```

- [x] **Step 8: Run Runner and Summary tests**

Run:

```powershell
npm test -- src/ui/screens/RunnerScreen.test.tsx src/ui/screens/SummaryScreen.test.tsx
```

Expected: PASS.

- [x] **Step 9: Run the first full v2 production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build successfully with no remaining v1 schema or
old runner-store references.

- [x] **Step 10: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 10: Surface Split Levels and Weekly Profile

**Files:**
- Modify: `src/application/stats.ts:1-42`
- Modify: `src/application/stats.test.ts:1-46`
- Modify: `src/ui/screens/StatsScreen.tsx:1-33`
- Create: `src/ui/screens/StatsScreen.test.tsx`
- Modify: `src/ui/screens/ProgramScreen.tsx:1-48`
- Modify: `src/ui/screens/ProgramScreen.test.tsx:1-86`
- Modify: `src/ui/screens/HomeScreen.test.tsx:1-72`

- [x] **Step 1: Add a latest-quality application helper**

Add to `src/application/stats.ts`:

```ts
import {
  classifySession,
  medianContractionOnsetRatio,
} from '../domain/apnea/qualityEngine';
import type {
  SessionQuality,
  TrainingSessionType,
} from '../domain/models/types';

export function latestSessionQuality(state: AppState): SessionQuality | null {
  const sessions = state.sessions
    .filter((session) => session.type !== 'MAX')
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const latest = sessions.at(-1);
  if (!latest) return null;
  return classifySession(latest, sessions.slice(0, -1));
}

export function medianContractionOnsetPct(
  state: AppState,
  type: TrainingSessionType,
): number | null {
  const ratio = medianContractionOnsetRatio(state.sessions, type);
  return ratio === null ? null : Math.round(ratio * 100);
}
```

Replace the existing `./stats` import with the following, then add these tests:

```ts
import {
  adherencePct,
  currentStreakDays,
  latestSessionQuality,
  medianContractionOnsetPct,
  personalBestSec,
  weeklySessionCount,
} from './stats';

it('reports the latest rated training quality', () => {
  const state = emptyAppState();
  state.sessions = [makeSession({ rpe: 'hard' })];
  expect(latestSessionQuality(state)).toBe('strained');
});

it('reports median contraction onset as a percentage of target', () => {
  const state = emptyAppState();
  state.sessions = [
    makeSession({
      type: 'CO2',
      rounds: [makeRound({
        targetHoldSec: 100,
        firstContractionSec: 60,
      })],
    }),
  ];
  expect(medianContractionOnsetPct(state, 'CO2')).toBe(60);
});
```

- [x] **Step 2: Write the failing Stats screen test**

Create `src/ui/screens/StatsScreen.test.tsx`:

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { StatsScreen } from './StatsScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';

it('shows independent levels and the active weekly profile', async () => {
  const state = emptyAppState();
  state.courseState.difficultyByType = { CO2: 3, O2: 1 };
  state.courseState.microcycleProfile = 'co2-heavy';
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };

  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders><StatsScreen /></AppProviders>
    </ServicesProvider>,
  );

  await waitFor(() => expect(screen.getByText('CO₂ level')).toBeInTheDocument());
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('CO₂-heavy')).toBeInTheDocument();
});
```

- [x] **Step 3: Run Stats tests to verify they fail**

Run:

```powershell
npm test -- src/application/stats.test.ts src/ui/screens/StatsScreen.test.tsx
```

Expected: FAIL until the new UI is rendered.

- [x] **Step 4: Add quality/profile cards to Stats**

In `StatsScreen.tsx`, import `latestSessionQuality` and
`medianContractionOnsetPct`, then add:

```tsx
<div className="grid grid-cols-2 gap-3">
  <StatCard label="CO₂ level" value={`${state.courseState.difficultyByType.CO2}`} />
  <StatCard label="O₂ level" value={`${state.courseState.difficultyByType.O2}`} />
</div>
<Card>
  <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
    Weekly profile
  </div>
  <div className="mt-1 text-lg font-semibold">
    {state.courseState.microcycleProfile === 'co2-heavy'
      ? 'CO₂-heavy'
      : state.courseState.microcycleProfile === 'o2-heavy'
        ? 'O₂-heavy'
        : 'Balanced'}
  </div>
  <div className="text-sm text-[color:var(--text-dim)]">
    Latest quality: {latestSessionQuality(state) ?? 'No rated sessions'}
  </div>
  <div className="mt-2 text-sm text-[color:var(--text-dim)]">
    CO₂ contraction onset: {
      medianContractionOnsetPct(state, 'CO2') === null
        ? 'Not enough data'
        : `${medianContractionOnsetPct(state, 'CO2')}% of target`
    }
  </div>
  <div className="text-sm text-[color:var(--text-dim)]">
    O₂ contraction onset: {
      medianContractionOnsetPct(state, 'O2') === null
        ? 'Not enough data'
        : `${medianContractionOnsetPct(state, 'O2')}% of target`
    }
  </div>
</Card>
```

- [x] **Step 5: Show active and queued profiles in Program**

Add to `ProgramScreen.tsx` before the week card:

```tsx
<Card>
  <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
    Training profile
  </div>
  <div className="mt-1 font-semibold">{state.courseState.microcycleProfile}</div>
  {state.courseState.pendingMicrocycleProfile && (
    <div className="text-sm text-[color:var(--text-dim)]">
      Next cycle: {state.courseState.pendingMicrocycleProfile}
    </div>
  )}
</Card>
```

Add this Program test:

```ts
it('shows a profile queued for the next microcycle', async () => {
  const state = emptyAppState();
  state.courseState.pendingMicrocycleProfile = 'o2-heavy';
  renderProgram(state, D('2026-07-06T10:00:00'));

  await waitFor(() =>
    expect(screen.getByText(/next cycle: o2-heavy/i)).toBeInTheDocument(),
  );
});
```

- [x] **Step 6: Update Home and Program fixtures to v2 builders**

In `HomeScreen.test.tsx`, replace `completedSession` with:

```ts
function completedSession(finishedAt: number): Session {
  return makeSession({
    id: 's1',
    type: 'CO2',
    rounds: [makeRound({
      targetHoldSec: 110,
      achievedHoldSec: 110,
    })],
    startedAt: finishedAt - 60_000,
    finishedAt,
    rpe: 'normal',
  });
}
```

In `ProgramScreen.test.tsx`, replace `completed` with:

```ts
function completed(over: Partial<Session> = {}): Session {
  return makeSession({
    id: 's1',
    type: 'CO2',
    rounds: Array.from({ length: 8 }, (_, index) => makeRound({
      index,
      targetHoldSec: 110,
      achievedHoldSec: 110,
    })),
    startedAt: D('2026-07-06T10:00:00'),
    finishedAt: D('2026-07-06T10:20:00'),
    rpe: 'normal',
    ...over,
  });
}
```

Import `makeRound` and `makeSession` from `../../test/fixtures` in both files.

- [x] **Step 7: Run screen tests**

Run:

```powershell
npm test -- src/ui/screens/HomeScreen.test.tsx src/ui/screens/StatsScreen.test.tsx src/ui/screens/ProgramScreen.test.tsx
```

Expected: PASS.

- [x] **Step 8: Inspect the uncommitted diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; changes remain uncommitted.

---

### Task 11: Run the Full Quality-Loop Regression

**Files:**
- No planned file modifications.

- [x] **Step 1: Run all tests**

Run:

```powershell
npm test
```

Expected: all Vitest suites pass.

- [x] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code 0.

- [x] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build successfully.

- [x] **Step 4: Verify the safety and persistence invariants explicitly**

Run:

```powershell
npm test -- src/domain/apnea/tableGenerator.o2.test.ts src/domain/apnea/qualityEngine.test.ts src/domain/apnea/microcycleProfiles.test.ts src/ui/screens/RunnerScreen.test.tsx src/ui/screens/SummaryScreen.test.tsx
```

Expected: PASS. Together these suites prove the 80% O₂ cap, early-ease trigger
and one-adjustment limit, O₂-heavy spacing, and delayed persistence invariant.

- [x] **Step 5: Review the final uncommitted change set**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: only quality-loop/schema files are changed; no commit or push is created.
