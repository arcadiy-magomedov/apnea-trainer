# Apnea Trainer — Goal Forecast and Adaptive Quality Loop

**Date:** 2026-07-09
**Status:** Approved for planning
**Author:** @amagomedov_microsoft (with Copilot)
**Builds on:** `2026-07-09-apnea-trainer-design.md`

## 1. Overview

Add two connected capabilities:

1. An open-ended **target static max-hold goal** with an assessment-based progress
   chart and a transparent ETA forecast.
2. A rule-based **training-quality feedback loop** that records first-contraction
   timing, automatically eases a session when contractions begin unusually early,
   and adapts CO₂ and O₂ difficulty independently between sessions.

The forecast and the training controller are deliberately separate. ETA describes
the observed trajectory; it never increases training load because the user is
"behind." Training load and CO₂/O₂ emphasis are controlled by actual session
quality, with existing safety rules taking precedence.

All logic remains pure TypeScript in `domain/`. The app stays static, offline,
single-device, and dependency-free for charting.

### Goals

- Let the user set, edit, clear, and achieve one target max-hold goal.
- Forecast ETA using a diminishing prior blended toward the user's standardized
  MAX-assessment history.
- Make larger target gaps produce longer forecasts.
- Clearly label forecast confidence and detect a sustained stalled trend.
- Record first-contraction timing for every training round without adding another
  user action.
- Automatically ease remaining rounds after repeated unusually early contractions.
- Collect one four-option quality rating after each session.
- Progress and deload CO₂ and O₂ independently.
- Select a stable CO₂-heavy, balanced, or O₂-heavy weekly profile from observed
  training quality.
- Allow up to three O₂ sessions per week only behind explicit quality and recency
  gates.
- Explain every automatic adjustment and progression decision to the user.

### Non-goals

- No deadline or target-date mode.
- No ML, opaque readiness score, wearable, HealthKit, Apple Watch, SpO₂, or heart
  rate integration.
- No physiological diagnosis. First-contraction timing is treated only as a
  personal workload signal.
- No automatic difficulty increase based on `ahead`, `on`, or `behind` status.
- No difficulty jumps larger than one level.
- No persistence of a finished-but-unrated Summary. Closing the PWA before rating
  discards that session and does not advance the course.
- No additional chart library.

## 2. Safety and Control Precedence

The following order is mandatory:

1. Existing hard safety behavior:
   - dry static only;
   - no hyperventilation guidance;
   - O₂ target holds capped at 80% of assessed max;
   - tap-out immediately eases the remaining session;
   - inactivity deload and retest rules remain active.
2. In-session quality protection:
   - repeated early contractions may ease, never intensify, remaining rounds.
3. Inter-session quality adaptation:
   - failed and strained sessions block progression or deload the relevant type.
4. Goal forecast and presentation:
   - ETA, trajectory status, and goal progress never override items 1–3.

`trajectoryStatus` is informational. It may influence explanatory copy, but it
must not accelerate difficulty, add training days, reduce rest, or bypass an
assessment-recovery gate.

## 3. Domain Model

### 3.1 Goal

```ts
export interface Goal {
  id: string;
  targetHoldSec: number;
  createdAt: number;
  startMaxSec: number;
  achievedAt: number | null;
}
```

- `startMaxSec` is the best standardized assessment available when the goal is
  created.
- `achievedAt` is set only by a standardized baseline or MAX assessment at or
  above the target.
- A long hold recorded during a CO₂ or O₂ table does not achieve the goal.

### 3.2 First-contraction timing

Add to `RoundResult`:

```ts
firstContractionSec: number | null;
```

The first press of the existing `Contraction` control records both the elapsed
hold time and contraction count `1`. Later presses only increment the count.
`null` means that no contraction was reported during the round; it must not be
silently converted into an onset time.

### 3.3 In-session adjustment

```ts
export interface InSessionAdjustment {
  reason: 'early-contractions' | 'tap-out';
  triggeredAtRoundIndex: number;
  restAddedSec: number;
  holdCapSec: number | null;
}
```

Add to `Session`:

```ts
adjustment: InSessionAdjustment | null;
```

Only the first automatic quality adjustment is stored. Tap-out remains the
stronger signal and may replace an earlier `early-contractions` adjustment in the
final session record.

### 3.4 Session quality

Keep the existing `Rpe` storage type and collect exactly one response:

```ts
type Rpe = 'easy' | 'normal' | 'hard' | 'failed';
```

UI labels may clarify the meaning:

- `easy`: Easy and controlled
- `normal`: Normal effort
- `hard`: Hard or relaxation was lost
- `failed`: Could not complete the planned work

Derived classification:

```ts
type SessionQuality = 'clean' | 'strained' | 'failed';
```

`SessionQuality` is computed from stored round results, adjustment, and RPE; it is
not persisted as a second source of truth. `classifySession` returns `null` for a
historical session whose RPE is missing; such a session remains visible in history
but does not influence progression or weekly-profile eligibility.

### 3.5 Independent CO₂/O₂ difficulty

Replace the single course difficulty with:

```ts
export interface DifficultyByType {
  CO2: number;
  O2: number;
}

export type MicrocycleProfile = 'co2-heavy' | 'balanced' | 'o2-heavy';
```

`CourseState` gains:

```ts
difficultyByType: DifficultyByType;
microcycleProfile: MicrocycleProfile;
pendingMicrocycleProfile: MicrocycleProfile | null;
profileLockedUntil: number | null;
```

Remove `CourseState.difficultyLevel`. `Session.difficultyLevel` remains because it
records the level actually used for that session's type.

### 3.6 AppState v2 and migration

- Add `goal: Goal | null`.
- Bump `AppState.version` from `1` to `2`.
- A v1 state migrates as follows:
  - `goal = null`;
  - every historical round gets `firstContractionSec = null`;
  - every historical session gets `adjustment = null`;
  - both `difficultyByType.CO2` and `difficultyByType.O2` receive the old
    `courseState.difficultyLevel`;
  - `microcycleProfile = 'balanced'`;
  - `pendingMicrocycleProfile = null`;
  - `profileLockedUntil = null`;
  - remove the old `courseState.difficultyLevel`.
- The same migration runs in `IndexedDbRepository.getState()` and `importJson()`.
- `emptyAppState()` returns a complete v2 state.

Because the goal feature has not shipped, goal and quality-loop fields are folded
into one v1→v2 migration rather than creating an intermediate schema.

## 4. Standardized Assessment History

### 4.1 Canonical source

```ts
export interface MaxPoint {
  id: string;
  at: number;
  sec: number;
}

assessmentHistory(state: AppState): MaxPoint[]
```

`assessmentHistory` uses `state.baselines` only, sorted ascending by `measuredAt`.
The initial baseline creates one `Baseline`; every completed MAX session appends
one `Baseline`. Although the corresponding MAX `Session` remains in session
history, it is not added again to assessment history.

This prevents the current MAX flow from double-counting each assessment as both a
baseline and a MAX session.

If imported data contains multiple baseline records with the same id, migration
keeps one. Distinct assessments that happen on the same day remain distinct; the
regression handles identical day coordinates by retaining the highest result at
that timestamp.

### 4.2 Latest versus best

```ts
latestAssessedMaxSec(state: AppState): number
bestAssessedMaxSec(state: AppState): number
```

- `latestAssessedMaxSec` anchors the current forecast because it reflects the most
  recent standardized test.
- `bestAssessedMaxSec` drives the progress ring and goal achievement because a
  reached personal best is not revoked by a later lower assessment.
- Home's primary "Personal best · static" value uses `bestAssessedMaxSec`.
- Training holds remain visible in session details but are not called an assessed
  personal best.

## 5. Goal Forecast Engine

New module: `domain/apnea/goalEngine.ts`.

All functions are pure and accept `now` explicitly.

### 5.1 Progress

```ts
progressPct = clamp(
  100 * (bestAssessedMaxSec - goal.startMaxSec)
      / (goal.targetHoldSec - goal.startMaxSec),
  0,
  100,
);
```

If the goal target is already at or below the assessed best, the goal is created
as achieved with `progressPct = 100`.

### 5.2 Diminishing prior

The old formula used a percentage of the remaining goal gap. Combined with
`ETA = gap / rate`, that produced almost the same initial ETA for small and large
goals. Replace it with a rate based on starting ability:

```ts
baseRatePerDay =
  goal.startMaxSec
  * APNEA_DEFAULTS.goal.priorWeeklyGainFractionOfStart
  / 7;

progress = clamp(
  (predictedSec - goal.startMaxSec)
  / (goal.targetHoldSec - goal.startMaxSec),
  0,
  1,
);

priorRatePerDay = max(
  APNEA_DEFAULTS.goal.minRatePerDay,
  baseRatePerDay * (1 - progress),
);
```

This is a transparent heuristic, not a physiological promise. It starts from the
same expected absolute pace for two goals set from the same assessed max, then
slows near the selected target. A larger gap therefore receives a longer ETA.

### 5.3 Observed rate

```ts
observedRatePerDay(points: MaxPoint[], goal: Goal): number | null
```

- Add a synthetic anchor at `goal.createdAt` / `goal.startMaxSec`.
- Use at most the six most recent standardized assessments after goal creation.
- Use least-squares slope in seconds per day.
- With no post-goal assessment, return `null`.
- If every usable point has the same timestamp and x-axis variance is zero, return
  `null`.
- Do not clamp a negative observed slope to zero; sustained non-positive movement
  is required for stalled detection.

### 5.4 Blended projection

Let `n` be the number of post-goal assessment points:

```ts
w = n / (n + APNEA_DEFAULTS.goal.blendK);
rate = (1 - w) * priorRateAtPredictedProgress + w * observedRate;
```

If observed rate is unavailable, `w = 0`.

ETA and chart projections use a deterministic one-day forward simulation. Each
step recalculates the diminishing prior at the predicted progress and blends it
with the current observed slope. Simulation ends when:

- the target is reached;
- the ten-year forecast horizon is reached; or
- stalled rules suppress ETA.

`goalForecast` returns:

```ts
export interface GoalForecast {
  latestSec: number;
  bestSec: number;
  targetSec: number;
  startSec: number;
  progressPct: number;
  ratePerDay: number;
  etaMs: number | null;
  confidence: 'low' | 'medium' | 'high';
  stalled: boolean;
  achieved: boolean;
}
```

Confidence is based on post-goal standardized assessments:

- `low`: 0–1 points;
- `medium`: 2–3 points;
- `high`: 4 or more points.

The UI must display confidence whenever it displays ETA.

### 5.5 Stalled state

`stalled = true` when all are true:

- at least three post-goal assessments exist;
- the observed regression slope is non-positive;
- the goal is not achieved.

In a stalled state, `etaMs = null`. The UI explains that the recent assessment
trend is flat or declining and recommends consolidation, recovery, or a new
assessment rather than harder training.

### 5.6 Expected trajectory and status

`expectedMaxAt(state, goal, at)` uses the same forward simulator as ETA.

The latest point must not participate in judging its own result:

1. Remove the latest post-goal assessment.
2. Build the forecast as it would have existed immediately before that assessment.
3. Predict the result at the latest assessment timestamp.
4. Compare actual versus predicted using `onTrackBandSec`.

```ts
trajectoryStatus(state, goal): 'behind' | 'on' | 'ahead'
```

With fewer than two post-goal assessments, return `on`. Status is presentation
only and never modifies training difficulty.

## 6. First-Contraction Quality Engine

New module: `domain/apnea/qualityEngine.ts`.

### 6.1 Onset ratio

For prescribed CO₂/O₂ rounds:

```ts
onsetRatio = firstContractionSec / targetHoldSec
```

Ignore MAX rounds, rounds with no reported contraction, zero targets, and corrupt
negative values.

### 6.2 Cold-start threshold

Until sufficient personal history exists, a contraction is "early" when:

```ts
onsetRatio < APNEA_DEFAULTS.quality.coldStartEarlyRatio
```

This is a workload-adjustment threshold, not a medical danger threshold.

### 6.3 Personalized threshold

For the same session type and round index:

1. Read valid onset ratios from up to the last six sessions.
2. Require at least five samples.
3. Compute the median.
4. Set:

```ts
threshold = clamp(
  median * APNEA_DEFAULTS.quality.personalMedianFactor,
  APNEA_DEFAULTS.quality.personalThresholdMin,
  APNEA_DEFAULTS.quality.personalThresholdMax,
);
```

This allows naturally early or late contraction patterns to calibrate without
letting one outlier dominate.

### 6.4 Trigger protection

Automatic easing triggers after either:

- two consecutive rounds below their effective early threshold; or
- one round below `extremeEarlyRatio`.

A single ordinary early round is recorded but does not change the plan.

### 6.5 In-session easing

At most one early-contraction adjustment may occur per session.

- **CO₂:** add one configured rest step to every remaining recovery interval.
  Hold targets stay unchanged.
- **O₂:** add one rest step to every remaining recovery interval and cap all
  remaining hold targets at the just-completed target, skipping further increases.
- **MAX:** never auto-adjust from contraction timing.

The runner immediately shows:

- why the plan changed;
- the added recovery;
- whether future O₂ increases were frozen.

Tap-out keeps the existing stronger behavior and may further ease the plan.

## 7. Session Classification and Type-Specific Progression

### 7.1 Target completion

For CO₂/O₂:

```ts
roundCompleted =
  !round.tappedOut
  && round.achievedHoldSec >= round.targetHoldSec;
```

Ending a prescribed hold early without pressing `I tapped out` is not a completed
round. This corrects the current behavior where every non-tap-out result counts as
completed regardless of achieved time.

MAX is an assessment attempt and is not evaluated with CO₂/O₂ target-completion
rules.

### 7.2 Classification

`clean` requires all of:

- every prescribed round completed;
- no tap-out;
- no in-session adjustment;
- RPE is `easy` or `normal`;
- available onset data does not show a material regression below the personalized
  threshold.

`failed` is any of:

- tap-out;
- an incomplete prescribed round;
- RPE is `failed`.

All other completed sessions are `strained`, including:

- RPE `hard`;
- early-contraction auto-ease;
- materially early onset without outright failure.

### 7.3 Progression

Evaluate recent sessions of the **same type only**:

- two consecutive `clean` sessions → progress that type by `+1`;
- one `strained` session → repeat that type's level;
- two consecutive `strained` sessions → deload that type by `-1`, floor `0`;
- one `failed` session → repeat;
- three consecutive `failed` sessions → deload by `-1` and suggest MAX retest.

No decision changes difficulty by more than one level.

CO₂ outcomes never directly change O₂ difficulty, and O₂ outcomes never directly
change CO₂ difficulty.

The quality loop is active with or without an active goal.

## 8. Adaptive Weekly Profiles

The weekly course keeps four training days and three rest days.

```ts
co2Heavy = ['CO2', 'REST', 'CO2', 'REST', 'CO2', 'O2', 'REST'];
balanced = ['CO2', 'REST', 'O2', 'REST', 'CO2', 'O2', 'REST'];
o2Heavy = ['O2', 'REST', 'O2', 'REST', 'O2', 'CO2', 'REST'];
```

The O₂-heavy template separates its three O₂ sessions with rest days and never
places O₂ on consecutive days.

### 8.1 CO₂-heavy eligibility

Select CO₂-heavy when recent valid data shows repeated early-contraction strain:

- at least two of the last three non-MAX sessions triggered early-contraction
  easing or were classified `strained` primarily from early onset; and
- O₂-heavy eligibility is not active.

### 8.2 O₂-heavy eligibility

Promotion to O₂-heavy requires all of:

- the latest three O₂ sessions are `clean`;
- no `strained` or `failed` session of either type exists among the latest four
  non-MAX sessions;
- no early-contraction adjustment exists among those four sessions;
- the latest standardized MAX assessment is no older than 21 days.

Any new O₂ `strained`, O₂ `failed`, tap-out, or early-contraction adjustment
immediately demotes O₂-heavy to balanced.

### 8.3 Stability

- Promotion or non-safety profile changes are stored in
  `pendingMicrocycleProfile` and applied only when the course reaches the next
  seven-slot microcycle boundary. This prevents a profile change from remapping
  the middle of the visible week.
- After applying a queued profile, another promotion or non-safety change cannot
  apply for seven calendar days.
- Safety demotion to balanced ignores the lock, clears any pending promotion, and
  happens immediately. All three profiles keep REST at the same indices, so an
  immediate demotion cannot remove a scheduled recovery day.
- If neither specialized profile is eligible, use balanced.
- Clearing a goal does not reset profile or difficulty because quality adaptation
  is goal-independent.

## 9. Assessment Cadence

Without a goal, retain the fixed 14-day MAX cadence.

With a goal:

- 7 days when forecast confidence is low and the latest two training sessions are
  clean;
- 14 days by default;
- 21 days when confidence is high and goal progress is at least 80%.

A due MAX assessment is offered after:

- one full calendar recovery day following an `easy` or `normal` session without
  auto-ease; or
- two full calendar recovery days following a `hard`, `failed`, or auto-eased
  session.

If the cooldown has not elapsed, the assessment remains due and the app prescribes
recovery rather than replacing it with an ordinary training session. Once the
cooldown elapses, MAX becomes eligible regardless of the previous rating, avoiding
an indefinite postponed state.

## 10. Use-cases and Data Flow

### 10.1 Set and clear goal

```ts
setGoal(state, targetHoldSec, now): AppState
clearGoal(state): AppState
```

`setGoal`:

- requires at least one standardized assessment;
- validates a finite positive target;
- sets `startMaxSec` to the assessed personal best;
- sets `achievedAt = now` if the assessed best already meets the target;
- does not reset either difficulty level or the current microcycle profile.

`clearGoal`:

- sets `goal = null`;
- preserves difficulty and quality-selected microcycle;
- restores fixed 14-day assessment cadence.

### 10.2 Start session

`startTodaySession`:

- resolves the prescribed day;
- reads `difficultyByType[dayType]`;
- applies inactivity deload to the prescribed type only;
- generates the plan from the latest standardized assessed max;
- never uses an ordinary training hold as the table baseline.

### 10.3 Run session

The runner:

- records first-contraction elapsed time on the first contraction tap;
- evaluates early-contraction triggers after each round;
- updates the remaining in-memory plan after an automatic adjustment;
- records the adjustment for Summary and history;
- does not persist or advance the course when the last round ends.

### 10.4 Rate and finish

At the end of the runner:

1. Build an unrated `Session` draft with `rpe = null`.
2. Navigate to Summary using route state.
3. Require one quality selection.
4. Add the selected RPE and call `finishSession`.
5. Persist the session, advance the course, adapt that type's difficulty, and
   reevaluate or queue the next weekly profile.

If the user closes or navigates away before step 4, the draft is discarded. The
session is not persisted and the course does not advance.

### 10.5 Finish MAX

For MAX:

- append the session;
- append exactly one new `Baseline` containing the achieved assessment;
- copy the MAX round's first-contraction time into that `Baseline`;
- update `lastMaxTestAt`;
- mark the goal achieved if the assessed result reaches it;
- do not change CO₂ or O₂ difficulty;
- reevaluate forecast confidence, ETA, and profile eligibility.

## 11. UI

### 11.1 Set goal

`SetGoalScreen.tsx`:

- duration input in `mm:ss`;
- current assessed max and proposed improvement shown together;
- soft warning above `currentBest * implausibleFactor`;
- an at-or-below-current target is accepted as already achieved;
- reachable after baseline and from Home, Stats, and Settings.

### 11.2 Home

Goal card:

- assessed best;
- target;
- progress ring;
- ETA and confidence label;
- `Goal reached`, `Progress stalled`, or projected date;
- tap opens Stats at the goal chart.

Without a goal, show a compact `Set a goal` prompt.

### 11.3 Runner

During hold:

- first contraction tap changes the secondary label to
  `First contraction · mm:ss`;
- later taps continue showing total contractions.

On auto-ease, show a non-blocking explanation:

- CO₂ example: `Recovery increased by 15s — contractions started earlier than your normal.`
- O₂ example: `Next hold increases paused; recovery increased by 15s.`

### 11.4 Summary

Summary first shows objective results, then one required four-option quality
question. After selection it shows:

- `clean`, `strained`, or `failed` explanation in user-facing language;
- CO₂ or O₂ level decision;
- any weekly-profile change;
- assessment due/postponed state when applicable.

There is no default `normal` rating.

### 11.5 Stats

Hand-rolled SVG progress chart:

- standardized assessment points only;
- actual line;
- horizontal goal line;
- dashed forecast from latest assessment to ETA;
- confidence label;
- latest leave-one-out `ahead/on/behind` status.

Add compact quality indicators without another chart:

- current CO₂ and O₂ levels;
- current weekly profile;
- recent clean/strained/failed result;
- median first-contraction onset for CO₂ and O₂ when sufficient data exists.

## 12. Error Handling and Edge Cases

- No baseline: goal creation and training remain blocked with the existing baseline
  CTA.
- No contraction reported: keep `firstContractionSec = null`; do not invent a
  favorable onset ratio.
- Insufficient personal onset history: use the cold-start threshold.
- Invalid elapsed time or target: reject explicitly; do not silently coerce.
- Goal target equal to start: create an achieved goal without division by zero.
- Negative observed trend with fewer than three assessments: show low/medium
  confidence but do not declare stalled.
- Forecast beyond ten years: show `ETA unavailable` rather than an extreme date.
- Interrupted Summary: discard the draft by explicit design.
- Imported v1 state: migrate before any domain calculation.
- Corrupt import that cannot be migrated: surface the existing import error and
  leave persisted state unchanged.

## 13. Configuration

Add:

```ts
goal: {
  priorWeeklyGainFractionOfStart: 0.05,
  minRatePerDay: 0.05,
  blendK: 3,
  maxObservedPoints: 6,
  onTrackBandSec: 5,
  forecastHorizonDays: 3650,
  assessMinDays: 7,
  assessDefaultDays: 14,
  assessMaxDays: 21,
  implausibleFactor: 2.0,
},
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

These are transparent product tuning defaults. They are not presented as medical
thresholds.

## 14. Testing Strategy

Implementation remains test-first.

### Domain

- v1→v2 migration for goal, rounds, sessions, and split difficulty.
- Assessment history contains one point per baseline/MAX assessment and never
  double-counts MAX sessions.
- Latest versus best assessment semantics.
- Goal progress and achieved state use standardized assessments only.
- Prior rate depends on start max rather than goal gap.
- Larger gaps produce later ETA from the same start.
- Forward simulation, forecast horizon, and confidence.
- Observed regression over the bounded post-goal window.
- Stalled detection after three non-positive assessment points.
- Leave-one-out `ahead/on/behind`.
- Cold-start and personalized onset thresholds.
- Median calibration and outlier resistance.
- Two-consecutive and one-extreme early trigger behavior.
- At most one early-contraction adjustment per session.
- CO₂ rest extension and O₂ hold-freeze behavior.
- Early manual hold end does not count as a completed prescribed round.
- Clean/strained/failed classification.
- CO₂ and O₂ progression remain independent.
- No progression step exceeds one.
- Profile eligibility, seven-day lock, and immediate safety demotion.
- Pending profile changes apply only at microcycle boundaries.
- O₂-heavy profile has exactly three O₂ days, three rest days, and no consecutive
  O₂ days.
- Goal-free quality adaptation remains active.
- Assessment cadence and recovery postponement.
- O₂ targets remain at or below 80% under every difficulty/profile combination.

### Application and stores

- Runner records only the first contraction timestamp.
- In-memory plan updates after auto-ease.
- Unrated Summary does not persist or advance.
- Selected rating persists once and applies adaptation once.
- MAX appends one session and one baseline.
- `startTodaySession` selects the correct type-specific level and assessed max.
- Set/clear goal preserve quality profile and difficulty.

### Components

- Set-goal validation and warnings.
- Goal card states: none, active, low-confidence, stalled, achieved.
- Progress chart renders only standardized assessment points.
- Runner first-contraction label and adjustment banner.
- Summary requires one quality choice and explains the resulting decision.
- Stats renders split levels and profile.

## 15. Future Work

- User-editable or deletable erroneous assessment records.
- A forecast uncertainty band once enough real assessment data exists to calibrate
  residual variance.
- Optional technique notes per session.
- Additional contraction and adherence charts.
- Multiple goal history and archived goals.
- Native wearable/sensor integration only if the product later gains a native app.
