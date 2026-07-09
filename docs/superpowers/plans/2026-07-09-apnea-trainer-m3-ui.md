# Apnea Trainer — Milestone 3: UI (Design System & Screens) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deep-ocean design-system components and all eight screens, wired to the Milestone 2 stores, with device services injected through a React context (real implementations arrive in Milestone 4).

**Architecture:** `ui/design-system` holds presentational primitives (no store access). `ui/screens` compose primitives and read/write stores through hooks. A `ServicesProvider` supplies `Clock` + device service ports (defaulting to safe no-ops here); an `AppProviders` builds the vanilla Zustand stores from those services and exposes typed hooks. Routing uses `react-router-dom` with a bottom tab bar.

**Tech Stack:** React 18, react-router-dom, Tailwind, Zustand (via `useStore`), Vitest + Testing Library. Depends on Milestones 1–2.

**Prerequisite:** Milestones 1–2 complete.

---

### Task 1: Install router and create the services context

**Files:**
- Create: `src/ui/app/services.tsx`
- Create: `src/infrastructure/device/noopServices.ts`
- Test: `src/ui/app/services.test.tsx`

- [ ] **Step 1: Install react-router-dom**

Run: `npm install react-router-dom`

- [ ] **Step 2: Create default no-op service implementations**

Create `src/infrastructure/device/noopServices.ts`:
```typescript
import type { WakeLockService } from '../../domain/ports/wakeLockService';
import type { CueService } from '../../domain/ports/cueService';
import type { NotificationService } from '../../domain/ports/notificationService';

export const noopWakeLock: WakeLockService = {
  async acquire() {},
  async release() {},
};

export const noopCues: CueService = {
  speak() {},
  beep() {},
  vibrate() {},
};

export const noopNotifications: NotificationService = {
  isSupported: () => false,
  async requestPermission() { return false; },
  async scheduleDailyReminders() {},
  async cancelAll() {},
};
```

- [ ] **Step 3: Write the failing test**

Create `src/ui/app/services.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServicesProvider, useServices } from './services';

function Probe() {
  const { clock } = useServices();
  return <span>now:{clock.now() > 0 ? 'ok' : 'bad'}</span>;
}

describe('ServicesProvider', () => {
  it('provides a working clock by default', () => {
    render(<ServicesProvider><Probe /></ServicesProvider>);
    expect(screen.getByText('now:ok')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -- app/services`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement the services context**

Create `src/ui/app/services.tsx`:
```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { Clock } from '../../domain/ports/clock';
import type { WakeLockService } from '../../domain/ports/wakeLockService';
import type { CueService } from '../../domain/ports/cueService';
import type { NotificationService } from '../../domain/ports/notificationService';
import type { IcsExporter } from '../../domain/ports/icsExporter';
import type { StateRepository } from '../../domain/ports/stateRepository';
import { systemClock } from '../../infrastructure/device/systemClock';
import { noopWakeLock, noopCues, noopNotifications } from '../../infrastructure/device/noopServices';
import { createIndexedDbRepository } from '../../infrastructure/persistence/indexedDbRepository';
import { buildIcs } from '../../infrastructure/notifications/icsExporter';

export interface Services {
  clock: Clock;
  wakeLock: WakeLockService;
  cues: CueService;
  notifications: NotificationService;
  ics: IcsExporter;
  repository: StateRepository;
}

function defaultServices(): Services {
  return {
    clock: systemClock,
    wakeLock: noopWakeLock,
    cues: noopCues,
    notifications: noopNotifications,
    ics: { build: buildIcs },
    repository: createIndexedDbRepository(),
  };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ children, value }: { children: ReactNode; value?: Partial<Services> }) {
  const services = { ...defaultServices(), ...value };
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within ServicesProvider');
  return ctx;
}
```

Note: `buildIcs` is created in Task 2 below; create that file first if your worker runs tasks strictly in order, or temporarily inline `ics: { build: () => '' }` and replace it in Task 2.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- app/services`
Expected: PASS (after Task 2 provides `buildIcs`, or with the temporary inline stub).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): add services context with default no-op device services"
```

---

### Task 2: ICS exporter (pure) — needed by services and Program screen

**Files:**
- Create: `src/infrastructure/notifications/icsExporter.ts`
- Test: `src/infrastructure/notifications/icsExporter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/notifications/icsExporter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildIcs } from './icsExporter';
import { defaultMicrocycle } from '../../domain/models/appState';

const D = (iso: string) => new Date(iso).getTime();

describe('buildIcs', () => {
  it('produces a valid VCALENDAR with a VEVENT per training day', () => {
    const ics = buildIcs(['19:00'], defaultMicrocycle(), D('2026-07-13T00:00:00')); // Monday
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    // default microcycle has 4 non-REST days -> 4 events
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(ics).toContain('SUMMARY:Apnea training');
  });

  it('returns an empty calendar when there are no reminder times', () => {
    const ics = buildIcs([], defaultMicrocycle(), D('2026-07-13T00:00:00'));
    expect(ics.match(/BEGIN:VEVENT/g)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- icsExporter`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the ICS builder**

Create `src/infrastructure/notifications/icsExporter.ts`:
```typescript
import type { MicrocycleTemplate } from '../../domain/models/types';
import { DAY_MS } from '../../domain/apnea/config';

const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function pad(n: number): string { return String(n).padStart(2, '0'); }

function dtStamp(t: number, hh: number, mm: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;
}

export function buildIcs(times: string[], template: MicrocycleTemplate, startDate: number): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ApneaTrainer//EN'];
  if (times.length > 0) {
    const [hh, mm] = times[0].split(':').map(Number);
    template.days.forEach((day, i) => {
      if (day === 'REST') return;
      const eventDate = startDate + i * DAY_MS;
      const weekday = ICS_DAY[new Date(eventDate).getDay()];
      lines.push(
        'BEGIN:VEVENT',
        `UID:apnea-${day}-${i}@apnea-trainer`,
        `DTSTART:${dtStamp(eventDate, hh, mm)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${weekday}`,
        `SUMMARY:Apnea training (${day})`,
        'END:VEVENT',
      );
    });
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- icsExporter`
Expected: PASS. Then update `src/ui/app/services.tsx` to import `buildIcs` (remove any temporary stub).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(infra): add pure ICS calendar exporter"
```

---

### Task 3: Store provider and hooks

**Files:**
- Create: `src/ui/app/stores.tsx`
- Test: `src/ui/app/stores.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/app/stores.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider } from './services';
import { AppProviders, useAppStore } from './stores';

function Probe() {
  const hydrated = useAppStore((s) => s.hydrated);
  return <span>{hydrated ? 'hydrated' : 'loading'}</span>;
}

describe('AppProviders', () => {
  it('hydrates the app store on mount', async () => {
    render(
      <ServicesProvider>
        <AppProviders><Probe /></AppProviders>
      </ServicesProvider>,
    );
    await waitFor(() => expect(screen.getByText('hydrated')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- app/stores`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store provider**

Create `src/ui/app/stores.tsx`:
```tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createAppStore, type AppStore } from '../../application/stores/appStore';
import { createSessionRunnerStore, type SessionRunnerStore } from '../../application/stores/sessionRunnerStore';
import { useServices } from './services';

type AppStoreApi = ReturnType<typeof createAppStore>;
type RunnerStoreApi = ReturnType<typeof createSessionRunnerStore>;

const AppStoreContext = createContext<AppStoreApi | null>(null);
const RunnerStoreContext = createContext<RunnerStoreApi | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const { repository, clock } = useServices();
  const [ready, setReady] = useState(false);
  const appRef = useRef<AppStoreApi>();
  const runnerRef = useRef<RunnerStoreApi>();
  if (!appRef.current) appRef.current = createAppStore(repository, () => clock.now());
  if (!runnerRef.current) runnerRef.current = createSessionRunnerStore(() => clock.now());

  useEffect(() => {
    appRef.current!.getState().hydrate().then(() => setReady(true));
  }, []);

  // Render children immediately; screens read `hydrated` to gate content.
  void ready;
  return (
    <AppStoreContext.Provider value={appRef.current}>
      <RunnerStoreContext.Provider value={runnerRef.current}>
        {children}
      </RunnerStoreContext.Provider>
    </AppStoreContext.Provider>
  );
}

export function useAppStore<T>(selector: (s: AppStore) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppStore requires AppProviders');
  return useStore(store, selector);
}

export function useRunnerStore<T>(selector: (s: SessionRunnerStore) => T): T {
  const store = useContext(RunnerStoreContext);
  if (!store) throw new Error('useRunnerStore requires AppProviders');
  return useStore(store, selector);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- app/stores`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add store provider with hydration and typed hooks"
```

---

### Task 4: Design-system primitives — Button, Card, StatCard

**Files:**
- Create: `src/ui/design-system/Button.tsx`, `Card.tsx`, `StatCard.tsx`
- Test: `src/ui/design-system/primitives.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/design-system/primitives.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { StatCard } from './StatCard';

describe('Button', () => {
  it('renders children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Start</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('StatCard', () => {
  it('shows a label and value', () => {
    render(<StatCard label="Personal best" value="3:42" />);
    expect(screen.getByText('Personal best')).toBeInTheDocument();
    expect(screen.getByText('3:42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- primitives`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the primitives**

Create `src/ui/design-system/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-cyan to-cyan-deep text-[#032430]',
  ghost: 'bg-surface text-[color:var(--text)] border border-[color:var(--border)]',
  danger: 'bg-danger text-[#2a0a0a]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-2xl px-5 py-3 font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
```

Create `src/ui/design-system/Card.tsx`:
```tsx
import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-[color:var(--border)] bg-surface p-4 ${className}`}>
      {children}
    </div>
  );
}
```

Create `src/ui/design-system/StatCard.tsx`:
```tsx
import { Card } from './Card';

export function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">{label}</div>
      <div className="mt-1 text-4xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- primitives`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add Button, Card, StatCard primitives"
```

---

### Task 5: ProgressRing and PhaseBadge (logic-bearing)

**Files:**
- Create: `src/ui/design-system/ProgressRing.tsx`, `PhaseBadge.tsx`
- Create: `src/ui/design-system/format.ts`
- Test: `src/ui/design-system/ring.test.tsx`, `src/ui/design-system/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/design-system/format.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { formatMMSS } from './format';

describe('formatMMSS', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMMSS(0)).toBe('0:00');
    expect(formatMMSS(65)).toBe('1:05');
    expect(formatMMSS(222)).toBe('3:42');
  });
});
```

Create `src/ui/design-system/ring.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';
import { dashOffset } from './ProgressRing';

describe('dashOffset', () => {
  it('is full circumference at 0% and 0 at 100%', () => {
    const c = 2 * Math.PI * 98;
    expect(dashOffset(0, 98)).toBeCloseTo(c);
    expect(dashOffset(1, 98)).toBeCloseTo(0);
    expect(dashOffset(0.5, 98)).toBeCloseTo(c / 2);
  });
});

describe('ProgressRing', () => {
  it('renders the centered label', () => {
    const { getByText } = render(<ProgressRing progress={0.5} label="1:04" sublabel="of 1:00" color="#fbbf24" />);
    expect(getByText('1:04')).toBeInTheDocument();
    expect(getByText('of 1:00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- design-system/format design-system/ring`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement format, ProgressRing, PhaseBadge**

Create `src/ui/design-system/format.ts`:
```typescript
export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
```

Create `src/ui/design-system/ProgressRing.tsx`:
```tsx
export function dashOffset(progress: number, radius: number): number {
  const c = 2 * Math.PI * radius;
  return c * (1 - Math.min(1, Math.max(0, progress)));
}

export function ProgressRing({
  progress, label, sublabel, color,
}: { progress: number; label: string; sublabel?: string; color: string }) {
  const r = 98;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-56 w-56">
      <svg width="224" height="224" viewBox="0 0 224 224" className="-rotate-90">
        <circle cx="112" cy="112" r={r} fill="none" stroke="var(--border)" strokeWidth="12" />
        <circle
          cx="112" cy="112" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={dashOffset(progress, r)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-bold tabular-nums">{label}</div>
        {sublabel && <div className="text-xs uppercase tracking-widest text-[color:var(--text-dim)]">{sublabel}</div>}
      </div>
    </div>
  );
}
```

Create `src/ui/design-system/PhaseBadge.tsx`:
```tsx
import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';

export const PHASE_COLOR: Record<RunnerPhase, string> = {
  breatheUp: 'var(--teal)',
  hold: 'var(--warn)',
  recover: 'var(--success)',
  done: 'var(--cyan)',
};

const LABEL: Record<RunnerPhase, string> = {
  breatheUp: 'Breathe up', hold: 'Hold', recover: 'Recover', done: 'Done',
};

export function PhaseBadge({ phase }: { phase: RunnerPhase }) {
  return (
    <div
      className="text-center text-xs uppercase tracking-[0.16em]"
      style={{ color: PHASE_COLOR[phase] }}
    >
      {LABEL[phase]}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- design-system/format design-system/ring`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add ProgressRing, PhaseBadge, and time formatting"
```

---

### Task 6: TabBar and app shell/routing

**Files:**
- Create: `src/ui/design-system/TabBar.tsx`
- Create: `src/ui/app/AppShell.tsx`
- Create: `src/ui/app/routes.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`
- Test: `src/ui/app/routes.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/app/routes.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from './services';
import { AppProviders } from './stores';
import { AppRoutes } from './routes';

function renderAt(path: string) {
  return render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

describe('routing', () => {
  it('renders the Settings screen at /settings', async () => {
    renderAt('/settings');
    await waitFor(() => expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- app/routes`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement TabBar, shell, routes, and entry**

Create `src/ui/design-system/TabBar.tsx`:
```tsx
import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', icon: '🏠', label: 'Home' },
  { to: '/stats', icon: '📊', label: 'Stats' },
  { to: '/train', icon: '🎯', label: 'Train' },
  { to: '/settings', icon: '⚙️', label: 'Settings' },
];

export function TabBar() {
  return (
    <nav className="flex justify-around border-t border-[color:var(--border)] bg-surface py-2">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 text-[11px] ${isActive ? 'text-[color:var(--cyan)]' : 'text-[color:var(--text-mute)]'}`
          }
        >
          <span className="text-lg">{t.icon}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

Create `src/ui/app/AppShell.tsx`:
```tsx
import type { ReactNode } from 'react';
import { TabBar } from '../design-system/TabBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-5 py-4">{children}</main>
      <TabBar />
    </div>
  );
}
```

Create `src/ui/app/routes.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';
import { HomeScreen } from '../screens/HomeScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { TrainScreen } from '../screens/TrainScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { RunnerScreen } from '../screens/RunnerScreen';
import { BaselineScreen } from '../screens/BaselineScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ProgramScreen } from '../screens/ProgramScreen';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/baseline" element={<BaselineScreen />} />
      <Route path="/runner" element={<RunnerScreen />} />
      <Route path="/" element={<AppShell><HomeScreen /></AppShell>} />
      <Route path="/stats" element={<AppShell><StatsScreen /></AppShell>} />
      <Route path="/train" element={<AppShell><TrainScreen /></AppShell>} />
      <Route path="/program" element={<AppShell><ProgramScreen /></AppShell>} />
      <Route path="/settings" element={<AppShell><SettingsScreen /></AppShell>} />
    </Routes>
  );
}
```

Replace `src/App.tsx`:
```tsx
import { BrowserRouter } from 'react-router-dom';
import { ServicesProvider } from './ui/app/services';
import { AppProviders } from './ui/app/stores';
import { AppRoutes } from './ui/app/routes';

export default function App() {
  return (
    <ServicesProvider>
      <AppProviders>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
    </ServicesProvider>
  );
}
```

Ensure `src/main.tsx` imports `./index.css` and renders `<App />` (the Vite default already does; keep it).

- [ ] **Step 4: Create minimal screen stubs so routing compiles**

Create each of these files with a heading so the app compiles; they are fleshed out in later tasks:
`src/ui/screens/HomeScreen.tsx`, `StatsScreen.tsx`, `TrainScreen.tsx`, `SettingsScreen.tsx`, `RunnerScreen.tsx`, `BaselineScreen.tsx`, `OnboardingScreen.tsx`, `ProgramScreen.tsx`. Example for Settings:
```tsx
export function SettingsScreen() {
  return <h2 className="text-2xl font-bold">Settings</h2>;
}
```
Use the same shape for the others (`HomeScreen`→"Home", etc.), exporting a named component matching the import.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- app/routes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add tab bar, app shell, routing, and screen stubs"
```

---

### Task 7: Onboarding screen with mandatory safety gate

**Files:**
- Modify: `src/ui/screens/OnboardingScreen.tsx`
- Test: `src/ui/screens/OnboardingScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/OnboardingScreen.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingScreen } from './OnboardingScreen';

function renderScreen() {
  return render(<MemoryRouter><OnboardingScreen /></MemoryRouter>);
}

describe('OnboardingScreen', () => {
  it('keeps continue disabled until the safety disclaimer is acknowledged', async () => {
    renderScreen();
    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    expect(cont).toBeEnabled();
  });

  it('shows the never-in-water warning', () => {
    renderScreen();
    expect(screen.getByText(/never.*water.*alone/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- OnboardingScreen`
Expected: FAIL (stub has no checkbox).

- [ ] **Step 3: Implement the onboarding screen**

Replace `src/ui/screens/OnboardingScreen.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';

export function OnboardingScreen() {
  const [acked, setAcked] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="text-3xl font-bold">Apnea Trainer</h1>
      <p className="text-[color:var(--text-dim)]">
        Dry static apnea training to build your breath-hold for spearfishing.
      </p>
      <Card className="border-[color:var(--danger)]">
        <h2 className="mb-2 font-semibold text-[color:var(--danger)]">Safety first</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--text-dim)]">
          <li>Train on <strong>dry land only</strong>. Never in or near water alone.</li>
          <li>No hyperventilation — it hides the urge to breathe and raises blackout risk.</li>
          <li>Stop any time you feel unwell. This app is not medical advice.</li>
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} aria-label="I understand: dry land only, never in water alone" />
          I understand and will train on dry land only.
        </label>
      </Card>
      <Button disabled={!acked} onClick={() => navigate('/baseline')}>Continue</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- OnboardingScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add onboarding screen with mandatory safety gate"
```

---

### Task 8: Baseline screen (guided Max STA)

**Files:**
- Modify: `src/ui/screens/BaselineScreen.tsx`
- Test: `src/ui/screens/BaselineScreen.test.tsx`

The screen guides two timed max holds (count-up), lets the user mark first contractions, records attempts, then calls `recordBaseline` and navigates home.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/BaselineScreen.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders, useAppStore } from '../app/stores';
import { BaselineScreen } from './BaselineScreen';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter>{children}</MemoryRouter>
      </AppProviders>
    </ServicesProvider>
  );
}

describe('BaselineScreen', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('counts up while holding and records an attempt on stop', async () => {
    const user = userEvent.setup();
    render(<Wrapper><BaselineScreen /></Wrapper>);
    await user.click(screen.getByRole('button', { name: /start hold/i }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/0:0[23]/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(screen.getByText(/attempt 1/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- BaselineScreen`
Expected: FAIL (stub has no controls).

- [ ] **Step 3: Implement the baseline screen**

Replace `src/ui/screens/BaselineScreen.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { ProgressRing } from '../design-system/ProgressRing';
import { formatMMSS } from '../design-system/format';
import { useCountUp } from '../hooks/useCountUp';
import { useAppStore } from '../app/stores';

export function BaselineScreen() {
  const navigate = useNavigate();
  const record = useAppStore((s) => s.recordBaseline);
  const { seconds, running, start, stop, reset } = useCountUp();
  const [attempts, setAttempts] = useState<number[]>([]);
  const [firstContraction, setFirstContraction] = useState<number | null>(null);

  function onStop() {
    stop();
    setAttempts((a) => [...a, seconds]);
    reset();
  }

  async function finish() {
    await record(attempts, firstContraction);
    navigate('/');
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-5 px-6 py-6">
      <h2 className="text-2xl font-bold">Baseline · Max hold</h2>
      <p className="text-sm text-[color:var(--text-dim)]">
        Relax, take a few calm breaths (no hyperventilation), then hold as long as is comfortable.
        Do two attempts with full recovery between.
      </p>
      <ProgressRing progress={0} label={formatMMSS(seconds)} sublabel={running ? 'holding' : 'ready'} color="var(--teal)" />
      {running && firstContraction === null && (
        <Button variant="ghost" onClick={() => setFirstContraction(seconds)}>Mark first contraction</Button>
      )}
      {!running
        ? <Button onClick={start}>Start hold</Button>
        : <Button variant="danger" onClick={onStop}>Stop</Button>}
      <Card>
        {attempts.length === 0
          ? <p className="text-sm text-[color:var(--text-mute)]">No attempts yet.</p>
          : attempts.map((a, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>Attempt {i + 1}</span><span className="tabular-nums">{formatMMSS(a)}</span>
              </div>
            ))}
      </Card>
      <Button disabled={attempts.length < 1} onClick={finish}>Save baseline</Button>
    </div>
  );
}
```

- [ ] **Step 4: Create the count-up hook it depends on**

Create `src/ui/hooks/useCountUp.ts`:
```typescript
import { useEffect, useRef, useState } from 'react';

export function useCountUp() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      return () => clearInterval(ref.current);
    }
  }, [running]);

  return {
    seconds,
    running,
    start: () => setRunning(true),
    stop: () => setRunning(false),
    reset: () => setSeconds(0),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- BaselineScreen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add guided baseline (Max STA) screen"
```

---

### Task 9: Session timer hook

**Files:**
- Create: `src/ui/hooks/useSessionTimer.ts`
- Test: `src/ui/hooks/useSessionTimer.test.ts`

Drives the runner: for a given `SessionPlan`, sequences breatheUp → hold → recover per round, counting down phase durations, invoking cue callbacks at phase transitions. Hold uses the round's `targetHoldSec` as a reference (count-up allowed past target); recover uses the next round's `restBeforeSec`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/hooks/useSessionTimer.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionTimer } from './useSessionTimer';
import { generateCo2Table } from '../../domain/apnea/tableGenerator';

describe('useSessionTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts in breatheUp and counts down', () => {
    const plan = generateCo2Table(200, 0);
    const { result } = renderHook(() => useSessionTimer(plan, { breatheUpSec: 3 }));
    act(() => result.current.begin());
    expect(result.current.phase).toBe('breatheUp');
    expect(result.current.remaining).toBe(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(2);
  });

  it('transitions from breatheUp to hold when the countdown ends', () => {
    const plan = generateCo2Table(200, 0);
    const onPhase = vi.fn();
    const { result } = renderHook(() => useSessionTimer(plan, { breatheUpSec: 1, onPhaseChange: onPhase }));
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.phase).toBe('hold');
    expect(onPhase).toHaveBeenCalledWith('hold');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useSessionTimer`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

Create `src/ui/hooks/useSessionTimer.ts`:
```typescript
import { useEffect, useRef, useState } from 'react';
import type { SessionPlan } from '../../domain/models/types';
import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';

interface Options {
  breatheUpSec?: number;
  onPhaseChange?: (phase: RunnerPhase) => void;
  onTick?: (phase: RunnerPhase, remaining: number) => void;
}

export function useSessionTimer(plan: SessionPlan, opts: Options = {}) {
  const breatheUpSec = opts.breatheUpSec ?? APNEA_DEFAULTS.breatheUpSec;
  const [roundIndex, setRoundIndex] = useState(0);
  const [phase, setPhase] = useState<RunnerPhase>('breatheUp');
  const [remaining, setRemaining] = useState(breatheUpSec);
  const [active, setActive] = useState(false);
  const holdElapsed = useRef(0);

  function toPhase(next: RunnerPhase, seconds: number) {
    setPhase(next);
    setRemaining(seconds);
    opts.onPhaseChange?.(next);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        const next = r - 1;
        opts.onTick?.(phase, Math.max(0, next));
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [active, phase]);

  useEffect(() => {
    if (!active || remaining > 0) return;
    if (phase === 'breatheUp') {
      holdElapsed.current = 0;
      toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999);
    }
    if (phase === 'recover') {
      toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999);
    }
  }, [remaining, active, phase, roundIndex]);

  return {
    roundIndex,
    phase,
    remaining,
    begin: () => { setActive(true); toPhase('breatheUp', breatheUpSec); },
    // advanceHoldToRecover / nextRound are driven by the Runner screen on user tap.
    endHold: () => {
      const nextIdx = roundIndex + 1;
      if (nextIdx >= plan.rounds.length) { setActive(false); toPhase('done', 0); return; }
      setRoundIndex(nextIdx);
      toPhase('recover', plan.rounds[nextIdx].restBeforeSec);
    },
    recoverToNextHold: () => toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999),
    stop: () => setActive(false),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useSessionTimer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add session timer hook with phase sequencing"
```

---

### Task 10: Runner screen

**Files:**
- Modify: `src/ui/screens/RunnerScreen.tsx`
- Test: `src/ui/screens/RunnerScreen.test.tsx`

Composes the timer hook, `ProgressRing`, `PhaseBadge`, contraction tap, and tap-out. Acquires wake lock on mount and releases on unmount; fires cues via services. On finish, builds the `Session` from the runner store and calls `completeSession`, then navigates to Summary.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/RunnerScreen.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { RunnerScreen } from './RunnerScreen';
import { noopWakeLock } from '../../infrastructure/device/noopServices';

it('acquires a wake lock when the runner mounts', async () => {
  const acquire = vi.fn(async () => {});
  render(
    <ServicesProvider value={{ wakeLock: { ...noopWakeLock, acquire } }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{ pathname: '/runner', state: { plan: { type: 'CO2', rounds: [{ index: 0, targetHoldSec: 60, restBeforeSec: 0 }] }, difficultyLevel: 0 } }]}>
          <RunnerScreen />
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  await waitFor(() => expect(acquire).toHaveBeenCalled());
  expect(screen.getByText(/breathe up/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- RunnerScreen`
Expected: FAIL (stub renders nothing relevant).

- [ ] **Step 3: Implement the runner screen**

Replace `src/ui/screens/RunnerScreen.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SessionPlan } from '../../domain/models/types';
import { ProgressRing } from '../design-system/ProgressRing';
import { PhaseBadge, PHASE_COLOR } from '../design-system/PhaseBadge';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { useServices } from '../app/services';
import { useAppStore, useRunnerStore } from '../app/stores';

interface RunnerNavState { plan: SessionPlan; difficultyLevel: number; }

export function RunnerScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = location.state as RunnerNavState | null;
  const { wakeLock, cues } = useServices();
  const runner = useRunnerStore((s) => s);
  const complete = useAppStore((s) => s.completeSession);
  const [contractions, setContractions] = useState(0);

  const plan = nav?.plan ?? { type: 'CO2', rounds: [] };
  const timer = useSessionTimer(plan, {
    onPhaseChange: (p) => { cues.speak(p); cues.beep(); },
  });

  useEffect(() => {
    wakeLock.acquire();
    runner.start(plan, nav?.difficultyLevel ?? 0);
    timer.begin();
    return () => { wakeLock.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tapOut() {
    runner.recordRound(0, contractions, true);
    setContractions(0);
    timer.endHold();
  }
  function endHold() {
    runner.recordRound(plan.rounds[timer.roundIndex].targetHoldSec, contractions, false);
    setContractions(0);
    timer.endHold();
  }

  if (timer.phase === 'done') {
    const session = runner.finish('normal');
    complete(session).then(() => navigate('/summary', { state: { session } }));
    return <p className="p-6">Saving…</p>;
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <div className="flex justify-between text-xs text-[color:var(--text-dim)]">
        <span>{plan.type} Table</span>
        <span>Round {timer.roundIndex + 1} / {plan.rounds.length}</span>
      </div>
      <PhaseBadge phase={timer.phase} />
      <ProgressRing
        progress={0.5}
        label={formatMMSS(timer.remaining)}
        sublabel={timer.phase === 'hold' ? `target ${formatMMSS(plan.rounds[timer.roundIndex]?.targetHoldSec ?? 0)}` : undefined}
        color={PHASE_COLOR[timer.phase]}
      />
      {timer.phase === 'hold' && (
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => setContractions((c) => c + 1)}>
            Contraction · {contractions}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={endHold}>End hold</Button>
        </div>
      )}
      <Button variant="danger" onClick={tapOut}>I tapped out</Button>
    </div>
  );
}
```

- [ ] **Step 4: Add the `/summary` route and Summary screen**

Create `src/ui/screens/SummaryScreen.tsx`:
```tsx
import { useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '../../domain/models/types';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';

export function SummaryScreen() {
  const navigate = useNavigate();
  const session = (useLocation().state as { session: Session } | null)?.session;
  if (!session) return <p className="p-6">No session data. <Button onClick={() => navigate('/')}>Home</Button></p>;
  const best = session.rounds.reduce((m, r) => Math.max(m, r.achievedHoldSec), 0);
  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <h2 className="text-2xl font-bold">Session complete</h2>
      <Card>
        <div className="flex justify-between text-sm"><span>Type</span><span>{session.type}</span></div>
        <div className="flex justify-between text-sm"><span>Completed rounds</span><span>{session.completedRounds}/{session.rounds.length}</span></div>
        <div className="flex justify-between text-sm"><span>Tap-outs</span><span>{session.tapOuts}</span></div>
        <div className="flex justify-between text-sm"><span>Best hold</span><span className="tabular-nums">{formatMMSS(best)}</span></div>
      </Card>
      <Button onClick={() => navigate('/')}>Done</Button>
    </div>
  );
}
```
Add to `src/ui/app/routes.tsx` imports and a route:
```tsx
import { SummaryScreen } from '../screens/SummaryScreen';
// ...inside <Routes>:
<Route path="/summary" element={<AppShell><SummaryScreen /></AppShell>} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- RunnerScreen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add session runner and summary screens"
```

---

### Task 11: Home and Train screens

**Files:**
- Modify: `src/ui/screens/HomeScreen.tsx`, `src/ui/screens/TrainScreen.tsx`
- Test: `src/ui/screens/HomeScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/HomeScreen.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { HomeScreen } from './HomeScreen';

it('shows the personal-best stat card', async () => {
  render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter><HomeScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByText(/personal best/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- HomeScreen`
Expected: FAIL (stub only shows "Home").

- [ ] **Step 3: Implement Home and Train**

Replace `src/ui/screens/HomeScreen.tsx`:
```tsx
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../design-system/StatCard';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { personalBestSec, weeklySessionCount, currentStreakDays } from '../../application/stats';
import { startTodaySession } from '../../application/usecases/startTodaySession';

export function HomeScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  const today = startTodaySession(state, now);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-[color:var(--text-dim)]">Ready to train?</div>
        <h2 className="text-xl font-bold">Apnea Trainer</h2>
      </div>
      <StatCard label="Personal best · static" value={formatMMSS(personalBestSec(state))} accent="var(--cyan)" />
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${weeklySessionCount(state, now)}`} />
        <StatCard label="Streak" value={`${currentStreakDays(state, now)}d`} />
      </div>
      <Card>
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
        <div className="mt-1 text-lg font-semibold">
          {today.needsBaseline ? 'Measure your baseline' : today.decision.dayType}
        </div>
        {today.decision.reason && <div className="text-sm text-[color:var(--text-dim)]">{today.decision.reason}</div>}
      </Card>
      <Button onClick={() => navigate(today.needsBaseline ? '/baseline' : '/train')}>
        {today.needsBaseline ? 'Start baseline' : 'Train'}
      </Button>
    </div>
  );
}
```

Replace `src/ui/screens/TrainScreen.tsx`:
```tsx
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { startTodaySession } from '../../application/usecases/startTodaySession';

export function TrainScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const today = startTodaySession(state, clock.now());

  if (today.needsBaseline) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">Train</h2>
        <Card><p className="text-sm">Measure your baseline first.</p></Card>
        <Button onClick={() => navigate('/baseline')}>Start baseline</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Today · {today.decision.dayType}</h2>
      {today.decision.deload && <Card><p className="text-sm text-[color:var(--warn)]">Eased session after time off.</p></Card>}
      {today.decision.suggestRetest && <Card><p className="text-sm text-[color:var(--warn)]">Consider retesting your baseline.</p></Card>}
      {today.decision.blocked ? (
        <>
          <Card><p className="text-sm">{today.decision.reason}</p></Card>
          <Button
            variant="ghost"
            disabled={!today.plan}
            onClick={() => navigate('/runner', { state: { plan: today.plan, difficultyLevel: today.appliedDifficulty } })}
          >
            Train anyway
          </Button>
        </>
      ) : (
        <Button
          disabled={!today.plan}
          onClick={() => navigate('/runner', { state: { plan: today.plan, difficultyLevel: today.appliedDifficulty } })}
        >
          Start {today.decision.dayType} session
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- HomeScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add Home and Train screens with soft-enforce gating"
```

---

### Task 12: Stats, Program, and Settings screens

**Files:**
- Modify: `src/ui/screens/StatsScreen.tsx`, `ProgramScreen.tsx`, `SettingsScreen.tsx`
- Test: `src/ui/screens/SettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/SettingsScreen.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders, useAppStore } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';

it('toggles voice cues and persists', async () => {
  render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter><SettingsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  const toggle = await screen.findByRole('checkbox', { name: /voice cues/i });
  expect(toggle).toBeChecked();
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- SettingsScreen`
Expected: FAIL (stub has no toggle).

- [ ] **Step 3: Implement the three screens**

Replace `src/ui/screens/StatsScreen.tsx`:
```tsx
import { StatCard } from '../design-system/StatCard';
import { Card } from '../design-system/Card';
import { formatMMSS } from '../design-system/format';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { personalBestSec, weeklySessionCount, currentStreakDays, adherencePct } from '../../application/stats';

export function StatsScreen() {
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Stats</h2>
      <StatCard label="Personal best" value={formatMMSS(personalBestSec(state))} accent="var(--cyan)" />
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${weeklySessionCount(state, now)}`} />
        <StatCard label="Streak" value={`${currentStreakDays(state, now)}d`} />
        <StatCard label="Adherence" value={`${adherencePct(state, now)}%`} />
        <StatCard label="Sessions" value={`${state.sessions.length}`} />
      </div>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Recent sessions</div>
        {state.sessions.slice(-8).reverse().map((s) => (
          <div key={s.id} className="flex justify-between border-b border-[color:var(--border)] py-1 text-sm last:border-0">
            <span>{s.type}</span>
            <span className="tabular-nums">{s.completedRounds}/{s.rounds.length} · {s.tapOuts} tap-outs</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
```

Replace `src/ui/screens/ProgramScreen.tsx`:
```tsx
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';

export function ProgramScreen() {
  const { clock, ics } = useServices();
  const state = useAppStore((s) => s.state);
  const days = state.courseState.template.days;
  const position = state.courseState.position % days.length;

  function exportIcs() {
    const content = ics.build(state.settings.reminderTimes, state.courseState.template, clock.now());
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'apnea-training.ics'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Program</h2>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">This week</div>
        <ol className="space-y-1 text-sm">
          {days.map((d, i) => (
            <li key={i} className={`flex justify-between ${i === position ? 'font-semibold text-[color:var(--cyan)]' : ''}`}>
              <span>Day {i + 1}</span><span>{d}{i === position ? ' · today' : ''}</span>
            </li>
          ))}
        </ol>
      </Card>
      <Button variant="ghost" onClick={exportIcs}>Export reminders (.ics)</Button>
    </div>
  );
}
```

Replace `src/ui/screens/SettingsScreen.tsx`:
```tsx
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { exportJson, importJson } from '../../infrastructure/persistence/jsonBackup';

export function SettingsScreen() {
  const state = useAppStore((s) => s.state);
  const update = useAppStore((s) => s.updateSettings);
  const { settings } = state;

  const toggle = (key: 'voiceCues' | 'beepCues' | 'vibrationCues', label: string) => (
    <label className="flex items-center justify-between py-1 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        aria-label={label}
        checked={settings[key]}
        onChange={(e) => update({ [key]: e.target.checked })}
      />
    </label>
  );

  function doExport() {
    const url = URL.createObjectURL(new Blob([exportJson(state)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'apnea-backup.json'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Settings</h2>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Cues</div>
        {toggle('voiceCues', 'Voice cues')}
        {toggle('beepCues', 'Beep cues')}
        {toggle('vibrationCues', 'Vibration cues')}
      </Card>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Data</div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={doExport}>Export backup</Button>
          <label className="flex-1 cursor-pointer rounded-2xl bg-surface px-5 py-3 text-center font-semibold" >
            Import
            <input
              type="file" accept="application/json" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const restored = importJson(await file.text());
                await update(restored.settings); // persists settings; full-state import handled by repository seed in M4 hardening
              }}
            />
          </label>
        </div>
      </Card>
      <Card className="border-[color:var(--danger)]">
        <p className="text-xs text-[color:var(--text-dim)]">
          Dry land only. Never train in or near water alone. No hyperventilation.
        </p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- SettingsScreen`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, build, commit**

Run: `npm run test`
Expected: all PASS.
Run: `npx tsc --noEmit`
Expected: clean.
Run: `npm run build`
Expected: succeeds.
```bash
git add -A
git commit -m "feat(ui): add Stats, Program, and Settings screens"
```

---

## Milestone 3 Done-Definition
- All eight screens render and route; bottom tab bar works.
- Onboarding safety gate blocks progress until acknowledged.
- Runner drives phases, records rounds, and persists a completed session.
- Design-system primitives (Button, Card, StatCard, ProgressRing, PhaseBadge, TabBar) are reusable and token-driven.
- `npm run test` green; `npx tsc --noEmit` clean; `npm run build` succeeds.

> **Note for M4:** the Settings "Import" currently restores only settings. Milestone 4 adds full-state import via a repository `seed(state)` path and wires real device services (wake lock, cues, notifications).
