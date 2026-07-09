# Apnea Trainer — Milestone 4: Platform Services & PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the app into an installable, offline-capable PWA with reliable update delivery, and replace the no-op device services with real implementations (wake lock, audio/vibration cues, local notifications), plus full-state backup import and a DigitalOcean App Platform CI/CD pipeline.

**Architecture:** Real service implementations live in `infrastructure/device` and `infrastructure/notifications`, implementing the M1 ports. A production `Services` factory wires them into the `ServicesProvider` from M3. `vite-plugin-pwa` (Workbox) provides the service worker with `registerType: 'prompt'` and `updateViaCache: 'none'`, so updates propagate regardless of CDN caching and never reload mid-session. Deployment is a GitHub Actions workflow that tests, then triggers a DO App Platform deploy.

**Tech Stack:** vite-plugin-pwa (Workbox), nosleep.js, Web Speech / Web Audio / Vibration APIs, doctl, GitHub Actions. Depends on Milestones 1–3.

**Prerequisite:** Milestones 1–3 complete and green.

---

### Task 1: Real WakeLockService with NoSleep fallback

**Files:**
- Create: `src/infrastructure/device/wakeLock.ts`
- Test: `src/infrastructure/device/wakeLock.test.ts`

- [ ] **Step 1: Install the fallback dependency**

Run: `npm install nosleep.js`

- [ ] **Step 2: Write the failing test**

Create `src/infrastructure/device/wakeLock.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createWakeLock } from './wakeLock';

describe('createWakeLock', () => {
  it('uses the Screen Wake Lock API when available', async () => {
    const release = vi.fn();
    const request = vi.fn(async () => ({ release, addEventListener() {} }));
    const nav = { wakeLock: { request } } as unknown as Navigator;
    const wl = createWakeLock(nav, () => ({ enable: vi.fn(), disable: vi.fn() }));
    await wl.acquire();
    expect(request).toHaveBeenCalledWith('screen');
    await wl.release();
    expect(release).toHaveBeenCalled();
  });

  it('falls back to NoSleep when the API is missing', async () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const nav = {} as Navigator;
    const wl = createWakeLock(nav, () => ({ enable, disable }));
    await wl.acquire();
    expect(enable).toHaveBeenCalled();
    await wl.release();
    expect(disable).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- device/wakeLock`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the wake lock**

Create `src/infrastructure/device/wakeLock.ts`:
```typescript
import type { WakeLockService } from '../../domain/ports/wakeLockService';

interface NoSleepLike { enable(): void; disable(): void; }
type SentinelLike = { release(): Promise<void> | void; addEventListener?: (t: string, cb: () => void) => void };

export function createWakeLock(
  nav: Navigator = navigator,
  makeNoSleep: () => NoSleepLike = () => {
    // Lazy import keeps nosleep.js out of the critical path.
    const NoSleep = require('nosleep.js');
    return new NoSleep();
  },
): WakeLockService {
  let sentinel: SentinelLike | null = null;
  let noSleep: NoSleepLike | null = null;
  const supported = 'wakeLock' in nav && typeof (nav as Navigator & { wakeLock?: { request?: unknown } }).wakeLock?.request === 'function';

  async function acquire(): Promise<void> {
    if (supported) {
      sentinel = await (nav as Navigator & { wakeLock: { request(t: string): Promise<SentinelLike> } }).wakeLock.request('screen');
      return;
    }
    noSleep = makeNoSleep();
    noSleep.enable();
  }

  return {
    async acquire() { await acquire(); },
    async release() {
      if (sentinel) { await sentinel.release(); sentinel = null; }
      if (noSleep) { noSleep.disable(); noSleep = null; }
    },
  };
}
```

Note: the runtime uses `import NoSleep from 'nosleep.js'`. If `require` is unavailable in the bundle, replace the default `makeNoSleep` with a module-scope `import NoSleep from 'nosleep.js'` at the top of the file and `() => new NoSleep()`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- device/wakeLock`
Expected: PASS.

- [ ] **Step 6: Add focus re-acquisition wrapper**

Create `src/infrastructure/device/wakeLockWithReacquire.ts`:
```typescript
import type { WakeLockService } from '../../domain/ports/wakeLockService';

export function withReacquire(inner: WakeLockService, doc: Document = document): WakeLockService {
  let held = false;
  const onVisible = () => { if (held && doc.visibilityState === 'visible') void inner.acquire(); };
  return {
    async acquire() { held = true; await inner.acquire(); doc.addEventListener('visibilitychange', onVisible); },
    async release() { held = false; doc.removeEventListener('visibilitychange', onVisible); await inner.release(); },
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(infra): add real wake lock with NoSleep fallback and re-acquire"
```

---

### Task 2: Real CueService (speech, beep, vibration)

**Files:**
- Create: `src/infrastructure/device/cues.ts`
- Test: `src/infrastructure/device/cues.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/device/cues.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createCues } from './cues';

describe('createCues', () => {
  it('speaks via speechSynthesis when available', () => {
    const speak = vi.fn();
    const win = { speechSynthesis: { speak }, SpeechSynthesisUtterance: class { constructor(public text: string) {} } } as unknown as Window;
    createCues(win, {} as Navigator).speak('Hold');
    expect(speak).toHaveBeenCalled();
  });

  it('vibrates via navigator.vibrate when available', () => {
    const vibrate = vi.fn();
    const nav = { vibrate } as unknown as Navigator;
    createCues({} as Window, nav).vibrate([100, 50]);
    expect(vibrate).toHaveBeenCalledWith([100, 50]);
  });

  it('is a no-op when APIs are missing (does not throw)', () => {
    const cues = createCues({} as Window, {} as Navigator);
    expect(() => { cues.speak('x'); cues.beep(); cues.vibrate([10]); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- device/cues`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the cue service**

Create `src/infrastructure/device/cues.ts`:
```typescript
import type { CueService } from '../../domain/ports/cueService';

export function createCues(win: Window = window, nav: Navigator = navigator): CueService {
  let audioCtx: AudioContext | null = null;
  return {
    speak(text: string) {
      const synth = (win as Window & { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
      const Utter = (win as Window & { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
      if (!synth || !Utter) return;
      synth.speak(new Utter(text));
    },
    beep() {
      const Ctx = (win as Window & { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctx) return;
      audioCtx ??= new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.1;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    },
    vibrate(pattern: number[]) {
      if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- device/cues`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(infra): add real cue service (speech, beep, vibration)"
```

---

### Task 3: Settings-aware cue facade and runner wiring

**Files:**
- Create: `src/ui/hooks/useCues.ts`
- Modify: `src/ui/screens/RunnerScreen.tsx`
- Test: `src/ui/hooks/useCues.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/hooks/useCues.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { useCues } from './useCues';
import { noopCues } from '../../infrastructure/device/noopServices';

function wrap(cues = noopCues) {
  return ({ children }: { children: React.ReactNode }) => (
    <ServicesProvider value={{ cues }}>
      <AppProviders>{children}</AppProviders>
    </ServicesProvider>
  );
}

it('gates speak on the voiceCues setting (default on)', () => {
  const speak = vi.fn();
  const { result } = renderHook(() => useCues(), { wrapper: wrap({ ...noopCues, speak }) });
  result.current.phaseCue('Hold');
  expect(speak).toHaveBeenCalledWith('Hold');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useCues`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the facade**

Create `src/ui/hooks/useCues.ts`:
```typescript
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';

export function useCues() {
  const { cues } = useServices();
  const settings = useAppStore((s) => s.state.settings);
  return {
    phaseCue(text: string) {
      if (settings.voiceCues) cues.speak(text);
      if (settings.beepCues) cues.beep();
      if (settings.vibrationCues) cues.vibrate([120]);
    },
  };
}
```

- [ ] **Step 4: Wire it into the runner**

In `src/ui/screens/RunnerScreen.tsx`, replace the direct `cues` usage:
- Remove `const { wakeLock, cues } = useServices();` → `const { wakeLock } = useServices();`
- Add `import { useCues } from '../hooks/useCues';` and `const cue = useCues();`
- Change the timer options to:
```tsx
const timer = useSessionTimer(plan, {
  onPhaseChange: (p) => cue.phaseCue(p),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- useCues`
Expected: PASS. Also run `npm run test -- RunnerScreen` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add settings-aware cue facade and wire runner"
```

---

### Task 4: Real NotificationService

**Files:**
- Create: `src/infrastructure/notifications/localNotifications.ts`
- Test: `src/infrastructure/notifications/localNotifications.test.ts`

Local notifications are best-effort (foreground/where supported). Reliable cross-platform reminders come from the `.ics` export built in M3. This service detects support and requests permission; scheduling is a thin wrapper that stores intent and shows immediate confirmation notifications (no push server).

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/notifications/localNotifications.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createLocalNotifications } from './localNotifications';

describe('createLocalNotifications', () => {
  it('reports unsupported when Notification is absent', () => {
    const svc = createLocalNotifications({} as Window);
    expect(svc.isSupported()).toBe(false);
  });

  it('requests permission and returns granted', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    const win = { Notification: Object.assign(function () {}, { requestPermission, permission: 'default' }) } as unknown as Window;
    const svc = createLocalNotifications(win);
    expect(svc.isSupported()).toBe(true);
    expect(await svc.requestPermission()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- localNotifications`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Create `src/infrastructure/notifications/localNotifications.ts`:
```typescript
import type { NotificationService } from '../../domain/ports/notificationService';

export function createLocalNotifications(win: Window = window): NotificationService {
  const Ctor = (win as Window & { Notification?: typeof Notification }).Notification;
  return {
    isSupported: () => typeof Ctor === 'function',
    async requestPermission() {
      if (typeof Ctor !== 'function') return false;
      const result = await Ctor.requestPermission();
      return result === 'granted';
    },
    async scheduleDailyReminders(times: string[]) {
      if (typeof Ctor !== 'function' || Ctor.permission !== 'granted') return;
      // Best-effort confirmation; reliable scheduling is delegated to the .ics export.
      new Ctor('Apnea Trainer', { body: `Reminders set for ${times.join(', ') || 'no times'}` });
    },
    async cancelAll() { /* no persistent local schedule to cancel without a push server */ },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- localNotifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(infra): add best-effort local notification service"
```

---

### Task 5: Full-state import (repository seed) and app-store replaceState

**Files:**
- Modify: `src/application/stores/appStore.ts`
- Modify: `src/ui/screens/SettingsScreen.tsx`
- Test: `src/application/stores/appStore.replace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/application/stores/appStore.replace.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createAppStore } from './appStore';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';

function memoryRepo(): StateRepository & { saved: unknown[] } {
  let current = emptyAppState();
  const saved: unknown[] = [];
  return { saved, async getState() { return current; }, async setState(s) { current = s; saved.push(s); } };
}

it('replaceState persists a whole imported state', async () => {
  const repo = memoryRepo();
  const store = createAppStore(repo, () => 0);
  await store.getState().hydrate();
  const imported = emptyAppState();
  imported.settings.reminderTimes = ['07:30'];
  await store.getState().replaceState(imported);
  expect(store.getState().state.settings.reminderTimes).toEqual(['07:30']);
  expect(repo.saved.length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- appStore.replace`
Expected: FAIL (replaceState missing).

- [ ] **Step 3: Add replaceState to the store**

In `src/application/stores/appStore.ts`, add to the `AppStore` interface:
```typescript
  replaceState(state: AppState): Promise<void>;
```
and to the store body (next to the other actions):
```typescript
      async replaceState(next: AppState) {
        await commit(next);
      },
```

- [ ] **Step 4: Wire full-state import in Settings**

In `src/ui/screens/SettingsScreen.tsx`, replace the import `onChange` handler body:
```tsx
onChange={async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const restored = importJson(await file.text());
  await replaceState(restored);
}}
```
and add near the other hooks: `const replaceState = useAppStore((s) => s.replaceState);` (remove the old settings-only import line).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- appStore.replace`
Expected: PASS. Run `npm run test -- SettingsScreen` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): add full-state import via replaceState"
```

---

### Task 6: Production services factory and provider wiring

**Files:**
- Create: `src/infrastructure/device/productionServices.ts`
- Modify: `src/ui/app/services.tsx`
- Test: `src/infrastructure/device/productionServices.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/device/productionServices.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { productionServices } from './productionServices';

it('builds a full services bundle', () => {
  const s = productionServices();
  expect(typeof s.clock.now).toBe('function');
  expect(typeof s.wakeLock.acquire).toBe('function');
  expect(typeof s.cues.speak).toBe('function');
  expect(typeof s.notifications.isSupported).toBe('function');
  expect(typeof s.ics.build).toBe('function');
  expect(typeof s.repository.getState).toBe('function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- productionServices`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the factory**

Create `src/infrastructure/device/productionServices.ts`:
```typescript
import type { Services } from '../../ui/app/services';
import { systemClock } from './systemClock';
import { createWakeLock } from './wakeLock';
import { withReacquire } from './wakeLockWithReacquire';
import { createCues } from './cues';
import { createLocalNotifications } from '../notifications/localNotifications';
import { buildIcs } from '../notifications/icsExporter';
import { createIndexedDbRepository } from '../persistence/indexedDbRepository';

export function productionServices(): Services {
  return {
    clock: systemClock,
    wakeLock: withReacquire(createWakeLock()),
    cues: createCues(),
    notifications: createLocalNotifications(),
    ics: { build: buildIcs },
    repository: createIndexedDbRepository(),
  };
}
```

- [ ] **Step 4: Default the provider to production services**

In `src/ui/app/services.tsx`, change `defaultServices()` to delegate to the production factory while keeping test overrides working. Replace the body of `defaultServices` with:
```tsx
import { productionServices } from '../../infrastructure/device/productionServices';
// ...
function defaultServices(): Services {
  return productionServices();
}
```
Keep the `value` prop merge so tests can inject fakes (`{ ...defaultServices(), ...value }`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- productionServices`
Expected: PASS. Run full suite `npm run test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(infra): wire production device services into the provider"
```

---

### Task 7: PWA manifest, service worker, and update strategy

**Files:**
- Modify: `vite.config.ts`
- Create: `src/ui/pwa/useAppUpdate.ts`
- Create: `src/ui/pwa/UpdatePrompt.tsx`
- Modify: `src/App.tsx`, `index.html`
- Create: `public/icons/` (icon assets)
- Test: `src/ui/pwa/useAppUpdate.test.tsx`

- [ ] **Step 1: Install the PWA plugin**

Run: `npm install -D vite-plugin-pwa`

- [ ] **Step 2: Configure vite-plugin-pwa**

Replace `vite.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? 'dev'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Apnea Trainer',
        short_name: 'Apnea',
        description: 'Dry static apnea training for spearfishing',
        theme_color: '#05121c',
        background_color: '#05121c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

Delete `vitest.config.ts` (the test config now lives in `vite.config.ts`) or keep it — if kept, ensure it does not conflict. Prefer deleting it to avoid duplicate config.

- [ ] **Step 3: Add the `__APP_VERSION__` global type**

Create `src/vite-env-app.d.ts`:
```typescript
declare const __APP_VERSION__: string;
```

- [ ] **Step 4: Write the failing test for the update hook**

Create `src/ui/pwa/useAppUpdate.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { makeAppUpdate } from './useAppUpdate';

it('exposes needRefresh and applies the update when not in session', async () => {
  const updateSW = vi.fn(async () => {});
  const { getNeedRefresh, setNeedRefresh, apply } = makeAppUpdate(updateSW);
  act(() => setNeedRefresh(true));
  expect(getNeedRefresh()).toBe(true);
  await act(async () => { await apply(false); });
  expect(updateSW).toHaveBeenCalledWith(true);
});

it('defers the update while a session is active', async () => {
  const updateSW = vi.fn(async () => {});
  const { apply } = makeAppUpdate(updateSW);
  await act(async () => { await apply(true); }); // sessionActive = true
  expect(updateSW).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- useAppUpdate`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement the update hook and prompt**

Create `src/ui/pwa/useAppUpdate.ts`:
```typescript
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

// Pure, testable core.
export function makeAppUpdate(updateSW: (reload?: boolean) => Promise<void>) {
  let needRefresh = false;
  const listeners = new Set<() => void>();
  return {
    getNeedRefresh: () => needRefresh,
    setNeedRefresh: (v: boolean) => { needRefresh = v; listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
    async apply(sessionActive: boolean) {
      if (sessionActive) return; // never reload mid-session
      await updateSW(true);
    },
  };
}

export function useAppUpdate(sessionActive: boolean) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(reload?: boolean) => Promise<void>>();

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      // updateViaCache defaults to 'none' via the plugin, so sw.js is always revalidated.
      onNeedRefresh() { setNeedRefresh(true); },
    });
    setUpdate(() => updateSW);
    // Periodically check for a new deployment (hourly + on focus).
    const id = setInterval(() => { void updateSW?.(); }, 60 * 60 * 1000);
    const onFocus = () => { void updateSW?.(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);

  return {
    needRefresh,
    async apply() {
      if (sessionActive || !update) return;
      await update(true);
    },
    dismiss: () => setNeedRefresh(false),
  };
}
```

Create `src/ui/pwa/UpdatePrompt.tsx`:
```tsx
import { useRunnerStore } from '../app/stores';
import { useAppUpdate } from './useAppUpdate';
import { Button } from '../design-system/Button';

export function UpdatePrompt() {
  const phase = useRunnerStore((s) => s.phase);
  const sessionActive = phase !== 'done';
  const { needRefresh, apply, dismiss } = useAppUpdate(sessionActive);
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-0 bottom-16 z-50 mx-auto max-w-md px-4">
      <div className="flex items-center justify-between rounded-2xl border border-[color:var(--border)] bg-surface-2 p-3 text-sm">
        <span>New version available{sessionActive ? ' — will update after your session' : ''}.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={dismiss}>Later</Button>
          <Button disabled={sessionActive} onClick={apply}>Update</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Mount the prompt and add the PWA virtual-module type**

Create `src/pwa.d.ts`:
```typescript
declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
  }): (reload?: boolean) => Promise<void>;
}
```

In `src/App.tsx`, render `<UpdatePrompt />` inside `<BrowserRouter>` after `<AppRoutes />`:
```tsx
import { UpdatePrompt } from './ui/pwa/UpdatePrompt';
// ...
<BrowserRouter>
  <AppRoutes />
  <UpdatePrompt />
</BrowserRouter>
```

- [ ] **Step 8: Create placeholder icon assets**

Create the directory and generate simple square PNG icons (solid `#05121c` background with a cyan drop) at `public/icons/icon-192.png`, `icon-512.png`, and `icon-512-maskable.png`. Run:
```bash
mkdir -p public/icons
node -e "const s=require('fs');['192','512'].forEach(n=>s.copyFileSync('src/assets/react.svg','public/icons/placeholder-'+n+'.txt'))"
```
Then replace the placeholders with real PNGs exported from the design (192×192 and 512×512). The maskable icon must keep the drop within the safe area (center 80%).

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test -- useAppUpdate`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(pwa): add manifest, service worker, and prompt update strategy"
```

---

### Task 8: Show build version in Settings

**Files:**
- Modify: `src/ui/screens/SettingsScreen.tsx`
- Test: `src/ui/screens/SettingsScreen.version.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/SettingsScreen.version.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';

vi.stubGlobal('__APP_VERSION__', 'test-sha');

it('displays the build version', async () => {
  render(
    <ServicesProvider><AppProviders>
      <MemoryRouter><SettingsScreen /></MemoryRouter>
    </AppProviders></ServicesProvider>,
  );
  expect(await screen.findByText(/test-sha/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- SettingsScreen.version`
Expected: FAIL (version not shown).

- [ ] **Step 3: Add the version footer**

At the bottom of the returned JSX in `src/ui/screens/SettingsScreen.tsx`, before the closing `</div>`, add:
```tsx
<p className="pt-2 text-center text-xs text-[color:var(--text-mute)]">Version {__APP_VERSION__}</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- SettingsScreen.version`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): show build version in settings"
```

---

### Task 9: DigitalOcean App Platform spec

**Files:**
- Create: `.do/app.yaml`

- [ ] **Step 1: Create the app spec**

Create `.do/app.yaml`:
```yaml
name: apnea-trainer
region: fra
static_sites:
  - name: web
    github:
      repo: <your-gh-user>/apnea-trainer
      branch: main
      deploy_on_push: false   # deploys are triggered by the CI workflow after tests pass
    build_command: npm ci && npm run build
    output_dir: dist
    environment_slug: node-js
    catchall_document: index.html   # SPA fallback for client-side routing
    index_document: index.html
    envs:
      - key: VITE_APP_VERSION
        scope: BUILD_TIME
        value: ${_self.COMMIT_HASH}
```

Notes:
- `catchall_document: index.html` makes App Platform serve the SPA for unknown paths (client-side routes like `/settings`).
- App Platform serves assets through its managed CDN. PWA update correctness does **not** depend on host cache headers: the service worker is registered with `updateViaCache: 'none'` (vite-plugin-pwa default), so `sw.js` is always revalidated, and content-hashed assets are safe to cache indefinitely.
- Replace `<your-gh-user>` with the real GitHub owner and adjust `region` as desired.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore(deploy): add DigitalOcean App Platform static-site spec"
```

---

### Task 10: GitHub Actions CI/CD (test, build, deploy)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the CI workflow (runs on every PR and push)**

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run test
      - run: npm run build
```

- [ ] **Step 2: Create the deploy workflow (main only, after CI passes)**

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      - name: Trigger App Platform deployment
        run: doctl apps create-deployment ${{ secrets.DO_APP_ID }} --wait
```

- [ ] **Step 3: Document the required secrets**

Create `docs/deployment.md`:
```markdown
# Deployment

Static PWA hosted on DigitalOcean App Platform (static site component).

## One-time setup
1. Create the app from `.do/app.yaml`: `doctl apps create --spec .do/app.yaml`.
2. Note the returned app id.
3. In GitHub repo settings → Secrets and variables → Actions, add:
   - `DIGITALOCEAN_ACCESS_TOKEN` — a DO API token with write access.
   - `DO_APP_ID` — the App Platform app id.

## Flow
- Every push/PR runs **CI** (typecheck, tests, build).
- On a successful **CI** run on `main`, **Deploy** triggers `doctl apps create-deployment`,
  which builds from source on App Platform and publishes the new version.
- App Platform serves the new content-hashed assets and `sw.js`; clients pick up the
  update via the in-app prompt (never mid-session).
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Actions test gate and DO deploy workflow"
```

---

### Task 11: Route onboarding for first-run and final verification

**Files:**
- Modify: `src/ui/app/routes.tsx`
- Test: `src/ui/app/firstRun.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/app/firstRun.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from './services';
import { AppProviders } from './stores';
import { AppRoutes } from './routes';

it('redirects to onboarding when there is no baseline', async () => {
  render(
    <ServicesProvider><AppProviders>
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders></ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: /apnea trainer/i })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- firstRun`
Expected: FAIL (Home renders, not onboarding).

- [ ] **Step 3: Add a first-run redirect guard**

In `src/ui/app/routes.tsx`, wrap the `/` route element with a guard component:
```tsx
import { Navigate } from 'react-router-dom';
import { useServices } from './services';
import { useAppStore } from './stores';

function HomeOrOnboarding() {
  const state = useAppStore((s) => s.state);
  const hydrated = useAppStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (state.baselines.length === 0) return <Navigate to="/onboarding" replace />;
  return <AppShell><HomeScreen /></AppShell>;
}
```
and change the `/` route to `element={<HomeOrOnboarding />}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- firstRun`
Expected: PASS.

- [ ] **Step 5: Final verification — full suite, typecheck, build**

Run: `npm run test`
Expected: all PASS.
Run: `npx tsc --noEmit`
Expected: clean.
Run: `npm run build`
Expected: succeeds; `dist/` contains `sw.js`, `manifest.webmanifest`, hashed assets.

- [ ] **Step 6: Manual smoke test (documented, not automated)**

Run: `npm run build && npm run preview`
Then in the browser: install the PWA, run a short session (screen stays awake), toggle offline and confirm the app still loads, and verify the version string in Settings.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): gate first run to onboarding until baseline exists"
```

---

## Milestone 4 Done-Definition
- Installable PWA: manifest, icons, offline precache, `display: standalone`.
- Update delivery: `prompt` strategy with `updateViaCache: 'none'`, hourly/focus checks, never reloads mid-session.
- Real device services (wake lock + NoSleep fallback, speech/beep/vibration cues, best-effort notifications) wired via the production factory; cues respect settings.
- Full-state JSON backup import; build version shown in Settings.
- DigitalOcean App Platform spec + GitHub Actions pipeline (CI test gate → DO deploy).
- `npm run test` green; `npx tsc --noEmit` clean; `npm run build` succeeds; manual PWA smoke test passes.
