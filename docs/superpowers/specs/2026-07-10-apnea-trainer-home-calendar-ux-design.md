# Apnea Trainer Home Hero and Calendar UX

**Date:** 2026-07-10
**Status:** Approved design
**Author:** @amagomedov_microsoft (with Copilot)

## 1. Overview

Simplify Home around the next useful action and replace the current Program
screen with a real training calendar.

The redesign has two product principles:

1. Home answers one question: **what should I do now?**
2. Calendar answers three questions: **what did I do, what is today, and what is
   currently planned?**

## 2. Goals

- Keep the primary training action permanently reachable by the user's thumb.
- Remove Stats information duplicated on Home.
- Preserve the existing large goal card on Home.
- Replace the abstract Day 1…7 list with a familiar monthly calendar.
- Show all completed CO₂, O₂, and standardized assessment history.
- Show today and a provisional six-week training plan.
- Make day details available without navigating to another screen.
- Remove the non-working iOS `.ics` export surface.

## 3. Non-goals

- No calendar-library dependency.
- No manual session editing or deletion.
- No drag-and-drop rescheduling.
- No long-range promise that the adaptive plan will remain unchanged.
- No native iOS calendar integration.
- No changes to training safety, progression, or assessment rules.

## 4. Home

### 4.1 Remove duplicated content

Remove these elements from Home:

- `Ready to train?`
- `Apnea Trainer`
- `Personal best`
- `This week`
- `Streak`

Those metrics remain available in Stats.

### 4.2 Keep goal progress

The existing large Goal Card remains the first content block. Its active,
stalled, achieved, and no-goal behavior remains unchanged.

### 4.3 Persistent Hero dock

Home uses the approved **Hero dock with context** design.

The dock is a dedicated non-scrolling `AppShell` region immediately above the
bottom tab bar. It is not an overlay inside the scroll container, so it never
covers Home content. It accounts for the iPhone safe-area through the shell and
tab-bar layout.

Trainable state:

- eyebrow: `Today`
- session type, current type-specific level, and round count
- one large, full-width, high-contrast primary button
- button label: `Start CO₂ session`, `Start O₂ session`, or
  `Start MAX assessment`

Other states:

- **No baseline:** `Measure baseline` primary action.
- **REST:** `Rest day` plus the next planned training type/date; no Start or
  Train Anyway button.
- **Assessment postponed:** recovery status plus the next eligible assessment
  information; no unsafe override.
- **Completed today:** green completed state plus tomorrow's session/rest
  summary; no second training action.

The dock is the visual Hero. Secondary links must not compete with its primary
button.

## 5. Calendar

### 5.1 Navigation

- Rename the bottom tab from `Program` to `Calendar`.
- Use `/calendar` as the canonical route.
- Keep `/program` as a redirect to `/calendar` for backward compatibility.
- Rename the screen/component to match its Calendar responsibility.

### 5.2 Month grid

Use the approved **Month + day drawer** layout:

- standard seven-column month grid;
- previous/next month controls;
- today receives a distinct outline/background;
- the selected day receives a separate selection treatment;
- multiple events on one date are supported.

Event markers:

- completed CO₂, O₂, and MAX events use filled semantic markers;
- future events use outlined markers;
- REST uses a neutral marker;
- visual status is never communicated by color alone: filled/outlined shape,
  labels, and drawer copy provide redundant meaning.

### 5.3 Day drawer

Tapping a date opens a compact inline drawer below the month grid.

For completed sessions it shows:

- session type;
- completed rounds versus planned rounds;
- derived quality (`clean`, `strained`, or `failed`) when available;
- tap-out count;
- best achieved hold;
- adjustment/recovery information when present.

For completed baseline/MAX assessments it shows:

- `MAX assessment`;
- assessed hold;
- first-contraction time when recorded;
- goal result when relevant.

For future events it shows:

- planned session type;
- current projected type-specific level;
- round count;
- REST or assessment-recovery explanation.

If a date contains multiple events, the drawer lists all of them rather than
collapsing the day to one event.

### 5.4 Completed history

Completed calendar history is derived, never separately persisted.

Sources:

- every stored `Session`;
- every baseline-only standardized assessment, including the initial baseline.

A MAX session and the `Baseline` generated from that same assessment must appear
as one calendar event. Pair them one-to-one using assessment value, calendar
day, and nearest timestamp. Unpaired baselines remain visible as baseline-only
assessment events.

### 5.5 Provisional future plan

Show a **42-calendar-day window including today**.

The future plan is a pure projection from current state:

- current synchronized course position and active microcycle profile;
- current CO₂/O₂ levels;
- REST-day calendar behavior;
- current goal-aware MAX cadence and recovery gate.

Projection assumes planned sessions are completed only to advance the calendar
position. It does not predict future RPE, quality adaptation, level changes, or
profile changes. A planned MAX resets the projected assessment cadence without
inventing a future assessment result.

Projection-only training records remain unrated. They therefore enforce the
minimum one-calendar-day assessment recovery gate without inventing a clean,
hard, or failed quality result. A real hard, failed, or auto-eased session may
extend the subsequently recalculated gate to two days.

Future events are labelled as provisional. The projection is recalculated from
real state after every completed session, assessment, profile change, import,
or app reload.

## 6. Remove `.ics` export

Remove:

- the `Export reminders (.ics)` button;
- the obsolete Web Share/download path used only by that button;
- unused service wiring that exists solely for `.ics` delivery.

Keep reminder data and notification-related state because they may still serve
local notification behavior. This redesign does not add native calendar
integration.

## 7. Component and data boundaries

### App shell

`AppShell` gains an optional bottom-action slot rendered between the scrollable
main area and `TabBar`.

### Home

Home computes its today model once and supplies it to:

- the scrollable Home content;
- `HomeHeroDock`.

The content does not duplicate training-decision logic.

### Calendar domain/application model

Add a pure calendar builder with no React dependency:

```ts
type TrainingCalendarEventStatus = 'completed' | 'planned';

interface TrainingCalendarEvent {
  id: string;
  at: number;
  dayType: 'CO2' | 'O2' | 'MAX' | 'REST';
  status: TrainingCalendarEventStatus;
  // completed or planned detail fields
}
```

The builder owns:

- completed session mapping;
- baseline/MAX deduplication;
- baseline-only events;
- 42-day provisional planning;
- stable chronological ordering.

Calendar UI owns only:

- visible month;
- selected date;
- rendering;
- opening the day drawer.

## 8. Edge cases

- Empty history still shows today and the future plan.
- A user without a baseline sees the baseline requirement rather than invented
  training events.
- Multiple sessions or assessments on one day remain individually visible.
- Month navigation works across year boundaries.
- Imported historical sessions with missing RPE remain visible with
  `quality unavailable`.
- A future adaptive profile change does not rewrite completed history.
- Assessment recovery postponement remains visible as recovery, not as an
  actionable MAX session.
- Calendar calculations use local calendar days and remain safe across DST.

## 9. Accessibility

- Hero remains reachable without scrolling.
- Minimum touch target is 44×44 CSS pixels.
- Calendar days are real buttons with complete accessible labels.
- Selected day, today, completed, and planned states are exposed through text
  and ARIA state, not color alone.
- Drawer content follows the selected day in DOM order.
- Month controls have explicit accessible names.

## 10. Testing

### Home

- duplicated heading/stat elements are absent;
- goal states remain visible;
- trainable Hero shows correct type, level, rounds, and action;
- baseline Hero routes to baseline;
- REST and postponed states expose no training action;
- completed state shows tomorrow's summary;
- Hero is rendered in the shell bottom-action slot.

### Calendar builder

- all completed sessions appear once;
- initial baseline appears;
- MAX session and generated baseline deduplicate one-to-one;
- multiple same-day events remain separate;
- missing RPE produces unavailable quality;
- future plan covers exactly 42 calendar days;
- REST, MAX cadence, and recovery gates match existing domain rules;
- month/year and DST boundaries are correct;
- projection does not mutate persisted state.

### Calendar UI

- Program tab is renamed and old route redirects;
- month navigation works;
- today and selected day are distinct;
- filled versus outlined marker semantics render correctly;
- tapping a date shows all day details;
- `.ics` export is absent.

## 11. Acceptance criteria

- On a normal phone viewport, the primary Home action is visible without
  scrolling.
- Home contains no duplicated Personal Best, This Week, Streak, or app-title
  blocks.
- REST days never expose a Start or Train Anyway action.
- Calendar shows complete history, today, and a six-week provisional plan.
- Selecting a completed day exposes type, result, quality, and tap-outs.
- Initial baseline and later MAX assessments are visible without duplicates.
- No `.ics` export control remains.
