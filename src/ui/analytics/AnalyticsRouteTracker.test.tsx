import { StrictMode, useEffect, useRef, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type {
  AnalyticsConsent,
  AnalyticsService,
} from '../../application/analytics/analyticsService';
import type { AnalyticsEvent } from '../../application/analytics/events';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';
import type { StateRepository } from '../../domain/ports/stateRepository';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import { AppRoutes } from '../app/routes';
import { ServicesProvider } from '../app/services';
import { AppProviders, useAppStore } from '../app/stores';
import {
  AnalyticsConsentProvider,
  useAnalyticsConsent,
} from './AnalyticsConsentProvider';
import { AnalyticsRouteTracker } from './AnalyticsRouteTracker';

class UnavailableAnalyticsService implements AnalyticsService {
  readonly available = false;
  readonly events: AnalyticsEvent[] = [];

  async setConsent(_consent: AnalyticsConsent): Promise<void> {}

  track(event: AnalyticsEvent): void {
    this.events.push({ ...event });
  }

  async getAnonymousId(): Promise<string | null> {
    return null;
  }

  async reset(): Promise<void> {}
}

class RejectingGrantAnalyticsService extends FakeAnalyticsService {
  override async setConsent(consent: AnalyticsConsent): Promise<void> {
    this.consentChanges.push(consent);
    if (consent === 'granted') {
      throw new Error('private adapter detail');
    }
  }
}

function TestControls() {
  const navigate = useNavigate();
  const { choose, consent, ready } = useAnalyticsConsent();
  const [, setRenderCount] = useState(0);

  return (
    <>
      <span>{`consent:${consent}`}</span>
      <span>{`ready:${String(ready)}`}</span>
      <button onClick={() => navigate('/stats')}>open stats</button>
      <button onClick={() => navigate('/calendar')}>open calendar</button>
      <button onClick={() => navigate('/programs')}>open program prefix</button>
      <button
        onClick={() => navigate('/stats?token=query-secret#hash-secret')}
      >
        change query and hash
      </button>
      <button onClick={() => void choose('granted')}>grant</button>
      <button onClick={() => void choose('denied')}>deny</button>
      <button onClick={() => setRenderCount((count) => count + 1)}>
        rerender
      </button>
    </>
  );
}

function NavigateWhenReady({ to }: { to: string }) {
  const navigate = useNavigate();
  const hydrated = useAppStore((state) => state.hydrated);
  const { ready } = useAnalyticsConsent();
  const navigated = useRef(false);

  useEffect(() => {
    if (hydrated && ready && !navigated.current) {
      navigated.current = true;
      navigate(to);
    }
  }, [hydrated, navigate, ready, to]);

  return null;
}

function OpenLegacyProgramRoute({ to }: { to: string }) {
  const navigate = useNavigate();

  return (
    <button onClick={() => navigate(to)}>
      open legacy program
    </button>
  );
}

function renderTracker({
  path = '/',
  consent = 'granted',
  analytics = new FakeAnalyticsService(),
  navigateWhenReady,
  strict = false,
}: {
  path?: string;
  consent?: AnalyticsConsent;
  analytics?: AnalyticsService;
  navigateWhenReady?: string;
  strict?: boolean;
} = {}) {
  const decision = consent === 'unknown'
    ? null
    : { status: consent, decidedAt: 1 };
  const state = emptyAppState();
  state.settings.onboarded = true;
  const content = (
    <ServicesProvider value={{
      analytics,
      analyticsConsent: new MemoryAnalyticsConsentStore(decision),
      repository: repositoryWith(state),
    }}>
      <AnalyticsConsentProvider>
        <AppProviders>
          <MemoryRouter initialEntries={[path]}>
            <AnalyticsRouteTracker />
            {navigateWhenReady && <NavigateWhenReady to={navigateWhenReady} />}
            <TestControls />
          </MemoryRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>
  );
  const result = render(strict ? <StrictMode>{content}</StrictMode> : content);

  return {
    analytics,
    ...result,
  };
}

function repositoryWith(state: AppState): StateRepository {
  return {
    async getState() {
      return state;
    },
    async setState() {},
  };
}

function renderIntegratedRoute(
  path: string,
  state: AppState,
  analytics = new FakeAnalyticsService(),
  legacyProgramPath = '/program',
) {
  const result = render(
    <ServicesProvider value={{
      analytics,
      analyticsConsent: new MemoryAnalyticsConsentStore({
        status: 'granted',
        decidedAt: 1,
      }),
      repository: repositoryWith(state),
    }}>
      <AnalyticsConsentProvider>
        <AppProviders>
          <MemoryRouter initialEntries={[path]}>
            <AnalyticsRouteTracker />
            <AppRoutes />
            <OpenLegacyProgramRoute to={legacyProgramPath} />
          </MemoryRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );

  return { analytics, ...result };
}

async function waitUntilReady() {
  await waitFor(() => {
    expect(screen.getByText('ready:true')).toBeInTheDocument();
  });
}

function pageViews(events: AnalyticsEvent[]) {
  return events.filter((event) => event.name === 'page_view');
}

function pwaInstalls(events: AnalyticsEvent[]) {
  return events.filter((event) => event.name === 'pwa_install_accepted');
}

describe('AnalyticsRouteTracker', () => {
  it('tracks a normalized page view after a stored grant', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({
      path: '/stats?focus=goal#chart',
      analytics,
    });

    await waitFor(() => {
      expect(analytics.events).toEqual([{
        name: 'page_view',
        path: '/stats',
        surface: 'stats',
      }]);
    });
  });

  it('tracks two real SPA route entries as exactly two page views', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({ analytics });
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(1));

    await userEvent.click(
      screen.getByRole('button', { name: 'open stats' }),
    );

    await waitFor(() => {
      expect(pageViews(analytics.events)).toEqual([
        { name: 'page_view', path: '/', surface: 'home' },
        { name: 'page_view', path: '/stats', surface: 'stats' },
      ]);
    });
  });

  it('tracks an entry before an immediate ordinary navigation effect', async () => {
    const analytics = new FakeAnalyticsService();
    vi.useFakeTimers();
    try {
      renderTracker({
        analytics,
        navigateWhenReady: '/stats',
      });
      await act(async () => {
        for (let index = 0; index < 5; index += 1) {
          await Promise.resolve();
        }
      });

      expect(pageViews(analytics.events)).toEqual([
        { name: 'page_view', path: '/', surface: 'home' },
        { name: 'page_view', path: '/stats', surface: 'stats' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks only onboarding after hydration redirects a first run from Home', async () => {
    const analytics = new FakeAnalyticsService();
    renderIntegratedRoute('/', emptyAppState(), analytics);

    await screen.findByRole('heading', { name: /apnea trainer/i });
    await waitFor(() => {
      expect(analytics.events).toEqual([
        {
          name: 'page_view',
          path: '/onboarding',
          surface: 'onboarding',
        },
        { name: 'onboarding_started' },
      ]);
    });
  });

  it('tracks only Calendar after resolving the legacy Program redirect', async () => {
    const state = emptyAppState();
    state.settings.onboarded = true;
    const analytics = new FakeAnalyticsService();
    renderIntegratedRoute('/program', state, analytics);

    await screen.findByRole('heading', { name: /^calendar$/i });
    await waitFor(() => {
      expect(pageViews(analytics.events)).toEqual([
        {
          name: 'page_view',
          path: '/calendar',
          surface: 'calendar',
        },
      ]);
    });
  });

  it.each(['/program', '/program/', '/Program', '/PROGRAM/'])(
    'tracks only Calendar when navigating in-session through legacy %s',
    async (legacyProgramPath) => {
      const state = emptyAppState();
      state.settings.onboarded = true;
      const analytics = new FakeAnalyticsService();
      renderIntegratedRoute('/stats', state, analytics, legacyProgramPath);

      await waitFor(() => {
        expect(pageViews(analytics.events)).toEqual([
          { name: 'page_view', path: '/stats', surface: 'stats' },
        ]);
      });
      analytics.events.length = 0;

      await userEvent.click(
        screen.getByRole('button', { name: 'open legacy program' }),
      );

      await screen.findByRole('heading', { name: /^calendar$/i });
      await waitFor(() => {
        expect(pageViews(analytics.events)).toEqual([
          { name: 'page_view', path: '/calendar', surface: 'calendar' },
        ]);
      });
      expect(pageViews(analytics.events)).not.toContainEqual(
        expect.objectContaining({ path: '/other' }),
      );
    },
  );

  it('does not suppress unrelated Program prefixes', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({ path: '/stats', analytics });

    await waitFor(() => {
      expect(pageViews(analytics.events)).toHaveLength(1);
    });
    analytics.events.length = 0;

    await userEvent.click(
      screen.getByRole('button', { name: 'open program prefix' }),
    );

    await waitFor(() => {
      expect(pageViews(analytics.events)).toEqual([
        { name: 'page_view', path: '/other', surface: 'content' },
      ]);
    });
  });

  it('tracks page view and onboarding start once for an onboarding entry', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({ path: '/onboarding', analytics });

    await waitFor(() => {
      expect(analytics.events).toEqual([
        {
          name: 'page_view',
          path: '/onboarding',
          surface: 'onboarding',
        },
        { name: 'onboarding_started' },
      ]);
    });
  });

  it.each([
    ['unknown', new FakeAnalyticsService()],
    ['denied', new FakeAnalyticsService()],
    ['unavailable', new UnavailableAnalyticsService()],
  ] as const)('emits no page or PWA events when analytics is %s', async (
    state,
    analytics,
  ) => {
    renderTracker({
      path: '/stats',
      consent: state === 'unavailable' ? 'granted' : state,
      analytics,
    });
    await waitUntilReady();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(analytics.events).toEqual([]);
  });

  it('emits no route or PWA events when stored grant activation rejects', async () => {
    const analytics = new RejectingGrantAnalyticsService();
    renderTracker({ path: '/stats', analytics });

    await waitUntilReady();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(analytics.consentChanges).toEqual(['granted', 'denied']);
    expect(analytics.resetCalls).toBe(1);
    expect(analytics.events).toEqual([]);
  });

  it('records the current route once when consent is granted in place', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({
      path: '/calendar',
      consent: 'unknown',
      analytics,
    });
    await waitUntilReady();
    expect(analytics.events).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    await waitFor(() => {
      expect(analytics.events).toEqual([{
        name: 'page_view',
        path: '/calendar',
        surface: 'calendar',
      }]);
    });
  });

  it('clears route deduplication on withdrawal and tracks after re-grant', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({ path: '/stats', analytics });
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));
    await waitFor(() => {
      expect(screen.getByText('consent:denied')).toBeInTheDocument();
      expect(screen.getByText('ready:true')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    await waitFor(() => {
      expect(pageViews(analytics.events)).toEqual([
        { name: 'page_view', path: '/stats', surface: 'stats' },
        { name: 'page_view', path: '/stats', surface: 'stats' },
      ]);
    });
  });

  it('deduplicates Strict Mode replay for page view and onboarding start', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({
      path: '/onboarding',
      analytics,
      strict: true,
    });

    await waitFor(() => {
      expect(analytics.events).toEqual([
        {
          name: 'page_view',
          path: '/onboarding',
          surface: 'onboarding',
        },
        { name: 'onboarding_started' },
      ]);
    });
  });

  it('deduplicates ordinary re-renders', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({ path: '/calendar', analytics });
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'rerender' }));

    expect(pageViews(analytics.events)).toHaveLength(1);
  });

  it('tracks each appinstalled event once and removes the listener on unmount', async () => {
    const analytics = new FakeAnalyticsService();
    const { unmount } = renderTracker({ analytics });
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(1));

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(pwaInstalls(analytics.events)).toHaveLength(2);

    unmount();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(pwaInstalls(analytics.events)).toHaveLength(2);
  });

  it('removes and reinstalls the appinstalled listener with consent', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({ analytics });
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));
    await waitFor(() => {
      expect(screen.getByText('consent:denied')).toBeInTheDocument();
    });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(pwaInstalls(analytics.events)).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(2));

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(pwaInstalls(analytics.events)).toHaveLength(1);
  });

  it('never includes query or hash values in event payloads', async () => {
    const analytics = new FakeAnalyticsService();
    renderTracker({
      path: '/stats?initial=query-value#initial-hash',
      analytics,
    });
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(1));

    await userEvent.click(
      screen.getByRole('button', { name: 'change query and hash' }),
    );
    await waitFor(() => expect(pageViews(analytics.events)).toHaveLength(2));

    expect(pageViews(analytics.events)).toEqual([
      { name: 'page_view', path: '/stats', surface: 'stats' },
      { name: 'page_view', path: '/stats', surface: 'stats' },
    ]);
    expect(JSON.stringify(analytics.events)).not.toMatch(
      /query-value|initial-hash|query-secret|hash-secret|\?|#/,
    );
  });
});
