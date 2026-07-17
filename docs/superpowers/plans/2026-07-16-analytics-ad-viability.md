# Apnea Trainer Analytics Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-gated GA4 product analytics and Search Console setup that measures acquisition, retention, core feature usage, and potential ad inventory without collecting exact training data or showing ads.

**Architecture:** Add a typed analytics contract in the application layer, a GA4 adapter and device-local consent store in infrastructure, and small React components for consent, route tracking, privacy controls, and candidate-ad viewability. Product code emits semantic events through the injected `AnalyticsService`; GA4 is not loaded until explicit consent, and Search Console remains an external operational integration.

**Tech Stack:** React 19, TypeScript 6, Vite 8, React Router 7, Vitest 4, Testing Library, GA4 `gtag.js`, Google Search Console, DigitalOcean App Platform.

**Git workflow:** Do not commit or push without explicit user approval. Each task ends with a staging checkpoint and a suggested commit message, but the executor must stop and request approval before creating any commit.

---

## Scope and file map

### New application files

- `src/application/analytics/events.ts` - typed event schema, path normalization, duration bucketing, runtime allow-list serialization.
- `src/application/analytics/events.test.ts` - pure event-schema and sanitization tests.
- `src/application/analytics/analyticsService.ts` - analytics and consent-store interfaces.
- `src/test/fakeAnalytics.ts` - reusable fake service and in-memory consent store for component tests.

### New infrastructure files

- `src/infrastructure/analytics/localAnalyticsConsentStore.ts` - device-local consent decision and timestamp.
- `src/infrastructure/analytics/localAnalyticsConsentStore.test.ts` - persistence, corruption, and export-isolation tests.
- `src/infrastructure/analytics/noopAnalytics.ts` - safe analytics fallback.
- `src/infrastructure/analytics/ga4Analytics.ts` - consent-gated Google tag loading, event dispatch, identifier retrieval, and reset.
- `src/infrastructure/analytics/ga4Analytics.test.ts` - tag, consent, payload, reset, and failure tests.

### New UI files

- `src/ui/analytics/AnalyticsConsentProvider.tsx` - consent state and actions.
- `src/ui/analytics/AnalyticsConsentProvider.test.tsx` - provider behavior.
- `src/ui/analytics/AnalyticsConsentPrompt.tsx` - first-use optional consent dialog.
- `src/ui/analytics/AnalyticsConsentPrompt.test.tsx` - accessible accept/decline flow.
- `src/ui/analytics/AnalyticsRouteTracker.tsx` - deduplicated SPA page views and PWA install tracking.
- `src/ui/analytics/AnalyticsRouteTracker.test.tsx` - consent, path normalization, and Strict Mode tests.
- `src/ui/analytics/AdOpportunityProbe.tsx` - no-layout candidate-placement viewability measurement.
- `src/ui/analytics/AdOpportunityProbe.test.tsx` - 50%-for-one-second behavior.
- `src/ui/screens/PrivacyScreen.tsx` - privacy disclosure and deletion-request instructions.
- `src/ui/screens/PrivacyScreen.test.tsx` - disclosure and contact rendering.

### Modified runtime files

- `src/ui/app/services.tsx` - inject analytics and consent storage.
- `src/infrastructure/device/productionServices.ts` - build production analytics services from Vite configuration.
- `src/infrastructure/device/productionServices.test.ts` - assert the expanded bundle.
- `src/vite-env-app.d.ts` - type the two public build variables.
- `src/App.tsx` - mount analytics consent, route tracking, and prompt components.
- `src/ui/app/routes.tsx` - add `/privacy`.
- `src/ui/app/routes.test.tsx` - verify the privacy route.
- `src/ui/screens/SettingsScreen.tsx` - analytics toggle, identifier, and privacy link.
- `src/ui/screens/SettingsScreen.test.tsx` - consent and identifier tests.
- `src/ui/screens/OnboardingScreen.tsx` and test - onboarding events.
- `src/ui/screens/BaselineScreen.tsx` and test - baseline start, complete, and abandon events.
- `src/ui/screens/RunnerScreen.tsx` and test - session start and abandon events only.
- `src/ui/screens/SummaryScreen.tsx` and test - session-completed event after persistence.
- `src/ui/screens/SetGoalScreen.tsx` and test - goal-created and goal-updated events.
- `src/ui/screens/CalendarScreen.tsx` and test - calendar-day event and placement probe.
- `src/ui/screens/HomeScreen.tsx` and test - Home placement probe.
- `src/ui/screens/StatsScreen.tsx` and test - Stats placement probe.
- `src/ui/screens/SummaryScreen.tsx` and test - Summary placement probe after rating.

### New and modified operational files

- `.env.example` - empty public analytics configuration keys.
- `docs/analytics-setup.md` - click-by-click GA4, Search Console, DigitalOcean, DebugView, and report setup.
- `docs/deployment.md` - analytics build variables and release checklist.

---

### Task 1: Define the typed analytics contract

**Files:**
- Create: `src/application/analytics/events.test.ts`
- Create: `src/application/analytics/events.ts`
- Create: `src/application/analytics/analyticsService.ts`
- Create: `src/test/fakeAnalytics.ts`

- [ ] **Step 1: Write the failing event-contract tests**

Create `src/application/analytics/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dayRelation,
  durationBucket,
  normalizeAnalyticsPath,
  serializeAnalyticsEvent,
  surfaceForPath,
} from './events';

describe('analytics events', () => {
  it('removes query strings and fragments from page paths', () => {
    expect(normalizeAnalyticsPath('/stats?focus=goal#chart')).toBe('/stats');
    expect(normalizeAnalyticsPath('/')).toBe('/');
  });

  it('collapses unknown paths instead of transmitting arbitrary URL data', () => {
    expect(normalizeAnalyticsPath('/invite/alice@example.test'))
      .toBe('/other');
    expect(normalizeAnalyticsPath('/guides/co2-tables'))
      .toBe('/guides/co2-tables');
  });

  it('maps app routes to stable low-cardinality surfaces', () => {
    expect(surfaceForPath('/')).toBe('home');
    expect(surfaceForPath('/runner')).toBe('runner');
    expect(surfaceForPath('/guides/co2-tables')).toBe('content');
  });

  it.each([
    [0, 599_999, 'under_10m'],
    [0, 600_000, '10_to_20m'],
    [0, 1_200_000, '20_to_30m'],
    [0, 1_800_000, '30m_plus'],
  ] as const)(
    'buckets %i..%i as %s without exposing an exact duration',
    (startedAt, finishedAt, expected) => {
      expect(durationBucket(startedAt, finishedAt)).toBe(expected);
    },
  );

  it('classifies calendar dates without transmitting a timestamp', () => {
    expect(dayRelation('2026-07-15', '2026-07-16')).toBe('past');
    expect(dayRelation('2026-07-16', '2026-07-16')).toBe('today');
    expect(dayRelation('2026-07-17', '2026-07-16')).toBe('future');
  });

  it('serializes only approved event properties', () => {
    expect(serializeAnalyticsEvent({
      name: 'training_session_completed',
      sessionType: 'co2',
      durationBucket: '10_to_20m',
    })).toEqual({
      name: 'training_session_completed',
      properties: {
        session_type: 'co2',
        duration_bucket: '10_to_20m',
      },
    });
  });

  it('rejects undeclared runtime properties', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'goal_created',
      targetHoldSec: 240,
    } as never)).toThrow(/unexpected analytics properties: targetHoldSec/i);
  });

  it('rejects unknown runtime event names', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'button_clicked',
    } as never)).toThrow(/unknown analytics event/i);
  });

  it('rejects undeclared runtime enum values', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'training_session_completed',
      sessionType: 'custom-session',
      durationBucket: 'exactly-17-minutes',
    } as never)).toThrow(/invalid analytics session_type/i);
  });

  it('rejects mismatched placement and surface values', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'ad_opportunity_viewable',
      placement: 'home_inline',
      surface: 'stats',
    })).toThrow(/does not belong to surface/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- src\application\analytics\events.test.ts
```

Expected: FAIL because `events.ts` does not exist.

- [ ] **Step 3: Implement the analytics service interfaces**

Create `src/application/analytics/analyticsService.ts`:

```ts
import type { AnalyticsEvent } from './events';

export type AnalyticsConsent = 'unknown' | 'granted' | 'denied';

export interface AnalyticsConsentDecision {
  status: Exclude<AnalyticsConsent, 'unknown'>;
  decidedAt: number;
}

export interface AnalyticsConsentStore {
  read(): AnalyticsConsentDecision | null;
  write(status: AnalyticsConsentDecision['status']): AnalyticsConsentDecision;
}

export interface AnalyticsService {
  readonly available: boolean;
  setConsent(consent: AnalyticsConsent): Promise<void>;
  track(event: AnalyticsEvent): void;
  getAnonymousId(): Promise<string | null>;
  reset(): Promise<void>;
}
```

- [ ] **Step 4: Implement the event schema and pure helpers**

Create `src/application/analytics/events.ts`:

```ts
import type { SessionType } from '../../domain/models/types';

export const ANALYTICS_SURFACES = [
  'home',
  'onboarding',
  'baseline',
  'runner',
  'summary',
  'stats',
  'calendar',
  'settings',
  'goal',
  'privacy',
  'content',
] as const;

export type AnalyticsSurface = typeof ANALYTICS_SURFACES[number];
export type AnalyticsSessionType = 'co2' | 'o2' | 'max';
export type AnalyticsDurationBucket =
  | 'under_10m'
  | '10_to_20m'
  | '20_to_30m'
  | '30m_plus';
export type AnalyticsDayRelation = 'past' | 'today' | 'future';
export type AnalyticsPlacement =
  | 'home_inline'
  | 'stats_inline'
  | 'calendar_inline'
  | 'summary_inline';
export type AnalyticsCtaName = 'open_app' | 'start_onboarding';

const ANALYTICS_SESSION_TYPES = ['co2', 'o2', 'max'] as const;
const ANALYTICS_DURATION_BUCKETS = [
  'under_10m',
  '10_to_20m',
  '20_to_30m',
  '30m_plus',
] as const;
const ANALYTICS_DAY_RELATIONS = ['past', 'today', 'future'] as const;
const ANALYTICS_CTA_NAMES = ['open_app', 'start_onboarding'] as const;

const PLACEMENT_SURFACES: Readonly<Record<
  AnalyticsPlacement,
  AnalyticsSurface
>> = {
  home_inline: 'home',
  stats_inline: 'stats',
  calendar_inline: 'calendar',
  summary_inline: 'summary',
};

export type AnalyticsEvent =
  | { name: 'page_view'; path: string; surface: AnalyticsSurface }
  | {
      name: 'content_cta_selected';
      contentSlug: string;
      ctaName: AnalyticsCtaName;
    }
  | { name: 'onboarding_started' }
  | { name: 'onboarding_completed' }
  | { name: 'baseline_started' }
  | { name: 'baseline_completed' }
  | { name: 'baseline_abandoned' }
  | {
      name: 'training_session_started';
      sessionType: AnalyticsSessionType;
    }
  | {
      name: 'training_session_completed';
      sessionType: AnalyticsSessionType;
      durationBucket: AnalyticsDurationBucket;
    }
  | {
      name: 'training_session_abandoned';
      sessionType: AnalyticsSessionType;
      durationBucket: AnalyticsDurationBucket;
    }
  | { name: 'goal_created' }
  | { name: 'goal_updated' }
  | { name: 'goal_cleared' }
  | {
      name: 'calendar_day_opened';
      dayRelation: AnalyticsDayRelation;
    }
  | { name: 'pwa_install_accepted' }
  | {
      name: 'ad_opportunity_viewable';
      placement: AnalyticsPlacement;
      surface: AnalyticsSurface;
    };

export interface SerializedAnalyticsEvent {
  name: AnalyticsEvent['name'];
  properties: Record<string, string>;
}

const ROUTE_SURFACES: Readonly<Record<string, AnalyticsSurface>> = {
  '/': 'home',
  '/onboarding': 'onboarding',
  '/baseline': 'baseline',
  '/runner': 'runner',
  '/summary': 'summary',
  '/stats': 'stats',
  '/calendar': 'calendar',
  '/settings': 'settings',
  '/goal': 'goal',
  '/privacy': 'privacy',
  '/other': 'content',
};

const GUIDE_PATH = /^\/guides\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EVENT_KEYS: Readonly<Record<AnalyticsEvent['name'], readonly string[]>> = {
  page_view: ['name', 'path', 'surface'],
  content_cta_selected: ['name', 'contentSlug', 'ctaName'],
  onboarding_started: ['name'],
  onboarding_completed: ['name'],
  baseline_started: ['name'],
  baseline_completed: ['name'],
  baseline_abandoned: ['name'],
  training_session_started: ['name', 'sessionType'],
  training_session_completed: ['name', 'sessionType', 'durationBucket'],
  training_session_abandoned: ['name', 'sessionType', 'durationBucket'],
  goal_created: ['name'],
  goal_updated: ['name'],
  goal_cleared: ['name'],
  calendar_day_opened: ['name', 'dayRelation'],
  pwa_install_accepted: ['name'],
  ad_opportunity_viewable: ['name', 'placement', 'surface'],
};

function assertExactKeys(
  event: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const extras = Object.keys(event).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new Error(`Unexpected analytics properties: ${extras.join(', ')}`);
  }
}

function assertKnownEvent(
  event: AnalyticsEvent,
): asserts event is AnalyticsEvent {
  const candidate = event as unknown;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('Unknown analytics event: non-object value');
  }
  const name = (candidate as { name?: unknown }).name;
  if (
    typeof name !== 'string'
    || !Object.prototype.hasOwnProperty.call(EVENT_KEYS, name)
  ) {
    throw new Error(`Unknown analytics event: ${String(name)}`);
  }
}

function assertAllowedValue(
  property: string,
  value: string,
  allowed: readonly string[],
): void {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid analytics ${property}: ${value}`);
  }
}

export function normalizeAnalyticsPath(value: string): string {
  const path = new URL(value, 'https://analytics.invalid').pathname;
  const withoutTrailingSlash = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const normalized = withoutTrailingSlash || '/';
  if (normalized in ROUTE_SURFACES || GUIDE_PATH.test(normalized)) {
    return normalized;
  }
  return '/other';
}

export function surfaceForPath(value: string): AnalyticsSurface {
  return ROUTE_SURFACES[normalizeAnalyticsPath(value)] ?? 'content';
}

export function durationBucket(
  startedAt: number,
  finishedAt: number,
): AnalyticsDurationBucket {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    throw new Error('Analytics duration timestamps must be finite');
  }
  const durationMs = Math.max(0, finishedAt - startedAt);
  if (durationMs < 10 * 60_000) return 'under_10m';
  if (durationMs < 20 * 60_000) return '10_to_20m';
  if (durationMs < 30 * 60_000) return '20_to_30m';
  return '30m_plus';
}

export function dayRelation(
  dayKey: string,
  todayKey: string,
): AnalyticsDayRelation {
  if (dayKey === todayKey) return 'today';
  return dayKey < todayKey ? 'past' : 'future';
}

export function analyticsSessionType(
  value: SessionType,
): AnalyticsSessionType {
  if (value === 'CO2') return 'co2';
  if (value === 'O2') return 'o2';
  return 'max';
}

export function serializeAnalyticsEvent(
  event: AnalyticsEvent,
): SerializedAnalyticsEvent {
  assertKnownEvent(event);
  assertExactKeys(
    event as unknown as Record<string, unknown>,
    EVENT_KEYS[event.name],
  );

  switch (event.name) {
    case 'page_view':
      {
        const path = normalizeAnalyticsPath(event.path);
        const expectedSurface = surfaceForPath(path);
        assertAllowedValue('surface', event.surface, ANALYTICS_SURFACES);
        if (event.surface !== expectedSurface) {
          throw new Error(
            `Analytics surface ${event.surface} does not match ${path}`,
          );
        }
        return {
          name: event.name,
          properties: {
            page_path: path,
            surface: event.surface,
          },
        };
      }
    case 'content_cta_selected':
      if (
        event.contentSlug.length > 80
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.contentSlug)
      ) {
        throw new Error('Content slug must be lower-case kebab-case');
      }
      assertAllowedValue('cta_name', event.ctaName, ANALYTICS_CTA_NAMES);
      return {
        name: event.name,
        properties: {
          content_slug: event.contentSlug,
          cta_name: event.ctaName,
        },
      };
    case 'training_session_started':
      assertAllowedValue(
        'session_type',
        event.sessionType,
        ANALYTICS_SESSION_TYPES,
      );
      return {
        name: event.name,
        properties: { session_type: event.sessionType },
      };
    case 'training_session_completed':
    case 'training_session_abandoned':
      assertAllowedValue(
        'session_type',
        event.sessionType,
        ANALYTICS_SESSION_TYPES,
      );
      assertAllowedValue(
        'duration_bucket',
        event.durationBucket,
        ANALYTICS_DURATION_BUCKETS,
      );
      return {
        name: event.name,
        properties: {
          session_type: event.sessionType,
          duration_bucket: event.durationBucket,
        },
      };
    case 'calendar_day_opened':
      assertAllowedValue(
        'day_relation',
        event.dayRelation,
        ANALYTICS_DAY_RELATIONS,
      );
      return {
        name: event.name,
        properties: { day_relation: event.dayRelation },
      };
    case 'ad_opportunity_viewable':
      assertAllowedValue(
        'placement',
        event.placement,
        Object.keys(PLACEMENT_SURFACES),
      );
      assertAllowedValue('surface', event.surface, ANALYTICS_SURFACES);
      if (PLACEMENT_SURFACES[event.placement] !== event.surface) {
        throw new Error(
          `Analytics placement ${event.placement} does not belong to surface `
          + event.surface,
        );
      }
      return {
        name: event.name,
        properties: {
          placement: event.placement,
          surface: event.surface,
        },
      };
    case 'onboarding_started':
    case 'onboarding_completed':
    case 'baseline_started':
    case 'baseline_completed':
    case 'baseline_abandoned':
    case 'goal_created':
    case 'goal_updated':
    case 'goal_cleared':
    case 'pwa_install_accepted':
      return { name: event.name, properties: {} };
    default:
      throw new Error(
        `Unknown analytics event: ${String((event as { name?: unknown }).name)}`,
      );
  }
}
```

- [ ] **Step 5: Add reusable analytics fakes**

Create `src/test/fakeAnalytics.ts`:

```ts
import type {
  AnalyticsConsent,
  AnalyticsConsentDecision,
  AnalyticsConsentStore,
  AnalyticsService,
} from '../application/analytics/analyticsService';
import type { AnalyticsEvent } from '../application/analytics/events';

export class FakeAnalyticsService implements AnalyticsService {
  readonly available = true;
  readonly events: AnalyticsEvent[] = [];
  readonly consentChanges: AnalyticsConsent[] = [];
  anonymousId: string | null = 'analytics-test-id';
  resetCalls = 0;

  async setConsent(consent: AnalyticsConsent): Promise<void> {
    this.consentChanges.push(consent);
  }

  track(event: AnalyticsEvent): void {
    this.events.push(event);
  }

  async getAnonymousId(): Promise<string | null> {
    return this.anonymousId;
  }

  async reset(): Promise<void> {
    this.resetCalls += 1;
    this.consentChanges.push('denied');
  }
}

export class MemoryAnalyticsConsentStore implements AnalyticsConsentStore {
  private decision: AnalyticsConsentDecision | null;
  private readonly now: () => number;

  constructor(
    decision: AnalyticsConsentDecision | null = null,
    now: () => number = () => 1,
  ) {
    this.decision = decision;
    this.now = now;
  }

  read(): AnalyticsConsentDecision | null {
    return this.decision ? { ...this.decision } : null;
  }

  write(status: AnalyticsConsentDecision['status']): AnalyticsConsentDecision {
    this.decision = { status, decidedAt: this.now() };
    return { ...this.decision };
  }
}
```

- [ ] **Step 6: Run the event-contract tests**

Run:

```powershell
npm test -- src\application\analytics\events.test.ts
```

Expected: PASS.

- [ ] **Step 7: Type-check the new contract**

Run:

```powershell
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Stage the checkpoint without committing**

Run:

```powershell
git add src\application\analytics\events.ts src\application\analytics\events.test.ts src\application\analytics\analyticsService.ts src\test\fakeAnalytics.ts
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: define privacy-safe analytics events`

---

### Task 2: Add device-local analytics consent storage

**Files:**
- Create: `src/infrastructure/analytics/localAnalyticsConsentStore.test.ts`
- Create: `src/infrastructure/analytics/localAnalyticsConsentStore.ts`

- [ ] **Step 1: Write the failing consent-store tests**

Create `src/infrastructure/analytics/localAnalyticsConsentStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { exportJson } from '../persistence/jsonBackup';
import { emptyAppState } from '../../domain/models/appState';
import {
  ANALYTICS_CONSENT_KEY,
  createLocalAnalyticsConsentStore,
} from './localAnalyticsConsentStore';

describe('local analytics consent store', () => {
  beforeEach(() => localStorage.clear());

  it('returns unknown as null when no decision exists', () => {
    const store = createLocalAnalyticsConsentStore(localStorage, () => 10);
    expect(store.read()).toBeNull();
  });

  it('persists the decision and timestamp outside AppState', () => {
    const store = createLocalAnalyticsConsentStore(localStorage, () => 123);
    expect(store.write('granted')).toEqual({
      status: 'granted',
      decidedAt: 123,
    });
    expect(store.read()).toEqual({
      status: 'granted',
      decidedAt: 123,
    });
    expect(exportJson(emptyAppState())).not.toContain(ANALYTICS_CONSENT_KEY);
  });

  it('discards a malformed stored decision and returns null', () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, '{"status":"maybe"}');
    const store = createLocalAnalyticsConsentStore(localStorage, () => 123);
    expect(store.read()).toBeNull();
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- src\infrastructure\analytics\localAnalyticsConsentStore.test.ts
```

Expected: FAIL because the consent store does not exist.

- [ ] **Step 3: Implement the local consent store**

Create `src/infrastructure/analytics/localAnalyticsConsentStore.ts`:

```ts
import type {
  AnalyticsConsentDecision,
  AnalyticsConsentStore,
} from '../../application/analytics/analyticsService';

export const ANALYTICS_CONSENT_KEY =
  'apnea-trainer.analytics-consent.v1';

function isDecision(value: unknown): value is AnalyticsConsentDecision {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.status === 'granted' || record.status === 'denied')
    && typeof record.decidedAt === 'number'
    && Number.isFinite(record.decidedAt)
  );
}

export function createLocalAnalyticsConsentStore(
  storage: Storage,
  now: () => number,
): AnalyticsConsentStore {
  return {
    read() {
      const raw = storage.getItem(ANALYTICS_CONSENT_KEY);
      if (raw === null) return null;

      try {
        const parsed: unknown = JSON.parse(raw);
        if (isDecision(parsed)) return parsed;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }

      storage.removeItem(ANALYTICS_CONSENT_KEY);
      return null;
    },
    write(status) {
      const decision = { status, decidedAt: now() };
      storage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify(decision));
      return decision;
    },
  };
}
```

- [ ] **Step 4: Run the consent-store tests**

Run:

```powershell
npm test -- src\infrastructure\analytics\localAnalyticsConsentStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Stage the checkpoint without committing**

Run:

```powershell
git add src\infrastructure\analytics\localAnalyticsConsentStore.ts src\infrastructure\analytics\localAnalyticsConsentStore.test.ts
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: persist analytics consent per device`

---

### Task 3: Implement the consent-gated GA4 adapter

**Files:**
- Create: `src/infrastructure/analytics/noopAnalytics.ts`
- Create: `src/infrastructure/analytics/ga4Analytics.test.ts`
- Create: `src/infrastructure/analytics/ga4Analytics.ts`

- [ ] **Step 1: Write failing GA4 adapter tests**

Create `src/infrastructure/analytics/ga4Analytics.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGa4Analytics } from './ga4Analytics';
import { noopAnalytics } from './noopAnalytics';

function dataLayerCommands() {
  return (
    (window as Window & { dataLayer?: unknown[][] }).dataLayer ?? []
  );
}

describe('GA4 analytics adapter', () => {
  beforeEach(() => {
    document.head.querySelectorAll('[data-apnea-ga4]').forEach((node) => {
      node.remove();
    });
    document.cookie.split(';').forEach((cookie) => {
      const name = cookie.split('=')[0]?.trim();
      if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
    });
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    delete (window as Window & { dataLayer?: unknown[][] }).dataLayer;
    delete (window as Window & { gtag?: unknown }).gtag;
    delete (
      window as Window & { 'ga-disable-G-TEST123'?: boolean }
    )['ga-disable-G-TEST123'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('provides a no-op fallback that never throws', async () => {
    expect(noopAnalytics.available).toBe(false);
    await expect(noopAnalytics.setConsent('granted')).resolves.toBeUndefined();
    expect(() => noopAnalytics.track({ name: 'goal_created' })).not.toThrow();
    await expect(noopAnalytics.getAnonymousId()).resolves.toBeNull();
    await expect(noopAnalytics.reset()).resolves.toBeUndefined();
  });

  it('does not load Google or send events before consent', async () => {
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });

    analytics.track({ name: 'goal_created' });
    await analytics.setConsent('unknown');

    expect(document.querySelector('[data-apnea-ga4]')).toBeNull();
    expect(dataLayerCommands()).toEqual([]);
  });

  it('loads once after consent with privacy-safe config', async () => {
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });

    await analytics.setConsent('granted');
    await analytics.setConsent('granted');

    expect(analytics.available).toBe(true);
    expect(document.querySelectorAll('[data-apnea-ga4]')).toHaveLength(1);
    expect(dataLayerCommands()).toContainEqual([
      'config',
      'G-TEST123',
      expect.objectContaining({
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      }),
    ]);
  });

  it('disables analytics for the page after one script-load warning', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });
    await analytics.setConsent('granted');
    const script = document.querySelector<HTMLScriptElement>(
      '[data-apnea-ga4]',
    )!;

    script.dispatchEvent(new Event('error'));
    script.dispatchEvent(new Event('error'));
    const commandCount = dataLayerCommands().length;
    analytics.track({ name: 'goal_created' });

    expect(dataLayerCommands()).toHaveLength(commandCount);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('adds common context and only serialized event properties', async () => {
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
      context: () => ({
        app_version: '1.2.3',
        install_mode: 'standalone',
        network_state: 'online',
      }),
    });
    await analytics.setConsent('granted');

    analytics.track({
      name: 'training_session_completed',
      sessionType: 'co2',
      durationBucket: '10_to_20m',
    });

    expect(dataLayerCommands()).toContainEqual([
      'event',
      'training_session_completed',
      {
        app_version: '1.2.3',
        install_mode: 'standalone',
        network_state: 'online',
        session_type: 'co2',
        duration_bucket: '10_to_20m',
      },
    ]);
  });

  it('drops invalid production events with one warning', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: false,
    });
    await analytics.setConsent('granted');
    const commandCount = dataLayerCommands().length;

    analytics.track({
      name: 'goal_created',
      targetHoldSec: 240,
    } as never);
    analytics.track({ name: 'unknown_event' } as never);

    expect(dataLayerCommands()).toHaveLength(commandCount);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('removes raw query data while retaining bounded campaign slugs', async () => {
    window.history.replaceState(
      {},
      '',
      '/stats?utm_source=reddit&utm_campaign=launch-2026'
        + '&utm_content=alice%40example.test&private_hold=240',
    );
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });
    await analytics.setConsent('granted');

    analytics.track({ name: 'goal_created' });

    const command = dataLayerCommands().find(
      (entry) => entry[0] === 'event' && entry[1] === 'goal_created',
    );
    expect(command?.[2]).toEqual(expect.objectContaining({
      page_location: `${window.location.origin}/stats`,
      campaign_source: 'reddit',
      campaign_name: 'launch-2026',
    }));
    expect(JSON.stringify(dataLayerCommands())).not.toMatch(
      /private_hold|alice|example\.test/i,
    );
  });

  it('stops tracking and clears GA identifiers on reset', async () => {
    document.cookie = '_ga=GA1.1.123.456; path=/';
    localStorage.setItem('_ga_test', 'value');
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });
    await analytics.setConsent('granted');
    await analytics.reset();
    const count = dataLayerCommands().length;

    analytics.track({ name: 'goal_created' });

    expect(dataLayerCommands()).toHaveLength(count);
    expect(document.cookie).not.toContain('_ga=');
    expect(localStorage.getItem('_ga_test')).toBeNull();
    expect(
      (window as Window & { 'ga-disable-G-TEST123'?: boolean })
        ['ga-disable-G-TEST123'],
    ).toBe(true);
  });

  it('restores analytics consent after an opt-out and later opt-in', async () => {
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });
    await analytics.setConsent('granted');
    await analytics.reset();
    await analytics.setConsent('granted');

    analytics.track({ name: 'goal_created' });

    expect(document.querySelectorAll('[data-apnea-ga4]')).toHaveLength(1);
    expect(
      (window as Window & { 'ga-disable-G-TEST123'?: boolean })
        ['ga-disable-G-TEST123'],
    ).toBe(false);
    expect(dataLayerCommands()).toContainEqual([
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'granted' }),
    ]);
    expect(dataLayerCommands()).toContainEqual([
      'event',
      'goal_created',
      expect.any(Object),
    ]);
  });

  it('returns the GA client id through the gtag get command', async () => {
    vi.useFakeTimers();
    const analytics = createGa4Analytics({
      measurementId: 'G-TEST123',
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();
    const command = dataLayerCommands().find(
      (entry) => entry[0] === 'get' && entry[2] === 'client_id',
    );
    const callback = command?.[3] as ((value: string) => void) | undefined;
    callback?.('client-123');

    await expect(result).resolves.toBe('client-123');
  });
});
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run:

```powershell
npm test -- src\infrastructure\analytics\ga4Analytics.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the no-op adapter**

Create `src/infrastructure/analytics/noopAnalytics.ts`:

```ts
import type { AnalyticsService } from '../../application/analytics/analyticsService';

export const noopAnalytics: AnalyticsService = {
  available: false,
  async setConsent() {},
  track() {},
  async getAnonymousId() { return null; },
  async reset() {},
};
```

- [ ] **Step 4: Implement the GA4 adapter**

Create `src/infrastructure/analytics/ga4Analytics.ts`:

```ts
import type {
  AnalyticsConsent,
  AnalyticsService,
} from '../../application/analytics/analyticsService';
import type { AnalyticsEvent } from '../../application/analytics/events';
import {
  normalizeAnalyticsPath,
  serializeAnalyticsEvent,
} from '../../application/analytics/events';

type GtagCommand = [command: string, ...args: unknown[]];

type GaDisableFlags = {
  [key in `ga-disable-${string}`]?: boolean;
};

type AnalyticsWindow = Window & GaDisableFlags & {
  dataLayer?: GtagCommand[];
  gtag?: (...args: GtagCommand) => void;
};

interface AnalyticsContext {
  app_version: string;
  install_mode: 'browser' | 'standalone';
  network_state: 'online' | 'offline';
  page_location?: string;
  page_referrer?: string;
  campaign_source?: string;
  campaign_medium?: string;
  campaign_name?: string;
  campaign_id?: string;
  campaign_term?: string;
  campaign_content?: string;
}

interface Ga4AnalyticsOptions {
  measurementId: string;
  strict: boolean;
  window?: Window;
  document?: Document;
  context?: () => AnalyticsContext;
}

const DENIED_CONSENT = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const;

const GRANTED_ANALYTICS_CONSENT = {
  ...DENIED_CONSENT,
  analytics_storage: 'granted',
} as const;

const CAMPAIGN_PARAMETERS = {
  utm_source: 'campaign_source',
  utm_medium: 'campaign_medium',
  utm_campaign: 'campaign_name',
  utm_id: 'campaign_id',
  utm_term: 'campaign_term',
  utm_content: 'campaign_content',
} as const;

function safeCampaignValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (
    !trimmed
    || trimmed.length > 80
    || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

function sanitizedLocation(origin: string, pathname: string): string {
  return `${origin}${normalizeAnalyticsPath(pathname)}`;
}

function sanitizedReferrer(value: string): string | undefined {
  if (value === '') return undefined;
  try {
    const referrer = new URL(value);
    return sanitizedLocation(referrer.origin, referrer.pathname);
  } catch {
    return undefined;
  }
}

function defaultContext(win: Window, doc: Document): AnalyticsContext {
  const navigatorWithStandalone = win.navigator as Navigator & {
    standalone?: boolean;
  };
  const standalone =
    win.matchMedia?.('(display-mode: standalone)').matches
    || navigatorWithStandalone.standalone === true;

  const result: AnalyticsContext = {
    app_version:
      typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    install_mode: standalone ? 'standalone' : 'browser',
    network_state: win.navigator.onLine ? 'online' : 'offline',
    page_location: sanitizedLocation(
      win.location.origin,
      win.location.pathname,
    ),
  };
  const pageReferrer = sanitizedReferrer(doc.referrer);
  if (pageReferrer) result.page_referrer = pageReferrer;

  const search = new URLSearchParams(win.location.search);
  for (
    const queryName of Object.keys(CAMPAIGN_PARAMETERS) as Array<
      keyof typeof CAMPAIGN_PARAMETERS
    >
  ) {
    const contextName = CAMPAIGN_PARAMETERS[queryName];
    const value = safeCampaignValue(search.get(queryName));
    if (value) result[contextName] = value;
  }
  return result;
}

function clearAnalyticsIdentifiers(win: Window, doc: Document): void {
  const hostnameParts = win.location.hostname.split('.');
  const domains = new Set<string | null>([null]);
  for (
    let index = 0;
    index < hostnameParts.length - 1;
    index += 1
  ) {
    const domain = hostnameParts.slice(index).join('.');
    domains.add(domain);
    domains.add(`.${domain}`);
  }

  for (const rawCookie of doc.cookie.split(';')) {
    const name = rawCookie.split('=')[0]?.trim();
    if (name === '_ga' || name?.startsWith('_ga_')) {
      for (const domain of domains) {
        const domainAttribute = domain ? `; domain=${domain}` : '';
        doc.cookie =
          `${name}=; Max-Age=0; path=/${domainAttribute}; SameSite=Lax`;
      }
    }
  }

  for (let index = win.localStorage.length - 1; index >= 0; index -= 1) {
    const key = win.localStorage.key(index);
    if (key === '_ga' || key?.startsWith('_ga_')) {
      win.localStorage.removeItem(key);
    }
  }
}

export function createGa4Analytics(
  options: Ga4AnalyticsOptions,
): AnalyticsService {
  const win = (options.window ?? window) as AnalyticsWindow;
  const doc = options.document ?? document;
  const context = options.context ?? (() => defaultContext(win, doc));
  const disableKey = `ga-disable-${options.measurementId}` as const;
  let consented = false;
  let initialized = false;
  let failed = false;
  let warned = false;

  function warn(message: string, error?: unknown): void {
    if (warned) return;
    warned = true;
    console.warn(message, error);
  }

  function ensureCommandQueue(): void {
    win.dataLayer ??= [];
    win.gtag ??= (...args: GtagCommand) => {
      win.dataLayer!.push(args);
    };
  }

  function ensureInitialized(): void {
    if (initialized || failed) return;
    ensureCommandQueue();

    const initialContext = context();
    win.gtag!('consent', 'default', DENIED_CONSENT);
    win.gtag!('consent', 'update', GRANTED_ANALYTICS_CONSENT);
    win.gtag!('js', new Date());
    win.gtag!('set', initialContext);
    win.gtag!('config', options.measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ...initialContext,
    });

    const script = doc.createElement('script');
    script.async = true;
    script.src =
      `https://www.googletagmanager.com/gtag/js?id=${
        encodeURIComponent(options.measurementId)
      }`;
    script.dataset.apneaGa4 = 'true';
    script.onerror = (error) => {
      failed = true;
      if (options.strict) {
        warn(
          'GA4 failed to load; analytics is disabled for this page.',
          error,
        );
      }
    };
    doc.head.append(script);
    initialized = true;
  }

  function dispatch(event: AnalyticsEvent): void {
    const serialized = serializeAnalyticsEvent(event);
    const eventContext = context();
    if (serialized.name === 'page_view') {
      win.gtag!('set', eventContext);
    }
    win.gtag!(
      'event',
      serialized.name,
      { ...eventContext, ...serialized.properties },
    );
  }

  return {
    available: true,
    async setConsent(consent: AnalyticsConsent) {
      consented = consent === 'granted';
      win[disableKey] = !consented;
      if (consented) {
        if (initialized && win.gtag) {
          win.gtag('consent', 'update', GRANTED_ANALYTICS_CONSENT);
        } else {
          ensureInitialized();
        }
        return;
      }

      if (win.gtag) {
        win.gtag('consent', 'update', DENIED_CONSENT);
      }
      if (consent === 'denied') {
        clearAnalyticsIdentifiers(win, doc);
      }
    },
    track(event) {
      if (!consented || failed) return;
      ensureInitialized();
      if (!win.gtag) return;

      try {
        dispatch(event);
      } catch (error) {
        if (options.strict) throw error;
        warn('An invalid analytics event was dropped.', error);
      }
    },
    async getAnonymousId() {
      if (!consented || failed) return null;
      ensureInitialized();
      if (!win.gtag) return null;

      return new Promise<string | null>((resolve) => {
        const timeout = win.setTimeout(() => resolve(null), 5_000);
        win.gtag!(
          'get',
          options.measurementId,
          'client_id',
          (value: unknown) => {
            win.clearTimeout(timeout);
            resolve(typeof value === 'string' ? value : null);
          },
        );
      });
    },
    async reset() {
      consented = false;
      win[disableKey] = true;
      if (win.gtag) {
        win.gtag('consent', 'update', DENIED_CONSENT);
      }
      clearAnalyticsIdentifiers(win, doc);
    },
  };
}
```

- [ ] **Step 5: Run the GA4 adapter tests**

Run:

```powershell
npm test -- src\infrastructure\analytics\ga4Analytics.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run contract and adapter tests together**

Run:

```powershell
npm test -- src\application\analytics\events.test.ts src\infrastructure\analytics\ga4Analytics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Stage the checkpoint without committing**

Run:

```powershell
git add src\infrastructure\analytics\noopAnalytics.ts src\infrastructure\analytics\ga4Analytics.ts src\infrastructure\analytics\ga4Analytics.test.ts
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: add consent-gated GA4 adapter`

---

### Task 4: Inject analytics through the existing service bundle

**Files:**
- Modify: `src/ui/app/services.tsx`
- Modify: `src/infrastructure/device/productionServices.ts`
- Modify: `src/infrastructure/device/productionServices.test.ts`
- Modify: `src/ui/app/services.test.tsx`
- Modify: `src/vite-env-app.d.ts`

- [ ] **Step 1: Extend the service-bundle tests first**

In `src/infrastructure/device/productionServices.test.ts`, add:

```ts
expect(typeof s.analytics.track).toBe('function');
expect(typeof s.analyticsConsent.read).toBe('function');
```

Also import `afterEach`, `vi`, and `noopAnalytics`, restore environment stubs
after each test, and add:

```ts
import { noopAnalytics } from '../analytics/noopAnalytics';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('uses no-op analytics for an invalid GA4 measurement id', () => {
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'not-a-ga4-id');
  expect(productionServices().analytics).toBe(noopAnalytics);
});

it('uses no-op analytics when the privacy contact is missing', () => {
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', '');
  expect(productionServices().analytics).toBe(noopAnalytics);
});

it('builds analytics when both public values are valid', () => {
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv(
    'VITE_PRIVACY_CONTACT_EMAIL',
    'privacy@apneatrainer.test',
  );
  expect(productionServices().analytics).not.toBe(noopAnalytics);
});
```

In `src/ui/app/services.test.tsx`, change `Probe` to read analytics too:

```tsx
function Probe() {
  const { analytics, clock } = useServices();
  return (
    <span>
      now:{clock.now() > 0 ? 'ok' : 'bad'} analytics:
      {typeof analytics.track === 'function' ? 'ok' : 'bad'}
    </span>
  );
}
```

Update the assertion to:

```ts
expect(screen.getByText(/now:ok analytics:ok/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run:

```powershell
npm test -- src\infrastructure\device\productionServices.test.ts src\ui\app\services.test.tsx
```

Expected: FAIL because `Services` has no analytics members.

- [ ] **Step 3: Type the Vite variables**

Replace `src/vite-env-app.d.ts` with:

```ts
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_PRIVACY_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Add analytics to `Services`**

Add these imports to `src/ui/app/services.tsx`:

```ts
import type {
  AnalyticsConsentStore,
  AnalyticsService,
} from '../../application/analytics/analyticsService';
```

Add these fields to `Services`:

```ts
analytics: AnalyticsService;
analyticsConsent: AnalyticsConsentStore;
```

- [ ] **Step 5: Build production analytics services**

Add these imports to `src/infrastructure/device/productionServices.ts`:

```ts
import { createGa4Analytics } from '../analytics/ga4Analytics';
import { noopAnalytics } from '../analytics/noopAnalytics';
import { createLocalAnalyticsConsentStore } from '../analytics/localAnalyticsConsentStore';
```

Add this module-level diagnostic guard:

```ts
let warnedAboutMissingAnalytics = false;
```

At the beginning of `productionServices`, add:

```ts
const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() ?? '';
const privacyContact =
  import.meta.env.VITE_PRIVACY_CONTACT_EMAIL?.trim() ?? '';
const analyticsConfigured =
  /^G-[A-Z0-9]+$/.test(measurementId)
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyContact);
if (
  !analyticsConfigured
  && import.meta.env.DEV
  && !warnedAboutMissingAnalytics
) {
  warnedAboutMissingAnalytics = true;
  console.info(
    '[analytics] Valid GA4 and privacy-contact configuration is missing; '
      + 'using no-op analytics.',
  );
}
const analytics = analyticsConfigured
  ? createGa4Analytics({
      measurementId,
      strict: import.meta.env.DEV,
    })
  : noopAnalytics;
```

Add these properties to the returned bundle:

```ts
analytics,
analyticsConsent: createLocalAnalyticsConsentStore(
  window.localStorage,
  () => Date.now(),
),
```

- [ ] **Step 6: Run service tests and type-check**

Run:

```powershell
npm test -- src\infrastructure\device\productionServices.test.ts src\ui\app\services.test.tsx
npx tsc --noEmit
```

Expected: both commands PASS.

- [ ] **Step 7: Stage the checkpoint without committing**

Run:

```powershell
git add src\ui\app\services.tsx src\ui\app\services.test.tsx src\infrastructure\device\productionServices.ts src\infrastructure\device\productionServices.test.ts src\vite-env-app.d.ts
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: inject analytics services`

---

### Task 5: Add the analytics consent provider

**Files:**
- Create: `src/ui/analytics/AnalyticsConsentProvider.test.tsx`
- Create: `src/ui/analytics/AnalyticsConsentProvider.tsx`

- [ ] **Step 1: Write failing provider tests**

Create `src/ui/analytics/AnalyticsConsentProvider.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesProvider } from '../app/services';
import {
  AnalyticsConsentProvider,
  useAnalyticsConsent,
} from './AnalyticsConsentProvider';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import { noopAnalytics } from '../../infrastructure/analytics/noopAnalytics';

function Probe() {
  const {
    available,
    consent,
    ready,
    error,
    choose,
    getAnonymousId,
  } = useAnalyticsConsent();
  return (
    <>
      <span>consent:{consent}</span>
      <span>available:{String(available)}</span>
      <span>ready:{String(ready)}</span>
      {error && <span role="alert">{error}</span>}
      <button onClick={() => void choose('granted')}>grant</button>
      <button onClick={() => void choose('denied')}>deny</button>
      <button
        onClick={() => void getAnonymousId().then((id) => {
          document.body.dataset.analyticsId = id ?? '';
        })}
      >
        id
      </button>
    </>
  );
}

describe('AnalyticsConsentProvider', () => {
  beforeEach(() => {
    delete document.body.dataset.analyticsId;
  });

  it('starts unknown with no stored decision', async () => {
    render(
      <ServicesProvider value={{
        analytics: new FakeAnalyticsService(),
        analyticsConsent: new MemoryAnalyticsConsentStore(),
      }}>
        <AnalyticsConsentProvider><Probe /></AnalyticsConsentProvider>
      </ServicesProvider>,
    );
    expect(screen.getByText('consent:unknown')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('ready:true')).toBeInTheDocument();
    });

    it('reports ready but unavailable for a no-op analytics build', async () => {
      render(
        <ServicesProvider value={{
          analytics: noopAnalytics,
          analyticsConsent: new MemoryAnalyticsConsentStore(),
        }}>
          <AnalyticsConsentProvider><Probe /></AnalyticsConsentProvider>
        </ServicesProvider>,
      );
      await waitFor(() => {
        expect(screen.getByText('ready:true')).toBeInTheDocument();
      });
      expect(screen.getByText('available:false')).toBeInTheDocument();
      expect(screen.getByText('consent:unknown')).toBeInTheDocument();
    });
  });

  it('persists and applies granted consent', async () => {
    const analytics = new FakeAnalyticsService();
    const store = new MemoryAnalyticsConsentStore();
    render(
      <ServicesProvider value={{ analytics, analyticsConsent: store }}>
        <AnalyticsConsentProvider><Probe /></AnalyticsConsentProvider>
      </ServicesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('ready:true')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'grant' }));
    await waitFor(() => {
      expect(screen.getByText('consent:granted')).toBeInTheDocument();
    });
    expect(store.read()?.status).toBe('granted');
    expect(analytics.consentChanges).toContain('granted');
  });

  it('uses reset when consent is denied', async () => {
    const analytics = new FakeAnalyticsService();
    render(
      <ServicesProvider value={{
        analytics,
        analyticsConsent: new MemoryAnalyticsConsentStore(),
      }}>
        <AnalyticsConsentProvider><Probe /></AnalyticsConsentProvider>
      </ServicesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('ready:true')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'deny' }));
    await waitFor(() => {
      expect(screen.getByText('consent:denied')).toBeInTheDocument();
    });
    expect(analytics.resetCalls).toBe(1);
  });

  it('surfaces consent persistence failures without applying consent', async () => {
    const analytics = new FakeAnalyticsService();
    const store = {
      read: () => null,
      write: () => {
        throw new Error('storage unavailable');
      },
    };
    render(
      <ServicesProvider value={{ analytics, analyticsConsent: store }}>
        <AnalyticsConsentProvider><Probe /></AnalyticsConsentProvider>
      </ServicesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('ready:true')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    expect(await screen.findByRole('alert'))
      .toHaveTextContent(/storage unavailable/i);
    expect(screen.getByText('consent:unknown')).toBeInTheDocument();
    expect(analytics.consentChanges).not.toContain('granted');
  });
});
```

- [ ] **Step 2: Run the provider tests to verify they fail**

Run:

```powershell
npm test -- src\ui\analytics\AnalyticsConsentProvider.test.tsx
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement the provider**

Create `src/ui/analytics/AnalyticsConsentProvider.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AnalyticsConsent } from '../../application/analytics/analyticsService';
import { useServices } from '../app/services';

interface AnalyticsConsentContextValue {
  available: boolean;
  consent: AnalyticsConsent;
  ready: boolean;
  error: string | null;
  choose(next: Exclude<AnalyticsConsent, 'unknown'>): Promise<void>;
  getAnonymousId(): Promise<string | null>;
}

const AnalyticsConsentContext =
  createContext<AnalyticsConsentContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Could not save the analytics preference';
}

export function AnalyticsConsentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { analytics, analyticsConsent } = useServices();
  const [initial] = useState(() => {
    try {
      return {
        consent: analyticsConsent.read()?.status ?? 'unknown' as AnalyticsConsent,
        error: null as string | null,
      };
    } catch (error) {
      return {
        consent: 'unknown' as AnalyticsConsent,
        error: errorMessage(error),
      };
    }
  });
  const [consent, setConsent] = useState<AnalyticsConsent>(initial.consent);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(initial.error);

  useEffect(() => {
    let cancelled = false;
    async function applyInitialConsent() {
      if (!analytics.available) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        if (initial.consent === 'denied') {
          await analytics.reset();
        } else {
          await analytics.setConsent(initial.consent);
        }
      } catch (applyError) {
        if (!cancelled) setError(errorMessage(applyError));
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void applyInitialConsent();
    return () => {
      cancelled = true;
    };
  }, [analytics, initial.consent]);

  const choose = useCallback(async (
    next: Exclude<AnalyticsConsent, 'unknown'>,
  ): Promise<void> => {
    setError(null);
    if (!analytics.available) {
      setError('Analytics is unavailable in this build');
      return;
    }
    setReady(false);
    try {
      analyticsConsent.write(next);
      if (next === 'denied') {
        await analytics.reset();
      } else {
        await analytics.setConsent(next);
      }
      setConsent(next);
    } catch (choiceError) {
      setError(errorMessage(choiceError));
    } finally {
      setReady(true);
    }
  }, [analytics, analyticsConsent]);

  const getAnonymousId = useCallback(
    () => analytics.getAnonymousId(),
    [analytics],
  );

  const value = useMemo<AnalyticsConsentContextValue>(() => ({
    available: analytics.available,
    consent,
    ready,
    error,
    choose,
    getAnonymousId,
  }), [
    analytics.available,
    choose,
    consent,
    error,
    getAnonymousId,
    ready,
  ]);

  return (
    <AnalyticsConsentContext.Provider value={value}>
      {children}
    </AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent(): AnalyticsConsentContextValue {
  const context = useContext(AnalyticsConsentContext);
  if (!context) {
    throw new Error(
      'useAnalyticsConsent requires AnalyticsConsentProvider',
    );
  }
  return context;
}
```

- [ ] **Step 4: Run provider tests**

Run:

```powershell
npm test -- src\ui\analytics\AnalyticsConsentProvider.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Stage the checkpoint without committing**

Run:

```powershell
git add src\ui\analytics\AnalyticsConsentProvider.tsx src\ui\analytics\AnalyticsConsentProvider.test.tsx
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: manage analytics consent`

---

### Task 6: Add consent, Privacy, and Settings UI

**Files:**
- Create: `src/ui/analytics/AnalyticsConsentPrompt.test.tsx`
- Create: `src/ui/analytics/AnalyticsConsentPrompt.tsx`
- Create: `src/ui/screens/PrivacyScreen.test.tsx`
- Create: `src/ui/screens/PrivacyScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/app/routes.tsx`
- Modify: `src/ui/app/routes.test.tsx`
- Modify: `src/ui/screens/SettingsScreen.tsx`
- Modify: `src/ui/screens/SettingsScreen.test.tsx`
- Modify: `src/ui/screens/SettingsScreen.version.test.tsx`

- [ ] **Step 1: Write failing prompt and Privacy tests**

Create `src/ui/analytics/AnalyticsConsentPrompt.test.tsx`:

```tsx
import { expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import {
  AnalyticsConsentProvider,
  useAnalyticsConsent,
} from './AnalyticsConsentProvider';
import { AnalyticsConsentPrompt } from './AnalyticsConsentPrompt';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import { noopAnalytics } from '../../infrastructure/analytics/noopAnalytics';

function renderPrompt(path = '/') {
  const analytics = new FakeAnalyticsService();
  const store = new MemoryAnalyticsConsentStore();
  render(
    <ServicesProvider value={{ analytics, analyticsConsent: store }}>
      <AnalyticsConsentProvider>
        <MemoryRouter initialEntries={[path]}>
          <AnalyticsConsentPrompt />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  return { analytics, store };
}

function ReadyProbe() {
  const { ready } = useAnalyticsConsent();
  return <span>{ready ? 'analytics-ready' : 'analytics-loading'}</span>;
}

it('offers equally clear accept and decline choices', async () => {
  const { store } = renderPrompt();
  expect(await screen.findByRole('dialog', { name: /anonymous analytics/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /share usage analytics/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /do not share/i }))
    .toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: /do not share/i }),
  );
  expect(store.read()?.status).toBe('denied');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

it.each(['/runner', '/baseline', '/privacy'])(
  'does not interrupt the protected route %s',
  async (path) => {
    const { analytics } = renderPrompt(path);
    await waitFor(() => {
      expect(analytics.consentChanges).toContain('unknown');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);

it('does not request consent when analytics is unavailable', async () => {
  render(
    <ServicesProvider value={{
      analytics: noopAnalytics,
      analyticsConsent: new MemoryAnalyticsConsentStore(),
    }}>
      <AnalyticsConsentProvider>
        <MemoryRouter>
          <AnalyticsConsentPrompt />
          <ReadyProbe />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  expect(await screen.findByText('analytics-ready')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
```

Create `src/ui/screens/PrivacyScreen.test.tsx`:

```tsx
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyScreen } from './PrivacyScreen';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('discloses collected and prohibited analytics data', () => {
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'privacy@apneatrainer.test');
  render(<PrivacyScreen />);
  expect(screen.getByText(/Google Analytics 4/i)).toBeInTheDocument();
  expect(screen.getByText(/exact hold times are not collected/i))
    .toBeInTheDocument();
  expect(screen.getByText(/coarse country and device category/i))
    .toBeInTheDocument();
  expect(screen.getByRole('link', { name: /privacy@apneatrainer.test/i }))
    .toHaveAttribute('href', 'mailto:privacy@apneatrainer.test');
});

it('does not render an invalid privacy contact as a mail link', () => {
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'not-an-email');
  render(<PrivacyScreen />);
  expect(screen.getByText(/privacy contact is not configured/i))
    .toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /not-an-email/i }))
    .not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add failing route and Settings expectations**

In `src/ui/app/routes.test.tsx`, add:

```ts
it('renders Privacy at /privacy', async () => {
  renderAt('/privacy');
  expect(await screen.findByRole('heading', { name: /privacy/i }))
    .toBeInTheDocument();
});
```

Also add the analytics imports and replace `renderAt` in
`src/ui/app/routes.test.tsx` so routes that render Settings have the required
consent context:

```tsx
import {
  AnalyticsConsentProvider,
} from '../analytics/AnalyticsConsentProvider';

function renderAt(path: string) {
  return render(
    <ServicesProvider>
      <AnalyticsConsentProvider>
        <AppProviders>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>
  );
}
```

In `src/ui/screens/SettingsScreen.test.tsx`, add these imports:

```tsx
import {
  AnalyticsConsentProvider,
} from '../analytics/AnalyticsConsentProvider';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import type { StateRepository } from '../../domain/ports/stateRepository';
```

Add this renderer and convert each existing test to pass its repository through
`renderSettings({ repository })` instead of rendering the screen directly:

```tsx
function memoryRepository(
  initialState = emptyAppState(),
): StateRepository {
  let state = initialState;
  return {
    async getState() {
      return state;
    },
    async setState(next) {
      state = next;
    },
  };
}

interface RenderSettingsOptions {
  repository?: StateRepository;
  analytics?: FakeAnalyticsService;
  analyticsConsent?: MemoryAnalyticsConsentStore;
}

function renderSettings({
  repository = memoryRepository(),
  analytics = new FakeAnalyticsService(),
  analyticsConsent = new MemoryAnalyticsConsentStore(),
}: RenderSettingsOptions = {}) {
  render(
    <ServicesProvider value={{
      repository,
      analytics,
      analyticsConsent,
    }}>
      <AnalyticsConsentProvider>
        <AppProviders>
          <MemoryRouter>
            <SettingsScreen />
          </MemoryRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  return { analytics, analyticsConsent, repository };
}
```

Then add:

```ts
it('can enable analytics and display the anonymous identifier', async () => {
  const analytics = new FakeAnalyticsService();
  renderSettings({ analytics });

  const toggle = await screen.findByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);

  expect(toggle).toBeChecked();
  expect(await screen.findByDisplayValue('analytics-test-id'))
    .toBeInTheDocument();
});

it('can withdraw analytics consent and hide the identifier', async () => {
  const analytics = new FakeAnalyticsService();
  const analyticsConsent = new MemoryAnalyticsConsentStore({
    status: 'granted',
    decidedAt: 1,
  });
  renderSettings({ analytics, analyticsConsent });

  const toggle = await screen.findByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toBeChecked();
  expect(await screen.findByDisplayValue('analytics-test-id'))
    .toBeInTheDocument();

  await userEvent.click(toggle);

  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(analyticsConsent.read()?.status).toBe('denied');
  expect(analytics.resetCalls).toBe(1);
  expect(screen.queryByLabelText(/anonymous analytics identifier/i))
    .not.toBeInTheDocument();
});
```

In `src/ui/screens/SettingsScreen.version.test.tsx`, import
`AnalyticsConsentProvider` and replace the render tree with:

```tsx
render(
  <ServicesProvider>
    <AnalyticsConsentProvider>
      <AppProviders>
        <MemoryRouter><SettingsScreen /></MemoryRouter>
      </AppProviders>
    </AnalyticsConsentProvider>
  </ServicesProvider>,
);
```

- [ ] **Step 3: Run the UI tests to verify they fail**

Run:

```powershell
npm test -- src\ui\analytics\AnalyticsConsentPrompt.test.tsx src\ui\screens\PrivacyScreen.test.tsx src\ui\app\routes.test.tsx src\ui\screens\SettingsScreen.test.tsx src\ui\screens\SettingsScreen.version.test.tsx
```

Expected: FAIL because the UI and route do not exist.

- [ ] **Step 4: Implement the consent prompt**

Create `src/ui/analytics/AnalyticsConsentPrompt.tsx`:

```tsx
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { useAnalyticsConsent } from './AnalyticsConsentProvider';

const SUPPRESSED_ROUTES = new Set(['/runner', '/baseline', '/privacy']);

export function AnalyticsConsentPrompt() {
  const location = useLocation();
  const {
    available,
    consent,
    ready,
    error,
    choose,
  } = useAnalyticsConsent();
  const [saving, setSaving] = useState(false);

  if (
    !ready
    || !available
    || consent !== 'unknown'
    || SUPPRESSED_ROUTES.has(location.pathname)
  ) {
    return null;
  }

  async function decide(next: 'granted' | 'denied') {
    setSaving(true);
    await choose(next);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-consent-title"
        className="mx-auto w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5"
      >
        <h2 id="analytics-consent-title" className="text-lg font-semibold">
          Anonymous analytics
        </h2>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Share anonymous app usage so we can improve the experience and
          estimate whether non-training screens could support ads. Exact hold
          times, goals, contractions, and reminder times are never collected.
        </p>
        <Link
          className="mt-2 inline-block text-sm text-[color:var(--cyan)]"
          to="/privacy"
        >
          Read the privacy details
        </Link>
        {error && (
          <p role="alert" className="mt-3 text-sm text-[color:var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-4 grid gap-2">
          <Button
            disabled={saving}
            onClick={() => void decide('granted')}
          >
            Share usage analytics
          </Button>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void decide('denied')}
          >
            Do not share
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement the Privacy screen**

Create `src/ui/screens/PrivacyScreen.tsx`:

```tsx
import { Card } from '../design-system/Card';

export function PrivacyScreen() {
  const configuredContact =
    import.meta.env.VITE_PRIVACY_CONTACT_EMAIL?.trim() ?? '';
  const contact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredContact)
    ? configuredContact
    : '';

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Privacy</h2>
      <Card>
        <h3 className="font-semibold">Anonymous usage analytics</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          If you opt in, this app uses Google Analytics 4 to measure screens,
          onboarding and session completion, retention, and possible future ad
          locations.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">What is never collected</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Exact hold times are not collected. Neither are baseline or goal
          values, contraction counts, RPE, reminder times, free text, backup
          data, or precise location.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">Aggregate reporting</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Reports may include coarse country and device category supplied by
          GA4, but not precise location. Analytics reports cover only people
          who opted in and are not a complete count of app users.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">Your controls</h3>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          You can withdraw consent in Settings. This stops collection and
          clears the analytics identifier stored on this device. GA4
          user-level event data is configured for two-month retention. Google
          processes opted-in analytics data under its{' '}
          <a
            className="text-[color:var(--cyan)]"
            href="https://policies.google.com/privacy"
            rel="noreferrer"
            target="_blank"
          >
            privacy policy
          </a>.
        </p>
      </Card>
      <Card>
        <h3 className="font-semibold">Access or deletion request</h3>
        {contact ? (
          <p className="mt-2 text-sm text-[color:var(--text-dim)]">
            If you want previously collected data deleted, copy the anonymous
            analytics identifier from Settings before turning analytics off;
            withdrawal clears it from this device. Include that identifier and
            email{' '}
            <a className="text-[color:var(--cyan)]" href={`mailto:${contact}`}>
              {contact}
            </a>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-[color:var(--danger)]">
            The privacy contact is not configured in this build.
          </p>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Mount consent UI and add the Privacy route**

Update `src/App.tsx` to:

```tsx
import { BrowserRouter } from 'react-router-dom';
import { ServicesProvider } from './ui/app/services';
import { AppProviders } from './ui/app/stores';
import { AppRoutes } from './ui/app/routes';
import { UpdatePrompt } from './ui/pwa/UpdatePrompt';
import {
  AnalyticsConsentProvider,
} from './ui/analytics/AnalyticsConsentProvider';
import { AnalyticsConsentPrompt } from './ui/analytics/AnalyticsConsentPrompt';

export default function App() {
  return (
    <ServicesProvider>
      <AnalyticsConsentProvider>
        <AppProviders>
          <BrowserRouter>
            <AppRoutes />
            <AnalyticsConsentPrompt />
            <UpdatePrompt />
          </BrowserRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>
  );
}
```

In `src/ui/app/routes.tsx`, import `PrivacyScreen` and add:

```tsx
<Route
  path="/privacy"
  element={<AppShell><PrivacyScreen /></AppShell>}
/>
```

- [ ] **Step 7: Add analytics controls to Settings**

In `src/ui/screens/SettingsScreen.tsx`:

1. Import `Link` from `react-router-dom`.
2. Import `useEffect`.
3. Import `useAnalyticsConsent`.
4. Add local `analyticsId` state.
5. Add this effect:

```tsx
const {
  available: analyticsAvailable,
  consent,
  ready,
  error: analyticsError,
  choose,
  getAnonymousId,
} = useAnalyticsConsent();
const [analyticsId, setAnalyticsId] =
  useState<string | null | undefined>(undefined);

useEffect(() => {
  let cancelled = false;
  if (!analyticsAvailable || !ready || consent !== 'granted') {
    setAnalyticsId(undefined);
    return;
  }
  setAnalyticsId(undefined);
  void getAnonymousId().then((id) => {
    if (!cancelled) setAnalyticsId(id);
  }).catch(() => {
    if (!cancelled) setAnalyticsId(null);
  });
  return () => {
    cancelled = true;
  };
}, [analyticsAvailable, consent, getAnonymousId, ready]);
```

After the Data card, add:

```tsx
<Card>
  <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
    Privacy
  </div>
  <label className="flex items-center justify-between gap-4 py-1 text-sm">
    <span>Share anonymous usage analytics</span>
    <input
      type="checkbox"
      aria-label="Share anonymous usage analytics"
      checked={consent === 'granted'}
      disabled={!analyticsAvailable || !ready}
      onChange={(event) => {
        void choose(event.target.checked ? 'granted' : 'denied');
      }}
    />
  </label>
  {analyticsAvailable && consent === 'granted' && (
    <label className="mt-2 block text-xs text-[color:var(--text-dim)]">
      Anonymous analytics identifier
      <input
        readOnly
        aria-label="Anonymous analytics identifier"
        value={
          analyticsId === undefined
            ? 'Loading...'
            : analyticsId ?? 'Unavailable'
        }
        className="mt-1 w-full rounded-lg bg-[color:var(--surface-2)] px-2 py-1 font-mono"
      />
      <span className="mt-1 block">
        Copy this before turning analytics off if you want to request deletion.
      </span>
    </label>
  )}
  {analyticsError && (
    <p role="alert" className="mt-2 text-sm text-[color:var(--danger)]">
      {analyticsError}
    </p>
  )}
  {!analyticsAvailable && (
    <p className="mt-2 text-xs text-[color:var(--text-dim)]">
      Analytics is not configured in this build.
    </p>
  )}
  <Link
    className="mt-3 inline-block text-sm text-[color:var(--cyan)]"
    to="/privacy"
  >
    Privacy details
  </Link>
</Card>
```

Do not add analytics consent to `AppState` or JSON backup.

- [ ] **Step 8: Run the consent, Privacy, route, and Settings tests**

Run:

```powershell
npm test -- src\ui\analytics\AnalyticsConsentPrompt.test.tsx src\ui\screens\PrivacyScreen.test.tsx src\ui\app\routes.test.tsx src\ui\screens\SettingsScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Stage the checkpoint without committing**

Run:

```powershell
git add src\App.tsx src\ui\analytics\AnalyticsConsentPrompt.tsx src\ui\analytics\AnalyticsConsentPrompt.test.tsx src\ui\screens\PrivacyScreen.tsx src\ui\screens\PrivacyScreen.test.tsx src\ui\app\routes.tsx src\ui\app\routes.test.tsx src\ui\screens\SettingsScreen.tsx src\ui\screens\SettingsScreen.test.tsx src\ui\screens\SettingsScreen.version.test.tsx
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: add analytics privacy controls`

---

### Task 7: Track consented SPA page views and PWA installation

**Files:**
- Create: `src/ui/analytics/AnalyticsRouteTracker.test.tsx`
- Create: `src/ui/analytics/AnalyticsRouteTracker.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing route-tracker tests**

Create `src/ui/analytics/AnalyticsRouteTracker.test.tsx`:

```tsx
import { StrictMode } from 'react';
import { expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import {
  AnalyticsConsentProvider,
} from './AnalyticsConsentProvider';
import { AnalyticsRouteTracker } from './AnalyticsRouteTracker';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';

function NavigationProbe() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/stats')}>open stats</button>;
}

function renderTracker(
  path: string,
  consent: 'granted' | 'denied',
  strict = false,
) {
  const analytics = new FakeAnalyticsService();
  const content = (
    <ServicesProvider value={{
      analytics,
      analyticsConsent: new MemoryAnalyticsConsentStore({
        status: consent,
        decidedAt: 1,
      }),
    }}>
      <AnalyticsConsentProvider>
        <MemoryRouter initialEntries={[path]}>
          <AnalyticsRouteTracker />
          <NavigationProbe />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>
  );
  render(strict ? <StrictMode>{content}</StrictMode> : content);
  return analytics;
}

it('tracks a normalized page view only after consent', async () => {
  const analytics = renderTracker('/stats?focus=goal#chart', 'granted');
  await waitFor(() => {
    expect(analytics.events).toEqual([{
      name: 'page_view',
      path: '/stats',
      surface: 'stats',
    }]);
  });

  it('tracks each real SPA navigation once', async () => {
    const analytics = renderTracker('/', 'granted');
    await waitFor(() => {
      expect(analytics.events.filter((event) => event.name === 'page_view'))
        .toHaveLength(1);
    });

    await userEvent.click(
      screen.getByRole('button', { name: /open stats/i }),
    );

    await waitFor(() => {
      expect(analytics.events.filter((event) => event.name === 'page_view'))
        .toEqual([
          { name: 'page_view', path: '/', surface: 'home' },
          { name: 'page_view', path: '/stats', surface: 'stats' },
        ]);
    });
  });
});

it('tracks onboarding start when the consented route is entered', async () => {
  const analytics = renderTracker('/onboarding', 'granted');
  await waitFor(() => {
    expect(analytics.events).toContainEqual({
      name: 'onboarding_started',
    });
  });
});

it('does not track a page view when denied', async () => {
  const analytics = renderTracker('/stats', 'denied');
  await waitFor(() => expect(analytics.resetCalls).toBe(1));
  expect(analytics.events).toEqual([]);
});

it('deduplicates the Strict Mode effect', async () => {
  const analytics = renderTracker('/calendar', 'granted', true);
  await waitFor(() => {
    expect(analytics.events.filter((event) => event.name === 'page_view'))
      .toHaveLength(1);
  });
});

it('tracks a supported PWA installation event', async () => {
  const analytics = renderTracker('/', 'granted');
  await waitFor(() => {
    expect(analytics.events.some((event) => event.name === 'page_view'))
      .toBe(true);
  });
  act(() => {
    window.dispatchEvent(new Event('appinstalled'));
  });
  expect(analytics.events).toContainEqual({
    name: 'pwa_install_accepted',
  });
});
```

- [ ] **Step 2: Run the tracker tests to verify they fail**

Run:

```powershell
npm test -- src\ui\analytics\AnalyticsRouteTracker.test.tsx
```

Expected: FAIL because the tracker does not exist.

- [ ] **Step 3: Implement the route tracker**

Create `src/ui/analytics/AnalyticsRouteTracker.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  normalizeAnalyticsPath,
  surfaceForPath,
} from '../../application/analytics/events';
import { useServices } from '../app/services';
import { useAnalyticsConsent } from './AnalyticsConsentProvider';

export function AnalyticsRouteTracker() {
  const location = useLocation();
  const { analytics } = useServices();
  const { consent, ready } = useAnalyticsConsent();
  const lastPageKey = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (consent !== 'granted') {
      lastPageKey.current = null;
      return;
    }
    const path = normalizeAnalyticsPath(location.pathname);
    const pageKey = `${location.key}:${path}`;
    if (lastPageKey.current === pageKey) return;
    lastPageKey.current = pageKey;
    analytics.track({
      name: 'page_view',
      path,
      surface: surfaceForPath(path),
    });
    if (path === '/onboarding') {
      analytics.track({ name: 'onboarding_started' });
    }
  }, [analytics, consent, location.key, location.pathname, ready]);

  useEffect(() => {
    if (!ready || consent !== 'granted') return;
    const installed = () => {
      analytics.track({ name: 'pwa_install_accepted' });
    };
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, [analytics, consent, ready]);

  return null;
}
```

- [ ] **Step 4: Mount the tracker**

In `src/App.tsx`, render it immediately inside `BrowserRouter`:

```tsx
<AnalyticsRouteTracker />
```

Keep it before `AppRoutes`.

- [ ] **Step 5: Run tracker and routing tests**

Run:

```powershell
npm test -- src\ui\analytics\AnalyticsRouteTracker.test.tsx src\ui\app\routes.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Stage the checkpoint without committing**

Run:

```powershell
git add src\App.tsx src\ui\analytics\AnalyticsRouteTracker.tsx src\ui\analytics\AnalyticsRouteTracker.test.tsx
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: track consented navigation`

---

### Task 8: Instrument onboarding completion and baseline activation

**Files:**
- Modify: `src/ui/screens/OnboardingScreen.tsx`
- Modify: `src/ui/screens/OnboardingScreen.test.tsx`
- Modify: `src/ui/screens/BaselineScreen.tsx`
- Modify: `src/ui/screens/BaselineScreen.test.tsx`

- [ ] **Step 1: Add failing onboarding analytics assertions**

Import `FakeAnalyticsService`, then replace the Onboarding test renderer with:

```tsx
function renderScreen(
  repo: StateRepository = memoryRepo(),
  analytics = new FakeAnalyticsService(),
) {
  render(
    <ServicesProvider value={{ repository: repo, analytics }}>
      <AppProviders>
        <MemoryRouter><OnboardingScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return { analytics, repo };
}
```

Then add:

```ts
it('tracks onboarding completion only after persistence', async () => {
  const { analytics } = renderScreen();
  expect(analytics.events).toEqual([]);

  await userEvent.click(
    screen.getByRole('checkbox', { name: /dry land only/i }),
  );
  expect(analytics.events).toEqual([]);

  await userEvent.click(screen.getByRole('button', { name: /continue/i }));
  await waitFor(() => expect(analytics.events).toContainEqual({
    name: 'onboarding_completed',
  }));
});
```

- [ ] **Step 2: Add failing baseline analytics assertions**

Import `FakeAnalyticsService`, then replace `renderBaselineFlow` with:

```tsx
function renderBaselineFlow(
  state: AppState,
  analytics = new FakeAnalyticsService(),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  return render(
    <ServicesProvider value={{ repository, analytics }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/baseline']}>
          <Routes>
            <Route path="/baseline" element={<BaselineScreen />} />
            <Route path="/goal" element={<SetGoalScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}
```

Then add:

```ts
it('tracks baseline start and completion without exact values', async () => {
  const analytics = new FakeAnalyticsService();
  renderBaselineFlow(emptyAppState(), analytics);
  await saveOneSecondBaseline();
  expect(analytics.events).toContainEqual({ name: 'baseline_started' });
  expect(analytics.events).toContainEqual({ name: 'baseline_completed' });
  expect(JSON.stringify(analytics.events)).not.toContain('maxHoldSec');
});

it('tracks abandonment after an attempt starts but is not saved', async () => {
  const analytics = new FakeAnalyticsService();
  const view = renderBaselineFlow(emptyAppState(), analytics);
  await userEvent.click(
    await screen.findByRole('button', { name: /start hold/i }),
  );
  view.unmount();
  expect(analytics.events).toContainEqual({ name: 'baseline_abandoned' });
});
```

- [ ] **Step 3: Run the activation tests to verify they fail**

Run:

```powershell
npm test -- src\ui\screens\OnboardingScreen.test.tsx src\ui\screens\BaselineScreen.test.tsx
```

Expected: FAIL because no events are emitted.

- [ ] **Step 4: Instrument Onboarding**

In `OnboardingScreen.tsx`:

1. Import `useServices` and add:

```ts
const { analytics } = useServices();
```

2. In `acknowledge`, track only after persistence succeeds:

```ts
await updateSettings({ onboarded: true });
analytics.track({ name: 'onboarding_completed' });
navigate('/baseline');
```

- [ ] **Step 5: Instrument Baseline**

In `BaselineScreen.tsx`:

1. Import `useEffect` and `useRef`.
2. Import `useServices` and add:

```ts
const { analytics } = useServices();
```

3. Add:

```ts
const baselineStarted = useRef(false);
const baselineCompleted = useRef(false);
```

4. Add cleanup:

```ts
useEffect(() => {
  return () => {
    if (baselineStarted.current && !baselineCompleted.current) {
      analytics.track({ name: 'baseline_abandoned' });
    }
  };
}, [analytics]);
```

5. Wrap the existing count-up start:

```ts
function startBaseline() {
  if (!baselineStarted.current) {
    baselineStarted.current = true;
    analytics.track({ name: 'baseline_started' });
  }
  start();
}
```

6. Change the Start button to `onClick={startBaseline}`.
7. In `finish`, after `record` succeeds:

```ts
baselineCompleted.current = true;
analytics.track({ name: 'baseline_completed' });
```

Then navigate as before.

- [ ] **Step 6: Run activation tests**

Run:

```powershell
npm test -- src\ui\screens\OnboardingScreen.test.tsx src\ui\screens\BaselineScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Stage the checkpoint without committing**

Run:

```powershell
git add src\ui\screens\OnboardingScreen.tsx src\ui\screens\OnboardingScreen.test.tsx src\ui\screens\BaselineScreen.tsx src\ui\screens\BaselineScreen.test.tsx
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: track activation funnel`

---

### Task 9: Instrument training, goal, and calendar outcomes

**Files:**
- Modify: `src/ui/screens/RunnerScreen.tsx`
- Modify: `src/ui/screens/RunnerScreen.test.tsx`
- Modify: `src/ui/screens/SummaryScreen.tsx`
- Modify: `src/ui/screens/SummaryScreen.test.tsx`
- Modify: `src/ui/screens/SetGoalScreen.tsx`
- Modify: `src/ui/screens/SetGoalScreen.test.tsx`
- Modify: `src/ui/screens/SettingsScreen.tsx`
- Modify: `src/ui/screens/SettingsScreen.test.tsx`
- Modify: `src/ui/screens/CalendarScreen.tsx`
- Modify: `src/ui/screens/CalendarScreen.test.tsx`

- [ ] **Step 1: Add failing Runner and Summary assertions**

Extend `RenderRunnerOptions` with:

```ts
analytics?: FakeAnalyticsService;
```

Import `FakeAnalyticsService`, add this default to the `renderRunner`
destructuring:

```ts
analytics = new FakeAnalyticsService(),
```

Change `render(` to `const view = render(`, change the provider, and update the
return value:

```tsx
<ServicesProvider value={{
  analytics,
  clock,
  repository,
  wakeLock,
  cues,
}}>
```

```ts
return { analytics, clock, repository, setState, view };
```

Then add:

```ts
it('tracks session start and coarse abandonment only', async () => {
  vi.useFakeTimers();
  const analytics = new FakeAnalyticsService();
  const clock = new FakeClock(1_000);
  renderRunner({ analytics, clock });

  await startSession();
  clock.advance(12 * 60_000);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: /cancel session/i }),
    );
  });

  expect(analytics.events).toContainEqual({
    name: 'training_session_started',
    sessionType: 'co2',
  });
  expect(analytics.events).toContainEqual({
    name: 'training_session_abandoned',
    sessionType: 'co2',
    durationBucket: '10_to_20m',
  });
  expect(JSON.stringify(analytics.events)).not.toMatch(
    /contraction|achievedHold|targetHold/i,
  );
});

it('tracks coarse abandonment when an active Runner is exited', async () => {
  vi.useFakeTimers();
  const analytics = new FakeAnalyticsService();
  const clock = new FakeClock(1_000);
  const { view } = renderRunner({ analytics, clock });

  await startSession();
  clock.advance(21 * 60_000);
  view.unmount();

  expect(analytics.events).toContainEqual({
    name: 'training_session_abandoned',
    sessionType: 'co2',
    durationBucket: '20_to_30m',
  });
});
```

Import `FakeAnalyticsService`, add this field to the `renderSummary` options
type:

```ts
analytics?: FakeAnalyticsService;
```

Add this default to the `renderSummary` destructuring:

```ts
analytics = new FakeAnalyticsService(),
```

Change its provider to:

```tsx
<ServicesProvider value={{
  analytics,
  repository,
  clock: new FakeClock(now),
}}>
```

Then add:

```ts
it('tracks completion only after the rated session persists', async () => {
  const analytics = new FakeAnalyticsService();
  renderSummary({
    analytics,
    session: makeSession({
      type: 'O2',
      startedAt: 0,
      finishedAt: 15 * 60_000,
      rpe: null,
    }),
  });
  await userEvent.click(
    screen.getByRole('button', { name: /normal effort/i }),
  );
  await waitFor(() => expect(analytics.events).toContainEqual({
    name: 'training_session_completed',
    sessionType: 'o2',
    durationBucket: '10_to_20m',
  }));
});
```

In the existing Summary persistence-error test, pass an analytics fake and add:

```ts
const analytics = new FakeAnalyticsService();
renderSummary({ analytics, setState });
```

```ts
expect(analytics.events).not.toContainEqual(
  expect.objectContaining({ name: 'training_session_completed' }),
);
```

In the existing duplicate-rating test, pass an analytics fake, release the
write, and add:

```ts
const analytics = new FakeAnalyticsService();
renderSummary({ analytics, setState });

// Keep the existing double-click and release() steps.
await waitFor(() => {
  expect(analytics.events.filter(
    (event) => event.name === 'training_session_completed',
  )).toHaveLength(1);
});
```

- [ ] **Step 2: Add failing goal and calendar assertions**

In `SetGoalScreen.test.tsx`, import `FakeAnalyticsService`, add this third
parameter to `renderGoal`, and pass it through the provider:

```tsx
function renderGoal(
  state = makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
  }),
  setState = vi.fn(async (_state: AppState) => {}),
  analytics = new FakeAnalyticsService(),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState,
  };
  render(
    <ServicesProvider value={{ analytics, repository }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/goal']}>
          <Routes>
            <Route path="/goal" element={<SetGoalScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return setState;
}

function stateWithActiveGoal(): AppState {
  return makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
    goal: {
      id: 'goal-1',
      targetHoldSec: 240,
      createdAt: 1,
      startMaxSec: 180,
      achievedAt: null,
    },
  });
}
```

Then add:

```ts
it('tracks creation of a new goal', async () => {
  const analytics = new FakeAnalyticsService();
  renderGoal(undefined, undefined, analytics);
  await userEvent.type(
    await screen.findByLabelText(/target hold/i),
    '4:00',
  );
  await userEvent.click(screen.getByRole('button', { name: /save goal/i }));
  await waitFor(() => {
    expect(analytics.events).toContainEqual({ name: 'goal_created' });
  });
});

it('tracks updates to an active goal', async () => {
  const analytics = new FakeAnalyticsService();
  renderGoal(stateWithActiveGoal(), undefined, analytics);
  await userEvent.clear(await screen.findByLabelText(/target hold/i));
  await userEvent.type(screen.getByLabelText(/target hold/i), '4:10');
  await userEvent.click(screen.getByRole('button', { name: /save goal/i }));
  await waitFor(() => {
    expect(analytics.events).toContainEqual({ name: 'goal_updated' });
  });
});
```

In `SettingsScreen.test.tsx`, add:

```ts
expect(analytics.events).toContainEqual({ name: 'goal_cleared' });
```

after the successful clear-goal assertion. Create the fake before rendering and
pass it to the Step 6 renderer:

```ts
const analytics = new FakeAnalyticsService();
renderSettings({ analytics, repository });
```

In the existing clear-goal failure test, pass another fake and add:

```ts
const analytics = new FakeAnalyticsService();
renderSettings({ analytics, repository });

// Keep the existing rejected-write assertions.
expect(analytics.events).not.toContainEqual({ name: 'goal_cleared' });
```

In the existing goal persistence-failure test, pass a fake as the third
`renderGoal` argument and add:

```ts
const analytics = new FakeAnalyticsService();
const state = makeState({
  baselines: [makeBaseline({ maxHoldSec: 180 })],
});
renderGoal(state, setState, analytics);

// Keep the existing storage-error and no-navigation assertions.
expect(analytics.events).not.toContainEqual(
  expect.objectContaining({ name: 'goal_created' }),
);
expect(analytics.events).not.toContainEqual(
  expect.objectContaining({ name: 'goal_updated' }),
);
```

In `CalendarScreen.test.tsx`, import `FakeAnalyticsService`, replace
`renderCalendar` with:

```tsx
function renderCalendar(
  state: AppState,
  now: number,
  analytics = new FakeAnalyticsService(),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_s: AppState) => {}),
  };
  render(
    <ServicesProvider value={{
      analytics,
      clock: new FakeClock(now),
      repository,
    }}>
      <AppProviders>
        <MemoryRouter><CalendarScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}
```

Then add:

```ts
it('tracks only the selected date relation', async () => {
  const analytics = new FakeAnalyticsService();
  renderCalendar(
    stateWithBaselineAndSession(),
    D('2026-07-10T10:00:00'),
    analytics,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: /July 9.*CO₂/i }),
  );
  expect(analytics.events).toContainEqual({
    name: 'calendar_day_opened',
    dayRelation: 'past',
  });
});
```

- [ ] **Step 3: Run the product-event tests to verify they fail**

Run:

```powershell
npm test -- src\ui\screens\RunnerScreen.test.tsx src\ui\screens\SummaryScreen.test.tsx src\ui\screens\SetGoalScreen.test.tsx src\ui\screens\SettingsScreen.test.tsx src\ui\screens\CalendarScreen.test.tsx
```

Expected: FAIL because the events are not emitted.

- [ ] **Step 4: Instrument Runner start and abandonment**

Add these imports to `RunnerScreen.tsx`:

```ts
import {
  analyticsSessionType,
  durationBucket,
  type AnalyticsSessionType,
} from '../../application/analytics/events';
```

Read `analytics` with the existing services:

```ts
const { analytics, clock, wakeLock } = useServices();
```

After `timer.begin()` in `beginSession`, add:

```ts
startedRef.current = true;
sessionStartedAtRef.current = clock.now();
sessionTypeRef.current = analyticsSessionType(navPlan.type);
analytics.track({
  name: 'training_session_started',
  sessionType: sessionTypeRef.current,
});
```

Add these refs beside the existing Runner refs:

```ts
const startedRef = useRef(false);
const sessionStartedAtRef = useRef(0);
const sessionTypeRef = useRef<AnalyticsSessionType | null>(null);
const abandonmentSent = useRef(false);
```

Add this helper inside `RunnerScreen`:

```ts
function trackAbandonment() {
  if (
    !startedRef.current
    || hasFinished.current
    || abandonmentSent.current
    || sessionTypeRef.current === null
  ) {
    return;
  }
  abandonmentSent.current = true;
  analytics.track({
    name: 'training_session_abandoned',
    sessionType: sessionTypeRef.current,
    durationBucket: durationBucket(
      sessionStartedAtRef.current,
      clock.now(),
    ),
  });
}
```

Call `trackAbandonment()` at the beginning of `cancel`.

Replace the existing wake-lock cleanup effect with:

```ts
useEffect(() => {
  return () => {
    trackAbandonment();
    void wakeLock.release();
  };
  // Services and refs are stable for one Runner mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

The existing completion effect already sets `hasFinished.current = true`
before navigating to Summary, so successful completion does not emit an
abandonment.

Do not add tracking to contraction, phase, hold, or tap-out handlers.

- [ ] **Step 5: Instrument successful session completion**

Add:

```ts
import {
  analyticsSessionType,
  durationBucket,
} from '../../application/analytics/events';
```

Then read `analytics` from services:

```ts
const { analytics, clock } = useServices();
```

After `completeSession` succeeds and before `setCompletion`, add:

```ts
analytics.track({
  name: 'training_session_completed',
  sessionType: analyticsSessionType(draft.type),
  durationBucket: durationBucket(draft.startedAt, draft.finishedAt),
});
```

This must remain inside the successful `try` block so failed persistence sends
no completion event.

- [ ] **Step 6: Instrument goal changes**

In `SetGoalScreen.tsx`, read `analytics` from `useServices()`. Preserve the
existing `editing` value before saving, then after `saveGoal` succeeds add:

```ts
analytics.track({ name: editing ? 'goal_updated' : 'goal_created' });
```

In `SettingsScreen.tsx`, read `analytics` from `useServices()` and add after a
successful `clearGoal()`:

```ts
analytics.track({ name: 'goal_cleared' });
```

Failed writes and duplicate clicks must not send events.

- [ ] **Step 7: Instrument calendar selection**

In `CalendarScreen.tsx`:

1. Read `analytics` with `clock`.
2. Import `dayRelation`.
3. Replace `onSelectDay={setSelectedDayKey}` with:

```tsx
onSelectDay={(dayKey) => {
  setSelectedDayKey(dayKey);
  analytics.track({
    name: 'calendar_day_opened',
    dayRelation: dayRelation(dayKey, localDateKey(now)),
  });
}}
```

- [ ] **Step 8: Run product-event tests**

Run:

```powershell
npm test -- src\ui\screens\RunnerScreen.test.tsx src\ui\screens\SummaryScreen.test.tsx src\ui\screens\SetGoalScreen.test.tsx src\ui\screens\SettingsScreen.test.tsx src\ui\screens\CalendarScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Stage the checkpoint without committing**

Run:

```powershell
git add src\ui\screens\RunnerScreen.tsx src\ui\screens\RunnerScreen.test.tsx src\ui\screens\SummaryScreen.tsx src\ui\screens\SummaryScreen.test.tsx src\ui\screens\SetGoalScreen.tsx src\ui\screens\SetGoalScreen.test.tsx src\ui\screens\SettingsScreen.tsx src\ui\screens\SettingsScreen.test.tsx src\ui\screens\CalendarScreen.tsx src\ui\screens\CalendarScreen.test.tsx
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: track product outcomes`

---

### Task 10: Measure future ad opportunities without rendering ads

**Files:**
- Create: `src/ui/analytics/AdOpportunityProbe.test.tsx`
- Create: `src/ui/analytics/AdOpportunityProbe.tsx`
- Modify: `src/ui/screens/HomeScreen.tsx`
- Modify: `src/ui/screens/HomeScreen.test.tsx`
- Modify: `src/ui/screens/StatsScreen.tsx`
- Modify: `src/ui/screens/StatsScreen.test.tsx`
- Modify: `src/ui/screens/CalendarScreen.tsx`
- Modify: `src/ui/screens/CalendarScreen.test.tsx`
- Modify: `src/ui/screens/SummaryScreen.tsx`
- Modify: `src/ui/screens/SummaryScreen.test.tsx`

- [ ] **Step 1: Write the failing probe tests**

Create `src/ui/analytics/AdOpportunityProbe.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ServicesProvider } from '../app/services';
import { FakeAnalyticsService } from '../../test/fakeAnalytics';
import { AdOpportunityProbe } from './AdOpportunityProbe';

let observerCallback:
  | IntersectionObserverCallback
  | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '0px';
    thresholds = [0.5];
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  observerCallback = undefined;
});

it('fires once after 50% visibility is sustained for one second', () => {
  const analytics = new FakeAnalyticsService();
  render(
    <ServicesProvider value={{ analytics }}>
      <AdOpportunityProbe
        placement="home_inline"
        surface="home"
      />
    </ServicesProvider>,
  );

  act(() => {
    observerCallback?.([
      {
        isIntersecting: true,
        intersectionRatio: 0.5,
        target: document.querySelector(
          '[data-ad-opportunity="home_inline"]',
        )!,
      } as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    vi.advanceTimersByTime(999);
  });
  expect(analytics.events).toEqual([]);

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(analytics.events).toEqual([{
    name: 'ad_opportunity_viewable',
    placement: 'home_inline',
    surface: 'home',
  }]);

  act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(analytics.events).toHaveLength(1);
});

it('cancels the timer when visibility drops below 50%', () => {
  const analytics = new FakeAnalyticsService();
  render(
    <ServicesProvider value={{ analytics }}>
      <AdOpportunityProbe
        placement="stats_inline"
        surface="stats"
      />
    </ServicesProvider>,
  );

  const target = document.querySelector(
    '[data-ad-opportunity="stats_inline"]',
  )!;
  act(() => {
    observerCallback?.([{
      isIntersecting: true,
      intersectionRatio: 0.5,
      target,
    } as IntersectionObserverEntry], {} as IntersectionObserver);
    vi.advanceTimersByTime(500);
    observerCallback?.([{
      isIntersecting: false,
      intersectionRatio: 0,
      target,
    } as IntersectionObserverEntry], {} as IntersectionObserver);
    vi.advanceTimersByTime(1_000);
  });

  expect(analytics.events).toEqual([]);
});

it('does nothing when IntersectionObserver is unavailable', () => {
  vi.unstubAllGlobals();
  const analytics = new FakeAnalyticsService();

  expect(() => {
    render(
      <ServicesProvider value={{ analytics }}>
        <AdOpportunityProbe
          placement="home_inline"
          surface="home"
        />
      </ServicesProvider>,
    );
  }).not.toThrow();
  expect(analytics.events).toEqual([]);
});
```

- [ ] **Step 2: Run the probe tests to verify they fail**

Run:

```powershell
npm test -- src\ui\analytics\AdOpportunityProbe.test.tsx
```

Expected: FAIL because the probe does not exist.

- [ ] **Step 3: Implement the no-layout probe**

Create `src/ui/analytics/AdOpportunityProbe.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type {
  AnalyticsPlacement,
  AnalyticsSurface,
} from '../../application/analytics/events';
import { useServices } from '../app/services';

export function AdOpportunityProbe({
  placement,
  surface,
}: {
  placement: AnalyticsPlacement;
  surface: AnalyticsSurface;
}) {
  const { analytics } = useServices();
  const target = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    const element = target.current;
    if (!element || sent.current) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some(
        (entry) =>
          entry.target === element
          && entry.isIntersecting
          && entry.intersectionRatio >= 0.5,
      );

      if (!visible) {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
        return;
      }

      if (timer.current !== null || sent.current) return;
      timer.current = window.setTimeout(() => {
        sent.current = true;
        timer.current = null;
        analytics.track({
          name: 'ad_opportunity_viewable',
          placement,
          surface,
        });
        observer.disconnect();
      }, 1_000);
    }, { threshold: [0.5] });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [analytics, placement, surface]);

  return (
    <div className="relative h-0 w-full" aria-hidden="true">
      <span
        ref={target}
        data-ad-opportunity={placement}
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
      />
    </div>
  );
}
```

- [ ] **Step 4: Place the probes on approved screens**

Add these probes:

- `HomeScreen.tsx`: after the goal card/CTA block:

```tsx
<AdOpportunityProbe placement="home_inline" surface="home" />
```

- `StatsScreen.tsx`: immediately before the Recent sessions card:

```tsx
<AdOpportunityProbe placement="stats_inline" surface="stats" />
```

- `CalendarScreen.tsx`: immediately before `CalendarDayDrawer`:

```tsx
<AdOpportunityProbe placement="calendar_inline" surface="calendar" />
```

- `SummaryScreen.tsx`: only inside the saved/completion branch, immediately
  before the Done button:

```tsx
<AdOpportunityProbe placement="summary_inline" surface="summary" />
```

Import `AdOpportunityProbe` in each file. Do not add probes to Onboarding,
Baseline, Runner, or Settings.

- [ ] **Step 5: Add screen-presence assertions**

In a hydrated Home test, add:

```ts
await waitFor(() => {
  expect(
    document.querySelector('[data-ad-opportunity="home_inline"]'),
  ).toBeInTheDocument();
});
```

In a hydrated Stats test, add:

```ts
await waitFor(() => {
  expect(
    document.querySelector('[data-ad-opportunity="stats_inline"]'),
  ).toBeInTheDocument();
});
```

In the first hydrated Calendar test, add:

```ts
expect(
  document.querySelector('[data-ad-opportunity="calendar_inline"]'),
).toBeInTheDocument();
```

In `SummaryScreen.test.tsx`, add:

```ts
it('shows the Summary opportunity only after persistence succeeds', async () => {
  renderSummary();
  expect(
    document.querySelector('[data-ad-opportunity="summary_inline"]'),
  ).not.toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: /normal effort/i }),
  );

  await waitFor(() => {
    expect(
      document.querySelector('[data-ad-opportunity="summary_inline"]'),
    ).toBeInTheDocument();
  });
});
```

If a selected test file does not already import `waitFor`, add it to that
file's Testing Library import.

- [ ] **Step 6: Run probe and screen tests**

Run:

```powershell
npm test -- src\ui\analytics\AdOpportunityProbe.test.tsx src\ui\screens\HomeScreen.test.tsx src\ui\screens\StatsScreen.test.tsx src\ui\screens\CalendarScreen.test.tsx src\ui\screens\SummaryScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Stage the checkpoint without committing**

Run:

```powershell
git add src\ui\analytics\AdOpportunityProbe.tsx src\ui\analytics\AdOpportunityProbe.test.tsx src\ui\screens\HomeScreen.tsx src\ui\screens\HomeScreen.test.tsx src\ui\screens\StatsScreen.tsx src\ui\screens\StatsScreen.test.tsx src\ui\screens\CalendarScreen.tsx src\ui\screens\CalendarScreen.test.tsx src\ui\screens\SummaryScreen.tsx src\ui\screens\SummaryScreen.test.tsx
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `feat: measure potential ad inventory`

---

### Task 11: Write the operator guide and configure GA4 step by step

**Files:**
- Create: `.env.example`
- Create: `docs/analytics-setup.md`
- Modify: `docs/deployment.md`

This task is deliberately interactive. The executing agent must present one
external-console action at a time, wait for the user's confirmation, inspect
the result, and only then give the next action. Do not dump all Google or
DigitalOcean steps on the user at once. Complete the pre-deployment Google
setup now, but defer DigitalOcean deployment and live-browser verification
until the user explicitly approves the code release in Task 12.

- [ ] **Step 1: Add the public environment template**

Create `.env.example`:

```dotenv
VITE_GA_MEASUREMENT_ID=
VITE_PRIVACY_CONTACT_EMAIL=
```

Both values are compiled into public static assets and are not secrets.

- [ ] **Step 2: Write the exact setup guide**

Create `docs/analytics-setup.md` with these sections and exact instructions:

```markdown
# Analytics Setup

This guide assumes no prior GA4 or Search Console experience. Complete one
checkpoint at a time.

## 1. Create the GA4 account and property

1. Open https://analytics.google.com and sign in with the Google account that
   will own Apnea Trainer analytics.
2. Open **Admin**.
3. Select **Create > Account** if no suitable account exists.
4. Use account name **Apnea Trainer**.
5. Select **Create > Property**.
6. Use property name **Apnea Trainer**.
7. Choose the reporting time zone and currency you will use for revenue
   decisions.
8. Complete the business-details screens without enabling advertising
   features.

Checkpoint: the GA4 property appears in the property selector.

## 2. Create the web data stream

1. In **Admin > Data collection and modification > Data streams**, select
   **Web**.
2. Use the current production URL shown by DigitalOcean App Platform.
3. Use stream name **Apnea Trainer Web**.
4. Turn **Enhanced measurement** off. The app sends an explicit allow-listed
   event schema instead.
5. Select **Create stream**.
6. Copy the Measurement ID beginning with `G-`.

Checkpoint: save the Measurement ID in a password manager or private note and
provide it to the implementation agent when asked.

## 3. Apply privacy settings

1. In **Admin > Data collection and modification > Data retention**, set event
   data retention to **2 months** and save.
2. In **Admin > Data collection and modification > Data collection**, leave
   **Google signals** disabled.
3. In the same area, open the advanced ads-personalization settings and disable
   ads personalization for all regions.
4. Do not create User-ID rules, audiences for advertising, or Google Ads links.
5. Do not create an AdSense link during this phase.

Checkpoint: retention is 2 months, Google signals is off, and ads
personalization is off.

## 4. Register custom dimensions

In **Admin > Data display > Custom definitions**, create event-scoped custom
dimensions with the exact parameter names below:

| Dimension name | Event parameter |
|---|---|
| App version | `app_version` |
| Surface | `surface` |
| Install mode | `install_mode` |
| Network state | `network_state` |
| Session type | `session_type` |
| Duration bucket | `duration_bucket` |
| Day relation | `day_relation` |
| Ad opportunity placement | `placement` |

Do not register exact duration, goal, baseline, contraction, RPE, session ID,
or reminder parameters.

Checkpoint: all eight event-scoped dimensions are listed.

## 5. Configure key events

In **Admin > Data display > Key events**, select **New key event** and enter
each exact event name:

- `onboarding_completed`
- `baseline_completed`
- `training_session_completed`

Add `content_cta_selected` only after the SEO content workstream emits it.

Checkpoint: the three initial key events are configured.

## 6. Configure DigitalOcean build variables

1. Open the Apnea Trainer app in DigitalOcean App Platform.
2. Open **Settings**.
3. Select the static-site component.
4. Open **Environment Variables** and choose **Edit**.
5. Add `VITE_GA_MEASUREMENT_ID` with the `G-` value copied from GA4.
6. Add `VITE_PRIVACY_CONTACT_EMAIL` with the monitored address that will
   receive analytics access/deletion requests. It will be publicly visible on
   the Privacy page.
7. Set both variables for build time. They are public configuration, not
   secrets.
8. Save and trigger a new deployment.

Checkpoint: the deployment succeeds and the Privacy page shows the configured
contact address.

## 7. Verify consent behavior before checking GA

1. Open the deployed site in a private browser window with developer tools.
2. Open the Network panel and filter for `collect` and `googletagmanager`.
3. Before choosing analytics consent, verify that neither the Google tag nor a
   GA collection request is present.
4. Select **Do not share** and verify requests are still absent.
5. Clear site data or use another private window.
6. Select **Share usage analytics**.
7. Verify that `gtag/js?id=<the exact Measurement ID copied in section 2>`
   loads and GA collection requests begin.
8. If a blocker prevents this verification, disable it only for this test and
   repeat the opt-in check.
9. Open Settings, turn analytics off, and verify new collection requests stop.
10. In the browser Application/Storage panel, verify `_ga` and `_ga_*` cookies
    are gone and the anonymous identifier is no longer shown in Settings.

Checkpoint: there is no Google request before consent and withdrawal stops
future collection.

## 8. Verify events with Tag Assistant and DebugView

1. Open https://tagassistant.google.com.
2. Start a session for the deployed production URL.
3. Accept analytics consent in the connected browser.
4. In GA4, open **Admin > Data display > DebugView**.
5. Visit Home, Calendar, Stats, and Settings.
6. Complete a disposable onboarding/baseline/session flow if safe to do so.
7. Confirm event names and inspect parameters.
8. Verify that no payload contains exact hold, baseline, goal, contraction,
   RPE, reminder, session ID, or query-string values.

Checkpoint: approved events appear in DebugView with only allowed properties.

For future campaign links, use lower-case slug values such as
`utm_source=reddit&utm_medium=community&utm_campaign=launch-2026`. The app
discards spaces, email-like values, unknown query parameters, and the raw query
string.

## 9. Add Search Console

1. Open https://search.google.com/search-console.
2. Select **Add property**.
3. Choose **Domain**, not URL-prefix.
4. Enter the production domain without protocol or path.
5. Copy the TXT record Google provides.
6. Add that TXT record at the DNS provider for the production domain.
7. Return to Search Console and select **Verify**.

Checkpoint: the Domain property shows as verified. If DNS access is unfamiliar,
stop after copying the TXT record and ask the implementation agent to guide the
specific DNS provider. Do not submit a sitemap until the separate SEO content
workstream creates one.

## 10. Link Search Console to GA4

1. In GA4, open **Admin > Product links > Search Console Links**.
2. Select **Link**.
3. Choose the verified Search Console Domain property.
4. Choose **Apnea Trainer Web** as the web stream.
5. Review and submit.

Checkpoint: the link appears in GA4. Search data can take time to populate.

## 11. Create the initial reports

1. Open **Explore** and select **Funnel exploration**.
2. Name it **Activation funnel**.
3. Add these closed-funnel steps in order:
   `page_view`, `onboarding_started`, `onboarding_completed`,
   `baseline_completed`, and `training_session_completed`.
4. Save the exploration.
5. Open **Explore** and select **Cohort exploration**.
6. Name it **D1 D7 D30 retention**, use first visit as inclusion, any event as
   return, and inspect day 1, day 7, and day 30. Add Session source / medium as
   a breakdown when enough data exists.
7. Open **Explore > Blank** and name it **Ad opportunity inventory**.
8. Add dimensions `placement`, Country, Device category, and Session source /
   medium. Add Event count as the metric and filter Event name exactly matches
   `ad_opportunity_viewable`.
9. Open another blank exploration named **Session completion**.
10. Add Event name and `session_type`, use Event count, and filter Event name
    to `training_session_started` or `training_session_completed`.
11. Create a second tab named **Session duration outcomes**, add
    `duration_bucket`, and filter Event name to
    `training_session_completed` or `training_session_abandoned`.

Do not optimize or report ad CTR because no live ads exist in this phase.

## 12. Maintain the ad-viability model

After at least four stable weeks, copy the monthly
`ad_opportunity_viewable` count into a spreadsheet. Keep three rows named Low,
Base, and High with explicit assumptions for:

- consent/ad-eligibility rate;
- non-blocked rate;
- coverage;
- net eCPM.

For each row calculate:

```text
projected served impressions =
  monthly viewable opportunities
  * consent/ad-eligibility rate
  * non-blocked rate
  * coverage

projected monthly revenue =
  projected served impressions / 1000
  * net eCPM
```

Label every assumption. Do not present a scenario as measured revenue, and do
not begin the separate ad-pilot workstream unless the base case has a credible
path to at least $100 per month.

## 13. Process an analytics deletion request

1. Ask the requester for the anonymous analytics identifier copied from
   Settings. Never ask for training data or account credentials.
2. In GA4, open **Explore > User explorer** and locate the matching client ID.
3. Open that user record and use **Delete user**.
4. Record only the request date, completion date, and a non-identifying ticket
   reference outside GA4.
5. If the GA4 UI does not expose individual deletion for the property, stop
   and use Google's User Deletion API documentation rather than inventing a
   manual workaround.

Checkpoint: the matching user deletion was accepted by GA4 and the requester
was notified.
```

- [ ] **Step 3: Update deployment documentation**

Add this section to `docs/deployment.md`:

```markdown
## Analytics build configuration

The static build reads two public build-time variables:

- `VITE_GA_MEASUREMENT_ID` - GA4 web-stream Measurement ID.
- `VITE_PRIVACY_CONTACT_EMAIL` - public contact shown for analytics
  access/deletion requests.

Configure both on the DigitalOcean static-site component before enabling the
analytics release. A missing Measurement ID leaves analytics as a no-op.

Follow `docs/analytics-setup.md` one checkpoint at a time. Do not add an
AdSense link or live ad code during the analytics-foundation release.
```

- [ ] **Step 4: Review the guide with the user one checkpoint at a time**

During execution:

1. Ask the user to open GA4 and complete only section 1.
2. Wait for confirmation.
3. Continue to section 2 and ask for the resulting Measurement ID.
4. Never ask the user to paste account credentials, recovery codes, or other
   secrets.
5. Continue through sections 3-5 and Search Console sections 9-10 with a
   confirmation after every checkpoint.
6. Collect the public Measurement ID and monitored contact address needed for
   deployment, but stop before section 6. Do not trigger DigitalOcean or claim
   live verification until Task 12 reaches the explicit release-approval gate.

Expected: the user can complete setup without prior GA4 knowledge.

- [ ] **Step 5: Stage the checkpoint without committing**

Run:

```powershell
git add .env.example docs\analytics-setup.md docs\deployment.md
git --no-pager diff --cached --check
```

Suggested commit message after explicit approval: `docs: add analytics setup guide`

---

### Task 12: Verify the complete analytics foundation

**Files:**
- Verify all files changed in Tasks 1-11

- [ ] **Step 1: Run the focused analytics tests**

Run:

```powershell
npm test -- src\application\analytics\events.test.ts src\infrastructure\analytics\localAnalyticsConsentStore.test.ts src\infrastructure\analytics\ga4Analytics.test.ts src\ui\analytics\AnalyticsConsentProvider.test.tsx src\ui\analytics\AnalyticsConsentPrompt.test.tsx src\ui\analytics\AnalyticsRouteTracker.test.tsx src\ui\analytics\AdOpportunityProbe.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run all modified screen tests together**

Run:

```powershell
npm test -- src\ui\screens\OnboardingScreen.test.tsx src\ui\screens\BaselineScreen.test.tsx src\ui\screens\RunnerScreen.test.tsx src\ui\screens\SummaryScreen.test.tsx src\ui\screens\SetGoalScreen.test.tsx src\ui\screens\SettingsScreen.test.tsx src\ui\screens\SettingsScreen.version.test.tsx src\ui\screens\CalendarScreen.test.tsx src\ui\screens\HomeScreen.test.tsx src\ui\screens\StatsScreen.test.tsx src\ui\app\routes.test.tsx src\ui\app\services.test.tsx src\infrastructure\device\productionServices.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full repository validation**

Run:

```powershell
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: all commands PASS.

- [ ] **Step 4: Inspect analytics boundaries for prohibited fields and direct tag use**

Run:

```powershell
rg -n "targetHoldSec|maxHoldSec|firstContractionSec|reminderTimes|rpe|sessionId|baselineId|goalId" src\application\analytics src\infrastructure\analytics --glob "!*.test.ts"
rg -n "gtag|dataLayer|googletagmanager" src --glob "!ga4Analytics.ts" --glob "!*.test.ts"
```

Expected: both commands return no matches. Only the GA4 adapter may reference
the Google tag, and production analytics boundary files contain none of the
prohibited training fields.

- [ ] **Step 5: Review the final diff**

Run:

```powershell
git --no-pager diff --check
git --no-pager status --short
git --no-pager diff --stat
```

Expected: only the approved analytics, privacy, documentation, spec, and plan
files are changed.

- [ ] **Step 6: Stop for explicit release approval**

Present:

- validation results;
- the complete changed-file list;
- the suggested commit sequence;
- confirmation that no ads or ad SDK were added.

Do not commit or push until the user explicitly approves.

- [ ] **Step 7: Release only after explicit approval**

After the user explicitly approves, follow their chosen git workflow to commit
and push or let them do so. Wait for the DigitalOcean deployment containing
these changes to succeed before continuing.

Expected: the deployed build includes `/privacy` and the analytics consent UI.

- [ ] **Step 8: Verify browser behavior on the deployed build**

Follow `docs\analytics-setup.md` sections 6-8 with the user, one action at a
time:

- no Google request before consent;
- decline remains request-free;
- grant loads one Google tag;
- approved events appear in DebugView;
- withdrawal stops new requests, removes GA cookies, and hides the identifier;
- Runner controls emit no granular analytics;
- an offline or blocked Google request never interrupts training;
- the update prompt remains unable to reload during an active session.

Expected: every item is observed.

- [ ] **Step 9: Finish reporting setup**

Guide the user through `docs\analytics-setup.md` sections 11-12 after live
events begin arriving. Section 13 is used only when an actual deletion request
is received.

Expected: the initial reports exist and the ad-viability worksheet records
explicit Low, Base, and High assumptions.
