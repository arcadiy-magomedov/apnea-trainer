import { describe, expect, it } from 'vitest';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import {
  ANALYTICS_CONTENT_SLUGS,
  type AnalyticsDayRelation,
  type AnalyticsDurationBucket,
  analyticsSessionType,
  dayRelation,
  durationBucket,
  normalizeAnalyticsPath,
  serializeAnalyticsEvent,
  surfaceForPath,
} from './events';

const D = (iso: string) => new Date(iso).getTime();
const PRIVATE_SENTINEL = 'private-analytics-value@example.test';

function rejectionMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error('Expected analytics input to be rejected.');
}

describe('analytics events contract', () => {
  it('normalizes routes without leaking query or hash fragments', () => {
    expect(normalizeAnalyticsPath('/stats?focus=goal#chart')).toBe('/stats');
    expect(normalizeAnalyticsPath('/')).toBe('/');
  });

  it('removes trailing slashes before matching routes', () => {
    expect(normalizeAnalyticsPath('/stats/')).toBe('/stats');
    expect(normalizeAnalyticsPath('/guides/co2-tables///?source=home')).toBe(
      '/guides/co2-tables',
    );
  });

  it('collapses unknown paths but preserves publisher-authored guide paths', () => {
    expect(normalizeAnalyticsPath('/invite/alice@example.test')).toBe('/other');
    expect(normalizeAnalyticsPath('/guides/co2-tables')).toBe('/guides/co2-tables');
    expect(normalizeAnalyticsPath('/guides/alice-smith')).toBe('/other');
    expect(normalizeAnalyticsPath('/content')).toBe('/other');
  });

  it('exports only approved publisher-authored content slugs', () => {
    expect(ANALYTICS_CONTENT_SLUGS).toEqual(['co2-tables']);
  });

  it.each([
    ['/', 'home'],
    ['/onboarding', 'onboarding'],
    ['/baseline', 'baseline'],
    ['/runner', 'runner'],
    ['/summary', 'summary'],
    ['/stats', 'stats'],
    ['/calendar', 'calendar'],
    ['/settings', 'settings'],
    ['/goal', 'goal'],
    ['/privacy', 'privacy'],
    ['/other', 'content'],
  ] as const)('maps the static route %s to the %s surface', (path, surface) => {
    expect(surfaceForPath(path)).toBe(surface);
  });

  it('maps publisher-authored guide paths to the content surface', () => {
    expect(surfaceForPath('/guides/co2-tables')).toBe('content');
  });

  it.each([
    ['CO2', 'co2'],
    ['O2', 'o2'],
    ['MAX', 'max'],
  ] as const)('maps the %s session type to %s', (sessionType, expected) => {
    expect(analyticsSessionType(sessionType)).toBe(expected);
  });

  it('safely serializes an unknown page path as content', () => {
    expect(serializeAnalyticsEvent({
      name: 'page_view',
      path: '/invite/arbitrary-private-value',
      surface: 'content',
    })).toEqual({
      name: 'page_view',
      properties: {
        page_path: '/other',
        surface: 'content',
      },
    });
  });

  it('rejects a page-view surface that does not match the normalized path', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'page_view',
      path: '/stats?focus=goal',
      surface: 'home',
    })).toThrow('Analytics page view surface does not match path.');
  });

  it('does not include rejected page paths in errors', () => {
    const path = `/private/${PRIVATE_SENTINEL}`;

    const message = rejectionMessage(() => serializeAnalyticsEvent({
      name: 'page_view',
      path,
      surface: 'home',
    }));

    expect(message).toBe('Analytics page view surface does not match path.');
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('buckets durations with exact 10, 20, and 30 minute boundaries', () => {
    const firstBucket: AnalyticsDurationBucket = durationBucket(
      D('2026-07-16T10:00:00Z'),
      D('2026-07-16T10:09:59.999Z'),
    );
    expect(firstBucket).toBe('under_10m');
    expect(durationBucket(D('2026-07-16T10:00:00Z'), D('2026-07-16T10:10:00Z')))
      .toBe('10_to_20m');
    expect(durationBucket(D('2026-07-16T10:00:00Z'), D('2026-07-16T10:19:59.999Z')))
      .toBe('10_to_20m');
    expect(durationBucket(D('2026-07-16T10:00:00Z'), D('2026-07-16T10:20:00Z')))
      .toBe('20_to_30m');
    expect(durationBucket(D('2026-07-16T10:00:00Z'), D('2026-07-16T10:29:59.999Z')))
      .toBe('20_to_30m');
    expect(durationBucket(D('2026-07-16T10:00:00Z'), D('2026-07-16T10:30:00Z')))
      .toBe('30m_plus');
  });

  it.each([
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, 0],
  ])('rejects non-finite duration inputs %s and %s', (startedAt, finishedAt) => {
    expect(() => durationBucket(startedAt, finishedAt)).toThrow(/finite/i);
  });

  it('rejects reversed duration timestamps', () => {
    expect(() => durationBucket(
      D('2026-07-16T10:01:00Z'),
      D('2026-07-16T10:00:00Z'),
    )).toThrow(/duration/i);
  });

  it('rejects a non-finite duration computed from finite timestamps', () => {
    expect(Number.isFinite(Number.MAX_VALUE)).toBe(true);
    expect(Number.isFinite(-Number.MAX_VALUE)).toBe(true);
    expect(() => durationBucket(-Number.MAX_VALUE, Number.MAX_VALUE))
      .toThrow(/finite/i);
  });

  it('classifies calendar days as past, today, or future', () => {
    const relation: AnalyticsDayRelation = dayRelation(
      '2026-07-15',
      '2026-07-16',
    );
    expect(relation).toBe('past');
    expect(dayRelation('2026-07-16', '2026-07-16')).toBe('today');
    expect(dayRelation('2026-07-17', '2026-07-16')).toBe('future');
  });

  it.each([
    ['2026-02-29', '2026-03-01'],
    ['2026-02-31', '2026-03-01'],
    ['2026-04-31', '2026-05-01'],
    ['2026-13-01', '2026-12-01'],
    ['2026-07-16', '2026-02-31'],
  ])('rejects impossible calendar keys %s and %s', (dayKey, todayKey) => {
    expect(() => dayRelation(dayKey, todayKey)).toThrow(/invalid analytics/i);
  });

  it('accepts leap-day calendar keys without changing lexical comparison', () => {
    expect(dayRelation('2024-02-29', '2024-03-01')).toBe('past');
    expect(dayRelation('2000-02-29', '2000-02-29')).toBe('today');
  });

  it('serializes training_session_completed using approved snake_case properties', () => {
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

  it.each([
    [
      {
        name: 'content_cta_selected',
        contentSlug: 'co2-tables',
        ctaName: 'open_app',
      },
      {
        name: 'content_cta_selected',
        properties: {
          content_slug: 'co2-tables',
          cta_name: 'open_app',
        },
      },
    ],
    [
      {
        name: 'training_session_started',
        sessionType: 'o2',
      },
      {
        name: 'training_session_started',
        properties: {
          session_type: 'o2',
        },
      },
    ],
    [
      {
        name: 'training_session_abandoned',
        sessionType: 'max',
        durationBucket: 'under_10m',
      },
      {
        name: 'training_session_abandoned',
        properties: {
          session_type: 'max',
          duration_bucket: 'under_10m',
        },
      },
    ],
    [
      {
        name: 'calendar_day_opened',
        dayRelation: 'future',
      },
      {
        name: 'calendar_day_opened',
        properties: {
          day_relation: 'future',
        },
      },
    ],
    [
      {
        name: 'ad_opportunity_viewable',
        placement: 'stats_inline',
        surface: 'stats',
      },
      {
        name: 'ad_opportunity_viewable',
        properties: {
          placement: 'stats_inline',
          surface: 'stats',
        },
      },
    ],
    [
      {
        name: 'goal_created',
      },
      {
        name: 'goal_created',
        properties: {},
      },
    ],
  ] as const)('serializes valid event %#', (event, expected) => {
    expect(serializeAnalyticsEvent(event)).toEqual(expected);
  });

  it('rejects undeclared runtime properties', () => {
    const event = {
      name: 'training_session_completed',
      sessionType: 'co2',
      durationBucket: '10_to_20m',
      [PRIVATE_SENTINEL]: 180,
    } as never;

    const message = rejectionMessage(() => serializeAnalyticsEvent(event));

    expect(message).toMatch(/undeclared/i);
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('does not include rejected values in errors', () => {
    const message = rejectionMessage(() => serializeAnalyticsEvent({
      name: 'training_session_started',
      sessionType: PRIVATE_SENTINEL,
    } as never));

    expect(message).toMatch(/invalid analytics session type/i);
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('does not include rejected event names in errors', () => {
    const message = rejectionMessage(() => serializeAnalyticsEvent({
      name: PRIVATE_SENTINEL,
    } as never));

    expect(message).toMatch(/unknown analytics event/i);
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('rejects an inherited event name', () => {
    const event = Object.create({ name: 'goal_created' });

    expect(() => serializeAnalyticsEvent(event as never))
      .toThrow('Missing required analytics property.');
  });

  it('rejects an inherited required payload property', () => {
    const event = Object.assign(
      Object.create({ sessionType: 'co2' }),
      { name: 'training_session_started' },
    );

    expect(() => serializeAnalyticsEvent(event as never))
      .toThrow('Missing required analytics property.');
  });

  it('rejects symbol runtime properties', () => {
    const extra = Symbol(PRIVATE_SENTINEL);
    const event = {
      name: 'goal_created',
      [extra]: 'secret',
    };

    const message = rejectionMessage(
      () => serializeAnalyticsEvent(event as never),
    );

    expect(message).toMatch(/undeclared analytics property/i);
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('rejects non-enumerable runtime properties', () => {
    const event = { name: 'goal_created' };
    Object.defineProperty(event, PRIVATE_SENTINEL, {
      value: 'secret',
      enumerable: false,
    });

    const message = rejectionMessage(
      () => serializeAnalyticsEvent(event as never),
    );

    expect(message).toMatch(/undeclared analytics property/i);
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('rejects unknown runtime event names', () => {
    const message = rejectionMessage(() => serializeAnalyticsEvent({
      name: PRIVATE_SENTINEL,
    } as never));

    expect(message).toMatch(/unknown/i);
    expect(message).not.toContain(PRIVATE_SENTINEL);
  });

  it('rejects invalid runtime enum values', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'training_session_started',
      sessionType: 'pulse',
    } as never)).toThrow(/invalid/i);
  });

  it('rejects invalid runtime duration buckets', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'training_session_abandoned',
      sessionType: 'co2',
      durationBucket: 'all_day',
    } as never)).toThrow(/invalid analytics duration bucket/i);
  });

  it('rejects invalid runtime day relations', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'calendar_day_opened',
      dayRelation: 'yesterday',
    } as never)).toThrow(/invalid analytics day relation/i);
  });

  it('rejects invalid runtime surfaces', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'page_view',
      path: '/stats',
      surface: 'dashboard',
    } as never)).toThrow(/invalid analytics surface/i);
  });

  it('rejects invalid runtime placements', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'ad_opportunity_viewable',
      placement: 'footer',
      surface: 'home',
    } as never)).toThrow(/invalid analytics placement/i);
  });

  it.each([
    'alice-smith',
    'CO2-tables',
    'co2 tables',
    'a'.repeat(81),
  ])('rejects the invalid content slug %s', (contentSlug) => {
    expect(() => serializeAnalyticsEvent({
      name: 'content_cta_selected',
      contentSlug,
      ctaName: 'open_app',
    } as never)).toThrow(/invalid analytics content slug/i);
  });

  it('rejects unknown runtime CTA names', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'content_cta_selected',
      contentSlug: 'co2-tables',
      ctaName: 'subscribe',
    } as never)).toThrow(/invalid analytics cta name/i);
  });

  it('rejects ad placements for the wrong surface', () => {
    expect(() => serializeAnalyticsEvent({
      name: 'ad_opportunity_viewable',
      placement: 'home_inline',
      surface: 'stats',
    })).toThrow('Analytics ad placement does not match surface.');
  });
});

describe('Task 1 analytics test doubles', () => {
  it('copies the initial consent decision passed to the constructor', () => {
    const initial = {
      status: 'granted',
      decidedAt: 123,
    } as const;
    const store = new MemoryAnalyticsConsentStore(initial);

    const mutableInitial = initial as {
      status: 'granted' | 'denied';
      decidedAt: number;
    };
    mutableInitial.status = 'denied';
    mutableInitial.decidedAt = 0;

    expect(store.read()).toEqual({ status: 'granted', decidedAt: 123 });
  });

  it('returns defensive consent decision copies from write and read', () => {
    const store = new MemoryAnalyticsConsentStore(null, () => 123);
    const written = store.write('granted');

    written.status = 'denied';
    written.decidedAt = 0;
    expect(store.read()).toEqual({ status: 'granted', decidedAt: 123 });

    const read = store.read();
    expect(read).not.toBeNull();
    read!.status = 'denied';
    read!.decidedAt = 0;
    expect(store.read()).toEqual({ status: 'granted', decidedAt: 123 });
  });

  it('records events, consent changes, resets, and nullable anonymous IDs', async () => {
    const analytics = new FakeAnalyticsService();

    analytics.track({ name: 'goal_created' });
    await analytics.setConsent('granted');
    expect(analytics.events).toEqual([{ name: 'goal_created' }]);
    expect(analytics.consentChanges).toEqual(['granted']);
    expect(await analytics.getAnonymousId()).toBe('analytics-test-id');

    analytics.anonymousId = null;
    expect(await analytics.getAnonymousId()).toBeNull();

    await analytics.reset();
    expect(analytics.resetCalls).toBe(1);
    expect(analytics.consentChanges).toEqual(['granted', 'denied']);
  });
});
