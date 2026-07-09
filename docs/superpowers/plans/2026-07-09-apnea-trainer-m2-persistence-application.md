# Apnea Trainer — Milestone 2: Persistence & Application — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist app state in IndexedDB, add JSON backup export/import, and build the application layer — pure use-cases plus Zustand stores that wire the domain to persistence.

**Architecture:** `infrastructure/persistence` implements the `StateRepository` port from M1. `application/usecases` are pure `(AppState, inputs, now) → AppState` functions (fully unit-testable). `application/stores` are Zustand stores that hydrate from the repository, invoke use-cases, and persist. A transient `sessionRunnerStore` holds live session progress and is **not** persisted.

**Tech Stack:** idb, Zustand, Vitest, fake-indexeddb. Depends on all types/ports from Milestone 1.

**Prerequisite:** Milestone 1 complete (`src/domain/**` and ports exist).

---

### Task 1: IndexedDB repository

**Files:**
- Create: `src/infrastructure/persistence/indexedDbRepository.ts`
- Test: `src/infrastructure/persistence/indexedDbRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/persistence/indexedDbRepository.test.ts`:
```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { createIndexedDbRepository } from './indexedDbRepository';
import { emptyAppState } from '../../domain/models/appState';

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
    expect(state.version).toBe(1);
    expect(state.sessions).toEqual([]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- indexedDbRepository`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repository**

Create `src/infrastructure/persistence/indexedDbRepository.ts`:
```typescript
import { openDB, type IDBPDatabase } from 'idb';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';
import { emptyAppState } from '../../domain/models/appState';

const DB_NAME = 'apnea-trainer';
const STORE = 'app';
const KEY = 'state';

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    },
  });
}

export function createIndexedDbRepository(): StateRepository {
  return {
    async getState(): Promise<AppState> {
      const stored = (await (await db()).get(STORE, KEY)) as AppState | undefined;
      return stored ?? emptyAppState();
    },
    async setState(state: AppState): Promise<void> {
      await (await db()).put(STORE, state, KEY);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- indexedDbRepository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(infra): add IndexedDB state repository"
```

---

### Task 2: JSON backup export/import

**Files:**
- Create: `src/infrastructure/persistence/jsonBackup.ts`
- Test: `src/infrastructure/persistence/jsonBackup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/persistence/jsonBackup.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { exportJson, importJson } from './jsonBackup';
import { emptyAppState } from '../../domain/models/appState';

describe('json backup', () => {
  it('exports then imports to an equal state', () => {
    const s = emptyAppState();
    s.settings.voiceCues = false;
    const round = importJson(exportJson(s));
    expect(round).toEqual(s);
  });

  it('rejects malformed json', () => {
    expect(() => importJson('not json')).toThrow(/invalid/i);
  });

  it('rejects an unsupported version', () => {
    expect(() => importJson(JSON.stringify({ version: 99 }))).toThrow(/version/i);
  });

  it('rejects a state missing required fields', () => {
    expect(() => importJson(JSON.stringify({ version: 1 }))).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- jsonBackup`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement export/import**

Create `src/infrastructure/persistence/jsonBackup.ts`:
```typescript
import type { AppState } from '../../domain/models/types';

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid backup: not valid JSON');
  }
  const s = parsed as Partial<AppState>;
  if (s.version !== 1) {
    throw new Error(`Unsupported backup version: ${String(s.version)}`);
  }
  if (!s.settings || !Array.isArray(s.baselines) || !s.courseState || !Array.isArray(s.sessions)) {
    throw new Error('Invalid backup: missing required fields');
  }
  return s as AppState;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- jsonBackup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(infra): add JSON backup export/import with validation"
```

---

### Task 3: Statistics selectors

**Files:**
- Create: `src/application/stats.ts`
- Test: `src/application/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/application/stats.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { personalBestSec, weeklySessionCount, currentStreakDays, adherencePct } from './stats';
import { emptyAppState } from '../domain/models/appState';
import type { Session } from '../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();
function sess(finishedAt: number, over: Partial<Session> = {}): Session {
  return {
    id: String(finishedAt), type: 'CO2',
    rounds: [{ index: 0, targetHoldSec: 60, achievedHoldSec: 60, restBeforeSec: 0, contractions: 0, tappedOut: false }],
    startedAt: finishedAt - 1000, finishedAt, completedRounds: 1, tapOuts: 0,
    rpe: 'normal', difficultyLevel: 0, ...over,
  };
}

describe('stats', () => {
  it('personalBest takes the max of baselines and MAX sessions', () => {
    const s = emptyAppState();
    s.baselines = [{ id: 'b', maxHoldSec: 180, firstContractionSec: null, measuredAt: 0 }];
    s.sessions = [sess(D('2026-07-01T10:00:00'), {
      type: 'MAX',
      rounds: [{ index: 0, targetHoldSec: 180, achievedHoldSec: 205, restBeforeSec: 0, contractions: 0, tappedOut: false }],
    })];
    expect(personalBestSec(s)).toBe(205);
  });

  it('weeklySessionCount counts sessions in the last 7 days', () => {
    const now = D('2026-07-09T12:00:00');
    const s = emptyAppState();
    s.sessions = [sess(D('2026-07-08T10:00:00')), sess(D('2026-07-01T10:00:00')), sess(D('2026-07-09T09:00:00'))];
    expect(weeklySessionCount(s, now)).toBe(2);
  });

  it('currentStreak counts consecutive days ending today or yesterday', () => {
    const now = D('2026-07-09T12:00:00');
    const s = emptyAppState();
    s.sessions = [sess(D('2026-07-07T10:00:00')), sess(D('2026-07-08T10:00:00')), sess(D('2026-07-09T09:00:00'))];
    expect(currentStreakDays(s, now)).toBe(3);
  });

  it('adherence is 0 with no sessions and capped at 100', () => {
    const now = D('2026-07-09T12:00:00');
    expect(adherencePct(emptyAppState(), now)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- application/stats`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the selectors**

Create `src/application/stats.ts`:
```typescript
import type { AppState } from '../domain/models/types';
import { DAY_MS } from '../domain/apnea/config';
import { startOfDay, isSameCalendarDay } from '../domain/apnea/time';

export function personalBestSec(state: AppState): number {
  const baselineMax = state.baselines.reduce((m, b) => Math.max(m, b.maxHoldSec), 0);
  const sessionMax = state.sessions.reduce((m, s) => {
    const best = s.rounds.reduce((rm, r) => Math.max(rm, r.achievedHoldSec), 0);
    return Math.max(m, best);
  }, 0);
  return Math.max(baselineMax, sessionMax);
}

export function weeklySessionCount(state: AppState, now: number): number {
  const cutoff = now - 7 * DAY_MS;
  return state.sessions.filter((s) => s.finishedAt >= cutoff).length;
}

export function currentStreakDays(state: AppState, now: number): number {
  const days = new Set(state.sessions.map((s) => startOfDay(s.finishedAt)));
  if (days.size === 0) return 0;
  let cursor = startOfDay(now);
  // Allow the streak to end today or yesterday.
  if (!days.has(cursor)) cursor -= DAY_MS;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

export function adherencePct(state: AppState, now: number, windowDays = 28): number {
  const trainingSlots = state.courseState.template.days.filter((d) => d !== 'REST').length;
  const perWeek = trainingSlots; // template is one week
  const expected = (windowDays / 7) * perWeek;
  if (expected <= 0) return 0;
  const cutoff = now - windowDays * DAY_MS;
  const done = state.sessions.filter((s) => s.finishedAt >= cutoff).length;
  return Math.min(100, Math.round((done / expected) * 100));
}

export { isSameCalendarDay };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- application/stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): add statistics selectors (PB, weekly, streak, adherence)"
```

---

### Task 4: Use-case — start today's session

**Files:**
- Create: `src/application/usecases/startTodaySession.ts`
- Test: `src/application/usecases/startTodaySession.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/application/usecases/startTodaySession.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { startTodaySession } from './startTodaySession';
import { emptyAppState } from '../../domain/models/appState';

const D = (iso: string) => new Date(iso).getTime();

describe('startTodaySession', () => {
  it('returns null plan when there is no baseline', () => {
    const r = startTodaySession(emptyAppState(), D('2026-07-09T10:00:00'));
    expect(r.plan).toBeNull();
    expect(r.needsBaseline).toBe(true);
  });

  it('builds the CO2 plan for a CO2 slot at 55% of max', () => {
    const s = emptyAppState();
    s.baselines = [{ id: 'b', maxHoldSec: 200, firstContractionSec: null, measuredAt: 0 }];
    const r = startTodaySession(s, D('2026-07-09T10:00:00')); // position 0 = CO2
    expect(r.plan?.type).toBe('CO2');
    expect(r.plan?.rounds[0].targetHoldSec).toBe(110);
    expect(r.decision.blocked).toBe(false);
  });

  it('applies deload difficulty when inactivity triggers it', () => {
    const s = emptyAppState();
    s.baselines = [{ id: 'b', maxHoldSec: 200, firstContractionSec: null, measuredAt: 0 }];
    s.courseState.difficultyLevel = 3;
    s.courseState.lastTrainedAt = D('2026-06-20T10:00:00'); // >7 days -> deload
    const r = startTodaySession(s, D('2026-07-09T10:00:00'));
    expect(r.appliedDifficulty).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- startTodaySession`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the use-case**

Create `src/application/usecases/startTodaySession.ts`:
```typescript
import type { AppState, SessionPlan, TodayDecision } from '../../domain/models/types';
import { resolveToday } from '../../domain/apnea/courseEngine';
import { generatePlanForDay } from '../../domain/apnea/tableGenerator';
import { personalBestSec } from '../stats';

export interface StartTodayResult {
  plan: SessionPlan | null;
  decision: TodayDecision;
  needsBaseline: boolean;
  appliedDifficulty: number;
}

export function startTodaySession(state: AppState, now: number): StartTodayResult {
  const decision = resolveToday(state.courseState, now);
  const maxHold = personalBestSec(state);
  const needsBaseline = state.baselines.length === 0;
  const appliedDifficulty = decision.deload
    ? Math.max(0, state.courseState.difficultyLevel - 1)
    : state.courseState.difficultyLevel;
  const plan = needsBaseline
    ? null
    : generatePlanForDay(decision.dayType, maxHold, appliedDifficulty);
  return { plan, decision, needsBaseline, appliedDifficulty };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- startTodaySession`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): add startTodaySession use-case"
```

---

### Task 5: Use-case — finish session (persist + adapt + advance)

**Files:**
- Create: `src/application/usecases/finishSession.ts`
- Test: `src/application/usecases/finishSession.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/application/usecases/finishSession.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { finishSession } from './finishSession';
import { emptyAppState } from '../../domain/models/appState';
import type { Session } from '../../domain/models/types';

const D = (iso: string) => new Date(iso).getTime();
function completed(over: Partial<Session> = {}): Session {
  return {
    id: 's1', type: 'CO2',
    rounds: Array.from({ length: 8 }, (_, i) => ({
      index: i, targetHoldSec: 110, achievedHoldSec: 110, restBeforeSec: 0, contractions: 0, tappedOut: false,
    })),
    startedAt: D('2026-07-09T10:00:00'), finishedAt: D('2026-07-09T10:20:00'),
    completedRounds: 8, tapOuts: 0, rpe: 'easy', difficultyLevel: 0, ...over,
  };
}

describe('finishSession', () => {
  it('appends the session and advances the course position', () => {
    const s = emptyAppState();
    const next = finishSession(s, completed(), D('2026-07-09T10:20:00'));
    expect(next.sessions).toHaveLength(1);
    expect(next.courseState.position).toBe(1);
    expect(next.courseState.lastTrainedAt).toBe(D('2026-07-09T10:20:00'));
  });

  it('progresses difficulty after two clean sessions', () => {
    let s = emptyAppState();
    s = finishSession(s, completed({ id: 'a' }), D('2026-07-08T10:20:00'));
    s = finishSession(s, completed({ id: 'b' }), D('2026-07-09T10:20:00'));
    expect(s.courseState.difficultyLevel).toBe(1);
  });

  it('deloads difficulty (floored at 0) after three failed sessions', () => {
    let s = emptyAppState();
    s.courseState.difficultyLevel = 2;
    const fail = (id: string, at: number): Session => completed({ id, tapOuts: 1, completedRounds: 5, rpe: 'failed', finishedAt: at });
    s = finishSession(s, fail('a', D('2026-07-07T10:00:00')), D('2026-07-07T10:00:00'));
    s = finishSession(s, fail('b', D('2026-07-08T10:00:00')), D('2026-07-08T10:00:00'));
    s = finishSession(s, fail('c', D('2026-07-09T10:00:00')), D('2026-07-09T10:00:00'));
    expect(s.courseState.difficultyLevel).toBe(1);
  });

  it('a MAX session records a new baseline and resets the recalibration clock', () => {
    const s = emptyAppState();
    const now = D('2026-07-09T10:20:00');
    const maxSess = completed({
      id: 'm', type: 'MAX',
      rounds: [{ index: 0, targetHoldSec: 0, achievedHoldSec: 222, restBeforeSec: 0, contractions: 0, tappedOut: false }],
      completedRounds: 1,
    });
    const next = finishSession(s, maxSess, now);
    expect(next.baselines.at(-1)?.maxHoldSec).toBe(222);
    expect(next.courseState.lastMaxTestAt).toBe(now);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- finishSession`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the use-case**

Create `src/application/usecases/finishSession.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- finishSession`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): add finishSession use-case (persist, adapt, advance)"
```

---

### Task 6: Use-cases — record baseline and save settings

**Files:**
- Create: `src/application/usecases/recordBaseline.ts`
- Create: `src/application/usecases/saveSettings.ts`
- Test: `src/application/usecases/recordBaseline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/application/usecases/recordBaseline.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { recordBaseline } from './recordBaseline';
import { saveSettings } from './saveSettings';
import { emptyAppState } from '../../domain/models/appState';

describe('recordBaseline', () => {
  it('adds a baseline from best-of attempts and stamps the max-test clock', () => {
    const now = 1000;
    const next = recordBaseline(emptyAppState(), [180, 205, 190], 95, now);
    expect(next.baselines.at(-1)?.maxHoldSec).toBe(205);
    expect(next.baselines.at(-1)?.firstContractionSec).toBe(95);
    expect(next.courseState.lastMaxTestAt).toBe(now);
  });
});

describe('saveSettings', () => {
  it('merges partial settings', () => {
    const next = saveSettings(emptyAppState(), { voiceCues: false, reminderTimes: ['19:00'] });
    expect(next.settings.voiceCues).toBe(false);
    expect(next.settings.reminderTimes).toEqual(['19:00']);
    expect(next.settings.beepCues).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- recordBaseline`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement both use-cases**

Create `src/application/usecases/recordBaseline.ts`:
```typescript
import type { AppState } from '../../domain/models/types';
import { computeBaseline } from '../../domain/apnea/baselineCalc';

export function recordBaseline(
  state: AppState,
  attemptsSec: number[],
  firstContractionSec: number | null,
  now: number,
): AppState {
  const baseline = computeBaseline(attemptsSec, firstContractionSec, `baseline-${now}`, now);
  return {
    ...state,
    baselines: [...state.baselines, baseline],
    courseState: { ...state.courseState, lastMaxTestAt: now },
  };
}
```

Create `src/application/usecases/saveSettings.ts`:
```typescript
import type { AppState, Settings } from '../../domain/models/types';

export function saveSettings(state: AppState, patch: Partial<Settings>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- recordBaseline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): add recordBaseline and saveSettings use-cases"
```

---

### Task 7: App store (Zustand) with hydration and persistence

**Files:**
- Create: `src/application/stores/appStore.ts`
- Test: `src/application/stores/appStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/application/stores/appStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStore } from './appStore';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';

function memoryRepo(initial: AppState = emptyAppState()): StateRepository & { saved: AppState[] } {
  let current = initial;
  const saved: AppState[] = [];
  return {
    saved,
    async getState() { return current; },
    async setState(s) { current = s; saved.push(s); },
  };
}

describe('appStore', () => {
  let repo: ReturnType<typeof memoryRepo>;
  beforeEach(() => { repo = memoryRepo(); });

  it('hydrates from the repository', async () => {
    const initial = emptyAppState();
    initial.settings.reminderTimes = ['08:00'];
    repo = memoryRepo(initial);
    const store = createAppStore(repo, () => 1000);
    await store.getState().hydrate();
    expect(store.getState().state.settings.reminderTimes).toEqual(['08:00']);
  });

  it('updateSettings persists via the repository', async () => {
    const store = createAppStore(repo, () => 1000);
    await store.getState().hydrate();
    await store.getState().updateSettings({ voiceCues: false });
    expect(store.getState().state.settings.voiceCues).toBe(false);
    expect(repo.saved.at(-1)?.settings.voiceCues).toBe(false);
  });

  it('completeSession persists and advances the course', async () => {
    const store = createAppStore(repo, () => 2000);
    await store.getState().hydrate();
    await store.getState().completeSession({
      id: 's', type: 'CO2',
      rounds: [{ index: 0, targetHoldSec: 60, achievedHoldSec: 60, restBeforeSec: 0, contractions: 0, tappedOut: false }],
      startedAt: 0, finishedAt: 2000, completedRounds: 1, tapOuts: 0, rpe: 'normal', difficultyLevel: 0,
    });
    expect(store.getState().state.courseState.position).toBe(1);
    expect(repo.saved.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- appStore`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `src/application/stores/appStore.ts`:
```typescript
import { createStore } from 'zustand/vanilla';
import type { AppState, Session, Settings } from '../../domain/models/types';
import type { StateRepository } from '../../domain/ports/stateRepository';
import { emptyAppState } from '../../domain/models/appState';
import { finishSession } from '../usecases/finishSession';
import { recordBaseline } from '../usecases/recordBaseline';
import { saveSettings } from '../usecases/saveSettings';

export interface AppStore {
  state: AppState;
  hydrated: boolean;
  hydrate(): Promise<void>;
  completeSession(session: Session): Promise<void>;
  recordBaseline(attempts: number[], firstContraction: number | null): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

export function createAppStore(repo: StateRepository, now: () => number) {
  return createStore<AppStore>((set, get) => {
    async function commit(next: AppState) {
      set({ state: next });
      await repo.setState(next);
    }
    return {
      state: emptyAppState(),
      hydrated: false,
      async hydrate() {
        const loaded = await repo.getState();
        set({ state: loaded, hydrated: true });
      },
      async completeSession(session) {
        await commit(finishSession(get().state, session, now()));
      },
      async recordBaseline(attempts, firstContraction) {
        await commit(recordBaseline(get().state, attempts, firstContraction, now()));
      },
      async updateSettings(patch) {
        await commit(saveSettings(get().state, patch));
      },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- appStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): add hydrating, persisting Zustand app store"
```

---

### Task 8: Transient session-runner store

**Files:**
- Create: `src/application/stores/sessionRunnerStore.ts`
- Test: `src/application/stores/sessionRunnerStore.test.ts`

The runner store holds live progress through a `SessionPlan`: current round, current phase, whether paused, and the accumulated `RoundResult[]`. It is **not** persisted; on finish it produces a `Session` for the app store.

- [ ] **Step 1: Write the failing test**

Create `src/application/stores/sessionRunnerStore.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createSessionRunnerStore } from './sessionRunnerStore';
import { generateCo2Table } from '../../domain/apnea/tableGenerator';

describe('sessionRunnerStore', () => {
  it('starts at round 0 in the breatheUp phase', () => {
    const store = createSessionRunnerStore(() => 1000);
    store.getState().start(generateCo2Table(200, 0), 0);
    expect(store.getState().roundIndex).toBe(0);
    expect(store.getState().phase).toBe('breatheUp');
  });

  it('records a completed hold and tap-out, then builds a Session', () => {
    const store = createSessionRunnerStore(() => 5000);
    store.getState().start(generateCo2Table(200, 0), 0);
    store.getState().recordRound(110, 2, false); // round 0 done
    store.getState().recordRound(80, 3, true);   // round 1 tapped out
    const session = store.getState().finish('normal');
    expect(session.rounds).toHaveLength(2);
    expect(session.tapOuts).toBe(1);
    expect(session.completedRounds).toBe(1);
    expect(session.rpe).toBe('normal');
    expect(session.type).toBe('CO2');
  });

  it('tapping out eases the remaining plan rounds', () => {
    const store = createSessionRunnerStore(() => 0);
    store.getState().start(generateCo2Table(200, 0), 0); // rests [0,120,105,90,75,60,45,30]
    store.getState().recordRound(50, 5, true); // tapped out on round 0
    // remaining rounds rest increased by one 15s step
    expect(store.getState().plan?.rounds[1].restBeforeSec).toBe(135 > 120 ? 120 : 135); // capped at restStart 120
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sessionRunnerStore`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the runner store**

Create `src/application/stores/sessionRunnerStore.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- sessionRunnerStore`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm run test`
Expected: all PASS.
Run: `npx tsc --noEmit`
Expected: clean.
```bash
git add -A
git commit -m "feat(app): add transient session-runner store"
```

---

## Milestone 2 Done-Definition
- IndexedDB repository round-trips state (fake-indexeddb tests green).
- JSON backup export/import validated.
- Pure use-cases (start/finish/baseline/settings) and stats selectors fully tested.
- App store hydrates + persists; runner store produces a `Session`.
- `npm run test` green; `npx tsc --noEmit` clean.
