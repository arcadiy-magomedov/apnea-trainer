# Apnea Trainer — Milestone 1: Foundation & Domain Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Vite + React + TS + Tailwind + Vitest project and implement the entire pure-TypeScript apnea domain (models, ports, table generation, adaptation, course engine) test-first.

**Architecture:** Feature-sliced clean architecture. This milestone produces `src/domain/**` — pure TypeScript with zero React/DOM/storage dependencies, fully unit-tested — plus the project scaffold and design tokens. All later milestones depend on the types and ports defined here.

**Tech Stack:** Vite, React 18, TypeScript (strict), Tailwind CSS, Vitest, Testing Library, fake-indexeddb (installed now, used in M2).

---

## Shared Contract (authoritative — all milestones use these exact names)

These types live in `src/domain/models/types.ts` and interfaces in `src/domain/ports/*.ts`. Do **not** rename them in later milestones.

```typescript
// SessionType: what kind of training a session is.
export type SessionType = 'CO2' | 'O2' | 'MAX';
// DayType: what a course microcycle slot prescribes.
export type DayType = 'CO2' | 'O2' | 'REST' | 'MAX';
// Rpe: subjective rate of perceived exertion collected after a session.
export type Rpe = 'easy' | 'normal' | 'hard' | 'failed';
// ProgressionAction: what the adaptation engine decides between sessions.
export type ProgressionAction = 'progress' | 'repeat' | 'deload';

export interface Baseline {
  id: string;
  maxHoldSec: number;
  firstContractionSec: number | null;
  measuredAt: number; // epoch ms
}

export interface RoundPlan {
  index: number;
  targetHoldSec: number;
  restBeforeSec: number; // recovery before this round's hold (round 0 = 0)
}

export interface RoundResult {
  index: number;
  targetHoldSec: number;
  achievedHoldSec: number;
  restBeforeSec: number;
  contractions: number;
  tappedOut: boolean;
}

export interface SessionPlan {
  type: SessionType;
  rounds: RoundPlan[];
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
}

export interface MicrocycleTemplate {
  days: DayType[]; // length 7
}

export interface CourseState {
  position: number;             // index into template.days (advances by completion for training, by calendar for REST)
  difficultyLevel: number;      // >= 0
  template: MicrocycleTemplate;
  lastTrainedAt: number | null; // epoch ms of last completed training session
  lastAdvanceAt: number | null; // epoch ms (start of day) of last position advance
  lastMaxTestAt: number | null; // epoch ms of last MAX recalibration
}

export interface Settings {
  units: 'metric';
  voiceCues: boolean;
  beepCues: boolean;
  vibrationCues: boolean;
  theme: 'ocean';
  reminderTimes: string[]; // 'HH:MM' 24h
}

export interface AppState {
  version: 1;
  settings: Settings;
  baselines: Baseline[];
  courseState: CourseState;
  sessions: Session[];
}

// Decisions returned by the domain (pure).
export interface TodayDecision {
  dayType: DayType;
  blocked: boolean;
  reason: string | null;
  deload: boolean;
  suggestRetest: boolean;
}

export interface ProgressionDecision {
  action: ProgressionAction;
  suggestRetest: boolean;
}
```

Ports (`src/domain/ports/`):

```typescript
// clock.ts
export interface Clock { now(): number; }

// stateRepository.ts
import type { AppState } from '../models/types';
export interface StateRepository {
  getState(): Promise<AppState>;
  setState(state: AppState): Promise<void>;
}

// notificationService.ts
export interface NotificationService {
  isSupported(): boolean;
  requestPermission(): Promise<boolean>;
  scheduleDailyReminders(times: string[]): Promise<void>;
  cancelAll(): Promise<void>;
}

// icsExporter.ts
import type { MicrocycleTemplate } from '../models/types';
export interface IcsExporter {
  build(times: string[], template: MicrocycleTemplate, startDate: number): string;
}

// wakeLockService.ts
export interface WakeLockService {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

// cueService.ts
export interface CueService {
  speak(text: string): void;
  beep(): void;
  vibrate(pattern: number[]): void;
}
```

---

### Task 1: Scaffold the project

**Files:**
- Create: project root files via Vite scaffolder, then trim.

- [ ] **Step 1: Create the Vite React-TS project in-place**

Run:
```bash
cd C:/Users/amagomedov/Documents/projects/apnea-trainer
npm create vite@latest . -- --template react-ts
```
If prompted about the non-empty directory (the `docs/` and `.superpowers/` folders), choose "Ignore files and continue".

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install
npm install zustand idb
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom fake-indexeddb @vitest/coverage-v8
npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer
```

- [ ] **Step 3: Add test scripts to `package.json`**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest",
"coverage": "vitest run --coverage"
```

- [ ] **Step 4: Create `vitest.config.ts`**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 5: Create the test setup file**

Create `src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Create the domain folder structure**

Run:
```bash
mkdir src/domain src/domain/models src/domain/ports src/domain/apnea
```

- [ ] **Step 7: Add a `.gitignore` entry for brainstorm artifacts**

Append to `.gitignore`:
```
.superpowers/
coverage/
```

- [ ] **Step 8: Verify the project builds and tests run**

Run: `npm run build`
Expected: build succeeds.
Run: `npm run test`
Expected: "No test files found" (exit 0) or passes — no error.

- [ ] **Step 9: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Vite React TS project with Vitest and Tailwind"
```

---

### Task 2: Design tokens and Tailwind theme

**Files:**
- Create: `src/ui/design-system/tokens.css`
- Modify: `src/index.css`
- Create: `postcss.config.js`, `tailwind.config.ts`
- Test: `src/ui/design-system/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/design-system/tokens.test.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('design tokens', () => {
  it('defines the deep-ocean palette variables', () => {
    const css = readFileSync('src/ui/design-system/tokens.css', 'utf-8');
    for (const token of [
      '--ocean-900', '--surface', '--cyan', '--teal',
      '--success', '--warn', '--danger', '--text',
    ]) {
      expect(css).toContain(token);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tokens`
Expected: FAIL (file not found).

- [ ] **Step 3: Create the tokens file**

Create `src/ui/design-system/tokens.css`:
```css
:root {
  --ocean-900: #05121c;
  --ocean-700: #0d2839;
  --surface: #102f43;
  --surface-2: #143a52;
  --border: #1f4a63;
  --text: #e8f6fb;
  --text-dim: #8fb6c8;
  --text-mute: #5d8298;
  --cyan: #22d3ee;
  --cyan-deep: #0891b2;
  --teal: #2dd4bf;
  --success: #34d399;
  --warn: #fbbf24;
  --danger: #f87171;
}
```

- [ ] **Step 4: Configure Tailwind and PostCSS**

Create `postcss.config.js`:
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

Create `tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ocean: { 900: 'var(--ocean-900)', 700: 'var(--ocean-700)' },
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        cyan: { DEFAULT: 'var(--cyan)', deep: 'var(--cyan-deep)' },
        teal: 'var(--teal)',
        success: 'var(--success)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Wire tokens into the global stylesheet**

Replace the contents of `src/index.css` with:
```css
@import './ui/design-system/tokens.css';
@import 'tailwindcss';

html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--ocean-900);
  color: var(--text);
  font-family: Inter, system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- tokens`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): add deep-ocean design tokens and Tailwind theme"
```

---

### Task 3: Domain types and empty-state factory

**Files:**
- Create: `src/domain/models/types.ts`
- Create: `src/domain/models/appState.ts`
- Test: `src/domain/models/appState.test.ts`

- [ ] **Step 1: Create the types file**

Create `src/domain/models/types.ts` with the full contents of the **Shared Contract** types block above (all `type` and `interface` declarations from `SessionType` through `ProgressionDecision`).

- [ ] **Step 2: Write the failing test**

Create `src/domain/models/appState.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { defaultMicrocycle, emptyAppState } from './appState';

describe('emptyAppState', () => {
  it('has version 1 and sane defaults', () => {
    const s = emptyAppState();
    expect(s.version).toBe(1);
    expect(s.baselines).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.settings.theme).toBe('ocean');
    expect(s.courseState.position).toBe(0);
    expect(s.courseState.difficultyLevel).toBe(0);
    expect(s.courseState.template.days).toHaveLength(7);
  });

  it('default microcycle biases toward CO2 and includes rest days', () => {
    expect(defaultMicrocycle().days).toEqual([
      'CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST',
    ]);
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npm run test -- appState`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the factory**

Create `src/domain/models/appState.ts`:
```typescript
import type { AppState, MicrocycleTemplate } from './types';

export function defaultMicrocycle(): MicrocycleTemplate {
  return { days: ['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST'] };
}

export function emptyAppState(): AppState {
  return {
    version: 1,
    settings: {
      units: 'metric',
      voiceCues: true,
      beepCues: true,
      vibrationCues: true,
      theme: 'ocean',
      reminderTimes: [],
    },
    baselines: [],
    courseState: {
      position: 0,
      difficultyLevel: 0,
      template: defaultMicrocycle(),
      lastTrainedAt: null,
      lastAdvanceAt: null,
      lastMaxTestAt: null,
    },
    sessions: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- appState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): add core types and empty app-state factory"
```

---

### Task 4: Ports and clock implementations

**Files:**
- Create: `src/domain/ports/clock.ts`, `stateRepository.ts`, `notificationService.ts`, `icsExporter.ts`, `wakeLockService.ts`, `cueService.ts`
- Create: `src/domain/ports/index.ts`
- Create: `src/infrastructure/device/systemClock.ts`
- Create: `src/test/fakeClock.ts`
- Test: `src/test/fakeClock.test.ts`

- [ ] **Step 1: Create the port interface files**

Create each file in `src/domain/ports/` with the corresponding interface from the **Shared Contract** ports block (`clock.ts`, `stateRepository.ts`, `notificationService.ts`, `icsExporter.ts`, `wakeLockService.ts`, `cueService.ts`).

Create `src/domain/ports/index.ts`:
```typescript
export type { Clock } from './clock';
export type { StateRepository } from './stateRepository';
export type { NotificationService } from './notificationService';
export type { IcsExporter } from './icsExporter';
export type { WakeLockService } from './wakeLockService';
export type { CueService } from './cueService';
```

- [ ] **Step 2: Write the failing test for FakeClock**

Create `src/test/fakeClock.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { FakeClock } from './fakeClock';

describe('FakeClock', () => {
  it('returns the set time and can advance', () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.set(42);
    expect(clock.now()).toBe(42);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- fakeClock`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement FakeClock and SystemClock**

Create `src/test/fakeClock.ts`:
```typescript
import type { Clock } from '../domain/ports/clock';

export class FakeClock implements Clock {
  constructor(private t: number) {}
  now(): number { return this.t; }
  advance(ms: number): void { this.t += ms; }
  set(ms: number): void { this.t = ms; }
}
```

Run: `mkdir src/infrastructure src/infrastructure/device`
Create `src/infrastructure/device/systemClock.ts`:
```typescript
import type { Clock } from '../../domain/ports/clock';

export const systemClock: Clock = { now: () => Date.now() };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- fakeClock`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(domain): add ports, SystemClock, and test FakeClock"
```

---

### Task 5: Apnea defaults and time helpers

**Files:**
- Create: `src/domain/apnea/config.ts`
- Create: `src/domain/apnea/time.ts`
- Test: `src/domain/apnea/time.test.ts`

- [ ] **Step 1: Create the config file**

Create `src/domain/apnea/config.ts`:
```typescript
export const APNEA_DEFAULTS = {
  co2: { rounds: 8, holdPct: 0.55, restStartSec: 120, restStepSec: 15, restFloorSec: 15 },
  o2: { rounds: 8, restSec: 120, holdStartPct: 0.40, holdEndPct: 0.80 },
  breatheUpSec: 120,
  difficulty: { co2RestReducePerLevelSec: 5, o2StartPctPerLevel: 0.02 },
  detraining: { deloadDays: 7, retestDays: 14 },
  recalibrationDays: 14,
  o2SafetyCapPct: 0.80,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Write the failing test for time helpers**

Create `src/domain/apnea/time.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { startOfDay, calendarDaysBetween, isSameCalendarDay } from './time';

const D = (iso: string) => new Date(iso).getTime();

describe('time helpers', () => {
  it('startOfDay truncates to local midnight', () => {
    const t = D('2026-07-09T15:30:00');
    expect(startOfDay(t)).toBe(D('2026-07-09T00:00:00'));
  });

  it('calendarDaysBetween counts whole calendar days', () => {
    expect(calendarDaysBetween(D('2026-07-09T23:00:00'), D('2026-07-10T01:00:00'))).toBe(1);
    expect(calendarDaysBetween(D('2026-07-09T01:00:00'), D('2026-07-09T23:00:00'))).toBe(0);
    expect(calendarDaysBetween(D('2026-07-01T00:00:00'), D('2026-07-16T00:00:00'))).toBe(15);
  });

  it('isSameCalendarDay compares by local day', () => {
    expect(isSameCalendarDay(D('2026-07-09T00:01:00'), D('2026-07-09T23:59:00'))).toBe(true);
    expect(isSameCalendarDay(D('2026-07-09T23:59:00'), D('2026-07-10T00:01:00'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- apnea/time`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the time helpers**

Create `src/domain/apnea/time.ts`:
```typescript
import { DAY_MS } from './config';

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function calendarDaysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function isSameCalendarDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- apnea/time`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(domain): add apnea defaults and calendar time helpers"
```

---

### Task 6: BaselineCalc

**Files:**
- Create: `src/domain/apnea/baselineCalc.ts`
- Test: `src/domain/apnea/baselineCalc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/baselineCalc.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeBaseline } from './baselineCalc';

describe('computeBaseline', () => {
  it('takes the best (max) of the attempts', () => {
    const b = computeBaseline([180, 200, 195], 90, 'b1', 1000);
    expect(b.maxHoldSec).toBe(200);
    expect(b.firstContractionSec).toBe(90);
    expect(b.id).toBe('b1');
    expect(b.measuredAt).toBe(1000);
  });

  it('accepts a null first-contraction time', () => {
    const b = computeBaseline([120], null, 'b2', 2000);
    expect(b.maxHoldSec).toBe(120);
    expect(b.firstContractionSec).toBeNull();
  });

  it('throws when there are no attempts', () => {
    expect(() => computeBaseline([], null, 'b3', 3000)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- baselineCalc`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement BaselineCalc**

Create `src/domain/apnea/baselineCalc.ts`:
```typescript
import type { Baseline } from '../models/types';

export function computeBaseline(
  attemptsSec: number[],
  firstContractionSec: number | null,
  id: string,
  measuredAt: number,
): Baseline {
  if (attemptsSec.length === 0) {
    throw new Error('computeBaseline requires at least one attempt');
  }
  return {
    id,
    maxHoldSec: Math.max(...attemptsSec),
    firstContractionSec,
    measuredAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- baselineCalc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): add BaselineCalc (best-of attempts)"
```

---

### Task 7: TableGenerator — CO2 table

**Files:**
- Create: `src/domain/apnea/tableGenerator.ts`
- Test: `src/domain/apnea/tableGenerator.co2.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/tableGenerator.co2.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateCo2Table } from './tableGenerator';

describe('generateCo2Table', () => {
  it('holds constant at 55% of max with decreasing rests', () => {
    const plan = generateCo2Table(200, 0);
    expect(plan.type).toBe('CO2');
    expect(plan.rounds).toHaveLength(8);
    expect(plan.rounds.every(r => r.targetHoldSec === 110)).toBe(true);
    expect(plan.rounds.map(r => r.restBeforeSec)).toEqual([0, 120, 105, 90, 75, 60, 45, 30]);
  });

  it('never lets rest fall below the floor', () => {
    const plan = generateCo2Table(60, 0);
    expect(Math.min(...plan.rounds.slice(1).map(r => r.restBeforeSec))).toBeGreaterThanOrEqual(15);
  });

  it('difficulty reduces every rest by 5s per level (down to floor)', () => {
    const plan = generateCo2Table(200, 2);
    expect(plan.rounds.map(r => r.restBeforeSec)).toEqual([0, 110, 95, 80, 65, 50, 35, 20]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tableGenerator.co2`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the CO2 generator**

Create `src/domain/apnea/tableGenerator.ts`:
```typescript
import type { SessionPlan, RoundPlan } from '../models/types';
import { APNEA_DEFAULTS } from './config';

export function generateCo2Table(maxHoldSec: number, difficultyLevel: number): SessionPlan {
  const c = APNEA_DEFAULTS.co2;
  const hold = Math.round(maxHoldSec * c.holdPct);
  const reduce = difficultyLevel * APNEA_DEFAULTS.difficulty.co2RestReducePerLevelSec;
  const rounds: RoundPlan[] = [];
  for (let i = 0; i < c.rounds; i++) {
    const restBeforeSec = i === 0
      ? 0
      : Math.max(c.restFloorSec, c.restStartSec - (i - 1) * c.restStepSec - reduce);
    rounds.push({ index: i, targetHoldSec: hold, restBeforeSec });
  }
  return { type: 'CO2', rounds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tableGenerator.co2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): add CO2 table generator"
```

---

### Task 8: TableGenerator — O2 table

**Files:**
- Modify: `src/domain/apnea/tableGenerator.ts`
- Test: `src/domain/apnea/tableGenerator.o2.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/tableGenerator.o2.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateO2Table } from './tableGenerator';

describe('generateO2Table', () => {
  it('keeps rest constant and ramps holds from 40% to 80% of max', () => {
    const plan = generateO2Table(200, 0);
    expect(plan.type).toBe('O2');
    expect(plan.rounds).toHaveLength(8);
    expect(plan.rounds[0].restBeforeSec).toBe(0);
    expect(plan.rounds.slice(1).every(r => r.restBeforeSec === 120)).toBe(true);
    expect(plan.rounds[0].targetHoldSec).toBe(80);   // 40% of 200
    expect(plan.rounds[7].targetHoldSec).toBe(160);  // 80% of 200
  });

  it('never exceeds the 80% safety cap even at high difficulty', () => {
    const plan = generateO2Table(200, 10);
    expect(Math.max(...plan.rounds.map(r => r.targetHoldSec))).toBeLessThanOrEqual(160);
  });

  it('difficulty raises the starting hold (compresses the ramp upward)', () => {
    const easy = generateO2Table(200, 0);
    const hard = generateO2Table(200, 3);
    expect(hard.rounds[0].targetHoldSec).toBeGreaterThan(easy.rounds[0].targetHoldSec);
    expect(hard.rounds[7].targetHoldSec).toBe(160);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tableGenerator.o2`
Expected: FAIL (generateO2Table not exported).

- [ ] **Step 3: Add the O2 generator**

Append to `src/domain/apnea/tableGenerator.ts`:
```typescript
export function generateO2Table(maxHoldSec: number, difficultyLevel: number): SessionPlan {
  const o = APNEA_DEFAULTS.o2;
  const endPct = APNEA_DEFAULTS.o2SafetyCapPct;
  const startPct = Math.min(
    endPct - 0.05,
    o.holdStartPct + difficultyLevel * APNEA_DEFAULTS.difficulty.o2StartPctPerLevel,
  );
  const rounds: RoundPlan[] = [];
  for (let i = 0; i < o.rounds; i++) {
    const pct = startPct + (endPct - startPct) * (i / (o.rounds - 1));
    rounds.push({
      index: i,
      targetHoldSec: Math.min(
        Math.round(maxHoldSec * endPct),
        Math.round(maxHoldSec * pct),
      ),
      restBeforeSec: i === 0 ? 0 : o.restSec,
    });
  }
  return { type: 'O2', rounds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tableGenerator.o2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): add O2 table generator with 80% safety cap"
```

---

### Task 9: TableGenerator — MAX and per-day dispatch

**Files:**
- Modify: `src/domain/apnea/tableGenerator.ts`
- Test: `src/domain/apnea/tableGenerator.dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/tableGenerator.dispatch.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateMaxTable, generatePlanForDay } from './tableGenerator';

describe('generateMaxTable', () => {
  it('is a single open-ended round referencing max', () => {
    const plan = generateMaxTable(200);
    expect(plan.type).toBe('MAX');
    expect(plan.rounds).toHaveLength(1);
    expect(plan.rounds[0].targetHoldSec).toBe(200);
    expect(plan.rounds[0].restBeforeSec).toBe(0);
  });
});

describe('generatePlanForDay', () => {
  it('maps day types to plans and returns null for REST', () => {
    expect(generatePlanForDay('CO2', 200, 0)?.type).toBe('CO2');
    expect(generatePlanForDay('O2', 200, 0)?.type).toBe('O2');
    expect(generatePlanForDay('MAX', 200, 0)?.type).toBe('MAX');
    expect(generatePlanForDay('REST', 200, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tableGenerator.dispatch`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Add MAX and dispatch functions**

Append to `src/domain/apnea/tableGenerator.ts`:
```typescript
import type { DayType } from '../models/types';

export function generateMaxTable(maxHoldSec: number): SessionPlan {
  return { type: 'MAX', rounds: [{ index: 0, targetHoldSec: maxHoldSec, restBeforeSec: 0 }] };
}

export function generatePlanForDay(
  day: DayType,
  maxHoldSec: number,
  difficultyLevel: number,
): SessionPlan | null {
  switch (day) {
    case 'CO2': return generateCo2Table(maxHoldSec, difficultyLevel);
    case 'O2': return generateO2Table(maxHoldSec, difficultyLevel);
    case 'MAX': return generateMaxTable(maxHoldSec);
    case 'REST': return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tableGenerator.dispatch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): add MAX table and per-day plan dispatch"
```

---

### Task 10: AdaptationEngine — intra-session safety net

**Files:**
- Create: `src/domain/apnea/adaptationEngine.ts`
- Test: `src/domain/apnea/adaptationEngine.tapout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/adaptationEngine.tapout.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { applyTapOut } from './adaptationEngine';
import { generateCo2Table, generateO2Table } from './tableGenerator';

describe('applyTapOut', () => {
  it('CO2: lengthens rests for rounds after the failed one', () => {
    const plan = generateCo2Table(200, 0); // rests [0,120,105,90,75,60,45,30]
    const eased = applyTapOut(plan, 3);     // failed on round index 3
    // rounds 0..3 unchanged, rounds 4..7 get +15s rest (one step back)
    expect(eased.rounds.slice(0, 4).map(r => r.restBeforeSec)).toEqual([0, 120, 105, 90]);
    expect(eased.rounds.slice(4).map(r => r.restBeforeSec)).toEqual([90, 75, 60, 45]);
  });

  it('O2: caps later holds at the failed round target', () => {
    const plan = generateO2Table(200, 0); // holds ramp 80..160
    const eased = applyTapOut(plan, 4);
    const capped = plan.rounds[4].targetHoldSec;
    expect(eased.rounds.slice(5).every(r => r.targetHoldSec <= capped)).toBe(true);
  });

  it('returns a new plan without mutating the input', () => {
    const plan = generateCo2Table(200, 0);
    const before = plan.rounds[5].restBeforeSec;
    applyTapOut(plan, 2);
    expect(plan.rounds[5].restBeforeSec).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- adaptationEngine.tapout`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement applyTapOut**

Create `src/domain/apnea/adaptationEngine.ts`:
```typescript
import type { SessionPlan, RoundPlan } from '../models/types';
import { APNEA_DEFAULTS } from './config';

export function applyTapOut(plan: SessionPlan, failedRoundIndex: number): SessionPlan {
  const step = APNEA_DEFAULTS.co2.restStepSec;
  const cap = plan.rounds[failedRoundIndex]?.targetHoldSec ?? Infinity;
  const rounds: RoundPlan[] = plan.rounds.map((r) => {
    if (r.index <= failedRoundIndex) return { ...r };
    if (plan.type === 'CO2') {
      return {
        ...r,
        restBeforeSec: Math.min(APNEA_DEFAULTS.co2.restStartSec, r.restBeforeSec + step),
      };
    }
    if (plan.type === 'O2') {
      return { ...r, targetHoldSec: Math.min(r.targetHoldSec, cap) };
    }
    return { ...r };
  });
  return { type: plan.type, rounds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- adaptationEngine.tapout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): add intra-session tap-out safety net"
```

---

### Task 11: AdaptationEngine — inter-session progression

**Files:**
- Modify: `src/domain/apnea/adaptationEngine.ts`
- Test: `src/domain/apnea/adaptationEngine.progression.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/adaptationEngine.progression.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { evaluateProgression } from './adaptationEngine';
import type { Session, Rpe } from '../models/types';

function session(over: Partial<Session>): Session {
  return {
    id: 'x', type: 'CO2', rounds: [], startedAt: 0, finishedAt: 0,
    completedRounds: 8, tapOuts: 0, rpe: 'normal', difficultyLevel: 0, ...over,
  };
}
const clean = (rpe: Rpe = 'normal') => session({ tapOuts: 0, completedRounds: 8, rpe });
const failed = () => session({ tapOuts: 1, completedRounds: 6, rpe: 'failed' });

describe('evaluateProgression', () => {
  it('progresses after two clean sessions', () => {
    const d = evaluateProgression([clean(), clean('easy')]);
    expect(d.action).toBe('progress');
    expect(d.suggestRetest).toBe(false);
  });

  it('repeats when the last session had a tap-out', () => {
    expect(evaluateProgression([clean(), failed()]).action).toBe('repeat');
  });

  it('deloads and suggests retest after three failed sessions', () => {
    const d = evaluateProgression([failed(), failed(), failed()]);
    expect(d.action).toBe('deload');
    expect(d.suggestRetest).toBe(true);
  });

  it('holds (repeat) when there is not enough history', () => {
    expect(evaluateProgression([clean()]).action).toBe('repeat');
    expect(evaluateProgression([]).action).toBe('repeat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- adaptationEngine.progression`
Expected: FAIL (evaluateProgression not exported).

- [ ] **Step 3: Implement evaluateProgression**

Append to `src/domain/apnea/adaptationEngine.ts`:
```typescript
import type { Session, ProgressionDecision } from '../models/types';

function isClean(s: Session): boolean {
  return s.tapOuts === 0
    && s.completedRounds === s.rounds.length
    && (s.rpe === 'easy' || s.rpe === 'normal');
}
function isFailed(s: Session): boolean {
  return s.tapOuts > 0 || s.rpe === 'failed';
}

export function evaluateProgression(orderedSessions: Session[]): ProgressionDecision {
  const n = orderedSessions.length;
  const last3 = orderedSessions.slice(Math.max(0, n - 3));
  if (last3.length === 3 && last3.every(isFailed)) {
    return { action: 'deload', suggestRetest: true };
  }
  const last = orderedSessions[n - 1];
  if (last && isFailed(last)) {
    return { action: 'repeat', suggestRetest: false };
  }
  const last2 = orderedSessions.slice(Math.max(0, n - 2));
  if (last2.length === 2 && last2.every(isClean)) {
    return { action: 'progress', suggestRetest: false };
  }
  return { action: 'repeat', suggestRetest: false };
}
```

Note: `isClean` compares `completedRounds` to `s.rounds.length`. In tests where `rounds` is empty, pass sessions whose `completedRounds` matches `rounds.length`; the `clean()` helper uses 8 completed with empty rounds, so update the helper OR the domain to compare against a stored total. To keep the domain honest, tests must build `rounds` of the right length. Adjust the `clean`/`failed` helpers to include `rounds: Array.from({length: 8})` if needed so `completedRounds === rounds.length` holds.

- [ ] **Step 4: Fix the test helper to satisfy the round-count invariant**

Edit `src/domain/apnea/adaptationEngine.progression.test.ts` `session()` helper to include real rounds:
```typescript
rounds: Array.from({ length: 8 }, (_, i) => ({
  index: i, targetHoldSec: 60, achievedHoldSec: 60, restBeforeSec: 0,
  contractions: 0, tappedOut: false,
})),
```
(place this before the spread `...over`), and in `failed()` pass `completedRounds: 6`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- adaptationEngine.progression`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(domain): add inter-session progression evaluation"
```

---

### Task 12: CourseEngine — rest sync and today resolution

**Files:**
- Create: `src/domain/apnea/courseEngine.ts`
- Test: `src/domain/apnea/courseEngine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/apnea/courseEngine.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { syncRestDays, resolveToday, completeSession, needsRecalibration } from './courseEngine';
import { emptyAppState } from '../models/appState';
import type { CourseState } from '../models/types';

const D = (iso: string) => new Date(iso).getTime();
function course(over: Partial<CourseState> = {}): CourseState {
  return { ...emptyAppState().courseState, ...over };
}

describe('courseEngine', () => {
  it('resolveToday returns the training type at the current position', () => {
    const c = course({ position: 0 }); // template day 0 = CO2
    const d = resolveToday(c, D('2026-07-09T10:00:00'));
    expect(d.dayType).toBe('CO2');
    expect(d.blocked).toBe(false);
  });

  it('blocks when already trained today', () => {
    const now = D('2026-07-09T18:00:00');
    const c = course({ position: 0, lastTrainedAt: D('2026-07-09T07:00:00') });
    const d = resolveToday(c, now);
    expect(d.blocked).toBe(true);
    expect(d.reason).toMatch(/already trained/i);
  });

  it('flags a rest slot as blocked', () => {
    const c = course({ position: 1 }); // template day 1 = REST
    const d = resolveToday(c, D('2026-07-09T10:00:00'));
    expect(d.dayType).toBe('REST');
    expect(d.blocked).toBe(true);
  });

  it('syncRestDays advances past REST slots as calendar days pass', () => {
    const c = course({ position: 1, lastAdvanceAt: D('2026-07-08T00:00:00') }); // REST slot
    const synced = syncRestDays(c, D('2026-07-09T10:00:00'));
    expect(synced.position).toBe(2); // consumed one rest day -> O2 slot
  });

  it('flags deload after >7 days and retest after >14 days of inactivity', () => {
    const base = course({ position: 0, lastTrainedAt: D('2026-06-20T10:00:00') });
    const d = resolveToday(base, D('2026-07-09T10:00:00'));
    expect(d.deload).toBe(true);
    expect(d.suggestRetest).toBe(true);
  });

  it('completeSession advances position and stamps training time', () => {
    const now = D('2026-07-09T10:00:00');
    const c = completeSession(course({ position: 0 }), now);
    expect(c.position).toBe(1);
    expect(c.lastTrainedAt).toBe(now);
  });

  it('needsRecalibration is true after the recalibration window', () => {
    expect(needsRecalibration(course({ lastMaxTestAt: D('2026-06-20T00:00:00') }), D('2026-07-09T00:00:00'))).toBe(true);
    expect(needsRecalibration(course({ lastMaxTestAt: D('2026-07-05T00:00:00') }), D('2026-07-09T00:00:00'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- courseEngine`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement CourseEngine**

Create `src/domain/apnea/courseEngine.ts`:
```typescript
import type { CourseState, DayType, TodayDecision } from '../models/types';
import { APNEA_DEFAULTS, DAY_MS } from './config';
import { startOfDay, isSameCalendarDay } from './time';

function slotAt(c: CourseState, position: number): DayType {
  return c.template.days[position % c.template.days.length];
}

export function syncRestDays(c: CourseState, now: number): CourseState {
  let position = c.position;
  let lastAdvanceAt = c.lastAdvanceAt ?? startOfDay(now);
  // Consume REST slots for each calendar day that has elapsed.
  while (
    slotAt(c, position) === 'REST' &&
    startOfDay(now) > startOfDay(lastAdvanceAt)
  ) {
    position += 1;
    lastAdvanceAt = startOfDay(lastAdvanceAt) + DAY_MS;
  }
  return { ...c, position, lastAdvanceAt };
}

export function needsRecalibration(c: CourseState, now: number): boolean {
  if (c.lastMaxTestAt === null) return false;
  return now - c.lastMaxTestAt >= APNEA_DEFAULTS.recalibrationDays * DAY_MS;
}

export function resolveToday(c: CourseState, now: number): TodayDecision {
  const synced = syncRestDays(c, now);
  let dayType = slotAt(synced, synced.position);
  if (dayType !== 'REST' && needsRecalibration(synced, now)) {
    dayType = 'MAX';
  }
  const gapDays = synced.lastTrainedAt === null
    ? 0
    : Math.round((startOfDay(now) - startOfDay(synced.lastTrainedAt)) / DAY_MS);
  const deload = gapDays > APNEA_DEFAULTS.detraining.deloadDays;
  const suggestRetest = gapDays > APNEA_DEFAULTS.detraining.retestDays;

  let blocked = false;
  let reason: string | null = null;
  if (dayType === 'REST') {
    blocked = true;
    reason = 'Rest day — recovery is part of the program';
  } else if (synced.lastTrainedAt !== null && isSameCalendarDay(synced.lastTrainedAt, now)) {
    blocked = true;
    reason = 'Already trained today';
  }
  return { dayType, blocked, reason, deload, suggestRetest };
}

export function completeSession(c: CourseState, now: number): CourseState {
  return {
    ...c,
    position: c.position + 1,
    lastTrainedAt: now,
    lastAdvanceAt: startOfDay(now),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- courseEngine`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm run test`
Expected: all domain tests PASS.
```bash
git add -A
git commit -m "feat(domain): add CourseEngine (rest sync, today resolution, recalibration)"
```

---

### Task 13: Domain barrel export

**Files:**
- Create: `src/domain/index.ts`
- Test: `src/domain/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import * as domain from './index';

describe('domain barrel', () => {
  it('re-exports the public API', () => {
    expect(typeof domain.generateCo2Table).toBe('function');
    expect(typeof domain.generateO2Table).toBe('function');
    expect(typeof domain.generatePlanForDay).toBe('function');
    expect(typeof domain.applyTapOut).toBe('function');
    expect(typeof domain.evaluateProgression).toBe('function');
    expect(typeof domain.resolveToday).toBe('function');
    expect(typeof domain.completeSession).toBe('function');
    expect(typeof domain.computeBaseline).toBe('function');
    expect(typeof domain.emptyAppState).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- domain/index`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the barrel**

Create `src/domain/index.ts`:
```typescript
export * from './models/types';
export * from './models/appState';
export * from './apnea/config';
export * from './apnea/time';
export * from './apnea/baselineCalc';
export * from './apnea/tableGenerator';
export * from './apnea/adaptationEngine';
export * from './apnea/courseEngine';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- domain/index`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `npm run test`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add -A
git commit -m "feat(domain): add public barrel export"
```

---

## Milestone 1 Done-Definition
- `npm run test` green; `npx tsc --noEmit` clean; `npm run build` succeeds.
- `src/domain/**` is pure TS (no imports from React/DOM/storage).
- All apnea logic (baseline, CO2/O2/MAX tables, tap-out, progression, course) is unit-tested.
