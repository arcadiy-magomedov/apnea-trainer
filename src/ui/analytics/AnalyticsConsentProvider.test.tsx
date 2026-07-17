import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AnalyticsConsent,
  AnalyticsConsentDecision,
  AnalyticsConsentStore,
  AnalyticsService,
} from '../../application/analytics/analyticsService';
import type { AnalyticsEvent } from '../../application/analytics/events';
import { noopAnalytics } from '../../infrastructure/analytics/noopAnalytics';
import { ServicesProvider } from '../app/services';
import {
  AnalyticsConsentProvider,
  useAnalyticsConsent,
  type AnalyticsConsentContextValue,
} from './AnalyticsConsentProvider';

type Choice = Exclude<AnalyticsConsent, 'unknown'>;

class TestConsentStore implements AnalyticsConsentStore {
  readCalls = 0;
  readonly writes: Choice[] = [];
  private decision: AnalyticsConsentDecision | null;
  private readonly onWrite?: (status: Choice) => void;

  constructor(
    decision: AnalyticsConsentDecision | null = null,
    onWrite?: (status: Choice) => void,
  ) {
    this.decision = decision;
    this.onWrite = onWrite;
  }

  read(): AnalyticsConsentDecision | null {
    this.readCalls += 1;
    return this.decision ? { ...this.decision } : null;
  }

  write(status: Choice): AnalyticsConsentDecision {
    this.onWrite?.(status);
    this.writes.push(status);
    this.decision = { status, decidedAt: this.writes.length };
    return { ...this.decision };
  }
}

class TestAnalytics implements AnalyticsService {
  readonly available: boolean;
  readonly calls: string[] = [];
  anonymousId: string | null = 'anonymous-test-id';
  private readonly onSetConsent?: (
    consent: AnalyticsConsent,
  ) => Promise<void>;
  private readonly onReset?: () => Promise<void>;

  constructor(
    available = true,
    onSetConsent?: (
      consent: AnalyticsConsent,
    ) => Promise<void>,
    onReset?: () => Promise<void>,
  ) {
    this.available = available;
    this.onSetConsent = onSetConsent;
    this.onReset = onReset;
  }

  async setConsent(consent: AnalyticsConsent): Promise<void> {
    this.calls.push(`set:${consent}`);
    await this.onSetConsent?.(consent);
  }

  track(_event: AnalyticsEvent): void {}

  async getAnonymousId(): Promise<string | null> {
    this.calls.push('get-id');
    return this.anonymousId;
  }

  async reset(): Promise<void> {
    this.calls.push('reset');
    await this.onReset?.();
  }
}

let latestValue: AnalyticsConsentContextValue | null = null;

function Probe() {
  const value = useAnalyticsConsent();
  useEffect(() => {
    latestValue = value;
  }, [value]);

  return (
    <>
      <span>consent:{value.consent}</span>
      <span>available:{String(value.available)}</span>
      <span>active:{String(value.active)}</span>
      <span>ready:{String(value.ready)}</span>
      {value.error && <span role="alert">{value.error}</span>}
      <button onClick={() => void value.choose('granted')}>grant</button>
      <button onClick={() => void value.choose('denied')}>deny</button>
      <button
        onClick={() => void value.getAnonymousId().then((id) => {
          document.body.dataset.analyticsId = id ?? '';
        })}
      >
        id
      </button>
    </>
  );
}

function renderProvider(
  analytics: AnalyticsService,
  analyticsConsent: AnalyticsConsentStore,
) {
  return render(
    <ServicesProvider value={{ analytics, analyticsConsent }}>
      <AnalyticsConsentProvider>
        <Probe />
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
}

async function waitUntilReady() {
  await waitFor(() => {
    expect(screen.getByText('ready:true')).toBeInTheDocument();
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('AnalyticsConsentProvider', () => {
  beforeEach(() => {
    latestValue = null;
    delete document.body.dataset.analyticsId;
  });

  it('starts unknown and applies disabled consent when no decision is stored', async () => {
    const analytics = new TestAnalytics();
    const store = new TestConsentStore();

    renderProvider(analytics, store);

    expect(screen.getByText('consent:unknown')).toBeInTheDocument();
    expect(screen.getByText('active:false')).toBeInTheDocument();
    expect(store.readCalls).toBe(1);
    await waitUntilReady();
    expect(analytics.calls).toEqual(['set:unknown']);
  });

  it('shows a safe read error and treats the decision as unknown', async () => {
    const analytics = new TestAnalytics();
    const store: AnalyticsConsentStore = {
      read: () => {
        throw new Error('private storage detail');
      },
      write: (status) => ({ status, decidedAt: 1 }),
    };

    renderProvider(analytics, store);

    expect(screen.getByText('consent:unknown')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the analytics preference. Analytics remains disabled.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private storage detail',
    );
    await waitUntilReady();
    expect(analytics.calls).toEqual(['set:unknown']);
  });

  it('becomes ready without initializing or persisting unavailable analytics', async () => {
    const store = new TestConsentStore();

    renderProvider(noopAnalytics, store);

    await waitUntilReady();
    expect(screen.getByText('available:false')).toBeInTheDocument();
    expect(screen.getByText('consent:unknown')).toBeInTheDocument();
    expect(screen.getByText('active:false')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Analytics is unavailable in this build.',
    );
    expect(store.writes).toEqual([]);
    await expect(latestValue!.getAnonymousId()).resolves.toBeNull();
  });

  it('persists and publishes denied consent when analytics is unavailable', async () => {
    const analytics = new TestAnalytics(false);
    const store = new TestConsentStore();
    renderProvider(analytics, store);
    await waitUntilReady();

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));

    await waitFor(() => {
      expect(screen.getByText('consent:denied')).toBeInTheDocument();
    });
    expect(store.writes).toEqual(['denied']);
    expect(analytics.calls).toEqual(['reset']);
    expect(screen.getByText('active:false')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['granted', 'set:granted'],
    ['denied', 'reset'],
  ] as const)('applies stored %s consent on mount', async (status, call) => {
    const analytics = new TestAnalytics();
    const store = new TestConsentStore({ status, decidedAt: 10 });

    renderProvider(analytics, store);

    expect(screen.getByText(`consent:${status}`)).toBeInTheDocument();
    await waitUntilReady();
    expect(analytics.calls).toEqual([call]);
    expect(screen.getByText(`active:${String(status === 'granted')}`))
      .toBeInTheDocument();
  });

  it('keeps stored granted consent inactive until adapter application resolves', async () => {
    const application = deferred();
    const analytics = new TestAnalytics(true, async (consent) => {
      if (consent === 'granted') {
        await application.promise;
      }
    });
    const store = new TestConsentStore({
      status: 'granted',
      decidedAt: 10,
    });

    renderProvider(analytics, store);

    expect(screen.getByText('consent:granted')).toBeInTheDocument();
    expect(screen.getByText('active:false')).toBeInTheDocument();
    application.resolve();
    await waitUntilReady();
    expect(screen.getByText('active:true')).toBeInTheDocument();
  });

  it('publishes persisted grant before adapter application settles', async () => {
    const application = deferred();
    const order: string[] = [];
    const analytics = new TestAnalytics(true, async (consent) => {
      order.push(`apply:${consent}`);
      if (consent === 'granted') {
        await application.promise;
      }
    });
    const store = new TestConsentStore(null, (status) => {
      order.push(`persist:${status}`);
    });
    renderProvider(analytics, store);
    await waitUntilReady();
    order.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    expect(screen.getByText('consent:granted')).toBeInTheDocument();
    expect(screen.getByText('active:false')).toBeInTheDocument();
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    expect(order).toEqual(['persist:granted', 'apply:granted']);
    expect(store.writes).toEqual(['granted']);

    application.resolve();
    await waitUntilReady();
    expect(screen.getByText('active:true')).toBeInTheDocument();
  });

  it('publishes persisted denial before deferred reset settles', async () => {
    const reset = deferred();
    const order: string[] = [];
    const analytics = new TestAnalytics(
      true,
      undefined,
      async () => {
        order.push('reset');
        await reset.promise;
      },
    );
    const store = new TestConsentStore(
      { status: 'granted', decidedAt: 10 },
      (status) => {
        order.push(`persist:${status}`);
      },
    );
    renderProvider(analytics, store);
    await waitUntilReady();
    expect(screen.getByText('active:true')).toBeInTheDocument();
    analytics.calls.length = 0;
    order.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));

    expect(screen.getByText('consent:denied')).toBeInTheDocument();
    expect(screen.getByText('active:false')).toBeInTheDocument();
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    expect(order).toEqual(['persist:denied', 'reset']);
    expect(analytics.calls).toEqual(['reset']);

    reset.resolve();
    await waitUntilReady();
  });

  it('does not apply or publish consent when persistence fails', async () => {
    const analytics = new TestAnalytics();
    const store: AnalyticsConsentStore = {
      read: () => ({ status: 'denied', decidedAt: 10 }),
      write: () => {
        throw new Error('private storage detail');
      },
    };
    renderProvider(analytics, store);
    await waitUntilReady();
    analytics.calls.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the analytics preference. Please try again.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private storage detail',
    );
    expect(screen.getByText('consent:denied')).toBeInTheDocument();
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(analytics.calls).toEqual([]);
  });

  it('resets after a denial write failure and keeps prior consent', async () => {
    const analytics = new TestAnalytics();
    const store: AnalyticsConsentStore = {
      read: () => ({ status: 'granted', decidedAt: 10 }),
      write: () => {
        throw new Error('private storage detail');
      },
    };
    renderProvider(analytics, store);
    await waitUntilReady();
    analytics.calls.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the analytics preference. Please try again.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private storage detail',
    );
    expect(screen.getByText('consent:granted')).toBeInTheDocument();
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(analytics.calls).toEqual(['reset']);
  });

  it('publishes persisted denial and shows a safe error when reset fails', async () => {
    const analytics = new TestAnalytics(
      true,
      undefined,
      async () => {
        throw new Error('private reset detail');
      },
    );
    const store = new TestConsentStore({
      status: 'granted',
      decidedAt: 10,
    });
    renderProvider(analytics, store);
    await waitUntilReady();
    analytics.calls.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Analytics preference was saved, but analytics could not be fully disabled. Please try again.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private reset detail',
    );
    expect(screen.getByText('consent:denied')).toBeInTheDocument();
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(store.writes).toEqual(['denied']);
    expect(analytics.calls).toEqual(['reset']);
  });

  it('shows a safe error when denial persistence and reset both fail', async () => {
    const analytics = new TestAnalytics(
      true,
      undefined,
      async () => {
        throw new Error('private reset detail');
      },
    );
    const store: AnalyticsConsentStore = {
      read: () => ({ status: 'granted', decidedAt: 10 }),
      write: () => {
        throw new Error('private storage detail');
      },
    };
    renderProvider(analytics, store);
    await waitUntilReady();
    analytics.calls.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'deny' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the analytics preference or fully disable analytics. Please try again.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private storage detail',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private reset detail',
    );
    expect(screen.getByText('consent:granted')).toBeInTheDocument();
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(analytics.calls).toEqual(['reset']);
  });

  it('keeps a failed persisted grant inactive and preserves the apply error', async () => {
    const analytics = new TestAnalytics(
      true,
      async (consent) => {
        if (consent === 'granted') {
          throw new Error('private adapter detail');
        }
      },
      async () => {
        throw new Error('private reset detail');
      },
    );
    const store = new TestConsentStore();
    renderProvider(analytics, store);
    await waitUntilReady();
    analytics.calls.length = 0;

    await userEvent.click(screen.getByRole('button', { name: 'grant' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not apply the analytics preference. Analytics remains disabled.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private adapter detail',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private reset detail',
    );
    expect(screen.getByText('consent:granted')).toBeInTheDocument();
    expect(screen.getByText('active:false')).toBeInTheDocument();
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(store.writes).toEqual(['granted']);
    expect(analytics.calls).toEqual(['set:granted', 'reset']);
    await expect(latestValue!.getAnonymousId()).resolves.toBeNull();
    expect(analytics.calls).not.toContain('get-id');
  });

  it('delegates anonymous ID retrieval', async () => {
    const analytics = new TestAnalytics();
    const store = new TestConsentStore({
      status: 'granted',
      decidedAt: 10,
    });
    renderProvider(analytics, store);
    await waitUntilReady();
    expect(screen.getByText('active:true')).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'id' }));
    });

    expect(document.body.dataset.analyticsId).toBe('anonymous-test-id');
    expect(analytics.calls).toContain('get-id');
  });

  it('throws when the hook is used outside the provider', () => {
    function OutsideProbe() {
      useAnalyticsConsent();
      return null;
    }

    expect(() => render(<OutsideProbe />)).toThrow(
      'useAnalyticsConsent must be used within AnalyticsConsentProvider',
    );
  });
});
