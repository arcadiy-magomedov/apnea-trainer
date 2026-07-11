# Home Hero and Calendar UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home action-first with a permanent thumb-reachable training Hero, and replace Program with a monthly Calendar containing complete training history, today, and a provisional six-week plan.

**Architecture:** Add calendar-safe local date helpers, a pure Home view model, and a pure application-level calendar event builder. `AppShell` owns a non-scrolling bottom-action slot; Home supplies `HomeHeroDock`, while Calendar renders derived completed/planned events through focused month-grid and day-drawer components. No calendar library or new persistence is introduced.

**Tech Stack:** React 19, TypeScript 6, React Router 7, Zustand 5, Tailwind CSS 4, Vitest 4, Testing Library.

**Workflow constraint:** The worktree already contains an uncommitted REST-anchor hotfix in `src/domain/apnea/courseEngine.ts` and `src/domain/apnea/courseEngine.test.ts`. Preserve it. Do not commit or push any task without explicit user approval.

---

## File structure

### New files

- `src/application/usecases/homeDayModel.ts` — one source of truth for Home today/completed/next state.
- `src/application/usecases/homeDayModel.test.ts` — Home model calendar-state tests.
- `src/application/calendar/trainingCalendar.ts` — completed-history aggregation, MAX/baseline deduplication, and 42-day projection.
- `src/application/calendar/trainingCalendar.test.ts` — pure calendar builder tests.
- `src/ui/components/HomeHeroDock.tsx` — persistent action/status dock.
- `src/ui/components/HomeHeroDock.test.tsx` — Hero state tests.
- `src/ui/design-system/MonthCalendar.tsx` — accessible seven-column month grid.
- `src/ui/design-system/MonthCalendar.test.tsx` — month-grid interaction/marker tests.
- `src/ui/components/CalendarDayDrawer.tsx` — selected-day details.
- `src/ui/components/CalendarDayDrawer.test.tsx` — completed/planned/multiple-event detail tests.
- `src/ui/screens/CalendarScreen.tsx` — Calendar page composition.
- `src/ui/screens/CalendarScreen.test.tsx` — screen integration tests.
- `src/ui/app/AppShell.test.tsx` — bottom-action slot and safe-area structure tests.

### Modified files

- `src/domain/apnea/time.ts`
- `src/domain/apnea/time.test.ts`
- `src/ui/app/AppShell.tsx`
- `src/ui/app/routes.tsx`
- `src/ui/app/routes.test.tsx`
- `src/ui/app/services.tsx`
- `src/ui/design-system/TabBar.tsx`
- `src/ui/screens/HomeScreen.tsx`
- `src/ui/screens/HomeScreen.test.tsx`
- `src/infrastructure/device/productionServices.ts`
- `src/infrastructure/device/productionServices.test.ts`
- `src/domain/ports/index.ts`

### Deleted files

- `src/ui/screens/ProgramScreen.tsx`
- `src/ui/screens/ProgramScreen.test.tsx`
- `src/ui/icsShare.ts`
- `src/ui/icsShare.test.ts`
- `src/domain/ports/icsExporter.ts`
- `src/infrastructure/notifications/icsExporter.ts`
- `src/infrastructure/notifications/icsExporter.test.ts`

---

### Task 1: Add calendar-safe local date helpers

**Files:**
- Modify: `src/domain/apnea/time.ts`
- Modify: `src/domain/apnea/time.test.ts`

- [ ] **Step 1: Write failing tests for local day keys and calendar arithmetic**

Add imports and tests:

```ts
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  isSameCalendarDay,
  localDateKey,
  startOfDay,
  startOfLocalMonth,
} from './time';

it('adds local calendar days across month and year boundaries', () => {
  expect(addCalendarDays(D('2026-07-31T15:00:00'), 1))
    .toBe(D('2026-08-01T00:00:00'));
  expect(addCalendarDays(D('2026-12-31T15:00:00'), 1))
    .toBe(D('2027-01-01T00:00:00'));
});

it('creates stable local day keys', () => {
  expect(localDateKey(D('2026-07-09T00:01:00'))).toBe('2026-07-09');
  expect(localDateKey(D('2026-07-09T23:59:00'))).toBe('2026-07-09');
});

it('moves between local month starts', () => {
  const july = startOfLocalMonth(D('2026-07-19T12:00:00'));
  expect(july).toBe(D('2026-07-01T00:00:00'));
  expect(addCalendarMonths(july, 1)).toBe(D('2026-08-01T00:00:00'));
  expect(addCalendarMonths(july, -1)).toBe(D('2026-06-01T00:00:00'));
});
```

- [ ] **Step 2: Run the time tests and verify RED**

Run:

```powershell
npm test -- src/domain/apnea/time.test.ts --maxWorkers=4
```

Expected: FAIL because the four new helpers are not exported.

- [ ] **Step 3: Implement the helpers with local `Date` operations**

Add to `time.ts`:

```ts
export function addCalendarDays(t: number, days: number): number {
  const date = new Date(startOfDay(t));
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function localDateKey(t: number): string {
  const date = new Date(t);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfLocalMonth(t: number): number {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.getTime();
}

export function addCalendarMonths(t: number, months: number): number {
  const date = new Date(startOfLocalMonth(t));
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}
```

- [ ] **Step 4: Run the time tests and verify GREEN**

Run:

```powershell
npm test -- src/domain/apnea/time.test.ts --maxWorkers=4
```

Expected: all time helper tests pass.

- [ ] **Step 5: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: the existing REST hotfix plus Task 1 changes remain uncommitted.

---

### Task 2: Add the non-scrolling AppShell bottom-action slot

**Files:**
- Create: `src/ui/app/AppShell.test.tsx`
- Modify: `src/ui/app/AppShell.tsx`
- Modify: `src/ui/design-system/TabBar.tsx`

- [ ] **Step 1: Write the failing AppShell test**

Create:

```tsx
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

it('renders a primary action outside the scroll area and above navigation', () => {
  render(
    <MemoryRouter>
      <AppShell bottomAction={<button>Start session</button>}>
        <div>scroll content</div>
      </AppShell>
    </MemoryRouter>,
  );

  const main = screen.getByRole('main');
  const action = screen.getByRole('region', { name: /primary action/i });
  const navigation = screen.getByRole('navigation');

  expect(main).toHaveTextContent('scroll content');
  expect(main).not.toContainElement(action);
  expect(action.compareDocumentPosition(navigation)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

- [ ] **Step 2: Run the AppShell test and verify RED**

Run:

```powershell
npm test -- src/ui/app/AppShell.test.tsx --maxWorkers=4
```

Expected: FAIL because `bottomAction` is not an `AppShell` prop.

- [ ] **Step 3: Implement the slot**

Replace `AppShell.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { TabBar } from '../design-system/TabBar';

export function AppShell({
  children,
  bottomAction,
}: {
  children: ReactNode;
  bottomAction?: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-5 py-4">{children}</main>
      {bottomAction && (
        <div
          role="region"
          aria-label="Primary action"
          className="shrink-0 bg-[color:var(--ocean-900)] px-5 pb-3 pt-2"
        >
          {bottomAction}
        </div>
      )}
      <TabBar />
    </div>
  );
}
```

Update `TabBar` so the iPhone home indicator is respected:

```tsx
<nav
  className="flex shrink-0 justify-around border-t border-[color:var(--border)] bg-surface pt-2"
  style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
>
```

- [ ] **Step 4: Run the AppShell test and existing navigation tests**

Run:

```powershell
npm test -- src/ui/app/AppShell.test.tsx src/ui/app/routes.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 5: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 3: Build one Home day model

**Files:**
- Create: `src/application/usecases/homeDayModel.ts`
- Create: `src/application/usecases/homeDayModel.test.ts`

- [ ] **Step 1: Write failing model tests**

Create:

```ts
import { describe, expect, it } from 'vitest';
import { finishSession } from './finishSession';
import { homeDayModel } from './homeDayModel';
import { emptyAppState } from '../../domain/models/appState';
import { makeBaseline, makeSession } from '../../test/fixtures';

const D = (iso: string) => new Date(iso).getTime();

describe('homeDayModel', () => {
  it('returns a trainable today plan from one source', () => {
    const state = emptyAppState();
    state.baselines = [makeBaseline({ measuredAt: D('2026-07-01T10:00:00') })];

    const model = homeDayModel(state, D('2026-07-09T10:00:00'));

    expect(model.today.decision.dayType).toBe('CO2');
    expect(model.today.plan?.rounds).toHaveLength(8);
    expect(model.doneToday).toBeNull();
  });

  it('finds the next trainable day after a REST day', () => {
    const state = emptyAppState();
    state.baselines = [makeBaseline()];
    state.courseState.position = 1;
    state.courseState.lastAdvanceAt = D('2026-07-10T00:00:00');

    const model = homeDayModel(state, D('2026-07-10T10:00:00'));

    expect(model.today.decision.dayType).toBe('REST');
    expect(model.nextTraining?.dayType).toBe('O2');
    expect(model.nextTraining?.at).toBe(D('2026-07-11T00:00:00'));
  });

  it('uses the latest completed session when multiple sessions exist today', () => {
    const now = D('2026-07-09T18:00:00');
    let state = emptyAppState();
    state.baselines = [makeBaseline()];
    state = finishSession(state, makeSession({
      id: 'morning',
      finishedAt: D('2026-07-09T09:00:00'),
    }), D('2026-07-09T09:00:00'));
    state.sessions.push(makeSession({
      id: 'evening',
      type: 'MAX',
      finishedAt: D('2026-07-09T17:00:00'),
    }));

    expect(homeDayModel(state, now).doneToday?.id).toBe('evening');
  });
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
npm test -- src/application/usecases/homeDayModel.test.ts --maxWorkers=4
```

Expected: FAIL because `homeDayModel` does not exist.

- [ ] **Step 3: Implement the pure model**

Create:

```ts
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
```

- [ ] **Step 4: Run the model tests**

Run:

```powershell
npm test -- src/application/usecases/homeDayModel.test.ts --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 5: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 4: Add the Home Hero dock

**Files:**
- Create: `src/ui/components/HomeHeroDock.tsx`
- Create: `src/ui/components/HomeHeroDock.test.tsx`

- [ ] **Step 1: Write failing Hero state tests**

Create tests for trainable, no-baseline, REST, postponed, and completed states:

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeHeroDock } from './HomeHeroDock';
import { homeDayModel } from '../../application/usecases/homeDayModel';
import { emptyAppState } from '../../domain/models/appState';
import { makeBaseline, makeSession } from '../../test/fixtures';

const D = (iso: string) => new Date(iso).getTime();

it('renders the trainable session as the dominant action', async () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];
  const onLaunch = vi.fn();

  render(
    <HomeHeroDock
      model={homeDayModel(state, D('2026-07-09T10:00:00'))}
      onLaunch={onLaunch}
      onMeasureBaseline={vi.fn()}
    />,
  );

  expect(screen.getByText(/CO₂ session/i)).toBeInTheDocument();
  expect(screen.getByText(/8 rounds/i)).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: /start CO₂ session/i }),
  );
  expect(onLaunch).toHaveBeenCalledOnce();
});

it('offers baseline measurement when no baseline exists', () => {
  render(
    <HomeHeroDock
      model={homeDayModel(emptyAppState(), D('2026-07-09T10:00:00'))}
      onLaunch={vi.fn()}
      onMeasureBaseline={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: /measure baseline/i }))
    .toBeInTheDocument();
});

it('shows REST status and no training action', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];
  state.courseState.position = 1;
  state.courseState.lastAdvanceAt = D('2026-07-10T00:00:00');

  render(
    <HomeHeroDock
      model={homeDayModel(state, D('2026-07-10T10:00:00'))}
      onLaunch={vi.fn()}
      onMeasureBaseline={vi.fn()}
    />,
  );

  expect(screen.getByText(/rest day/i)).toBeInTheDocument();
  expect(screen.getByText(/next.*O₂/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start|train anyway/i }))
    .not.toBeInTheDocument();
});

it('shows the latest completed session without another start action', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];
  state.sessions = [makeSession({
    type: 'CO2',
    finishedAt: D('2026-07-09T09:00:00'),
  })];
  state.courseState.lastTrainedAt = D('2026-07-09T09:00:00');

  render(
    <HomeHeroDock
      model={homeDayModel(state, D('2026-07-09T18:00:00'))}
      onLaunch={vi.fn()}
      onMeasureBaseline={vi.fn()}
    />,
  );

  expect(screen.getByText(/CO₂ session complete/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start/i }))
    .not.toBeInTheDocument();
});

it('labels a due MAX assessment without a type level', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline({ measuredAt: 0 })];
  state.courseState.lastMaxTestAt = 0;

  render(
    <HomeHeroDock
      model={homeDayModel(state, 15 * 24 * 60 * 60 * 1000)}
      onLaunch={vi.fn()}
      onMeasureBaseline={vi.fn()}
    />,
  );

  expect(screen.getByText('MAX assessment')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /start MAX assessment/i }))
    .toBeInTheDocument();
  expect(screen.queryByText(/· L0/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the Hero tests and verify RED**

Run:

```powershell
npm test -- src/ui/components/HomeHeroDock.test.tsx --maxWorkers=4
```

Expected: FAIL because `HomeHeroDock` does not exist.

- [ ] **Step 3: Implement the Hero**

Create a component with this state order:

```tsx
import type { HomeDayModel } from '../../application/usecases/homeDayModel';
import { formatMMSS } from '../design-system/format';
import { Button } from '../design-system/Button';

function label(dayType: 'CO2' | 'O2' | 'MAX'): string {
  if (dayType === 'CO2') return 'CO₂';
  if (dayType === 'O2') return 'O₂';
  return 'MAX';
}

function nextCopy(model: HomeDayModel): string {
  if (!model.nextTraining) return 'Next training will appear here';
  return `Next: ${label(model.nextTraining.dayType)} · ${
    new Date(model.nextTraining.at).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  }`;
}

export function HomeHeroDock({
  model,
  onLaunch,
  onMeasureBaseline,
}: {
  model: HomeDayModel;
  onLaunch: () => void;
  onMeasureBaseline: () => void;
}) {
  const { today, doneToday } = model;

  if (doneToday) {
    return (
      <div className="rounded-3xl border border-[color:var(--success)] bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Today
        </div>
        <div className="mt-1 text-lg font-semibold text-[color:var(--success)]">
          {label(doneToday.type)} session complete
        </div>
        <div className="text-sm text-[color:var(--text-dim)]">
          {nextCopy(model)}
        </div>
      </div>
    );
  }

  if (today.needsBaseline) {
    return (
      <Button
        className="min-h-16 w-full text-lg shadow-[0_10px_28px_rgba(34,211,238,0.25)]"
        onClick={onMeasureBaseline}
      >
        Measure baseline
      </Button>
    );
  }

  if (today.decision.dayType === 'REST' || today.decision.blocked) {
    const postponed = today.assessmentSchedule.postponed;
    return (
      <div className="rounded-3xl border border-[color:var(--border)] bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Today
        </div>
        <div className="mt-1 text-lg font-semibold">
          {postponed ? 'MAX assessment postponed' : 'Rest day'}
        </div>
        <div className="text-sm text-[color:var(--text-dim)]">
          {postponed ? 'Recovery gate is active. ' : ''}
          {nextCopy(model)}
        </div>
      </div>
    );
  }

  const type = today.decision.dayType;
  const isMax = type === 'MAX';
  const title = isMax ? 'MAX assessment' : `${label(type)} session`;
  const action = isMax
    ? 'Start MAX assessment'
    : `Start ${label(type)} session`;
  const bestTarget = today.plan?.rounds.reduce(
    (best, round) => Math.max(best, round.targetHoldSec),
    0,
  ) ?? 0;

  return (
    <div className="rounded-3xl border border-[color:var(--border)] bg-surface p-3">
      <div className="flex items-end justify-between px-1 pb-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
            Today
          </div>
          <div className="text-lg font-semibold">{title}</div>
        </div>
        <div className="text-right text-xs text-[color:var(--text-dim)]">
          <div>
            {isMax
              ? `${today.plan?.rounds.length ?? 0} attempt`
              : `${today.plan?.rounds.length ?? 0} rounds · L${today.appliedDifficulty}`}
          </div>
          <div>up to {formatMMSS(bestTarget)}</div>
        </div>
      </div>
      <Button
        className="min-h-16 w-full text-lg shadow-[0_10px_28px_rgba(34,211,238,0.25)]"
        onClick={onLaunch}
      >
        {action}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run Hero tests**

Run:

```powershell
npm test -- src/ui/components/HomeHeroDock.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 5: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 5: Simplify Home and integrate the dock

**Files:**
- Modify: `src/ui/screens/HomeScreen.tsx`
- Modify: `src/ui/screens/HomeScreen.test.tsx`
- Modify: `src/ui/app/routes.tsx`

- [ ] **Step 1: Replace duplicated-stat tests with action-first tests**

Delete the old `shows the personal-best stat card` test. Add:

```tsx
it('removes duplicate headings and Stats metrics from Home', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'baseline',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: D('2026-07-01T10:00:00'),
  }];
  renderHome(state, D('2026-07-09T10:00:00'));

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /start CO₂ session/i }))
      .toBeInTheDocument(),
  );
  expect(screen.queryByText(/ready to train/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /apnea trainer/i }))
    .not.toBeInTheDocument();
  expect(screen.queryByText(/personal best/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
});

it('keeps the goal card above the persistent Hero', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'baseline',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: D('2026-07-01T10:00:00'),
  }];
  state.goal = {
    id: 'goal',
    targetHoldSec: 240,
    createdAt: D('2026-07-01T10:00:00'),
    startMaxSec: 180,
    achievedAt: null,
  };
  renderHome(state, D('2026-07-09T10:00:00'));

  expect(await screen.findByText(/max-hold goal/i)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: /primary action/i }))
    .toContainElement(
      screen.getByRole('button', { name: /start CO₂ session/i }),
    );
});
```

Update the completed and postponed tests to assert Hero dock copy and absence of
any Start/Train Anyway button.

- [ ] **Step 2: Run Home tests and verify RED**

Run:

```powershell
npm test -- src/ui/screens/HomeScreen.test.tsx --maxWorkers=4
```

Expected: FAIL because duplicate content remains and Home does not own
`AppShell.bottomAction`.

- [ ] **Step 3: Refactor Home around `homeDayModel`**

The final `HomeScreen` structure must be:

```tsx
export function HomeScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((store) => store.state);
  const now = clock.now();
  const model = homeDayModel(state, now);
  const forecast = state.goal ? goalForecast(state, state.goal, now) : null;

  function launch() {
    navigate('/runner', {
      state: {
        plan: model.today.plan,
        difficultyLevel: model.today.appliedDifficulty,
        earlyContractionThresholds:
          model.today.earlyContractionThresholds,
      },
    });
  }

  return (
    <AppShell
      bottomAction={(
        <HomeHeroDock
          model={model}
          onLaunch={launch}
          onMeasureBaseline={() => navigate('/baseline')}
        />
      )}
    >
      <div className="flex flex-col gap-4">
        {forecast ? (
          <GoalCard
            forecast={forecast}
            onOpen={() => navigate('/stats', { state: { focus: 'goal' } })}
            onSetGoal={forecast.achieved ? () => navigate('/goal') : undefined}
          />
        ) : (
          <Button variant="ghost" onClick={() => navigate('/goal')}>
            Set a max-hold goal
          </Button>
        )}
      </div>
    </AppShell>
  );
}
```

Remove imports for `StatCard`, `Card`, `formatMMSS`, Stats helpers,
`startTodaySession`, `isSameCalendarDay`, and `DAY_MS`.

In `HomeOrOnboarding`, replace:

```tsx
return <AppShell><HomeScreen /></AppShell>;
```

with:

```tsx
return <HomeScreen />;
```

- [ ] **Step 4: Run Home and route tests**

Run:

```powershell
npm test -- src/ui/screens/HomeScreen.test.tsx src/ui/app/routes.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 5: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 6: Derive completed calendar history

**Files:**
- Create: `src/application/calendar/trainingCalendar.ts`
- Create: `src/application/calendar/trainingCalendar.test.ts`

- [ ] **Step 1: Write failing completed-history tests**

Create tests that use real domain fixtures:

```ts
import { describe, expect, it } from 'vitest';
import {
  completedCalendarEvents,
  type TrainingCalendarEvent,
} from './trainingCalendar';
import { emptyAppState } from '../../domain/models/appState';
import { makeBaseline, makeRound, makeSession } from '../../test/fixtures';

const D = (iso: string) => new Date(iso).getTime();

function completed(events: TrainingCalendarEvent[]) {
  return events.filter((event) => event.status === 'completed');
}

describe('completedCalendarEvents', () => {
  it('maps every completed session with real details and quality', () => {
    const state = emptyAppState();
    state.sessions = [
      makeSession({
        id: 'co2',
        type: 'CO2',
        finishedAt: D('2026-07-09T10:20:00'),
        rpe: 'normal',
        tapOuts: 0,
        rounds: [
          makeRound({ index: 0, achievedHoldSec: 80 }),
          makeRound({ index: 1, achievedHoldSec: 90 }),
        ],
        completedRounds: 2,
      }),
    ];

    expect(completed(completedCalendarEvents(state))).toEqual([
      expect.objectContaining({
        id: 'session-co2',
        dayType: 'CO2',
        status: 'completed',
        quality: 'clean',
        completedRounds: 2,
        plannedRounds: 2,
        tapOuts: 0,
        bestHoldSec: 90,
      }),
    ]);
  });

  it('keeps multiple sessions on the same local day', () => {
    const state = emptyAppState();
    state.sessions = [
      makeSession({
        id: 'morning',
        finishedAt: D('2026-07-09T08:00:00'),
      }),
      makeSession({
        id: 'evening',
        type: 'O2',
        finishedAt: D('2026-07-09T18:00:00'),
      }),
    ];

    const events = completedCalendarEvents(state);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.dayKey))).toEqual(
      new Set(['2026-07-09']),
    );
  });

  it('shows an initial baseline as one MAX assessment event', () => {
    const state = emptyAppState();
    state.baselines = [makeBaseline({
      id: 'initial',
      measuredAt: D('2026-07-01T09:00:00'),
      maxHoldSec: 180,
      firstContractionSec: 95,
    })];

    expect(completedCalendarEvents(state)).toEqual([
      expect.objectContaining({
        id: 'assessment-initial',
        dayType: 'MAX',
        source: 'assessment',
        bestHoldSec: 180,
        firstContractionSec: 95,
      }),
    ]);
  });

  it('deduplicates a MAX session and its generated baseline one-to-one', () => {
    const state = emptyAppState();
    state.sessions = [makeSession({
      id: 'max',
      type: 'MAX',
      finishedAt: D('2026-07-09T10:00:00'),
      rounds: [makeRound({
        achievedHoldSec: 205,
        firstContractionSec: 100,
      })],
    })];
    state.baselines = [makeBaseline({
      id: 'baseline-max',
      measuredAt: D('2026-07-09T10:02:00'),
      maxHoldSec: 205,
      firstContractionSec: 100,
    })];

    const events = completedCalendarEvents(state);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      source: 'session',
      dayType: 'MAX',
      bestHoldSec: 205,
      firstContractionSec: 100,
    }));
  });

  it('marks unrated imported training quality as unavailable', () => {
    const state = emptyAppState();
    state.sessions = [makeSession({ rpe: null })];
    expect(completedCalendarEvents(state)[0]?.quality).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run completed-history tests and verify RED**

Run:

```powershell
npm test -- src/application/calendar/trainingCalendar.test.ts --maxWorkers=4
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define the event types**

Create:

```ts
import type {
  AppState,
  DayType,
  InSessionAdjustment,
  Session,
  SessionQuality,
} from '../../domain/models/types';
import { classifySession } from '../../domain/apnea/qualityEngine';
import { localDateKey } from '../../domain/apnea/time';

export type CalendarEventQuality =
  | SessionQuality
  | 'unavailable'
  | null;

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
```

- [ ] **Step 4: Implement completed mapping and one-to-one MAX pairing**

Use these helpers:

```ts
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
```

`completedCalendarEvents` must:

1. Sort sessions by `finishedAt`.
2. For each MAX session, find one unmatched baseline satisfying all conditions:
   - same `localDateKey`;
   - `baseline.maxHoldSec === bestHold(session)`;
   - `baseline.measuredAt >= session.finishedAt`.
3. Choose the candidate with the smallest timestamp distance and mark its id
   consumed.
4. Emit one event per session.
5. Emit one assessment event per unconsumed baseline.
6. Sort by `at`, then `id`.

Use stable ids:

```ts
`session-${session.id}`
`assessment-${baseline.id}`
```

- [ ] **Step 5: Run completed-history tests**

Run:

```powershell
npm test -- src/application/calendar/trainingCalendar.test.ts --maxWorkers=4
```

Expected: completed-history tests pass.

- [ ] **Step 6: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 7: Project the provisional 42-day plan

**Files:**
- Modify: `src/application/calendar/trainingCalendar.ts`
- Modify: `src/application/calendar/trainingCalendar.test.ts`

- [ ] **Step 1: Add failing projection tests**

Add:

```ts
import { plannedCalendarEvents } from './trainingCalendar';
import { DAY_MS } from '../../domain/apnea/config';

it('projects exactly 42 local calendar days including today', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];
  const original = structuredClone(state);

  const events = plannedCalendarEvents(
    state,
    D('2026-07-10T10:00:00'),
  );

  expect(events).toHaveLength(42);
  expect(events[0]?.dayKey).toBe('2026-07-10');
  expect(events.at(-1)?.dayKey).toBe('2026-08-20');
  expect(state).toEqual(original);
});

it('projects the default sequence with real REST days', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];

  expect(
    plannedCalendarEvents(state, D('2026-07-06T10:00:00'))
      .slice(0, 7)
      .map((event) => event.dayType),
  ).toEqual(['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST']);
});

it('does not add a planned event over a session already completed today', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];
  state.sessions = [makeSession({
    id: 'done',
    finishedAt: D('2026-07-09T09:00:00'),
  })];
  state.courseState.position = 1;
  state.courseState.lastTrainedAt = D('2026-07-09T09:00:00');
  state.courseState.lastAdvanceAt = D('2026-07-10T00:00:00');

  const events = plannedCalendarEvents(
    state,
    D('2026-07-09T18:00:00'),
  );

  expect(events.some((event) => event.dayKey === '2026-07-09')).toBe(false);
  expect(events[0]?.dayKey).toBe('2026-07-10');
});

it('projects hard-session recovery before an eligible MAX assessment', () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline({ measuredAt: 0 })];
  state.courseState.lastMaxTestAt = 0;
  state.sessions = [makeSession({
    id: 'hard',
    rpe: 'hard',
    finishedAt: 14 * DAY_MS,
  })];

  const events = plannedCalendarEvents(state, 15 * DAY_MS);

  expect(events[0]).toEqual(expect.objectContaining({
    dayType: 'REST',
    postponed: true,
  }));
  expect(events.some((event) => event.dayType === 'MAX')).toBe(true);
});

it('returns no invented training plan without a baseline', () => {
  expect(
    plannedCalendarEvents(emptyAppState(), D('2026-07-10T10:00:00')),
  ).toEqual([]);
});
```

- [ ] **Step 2: Run projection tests and verify RED**

Run:

```powershell
npm test -- src/application/calendar/trainingCalendar.test.ts --maxWorkers=4
```

Expected: FAIL because `plannedCalendarEvents` does not exist.

- [ ] **Step 3: Implement projection-only state advancement**

Add imports:

```ts
import { addCalendarDays, isSameCalendarDay, startOfDay } from '../../domain/apnea/time';
import { latestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';
import { completeSession, syncRestDays } from '../../domain/apnea/courseEngine';
import { startTodaySession } from '../usecases/startTodaySession';
import type { RoundResult } from '../../domain/models/types';
```

Add:

```ts
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
  days = PROJECTION_DAYS,
): TrainingCalendarEvent[] {
  if (latestAssessedMaxSec(state) <= 0) return [];

  let projected: AppState = {
    ...state,
    sessions: [...state.sessions],
    courseState: {
      ...state.courseState,
      difficultyByType: { ...state.courseState.difficultyByType },
      template: { days: [...state.courseState.template.days] },
    },
  };
  const events: TrainingCalendarEvent[] = [];
  const firstDay = startOfDay(now);

  for (let offset = 0; offset < days; offset += 1) {
    const at = addCalendarDays(firstDay, offset);
    projected = {
      ...projected,
      courseState: syncRestDays(projected.courseState, at),
    };

    if (
      offset === 0
      && state.sessions.some((session) =>
        isSameCalendarDay(session.finishedAt, at))
    ) {
      continue;
    }

    const today = startTodaySession(projected, at);
    const plan = today.plan;
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
      bestHoldSec: plan?.rounds.reduce(
        (best, round) => Math.max(best, round.targetHoldSec),
        0,
      ) ?? null,
      difficultyLevel:
        today.decision.dayType === 'CO2'
        || today.decision.dayType === 'O2'
          ? today.appliedDifficulty
          : null,
      firstContractionSec: null,
      adjustment: null,
      postponed: today.assessmentSchedule.postponed,
    });

    if (!plan || today.decision.blocked) continue;

    let courseState = completeSession(projected.courseState, at);
    if (today.decision.dayType === 'MAX') {
      courseState = { ...courseState, lastMaxTestAt: at };
    } else {
      const rounds = projectionRounds(plan);
      projected = {
        ...projected,
        sessions: [...projected.sessions, {
          id: `projection-${at}`,
          type: today.decision.dayType,
          rounds,
          startedAt: at,
          finishedAt: at,
          completedRounds: rounds.length,
          tapOuts: 0,
          rpe: null,
          difficultyLevel: today.appliedDifficulty,
          adjustment: null,
        }],
      };
    }
    projected = { ...projected, courseState };
  }

  return events;
}
```

The projection session is never returned or persisted. Its `rpe: null` prevents
invented clean/strained/failed adaptation while preserving the one-day minimum
assessment recovery gate.

- [ ] **Step 4: Run all calendar builder tests**

Run:

```powershell
npm test -- src/application/calendar/trainingCalendar.test.ts --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 5: Run scheduling invariants**

Run:

```powershell
npm test -- src/domain/apnea/courseEngine.test.ts src/domain/apnea/assessmentSchedule.test.ts src/application/usecases/startTodaySession.test.ts --maxWorkers=4
```

Expected: PASS, including the uncommitted legacy REST-anchor regression.

- [ ] **Step 6: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 8: Build the accessible MonthCalendar primitive

**Files:**
- Create: `src/ui/design-system/MonthCalendar.tsx`
- Create: `src/ui/design-system/MonthCalendar.test.tsx`

- [ ] **Step 1: Write failing month-grid tests**

Create:

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthCalendar } from './MonthCalendar';
import type { TrainingCalendarEvent } from '../../application/calendar/trainingCalendar';

const D = (iso: string) => new Date(iso).getTime();

const completed: TrainingCalendarEvent = {
  id: 'completed',
  at: D('2026-07-09T10:00:00'),
  dayKey: '2026-07-09',
  dayType: 'CO2',
  status: 'completed',
  source: 'session',
  quality: 'clean',
  completedRounds: 8,
  plannedRounds: 8,
  tapOuts: 0,
  bestHoldSec: 92,
  difficultyLevel: 1,
  firstContractionSec: null,
  adjustment: null,
  postponed: false,
};

it('renders a six-week month grid with today and event markers', () => {
  render(
    <MonthCalendar
      visibleMonth={D('2026-07-01T00:00:00')}
      today={D('2026-07-10T10:00:00')}
      selectedDayKey="2026-07-09"
      events={[
        completed,
        {
          ...completed,
          id: 'planned',
          at: D('2026-07-11T00:00:00'),
          dayKey: '2026-07-11',
          dayType: 'O2',
          status: 'planned',
          source: 'projection',
        },
      ]}
      onSelectDay={vi.fn()}
      onPreviousMonth={vi.fn()}
      onNextMonth={vi.fn()}
    />,
  );

  expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  expect(screen.getByRole('button', { name: /July 10.*today/i }))
    .toBeInTheDocument();
  expect(screen.getByTestId('marker-completed')).toHaveClass('bg-[color:var(--cyan)]');
  expect(screen.getByTestId('marker-planned')).toHaveClass('border');
});

it('selects a day and exposes named month controls', async () => {
  const onSelectDay = vi.fn();
  const onNextMonth = vi.fn();
  render(
    <MonthCalendar
      visibleMonth={D('2026-07-01T00:00:00')}
      today={D('2026-07-10T10:00:00')}
      selectedDayKey="2026-07-10"
      events={[]}
      onSelectDay={onSelectDay}
      onPreviousMonth={vi.fn()}
      onNextMonth={onNextMonth}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: /July 15/i }));
  expect(onSelectDay).toHaveBeenCalledWith('2026-07-15');
  await userEvent.click(screen.getByRole('button', { name: /next month/i }));
  expect(onNextMonth).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run MonthCalendar tests and verify RED**

Run:

```powershell
npm test -- src/ui/design-system/MonthCalendar.test.tsx --maxWorkers=4
```

Expected: FAIL because `MonthCalendar` does not exist.

- [ ] **Step 3: Implement fixed 42-cell local month generation**

Use:

```ts
function monthCells(visibleMonth: number): number[] {
  const first = new Date(visibleMonth);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    addCalendarDays(visibleMonth, index - mondayOffset));
}
```

Group events by `dayKey`. Render:

- `role="grid"` around the calendar;
- seven weekday headers;
- 42 `role="gridcell"` wrappers;
- one date button per cell;
- `aria-pressed={dayKey === selectedDayKey}`;
- complete accessible text containing date, today/selected state, and event
  summaries;
- one marker per event.

Semantic marker classes:

```ts
const markerColor = {
  CO2: 'border-[color:var(--cyan)] bg-[color:var(--cyan)]',
  O2: 'border-[color:var(--teal)] bg-[color:var(--teal)]',
  MAX: 'border-[color:var(--warn)] bg-[color:var(--warn)]',
  REST: 'border-[color:var(--text-mute)] bg-[color:var(--text-mute)]',
} satisfies Record<TrainingCalendarEvent['dayType'], string>;
```

For planned events append:

```ts
' border bg-transparent'
```

Do not hide adjacent-month dates; render them with muted text and allow
selection.

- [ ] **Step 4: Run MonthCalendar tests**

Run:

```powershell
npm test -- src/ui/design-system/MonthCalendar.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 5: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 9: Add the day drawer and Calendar screen

**Files:**
- Create: `src/ui/components/CalendarDayDrawer.tsx`
- Create: `src/ui/components/CalendarDayDrawer.test.tsx`
- Create: `src/ui/screens/CalendarScreen.tsx`
- Create: `src/ui/screens/CalendarScreen.test.tsx`

- [ ] **Step 1: Write failing drawer tests**

Create the test file with these imports and fixtures:

```tsx
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarDayDrawer } from './CalendarDayDrawer';
import type { TrainingCalendarEvent } from '../../application/calendar/trainingCalendar';

const completedEvent: TrainingCalendarEvent = {
  id: 'completed',
  at: new Date('2026-07-09T10:00:00').getTime(),
  dayKey: '2026-07-09',
  dayType: 'CO2',
  status: 'completed',
  source: 'session',
  quality: 'clean',
  completedRounds: 8,
  plannedRounds: 8,
  tapOuts: 0,
  bestHoldSec: 92,
  difficultyLevel: 1,
  firstContractionSec: 50,
  adjustment: null,
  postponed: false,
};

const plannedEvent: TrainingCalendarEvent = {
  id: 'planned',
  at: new Date('2026-07-11T00:00:00').getTime(),
  dayKey: '2026-07-11',
  dayType: 'O2',
  status: 'planned',
  source: 'projection',
  quality: null,
  completedRounds: null,
  plannedRounds: 8,
  tapOuts: null,
  bestHoldSec: 108,
  difficultyLevel: 2,
  firstContractionSec: null,
  adjustment: null,
  postponed: false,
};

it('shows completed result, quality, tap-outs, and best hold', () => {
  render(<CalendarDayDrawer dayKey="2026-07-09" events={[completedEvent]} />);
  expect(screen.getByText(/CO₂ session/i)).toBeInTheDocument();
  expect(screen.getByText(/clean/i)).toBeInTheDocument();
  expect(screen.getByText(/8\\/8 rounds/i)).toBeInTheDocument();
  expect(screen.getByText(/0 tap-outs/i)).toBeInTheDocument();
  expect(screen.getByText(/1:32 best hold/i)).toBeInTheDocument();
});

it('lists multiple events on the selected date', () => {
  render(
    <CalendarDayDrawer
      dayKey="2026-07-09"
      events={[completedEvent, { ...completedEvent, id: 'max', dayType: 'MAX' }]}
    />,
  );
  expect(screen.getAllByTestId('calendar-day-event')).toHaveLength(2);
});

it('shows planned level and rounds without completed metrics', () => {
  render(<CalendarDayDrawer dayKey="2026-07-11" events={[plannedEvent]} />);
  expect(screen.getByText(/planned/i)).toBeInTheDocument();
  expect(screen.getByText(/level 2/i)).toBeInTheDocument();
  expect(screen.getByText(/8 rounds/i)).toBeInTheDocument();
  expect(screen.queryByText(/tap-outs/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Implement the drawer**

Use one `Card` with a localized date heading. Map every event to a
`data-testid="calendar-day-event"` block. Use `formatMMSS` for holds and
first-contraction time. Exact labels:

- `CO₂ session`, `O₂ session`, `MAX assessment`, `Rest day`;
- `Completed`, `Planned`, `Postponed`;
- `Quality unavailable` for imported unrated training;
- `8/8 rounds`, `0 tap-outs`, `1:32 best hold`;
- `Level 2 · 8 rounds` for future training.

- [ ] **Step 3: Run drawer tests**

Run:

```powershell
npm test -- src/ui/components/CalendarDayDrawer.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 4: Write failing CalendarScreen integration tests**

Create a `renderCalendar(state, now)` helper using `FakeClock`, repository,
`AppProviders`, and `MemoryRouter`. Add:

```tsx
it('renders history, today, and provisional future markers', async () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline({
    measuredAt: D('2026-07-01T09:00:00'),
  })];
  state.sessions = [makeSession({
    id: 'co2',
    finishedAt: D('2026-07-09T10:00:00'),
  })];

  renderCalendar(state, D('2026-07-10T10:00:00'));

  expect(await screen.findByRole('heading', { name: 'Calendar' }))
    .toBeInTheDocument();
  expect(screen.getByText(/provisional plan · 6 weeks/i))
    .toBeInTheDocument();
  expect(screen.getAllByTestId('marker-completed').length)
    .toBeGreaterThan(0);
  expect(screen.getAllByTestId('marker-planned').length)
    .toBeGreaterThan(0);
});

it('opens details for a completed day', async () => {
  const state = emptyAppState();
  state.baselines = [makeBaseline()];
  state.sessions = [makeSession({
    id: 'co2',
    finishedAt: D('2026-07-09T10:00:00'),
    rpe: 'normal',
  })];
  renderCalendar(state, D('2026-07-10T10:00:00'));

  await userEvent.click(screen.getByRole('button', { name: /July 9.*CO₂/i }));
  expect(screen.getByText(/CO₂ session/i)).toBeInTheDocument();
  expect(screen.getByText(/clean/i)).toBeInTheDocument();
});

it('shows baseline guidance instead of an invented plan', async () => {
  renderCalendar(emptyAppState(), D('2026-07-10T10:00:00'));
  expect(await screen.findByText(/measure a baseline to create your plan/i))
    .toBeInTheDocument();
  expect(screen.queryByTestId('marker-planned')).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Implement CalendarScreen**

Use:

```tsx
const now = clock.now();
const [visibleMonth, setVisibleMonth] = useState(
  () => startOfLocalMonth(now),
);
const [selectedDayKey, setSelectedDayKey] = useState(
  () => localDateKey(now),
);
const events = useMemo(
  () => [
    ...completedCalendarEvents(state),
    ...plannedCalendarEvents(state, now),
  ],
  [state, now],
);
const selectedEvents = events.filter(
  (event) => event.dayKey === selectedDayKey,
);
```

Render:

1. `h2` with `Calendar`.
2. A compact legend: filled `Completed`, outlined `Planned`, and semantic
   CO₂/O₂/MAX/REST labels.
3. `MonthCalendar`.
4. `Provisional plan · 6 weeks`.
5. Baseline CTA when `state.baselines.length === 0`.
6. `CalendarDayDrawer` for the selected date, including an empty-day message.

Previous/next month callbacks use `addCalendarMonths`.

- [ ] **Step 6: Run Calendar component and screen tests**

Run:

```powershell
npm test -- src/ui/components/CalendarDayDrawer.test.tsx src/ui/design-system/MonthCalendar.test.tsx src/ui/screens/CalendarScreen.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 7: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: changes remain uncommitted.

---

### Task 10: Rename Program navigation and remove `.ics` delivery

**Files:**
- Modify: `src/ui/app/routes.tsx`
- Modify: `src/ui/app/routes.test.tsx`
- Modify: `src/ui/design-system/TabBar.tsx`
- Modify: `src/ui/app/services.tsx`
- Modify: `src/infrastructure/device/productionServices.ts`
- Modify: `src/infrastructure/device/productionServices.test.ts`
- Modify: `src/domain/ports/index.ts`
- Delete: `src/ui/screens/ProgramScreen.tsx`
- Delete: `src/ui/screens/ProgramScreen.test.tsx`
- Delete: `src/ui/icsShare.ts`
- Delete: `src/ui/icsShare.test.ts`
- Delete: `src/domain/ports/icsExporter.ts`
- Delete: `src/infrastructure/notifications/icsExporter.ts`
- Delete: `src/infrastructure/notifications/icsExporter.test.ts`

- [ ] **Step 1: Add failing route and navigation tests**

Add route tests:

```tsx
it('renders Calendar at /calendar', async () => {
  renderAt('/calendar');
  expect(await screen.findByRole('heading', { name: 'Calendar' }))
    .toBeInTheDocument();
});

it('redirects legacy /program links to Calendar', async () => {
  renderAt('/program');
  expect(await screen.findByRole('heading', { name: 'Calendar' }))
    .toBeInTheDocument();
});
```

In `AppShell.test.tsx`, assert:

```tsx
expect(screen.getByRole('link', { name: /Calendar/i }))
  .toHaveAttribute('href', '/calendar');
expect(screen.queryByRole('link', { name: /Program/i }))
  .not.toBeInTheDocument();
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```powershell
npm test -- src/ui/app/routes.test.tsx src/ui/app/AppShell.test.tsx --maxWorkers=4
```

Expected: FAIL because `/calendar` and Calendar tab do not exist.

- [ ] **Step 3: Wire Calendar routes and tab**

In `routes.tsx`:

```tsx
import { CalendarScreen } from '../screens/CalendarScreen';
```

Replace the Program route with:

```tsx
<Route
  path="/calendar"
  element={<AppShell><CalendarScreen /></AppShell>}
/>
<Route path="/program" element={<Navigate to="/calendar" replace />} />
```

Update the tab entry:

```ts
{ to: '/calendar', icon: '🗓️', label: 'Calendar' },
```

- [ ] **Step 4: Remove `.ics` service wiring**

In `services.tsx`, remove the `IcsExporter` import and `ics` field.

In `productionServices.ts`, remove:

```ts
import { buildIcs } from '../notifications/icsExporter';
```

and:

```ts
ics: { build: buildIcs },
```

In `productionServices.test.ts`, remove:

```ts
expect(typeof s.ics.build).toBe('function');
```

In `domain/ports/index.ts`, remove:

```ts
export type { IcsExporter } from './icsExporter';
```

Delete all files listed in this task. Keep `settings.reminderTimes` and all
persistence/migration tests for reminder data.

- [ ] **Step 5: Run route, services, and Calendar tests**

Run:

```powershell
npm test -- src/ui/app/routes.test.tsx src/ui/app/AppShell.test.tsx src/ui/app/services.test.tsx src/infrastructure/device/productionServices.test.ts src/ui/screens/CalendarScreen.test.tsx --maxWorkers=4
```

Expected: PASS.

- [ ] **Step 6: Prove no `.ics` UI or wiring remains**

Run:

```powershell
rg -n "Export reminders|shareOrDownloadIcs|IcsExporter|icsExporter|\\.ics" src
```

Expected: no matches. `reminderTimes` may still exist and is not part of this
search.

- [ ] **Step 7: Inspect without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: deleted Program/ICS files and new Calendar files remain uncommitted.

---

### Task 11: Run the final UX and safety regression

**Files:**
- No planned source modifications.

- [ ] **Step 1: Run all new UX tests**

Run:

```powershell
npm test -- src/application/usecases/homeDayModel.test.ts src/application/calendar/trainingCalendar.test.ts src/ui/app/AppShell.test.tsx src/ui/components/HomeHeroDock.test.tsx src/ui/design-system/MonthCalendar.test.tsx src/ui/components/CalendarDayDrawer.test.tsx src/ui/screens/HomeScreen.test.tsx src/ui/screens/CalendarScreen.test.tsx src/ui/app/routes.test.tsx --maxWorkers=4
```

Expected: all Home Hero and Calendar tests pass.

- [ ] **Step 2: Run scheduling and persistence safety tests**

Run:

```powershell
npm test -- src/domain/apnea/courseEngine.test.ts src/domain/apnea/assessmentSchedule.test.ts src/application/usecases/startTodaySession.test.ts src/application/usecases/finishSession.test.ts src/application/stores/appStore.test.ts src/ui/pwa/useAppUpdate.test.tsx --maxWorkers=4
```

Expected:

- legacy REST anchors still self-heal;
- REST days remain non-trainable;
- MAX recovery gates remain intact;
- session persistence remains durable and idempotent;
- PWA updates still do not reload an active session.

- [ ] **Step 3: Run the full suite**

Run:

```powershell
npm test -- --maxWorkers=4
```

Expected: all Vitest files pass. The existing Onboarding `act(...)` warning may
remain, but no test may fail.

- [ ] **Step 4: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code 0. Existing warnings may remain; no new warning should be
introduced by this feature.

- [ ] **Step 5: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite/PWA build successfully.

- [ ] **Step 6: Review the complete uncommitted diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected:

- the pre-existing local REST-anchor hotfix is preserved;
- Home contains no duplicate Stats content;
- AppShell owns the Hero slot;
- Program/ICS files are removed;
- Calendar domain/UI files and tests are present;
- no commit or push has occurred.

- [ ] **Step 7: Request final code review**

Review all tracked and untracked changes against:

- `docs/superpowers/specs/2026-07-10-apnea-trainer-home-calendar-ux-design.md`
- this implementation plan;
- the existing safety and PWA update requirements.

Fix every Critical or Important finding, rerun the affected targeted tests, then
rerun Steps 3–6. Leave the final change set uncommitted until the user explicitly
authorizes commit/push.
