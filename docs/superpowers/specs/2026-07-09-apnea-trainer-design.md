# Apnea Trainer — Design Specification

**Date:** 2026-07-09
**Status:** Approved for planning
**Author:** @amagomedov_microsoft (with Copilot)

## 1. Overview

Apnea Trainer is a browser-based Progressive Web App (PWA) for **dry static apnea
training** — improving breath-hold tolerance on land, aimed at spearfishing. The
app measures a personal baseline, then guides the user through a structured,
course-like program of CO₂ and O₂ tolerance sessions, adapting difficulty over
time.

The UI is in **English**. The app is installable on Android and iOS, works
offline, and ships as **100% static assets** (no backend). All state lives on the
device (IndexedDB), with JSON export/import as a backup safety net.

### Goals
- Guided baseline measurement (Max STA) that seeds a personalised program.
- A course that dictates each day's session (CO₂ / O₂ / rest / max-retest) — the
  user does not pick what to train.
- A focused session runner with a large timer, phase cues (voice/vibration/beep),
  contraction tracking, and a "tapped out" flow.
- Rule-based adaptation: react to failures within a session and progress or
  deload across sessions.
- History and statistics: personal bests, completion, contractions, adherence.
- Training reminders via local notifications (where supported) and `.ics`
  calendar export (reliable cross-platform, including iOS).
- Installable, offline-capable PWA with a dark "deep ocean" design system.

### Non-Goals
- No account system, no server, no cross-device sync (single device only).
- No in-water training features. The app is **dry-land only** by design.
- No social features, no marketplace of programs.

### Primary user
The author, training for spearfishing. Public availability is a secondary
consideration; the design optimises for a single, self-coached user.

## 2. Domain Knowledge: Apnea Training

Breath-hold duration is limited by two tolerances, trained separately:
- **CO₂ tolerance** — the urge to breathe and diaphragm contractions.
- **O₂ tolerance / hypoxia** — actual oxygen depletion (blackout risk).

**Baseline (Max STA):** a maximal relaxed static hold at rest, **without
hyperventilation**, after a few calm breaths. We record the best of two attempts
(full recovery between) as `maxHold`, plus the time to first contractions
(the "comfortable phase"). All tables are derived as percentages of `maxHold`.

**Protocols:**
- **CO₂ table** — hold time is constant (submaximal); rest intervals **decrease**
  each round. Trains CO₂ tolerance.
- **O₂ table** — rest is constant; hold time **increases** each round toward
  (but never reaching) max. Trains hypoxia tolerance.
- **Max attempt** — periodic maximal hold to recalibrate `maxHold`.

**Safety (mandatory):** dry static only, **never in or near water alone**.
Hyperventilation masks the urge to breathe and increases blackout risk — the app
actively discourages it. O₂ tables are capped at ≤80% of `maxHold`.

## 3. Architecture

Feature-sliced **clean architecture**. The domain is pure TypeScript with no React
and no storage knowledge; it communicates through interfaces implemented in the
infrastructure layer. This keeps all apnea logic independently unit-testable.

```
src/
  domain/            // pure TS: entities + all apnea logic, no React/storage
    apnea/           // TableGenerator (CO₂/O₂), AdaptationEngine, BaselineCalc, CourseEngine
    models/          // Session, Round, Baseline, Program, CourseState, Settings (types)
    ports/           // interfaces: SessionRepository, NotificationService, WakeLockService, Clock
  application/       // use-cases + Zustand stores (persist via repositories)
    stores/          // sessionStore, courseStore, statsStore, settingsStore
    usecases/        // startTodaySession, recordRound, tapOut, finishSession, recalibrate, ...
  infrastructure/    // adapters implementing domain ports
    persistence/     // IndexedDBRepository (idb) + JSON export/import
    notifications/   // localNotifications + icsExport
    device/          // wakeLock (Wake Lock API + NoSleep fallback), audioCues, vibration
    pwa/             // service worker registration, install prompt
  ui/
    design-system/   // tokens, Button, Card, ProgressRing, Stat, TabBar, Sheet, ...
    screens/         // Onboarding, Baseline, Home, Runner, Summary, Stats, Program, Settings
    app/             // routing, layout, providers
```

**Dependency rule:** `ui` → `application` → `domain`; `infrastructure` implements
`domain/ports`. The domain never imports from `application`, `infrastructure`, or
`ui`.

### Tech stack
- **React + TypeScript + Vite** (build → static output).
- **Tailwind CSS** for the design system (tokens as CSS variables + Tailwind theme).
- **Zustand** for state (with persist middleware backed by the IndexedDB repository).
- **idb** for IndexedDB access.
- **Vitest + Testing Library + fake-indexeddb** for tests.
- **vite-plugin-pwa** (or hand-rolled manifest + service worker) for PWA/offline.

### Development methodology
Code is written **test-first (TDD)**: red → green → refactor. Domain logic and key
components get failing tests before implementation.

## 4. Domain Model & Apnea Logic

### 4.1 Entities (conceptual)
- **Baseline** — `{ id, maxHold, timeToFirstContraction, measuredAt }`. History kept.
- **Round** — `{ index, phase, targetHold, achievedHold, restBefore, contractions, tappedOut }`.
- **Session** — `{ id, type: 'CO2'|'O2'|'MAX', rounds[], startedAt, finishedAt,
  completedRounds, tapOuts, rpe }`.
- **CourseState** — `{ position, currentWeek, microcycleTemplate, lastTrainedAt,
  difficultyLevel, pendingRecalibration }`.
- **Settings** — units, cue toggles (voice/vibration/beep), theme, reminder times.

### 4.2 Baseline measurement
Guided Max STA. Best of two attempts with full recovery, no hyperventilation, a few
calm breaths before. Record `maxHold` and time to first contractions. All tables
are functions of `maxHold`. (Resting HR is out of scope for v1.)

### 4.3 Table generation (defaults; all constants configurable)
- **CO₂ table** — default 8 rounds. Hold = `round(0.55 * maxHold)` (constant).
  Rest starts high and decreases by a fixed step each round to a floor of `0:15`.
- **O₂ table** — default 8 rounds. Rest = `2:00` (constant). Hold increases
  linearly from `~0.40 * maxHold` to `~0.80 * maxHold` (never 100%).
- **Max attempt** — single maximal hold with full preparation, used to update
  `maxHold`.

### 4.4 AdaptationEngine (two loops)
- **Intra-session safety net.** On tap-out, the achieved hold time is recorded and
  the round marked failed; remaining rounds are eased by one step:
  - CO₂: lengthen the remaining rests by one step (and optionally shave target hold).
  - O₂: stop increasing hold; hold the last successful level.
  One failure must never cascade the whole session.
- **Inter-session progression.** After each session collect: % rounds completed,
  tap-out count, contraction count, and subjective **RPE** (easy / normal / hard /
  failed). Transparent rules set next session difficulty:
  - 2 clean sessions in a row with easy/normal RPE → **progress**
    (CO₂: −5 s rest per round; O₂: +5–10 s on the top rounds).
  - Any session with a tap-out → **repeat** the same level.
  - 3 failed sessions in a row or a sharp regression → **deload** one step +
    prompt to retest baseline.

### 4.5 CourseEngine
- The course is an **ongoing, perpetual program**, not a fixed N-week plan: a
  repeating weekly microcycle that progresses via the AdaptationEngine, with a
  **max-retest every ~2 weeks**.
- Default microcycle (spearfishing bias toward CO₂ tolerance and longer holds):
  `CO2 · rest · O2 · rest · CO2 · O2 · rest` (configurable).
- **The app dictates today's session** (CO₂ / O₂ / rest / max-retest). The user
  never picks the training type.
- **Course advances by completion, not by calendar.** "Today's session" is the
  next uncompleted step.
- **Soft enforcement of rest/schedule:** outside the schedule (rest day, or already
  trained today) the Train action is blocked with an explanation, but a confirmed
  **override** is available. Max one session per day; max-retest is gated by a
  minimum recovery gap.
- **Missed-session handling (roll-forward + detraining deload):**
  - Short gap: course position simply does not advance; the next session is still
    the next prescribed step.
  - Inactivity **> 7 days** → next session auto-deloads one step (gentle re-entry).
  - Inactivity **> 14 days** → prompt to retest baseline before resuming.
  - Streak resets on a missed day; course position is preserved; skipped scheduled
    sessions are logged for **adherence %**.

## 5. Screens & Navigation

Bottom tab bar: **Home · Stats · Train · Settings**.

1. **Onboarding** — welcome + mandatory safety disclaimer (dry-only, no
   hyperventilation) with explicit acknowledgement, then baseline.
2. **Baseline** — guided Max STA test (best of two, contraction marker).
3. **Home** — personal best, weekly stats, streak, and today's prescribed session
   (or rest-day / retest state).
4. **Session Runner** — breathe-up → rounds (large progress ring, phase color,
   contraction tap, "I tapped out") → automatic phase transitions. Wake lock active.
5. **Summary** — per-session results + RPE prompt; shows any adaptation applied.
6. **Stats** — charts: max hold over time, completion rate, contractions, training
   volume, adherence %.
7. **Program** — the **course route** (done / today / upcoming), reminder times,
   `.ics` export. Not a schedule editor.
8. **Settings** — units, cue toggles, theme, data export/import, safety info.

## 6. Data & Persistence

- **IndexedDB** via `idb`. Stores: `settings`, `baselines[]`, `courseState`,
  `sessions[]`. Statistics are computed on read.
- **Repository interface** in `domain/ports`; `IndexedDBRepository` in
  `infrastructure/persistence`. Domain never touches storage directly.
- **Export/Import JSON** — full-state backup against cache clearing. Single device;
  no sync.

## 7. Platform Services

- **Wake lock** — `navigator.wakeLock` (Screen Wake Lock API) with a NoSleep-style
  hidden muted-video fallback for older iOS; re-acquired on `visibilitychange`.
- **Reminders** — local notifications where supported (Android/Chromium) **plus**
  `.ics` calendar export for reliable cross-platform reminders (iOS uses the system
  calendar). No push server; stays fully static.
- **Audio/vibration cues** — Web Speech API (spoken phase cues), beeps, and the
  Vibration API. All cues individually toggleable.
- **PWA** — web app manifest + service worker (offline-first, precache static
  assets), install prompt, icons and splash screens for Android/iOS.

## 7a. Deployment & Update Delivery

- **Hosting:** DigitalOcean App Platform **static site** component (built-in CDN),
  built from the GitHub repo (`npm ci && npm run build`, output `dist/`), with
  `catchall_document: index.html` for SPA client-side routing.
- **CI/CD:** GitHub Actions. A `CI` workflow runs typecheck + tests + build on every
  push/PR; on a successful `CI` run on `main`, a `Deploy` workflow triggers
  `doctl apps create-deployment`, gating releases on green tests.
- **Update strategy:** `vite-plugin-pwa` with `registerType: 'prompt'` and
  `updateViaCache: 'none'`. Correctness comes from the service-worker layer, not
  host cache headers: `sw.js` is always revalidated, content-hashed assets are
  cached immutably, and the in-app update prompt **never reloads mid-session**. The
  app checks for updates hourly and on window focus. Build version (git SHA) is
  injected at build time and shown in Settings.

## 8. Safety

- Mandatory disclaimer on first launch, with acknowledgement.
- Persistent warnings: **dry only, never in/near water alone**.
- Anti-hyperventilation guidance during breathe-up.
- O₂ tables capped at ≤80% of `maxHold`.

## 9. Testing Strategy

- **Unit (Vitest):** all `domain` logic — `TableGenerator`, `AdaptationEngine`,
  `BaselineCalc`, `CourseEngine` — deterministic, no DOM, using an injectable
  `Clock`.
- **Component (Vitest + Testing Library):** key design-system components and the
  Session Runner timer (fake timers).
- **Persistence:** `IndexedDBRepository` tested against `fake-indexeddb`.
- **Methodology:** TDD throughout (tests precede implementation).

## 10. Design System

Dark-first "deep ocean" theme, mobile-first, calm and easy on the eyes during
holds. Layered navy surfaces with cyan/teal accents; semantic colors: amber = CO₂,
green = O₂, red = safety. Typography: Inter. Tokens exposed as CSS variables and
wired into the Tailwind theme. Components are built in isolation with clear props
and no hidden coupling.

**Color tokens (initial):**
`ocean-900 #05121c` (app bg), `ocean-700 #0d2839`, `surface #102f43`,
`surface-2 #143a52`, `border #1f4a63`, `text #e8f6fb`, `text-dim #8fb6c8`,
`cyan #22d3ee` (accent), `teal #2dd4bf`, `success #34d399` (O₂),
`warn #fbbf24` (CO₂), `danger #f87171` (safety).

## 11. Open Questions / Future Work

- Optional cloud sync (Google Drive appDataFolder via OAuth PKCE, or a light
  backend) — deliberately out of scope; single-device only for now.
- Dive-reflex training aids (cold-face exposure guidance) — possible later.
- Configurable/alternative course templates beyond the default microcycle.
