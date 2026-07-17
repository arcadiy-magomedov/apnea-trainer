import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ServicesProvider } from '../app/services';
import { FakeAnalyticsService } from '../../test/fakeAnalytics';
import { AdOpportunityProbe } from './AdOpportunityProbe';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds: readonly number[];
  readonly observe = vi.fn<(target: Element) => void>();
  readonly unobserve = vi.fn<(target: Element) => void>();
  readonly disconnect = vi.fn<() => void>();
  readonly takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => []);

  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    observers.push(this);
  }

  emit(isIntersecting: boolean, intersectionRatio: number) {
    const target = this.observe.mock.calls[0]?.[0];
    if (!target) throw new Error('Probe was not observed.');

    this.callback([{
      isIntersecting,
      intersectionRatio,
      target,
    } as IntersectionObserverEntry], this);
  }
}

let observers: MockIntersectionObserver[] = [];

function renderProbe(
  analytics = new FakeAnalyticsService(),
  placement: 'home_inline' | 'stats_inline' = 'home_inline',
  surface: 'home' | 'stats' = 'home',
) {
  const result = render(
    <ServicesProvider value={{ analytics }}>
      <AdOpportunityProbe placement={placement} surface={surface} />
    </ServicesProvider>,
  );
  return { analytics, observer: observers.at(-1), ...result };
}

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AdOpportunityProbe', () => {
  it('renders an inert no-layout marker and observes it at the 50% threshold', () => {
    const { container, observer } = renderProbe();
    const marker = container.querySelector(
      '[data-ad-opportunity="home_inline"]',
    );

    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(marker).toHaveClass('pointer-events-none', 'absolute', 'h-px');
    expect(marker?.parentElement).toHaveClass('h-0');
    expect(observer?.thresholds).toEqual([0.5]);
    expect(observer?.observe).toHaveBeenCalledWith(marker);
  });

  it('emits the exact event once at the 1,000 ms visibility boundary', () => {
    const { analytics, observer } = renderProbe();

    act(() => {
      observer?.emit(true, 0.5);
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
      observer?.emit(true, 1);
      vi.runOnlyPendingTimers();
    });
    expect(analytics.events).toHaveLength(1);
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it('cancels on a visibility drop and allows a later full second', () => {
    const { analytics, observer } = renderProbe(
      undefined,
      'stats_inline',
      'stats',
    );

    act(() => {
      observer?.emit(true, 0.5);
      vi.advanceTimersByTime(500);
      observer?.emit(true, 0.49);
      vi.advanceTimersByTime(2_000);
    });
    expect(analytics.events).toEqual([]);

    act(() => {
      observer?.emit(true, 0.75);
      vi.advanceTimersByTime(999);
    });
    expect(analytics.events).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(analytics.events).toEqual([{
      name: 'ad_opportunity_viewable',
      placement: 'stats_inline',
      surface: 'stats',
    }]);
  });

  it('does not create duplicate timers for repeated qualifying callbacks', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const { analytics, observer } = renderProbe();

    act(() => {
      observer?.emit(true, 0.5);
      vi.advanceTimersByTime(400);
      observer?.emit(true, 0.75);
      vi.advanceTimersByTime(400);
      observer?.emit(true, 1);
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(analytics.events).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(analytics.events).toHaveLength(1);
  });

  it('clears pending work and disconnects on unmount', () => {
    const { analytics, observer, unmount } = renderProbe();

    act(() => {
      observer?.emit(true, 1);
      vi.advanceTimersByTime(999);
    });
    unmount();

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(analytics.events).toEqual([]);
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it('is harmless and silent when IntersectionObserver is unavailable', () => {
    vi.unstubAllGlobals();
    const analytics = new FakeAnalyticsService();

    expect(() => render(
      <ServicesProvider value={{ analytics }}>
        <AdOpportunityProbe placement="home_inline" surface="home" />
      </ServicesProvider>,
    )).not.toThrow();

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(analytics.events).toEqual([]);
  });
});
