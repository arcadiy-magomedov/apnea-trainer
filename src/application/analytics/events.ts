import type { SessionType } from '../../domain/models/types';

export const ANALYTICS_SURFACES = {
  home: 'home',
  onboarding: 'onboarding',
  baseline: 'baseline',
  runner: 'runner',
  summary: 'summary',
  stats: 'stats',
  calendar: 'calendar',
  settings: 'settings',
  goal: 'goal',
  privacy: 'privacy',
  content: 'content',
} as const;

export type AnalyticsSurface =
  typeof ANALYTICS_SURFACES[keyof typeof ANALYTICS_SURFACES];

export const ANALYTICS_SESSION_TYPES = {
  co2: 'co2',
  o2: 'o2',
  max: 'max',
} as const;

export type AnalyticsSessionType =
  typeof ANALYTICS_SESSION_TYPES[keyof typeof ANALYTICS_SESSION_TYPES];

export type AnalyticsDurationBucket =
  | 'under_10m'
  | '10_to_20m'
  | '20_to_30m'
  | '30m_plus';
export type AnalyticsDayRelation = 'past' | 'today' | 'future';

export const ANALYTICS_PLACEMENTS = {
  home_inline: 'home_inline',
  stats_inline: 'stats_inline',
  calendar_inline: 'calendar_inline',
  summary_inline: 'summary_inline',
} as const;

export type AnalyticsPlacement =
  typeof ANALYTICS_PLACEMENTS[keyof typeof ANALYTICS_PLACEMENTS];

export const ANALYTICS_CTA_NAMES = {
  open_app: 'open_app',
  start_onboarding: 'start_onboarding',
} as const;

export type AnalyticsCtaName =
  typeof ANALYTICS_CTA_NAMES[keyof typeof ANALYTICS_CTA_NAMES];

export const ANALYTICS_CONTENT_SLUGS = ['co2-tables'] as const;

export type AnalyticsContentSlug =
  typeof ANALYTICS_CONTENT_SLUGS[number];

export type AnalyticsEventName =
  | 'page_view'
  | 'content_cta_selected'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'baseline_started'
  | 'baseline_completed'
  | 'baseline_abandoned'
  | 'training_session_started'
  | 'training_session_completed'
  | 'training_session_abandoned'
  | 'goal_created'
  | 'goal_updated'
  | 'goal_cleared'
  | 'calendar_day_opened'
  | 'pwa_install_accepted'
  | 'ad_opportunity_viewable';

interface PageViewEvent {
  name: 'page_view';
  path: string;
  surface: AnalyticsSurface;
}

interface ContentCtaSelectedEvent {
  name: 'content_cta_selected';
  contentSlug: AnalyticsContentSlug;
  ctaName: AnalyticsCtaName;
}

interface NoPayloadEvent {
  name:
    | 'onboarding_started'
    | 'onboarding_completed'
    | 'baseline_started'
    | 'baseline_completed'
    | 'baseline_abandoned'
    | 'goal_created'
    | 'goal_updated'
    | 'goal_cleared'
    | 'pwa_install_accepted';
}

interface TrainingSessionStartedEvent {
  name: 'training_session_started';
  sessionType: AnalyticsSessionType;
}

interface TrainingSessionFinishedEvent {
  name: 'training_session_completed' | 'training_session_abandoned';
  sessionType: AnalyticsSessionType;
  durationBucket: AnalyticsDurationBucket;
}

interface CalendarDayOpenedEvent {
  name: 'calendar_day_opened';
  dayRelation: AnalyticsDayRelation;
}

interface AdOpportunityViewableEvent {
  name: 'ad_opportunity_viewable';
  placement: AnalyticsPlacement;
  surface: AnalyticsSurface;
}

export type AnalyticsEvent =
  | PageViewEvent
  | ContentCtaSelectedEvent
  | NoPayloadEvent
  | TrainingSessionStartedEvent
  | TrainingSessionFinishedEvent
  | CalendarDayOpenedEvent
  | AdOpportunityViewableEvent;

export interface SerializedAnalyticsEvent {
  name: AnalyticsEventName;
  properties: Record<string, string>;
}

const ROUTE_TO_SURFACE: Record<string, AnalyticsSurface> = {
  '/': ANALYTICS_SURFACES.home,
  '/onboarding': ANALYTICS_SURFACES.onboarding,
  '/baseline': ANALYTICS_SURFACES.baseline,
  '/runner': ANALYTICS_SURFACES.runner,
  '/summary': ANALYTICS_SURFACES.summary,
  '/stats': ANALYTICS_SURFACES.stats,
  '/calendar': ANALYTICS_SURFACES.calendar,
  '/settings': ANALYTICS_SURFACES.settings,
  '/goal': ANALYTICS_SURFACES.goal,
  '/privacy': ANALYTICS_SURFACES.privacy,
  '/other': ANALYTICS_SURFACES.content,
};

const CONTENT_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const EVENT_ALLOWED_KEYS = {
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
} as const satisfies Record<AnalyticsEventName, readonly string[]>;

const PLACEMENT_SURFACE = {
  home_inline: ANALYTICS_SURFACES.home,
  stats_inline: ANALYTICS_SURFACES.stats,
  calendar_inline: ANALYTICS_SURFACES.calendar,
  summary_inline: ANALYTICS_SURFACES.summary,
} as const satisfies Record<AnalyticsPlacement, AnalyticsSurface>;

const SESSION_TYPE_TO_ANALYTICS = {
  CO2: ANALYTICS_SESSION_TYPES.co2,
  O2: ANALYTICS_SESSION_TYPES.o2,
  MAX: ANALYTICS_SESSION_TYPES.max,
} as const satisfies Record<SessionType, AnalyticsSessionType>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn<T extends object>(
  object: T,
  key: PropertyKey,
): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid analytics ${label}.`);
  }
  return value;
}

function assertAllowedValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Invalid analytics ${label}.`);
  }
  return value as T;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  for (const key of allowedKeys) {
    if (!hasOwn(value, key)) {
      throw new Error('Missing required analytics property.');
    }
  }

  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new Error('Undeclared analytics property.');
    }
  }
}

function isGuidePath(path: string): boolean {
  return ANALYTICS_CONTENT_SLUGS.some(
    (contentSlug) => path === `/guides/${contentSlug}`,
  );
}

function isKnownRoute(path: string): path is keyof typeof ROUTE_TO_SURFACE {
  return hasOwn(ROUTE_TO_SURFACE, path);
}

export function normalizeAnalyticsPath(input: string): string {
  if (typeof input !== 'string' || input.length === 0 || !input.startsWith('/')) {
    return '/other';
  }

  const cutAt = input.search(/[?#]/);
  const pathWithTrailingSlashes = cutAt === -1 ? input : input.slice(0, cutAt);
  const path = pathWithTrailingSlashes === '/'
    ? '/'
    : pathWithTrailingSlashes.replace(/\/+$/, '') || '/';

  if (path === '/' || isKnownRoute(path) || isGuidePath(path)) {
    return path;
  }

  return '/other';
}

export function surfaceForPath(path: string): AnalyticsSurface {
  const normalized = normalizeAnalyticsPath(path);
  if (isGuidePath(normalized)) {
    return ANALYTICS_SURFACES.content;
  }

  if (isKnownRoute(normalized)) {
    return ROUTE_TO_SURFACE[normalized];
  }

  throw new Error('Unknown analytics path.');
}

export function analyticsSessionType(sessionType: SessionType): AnalyticsSessionType {
  return SESSION_TYPE_TO_ANALYTICS[sessionType];
}

export function durationBucket(
  startedAt: number,
  finishedAt: number,
): AnalyticsDurationBucket {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    throw new Error('Duration timestamps must be finite.');
  }

  const duration = finishedAt - startedAt;
  if (!Number.isFinite(duration)) {
    throw new Error('Computed duration must be finite.');
  }

  if (duration < 0) {
    throw new Error('Duration timestamps must be chronological.');
  }

  const tenMinutes = 10 * 60 * 1000;
  const twentyMinutes = 20 * 60 * 1000;
  const thirtyMinutes = 30 * 60 * 1000;

  if (duration < tenMinutes) {
    return 'under_10m';
  }

  if (duration < twentyMinutes) {
    return '10_to_20m';
  }

  if (duration < thirtyMinutes) {
    return '20_to_30m';
  }

  return '30m_plus';
}

function isValidCalendarDayKey(value: string): boolean {
  if (!DAY_KEY_RE.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1];
}

export function dayRelation(
  dayKey: string,
  todayKey: string,
): AnalyticsDayRelation {
  if (!isValidCalendarDayKey(dayKey)) {
    throw new Error('Invalid analytics day key.');
  }

  if (!isValidCalendarDayKey(todayKey)) {
    throw new Error('Invalid analytics today key.');
  }

  if (dayKey === todayKey) {
    return 'today';
  }

  return dayKey < todayKey ? 'past' : 'future';
}

function assertSurface(value: unknown): AnalyticsSurface {
  return assertAllowedValue(value, Object.values(ANALYTICS_SURFACES), 'surface');
}

function assertSessionType(value: unknown): AnalyticsSessionType {
  return assertAllowedValue(
    value,
    Object.values(ANALYTICS_SESSION_TYPES),
    'session type',
  );
}

function assertDurationBucket(value: unknown): AnalyticsDurationBucket {
  return assertAllowedValue(value, ['under_10m', '10_to_20m', '20_to_30m', '30m_plus'] as const, 'duration bucket');
}

function assertDayRelation(value: unknown): AnalyticsDayRelation {
  return assertAllowedValue(value, ['past', 'today', 'future'] as const, 'day relation');
}

function assertPlacement(value: unknown): AnalyticsPlacement {
  return assertAllowedValue(
    value,
    Object.values(ANALYTICS_PLACEMENTS),
    'placement',
  );
}

function assertCtaName(value: unknown): AnalyticsCtaName {
  return assertAllowedValue(
    value,
    Object.values(ANALYTICS_CTA_NAMES),
    'cta name',
  );
}

function assertContentSlug(value: unknown): AnalyticsContentSlug {
  const slug = assertString(value, 'content slug');
  if (
    slug.length > 80
    || !CONTENT_SLUG_RE.test(slug)
    || !ANALYTICS_CONTENT_SLUGS.includes(slug as AnalyticsContentSlug)
  ) {
    throw new Error('Invalid analytics content slug.');
  }
  return slug as AnalyticsContentSlug;
}

function serializeNoPayloadEvent(name: NoPayloadEvent['name']): SerializedAnalyticsEvent {
  return { name, properties: {} };
}

export function serializeAnalyticsEvent(
  event: AnalyticsEvent,
): SerializedAnalyticsEvent {
  const runtimeEvent: unknown = event;
  if (!isRecord(runtimeEvent)) {
    throw new Error('Analytics event must be an object.');
  }

  const name = runtimeEvent.name;
  if (typeof name !== 'string' || !hasOwn(EVENT_ALLOWED_KEYS, name)) {
    throw new Error('Unknown analytics event.');
  }

  assertExactKeys(runtimeEvent, EVENT_ALLOWED_KEYS[name]);

  switch (name) {
    case 'page_view': {
      const path = assertString(runtimeEvent.path, 'path');
      const surface = assertSurface(runtimeEvent.surface);
      const normalizedPath = normalizeAnalyticsPath(path);
      const expectedSurface = surfaceForPath(normalizedPath);
      if (surface !== expectedSurface) {
        throw new Error('Analytics page view surface does not match path.');
      }
      return {
        name,
        properties: {
          page_path: normalizedPath,
          surface,
        },
      };
    }
    case 'content_cta_selected':
      return {
        name,
        properties: {
          content_slug: assertContentSlug(runtimeEvent.contentSlug),
          cta_name: assertCtaName(runtimeEvent.ctaName),
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
      return serializeNoPayloadEvent(name);
    case 'training_session_started':
      return {
        name,
        properties: {
          session_type: assertSessionType(runtimeEvent.sessionType),
        },
      };
    case 'training_session_completed':
    case 'training_session_abandoned':
      return {
        name,
        properties: {
          session_type: assertSessionType(runtimeEvent.sessionType),
          duration_bucket: assertDurationBucket(runtimeEvent.durationBucket),
        },
      };
    case 'calendar_day_opened':
      return {
        name,
        properties: {
          day_relation: assertDayRelation(runtimeEvent.dayRelation),
        },
      };
    case 'ad_opportunity_viewable': {
      const placement = assertPlacement(runtimeEvent.placement);
      const surface = assertSurface(runtimeEvent.surface);
      const expectedSurface = PLACEMENT_SURFACE[placement];
      if (surface !== expectedSurface) {
        throw new Error('Analytics ad placement does not match surface.');
      }
      return {
        name,
        properties: {
          placement,
          surface,
        },
      };
    }
    default:
      throw new Error('Unknown analytics event.');
  }
}
