import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGa4Analytics } from './ga4Analytics';
import { noopAnalytics } from './noopAnalytics';

type GtagCommand = [command: string, ...args: unknown[]];
type QueuedGtagCommand = GtagCommand | IArguments;
type GaDisableFlags = {
  [key in `ga-disable-${string}`]?: boolean;
};
type TestAnalyticsWindow = Window & GaDisableFlags & {
  dataLayer?: QueuedGtagCommand[];
  gtag?: unknown;
};

const MEASUREMENT_ID = 'G-TEST123';
const DISABLE_KEY = `ga-disable-${MEASUREMENT_ID}` as const;
const PRIVATE_VALUE = 'private-analytics-value@example.test';
const REGISTRY_SYMBOL_DESCRIPTION =
  'apnea-trainer.ga4-analytics-registry';

function analyticsWindow(win: Window = window): TestAnalyticsWindow {
  return win as TestAnalyticsWindow;
}

function rawDataLayerCommands(
  win: Window = window,
): QueuedGtagCommand[] {
  return analyticsWindow(win).dataLayer ?? [];
}

function dataLayerCommands(win: Window = window): GtagCommand[] {
  return rawDataLayerCommands(win).map((entry) => {
    const [command, ...args] = Array.from(entry);
    if (typeof command !== 'string') {
      throw new Error('Invalid test analytics command.');
    }
    return [command, ...args];
  });
}

function clearAnalyticsRegistry(doc: Document = document): void {
  for (const key of Object.getOwnPropertySymbols(doc)) {
    if (key.description === REGISTRY_SYMBOL_DESCRIPTION) {
      Reflect.deleteProperty(doc, key);
    }
  }
}

function documentWithReferrer(referrer: string): Document {
  return {
    referrer,
    head: document.head,
    createElement: document.createElement.bind(document),
    get cookie() {
      return document.cookie;
    },
    set cookie(value: string) {
      document.cookie = value;
    },
  } as unknown as Document;
}

function windowForHostname(hostname: string): Window {
  return {
    location: {
      hostname,
      origin: `https://${hostname}`,
      pathname: '/',
      search: '',
    },
    navigator: window.navigator,
    localStorage: window.localStorage,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  } as unknown as Window;
}

describe('GA4 analytics adapter', () => {
  beforeEach(() => {
    clearAnalyticsRegistry();
    document.head.querySelectorAll('[data-apnea-ga4]').forEach((node) => {
      node.remove();
    });
    document.cookie.split(';').forEach((cookie) => {
      const name = cookie.split('=')[0]?.trim();
      if (name) {
        document.cookie = `${name}=; Max-Age=0; path=/`;
      }
    });
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    delete analyticsWindow().dataLayer;
    delete analyticsWindow().gtag;
    delete analyticsWindow()[DISABLE_KEY];
    delete analyticsWindow()['ga-disable-G-OTHER'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('provides an unavailable no-op fallback whose methods never throw', async () => {
    expect(noopAnalytics.available).toBe(false);
    await expect(noopAnalytics.setConsent('granted')).resolves.toBeUndefined();
    expect(() => noopAnalytics.track({ name: 'goal_created' })).not.toThrow();
    await expect(noopAnalytics.getAnonymousId()).resolves.toBeNull();
    await expect(noopAnalytics.reset()).resolves.toBeUndefined();
  });

  it('creates no tag, command queue, or request before explicit consent', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });

    analytics.track({ name: 'goal_created' });
    await analytics.setConsent('unknown');

    expect(analytics.available).toBe(true);
    expect(document.querySelector('[data-apnea-ga4]')).toBeNull();
    expect(dataLayerCommands()).toEqual([]);
    await expect(analytics.getAnonymousId()).resolves.toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('reuses one service for the same document and measurement ID', async () => {
    const first = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    const second = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: false,
    });

    expect(second).toBe(first);

    await second.setConsent('granted');

    expect(document.querySelectorAll('[data-apnea-ga4]')).toHaveLength(1);
    expect(
      dataLayerCommands().filter((command) => command[0] === 'config'),
    ).toHaveLength(1);
  });

  it('rejects a different measurement ID for the same document', () => {
    createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });

    expect(() => createGa4Analytics({
      measurementId: 'G-OTHER',
      strict: false,
    })).toThrow('GA4 analytics is already configured for this document.');
    expect(analyticsWindow()['ga-disable-G-OTHER']).toBeUndefined();
  });

  it('does not initialize when consent is denied', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });

    await analytics.setConsent('denied');
    analytics.track({ name: 'goal_created' });

    expect(document.querySelector('[data-apnea-ga4]')).toBeNull();
    expect(dataLayerCommands()).toEqual([]);
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('loads one encoded async tag and queues privacy-first initialization', async () => {
    window.history.replaceState(
      {},
      '',
      '/stats?utm_source=reddit&utm_campaign=launch-2026',
    );
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });

    await analytics.setConsent('granted');
    await analytics.setConsent('granted');

    const scripts = document.querySelectorAll<HTMLScriptElement>(
      '[data-apnea-ga4]',
    );
    expect(scripts).toHaveLength(1);
    expect(scripts[0].async).toBe(true);
    expect(scripts[0].src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${
        encodeURIComponent(MEASUREMENT_ID)
      }`,
    );
    expect(analyticsWindow()[DISABLE_KEY]).toBe(false);

    const commands = dataLayerCommands();
    expect(commands[0]).toEqual([
      'consent',
      'default',
      {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ]);
    expect(commands[1]).toEqual([
      'consent',
      'update',
      { analytics_storage: 'granted' },
    ]);
    expect(commands[2]?.[0]).toBe('js');

    const setIndex = commands.findIndex((command) => command[0] === 'set');
    const configIndex = commands.findIndex((command) => command[0] === 'config');
    expect(setIndex).toBeGreaterThan(1);
    expect(configIndex).toBeGreaterThan(setIndex);
    expect(commands[setIndex]?.[1]).toEqual(expect.objectContaining({
      app_version: expect.any(String),
      install_mode: expect.stringMatching(/^(browser|standalone)$/),
      network_state: expect.stringMatching(/^(online|offline)$/),
      page_location: `${window.location.origin}/stats`,
      campaign_source: 'reddit',
      campaign_name: 'launch-2026',
    }));
    expect(commands[configIndex]).toEqual([
      'config',
      MEASUREMENT_ID,
      expect.objectContaining({
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: `${window.location.origin}/stats`,
      }),
    ]);
  });

  it('queues documented arguments objects for Google tag compatibility', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });

    await analytics.setConsent('granted');

    const entries = rawDataLayerCommands();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(
      (entry) => Object.prototype.toString.call(entry) === '[object Arguments]',
    )).toBe(true);
  });

  it('fails closed when a pre-existing gtag is not a function', async () => {
    analyticsWindow().gtag = { broken: true };
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: false,
    });

    await expect(analytics.setConsent('granted')).resolves.toBeUndefined();

    expect(document.querySelector('[data-apnea-ga4]')).toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
    await expect(analytics.getAnonymousId()).resolves.toBeNull();
  });

  it('fails closed without appending the loader when initialization dispatch throws', async () => {
    const commands: GtagCommand[] = [];
    analyticsWindow().gtag = (...command: GtagCommand) => {
      commands.push(command);
      if (command[0] === 'config') {
        throw new Error(PRIVATE_VALUE);
      }
    };
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });

    await expect(analytics.setConsent('granted')).resolves.toBeUndefined();

    expect(document.querySelector('[data-apnea-ga4]')).toBeNull();
    expect(commands.at(-1)).toEqual([
      'consent',
      'update',
      {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ]);
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('warns once and disables dispatch for the page after script failure', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
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
    await analytics.setConsent('granted');

    expect(dataLayerCommands()).toHaveLength(commandCount);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      'GA4 failed to load; analytics is disabled for this page.',
    );
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
    await expect(analytics.getAnonymousId()).resolves.toBeNull();
  });

  it('does not warn about script failure in production mode', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: false,
    });
    await analytics.setConsent('granted');

    document.querySelector<HTMLScriptElement>('[data-apnea-ga4]')!
      .dispatchEvent(new Event('error'));

    expect(warning).not.toHaveBeenCalled();
  });

  it('adds common context and only Task 1 serialized event properties', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
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
      expect.objectContaining({
        app_version: '1.2.3',
        install_mode: 'standalone',
        network_state: 'online',
        page_location: `${window.location.origin}/`,
        session_type: 'co2',
        duration_bucket: '10_to_20m',
      }),
    ]);
    expect(JSON.stringify(dataLayerCommands())).not.toMatch(
      /sessionType|durationBucket/,
    );
  });

  it('accepts an explicit browser install mode from the context provider', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
    })));
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
      context: () => ({
        app_version: '1.2.3',
        install_mode: 'browser',
        network_state: 'online',
      }),
    });
    await analytics.setConsent('granted');

    analytics.track({ name: 'goal_created' });

    expect(dataLayerCommands()).toContainEqual([
      'event',
      'goal_created',
      expect.objectContaining({ install_mode: 'browser' }),
    ]);
  });

  it('throws invalid events in strict mode', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    expect(() => analytics.track({
      name: 'goal_created',
      targetHoldSec: 240,
    } as never)).toThrow('Undeclared analytics property.');
  });

  it('drops invalid production events with one value-safe warning', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: false,
    });
    await analytics.setConsent('granted');
    const commandCount = dataLayerCommands().length;

    analytics.track({
      name: 'goal_created',
      [PRIVATE_VALUE]: 240,
    } as never);
    analytics.track({ name: PRIVATE_VALUE } as never);

    expect(dataLayerCommands()).toHaveLength(commandCount);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      'An invalid analytics event was dropped.',
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(PRIVATE_VALUE);
  });

  it('updates page context without retaining raw query or referrer values', async () => {
    const referrer = `https://ref.example/stats?email=${PRIVATE_VALUE}#private`;
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
      document: documentWithReferrer(referrer),
    });
    await analytics.setConsent('granted');

    window.history.replaceState(
      {},
      '',
      '/stats?utm_source=reddit&utm_medium=social_media'
        + '&utm_campaign=launch-2026&utm_id=spring_26'
        + '&utm_term=breath-hold&utm_content=unsafe%40example.test'
        + `&private_hold=${encodeURIComponent(PRIVATE_VALUE)}`,
    );
    analytics.track({
      name: 'page_view',
      path: window.location.pathname,
      surface: 'stats',
    });

    const commands = dataLayerCommands();
    const eventIndex = commands.findIndex(
      (command) => command[0] === 'event' && command[1] === 'page_view',
    );
    expect(commands[eventIndex - 1]).toEqual([
      'set',
      expect.objectContaining({
        page_location: `${window.location.origin}/stats`,
        page_referrer: 'https://ref.example/stats',
        campaign_source: 'reddit',
        campaign_medium: 'social_media',
        campaign_name: 'launch-2026',
        campaign_id: 'spring_26',
        campaign_term: 'breath-hold',
      }),
    ]);
    expect(commands[eventIndex]).toEqual([
      'event',
      'page_view',
      expect.objectContaining({
        page_location: `${window.location.origin}/stats`,
        page_referrer: 'https://ref.example/stats',
        page_path: '/stats',
        surface: 'stats',
      }),
    ]);
    expect(JSON.stringify(commands)).not.toMatch(
      /private_hold|unsafe|private-analytics-value|example\.test.*private/i,
    );
  });

  it('uses sanitized virtual referrers across SPA page views and semantic events', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
      document: documentWithReferrer(
        `https://ref.example/stats?private=${PRIVATE_VALUE}#secret`,
      ),
    });
    await analytics.setConsent('granted');

    window.history.replaceState({}, '', `/stats?private=${PRIVATE_VALUE}#one`);
    analytics.track({
      name: 'page_view',
      path: '/stats',
      surface: 'stats',
    });
    window.history.replaceState(
      {},
      '',
      `/calendar?private=${PRIVATE_VALUE}#two`,
    );
    analytics.track({
      name: 'page_view',
      path: '/calendar',
      surface: 'calendar',
    });
    analytics.track({ name: 'goal_created' });

    const events = dataLayerCommands().filter(
      (command) => command[0] === 'event',
    );
    expect(events).toEqual([
      [
        'event',
        'page_view',
        expect.objectContaining({
          page_location: `${window.location.origin}/stats`,
          page_referrer: 'https://ref.example/stats',
        }),
      ],
      [
        'event',
        'page_view',
        expect.objectContaining({
          page_location: `${window.location.origin}/calendar`,
          page_referrer: `${window.location.origin}/stats`,
        }),
      ],
      [
        'event',
        'goal_created',
        expect.objectContaining({
          page_location: `${window.location.origin}/calendar`,
          page_referrer: `${window.location.origin}/stats`,
        }),
      ],
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /private-analytics-value|[?#](?:one|two|secret)/i,
    );
  });

  it('omits an absent referrer from the first manual page view', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');
    window.history.replaceState({}, '', '/stats');

    analytics.track({
      name: 'page_view',
      path: '/stats',
      surface: 'stats',
    });

    const pageView = dataLayerCommands().find(
      (command) => command[0] === 'event' && command[1] === 'page_view',
    );
    expect(pageView?.[2]).not.toHaveProperty('page_referrer');
  });

  it('does not advance the virtual referrer when a page view is dropped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: false,
      document: documentWithReferrer('https://ref.example/landing'),
    });
    await analytics.setConsent('granted');

    window.history.replaceState({}, '', '/');
    analytics.track({
      name: 'page_view',
      path: '/',
      surface: 'home',
    });
    window.history.replaceState({}, '', '/stats');
    analytics.track({
      name: 'page_view',
      path: '/stats',
      surface: 'stats',
      [PRIVATE_VALUE]: 'private',
    } as never);
    window.history.replaceState({}, '', '/calendar');
    analytics.track({
      name: 'page_view',
      path: '/calendar',
      surface: 'calendar',
    });

    const pageViews = dataLayerCommands().filter(
      (command) => command[0] === 'event' && command[1] === 'page_view',
    );
    expect(pageViews).toHaveLength(2);
    expect(pageViews[1]?.[2]).toEqual(expect.objectContaining({
      page_location: `${window.location.origin}/calendar`,
      page_referrer: `${window.location.origin}/`,
    }));
  });

  it('does not advance the virtual referrer when page-view dispatch fails', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
      document: documentWithReferrer('https://ref.example/privacy'),
    });
    await analytics.setConsent('granted');
    window.history.replaceState({}, '', '/');
    analytics.track({
      name: 'page_view',
      path: '/',
      surface: 'home',
    });

    const commands: GtagCommand[] = [];
    let reentered = false;
    analyticsWindow().gtag = (...command: GtagCommand) => {
      commands.push(command);
      if (
        command[0] === 'event'
        && command[1] === 'page_view'
        && !reentered
      ) {
        reentered = true;
        analytics.track({ name: 'goal_created' });
        throw new Error(PRIVATE_VALUE);
      }
    };
    window.history.replaceState({}, '', '/stats');

    expect(() => analytics.track({
      name: 'page_view',
      path: '/stats',
      surface: 'stats',
    })).not.toThrow();

    expect(commands).toContainEqual([
      'event',
      'goal_created',
      expect.objectContaining({
        page_location: `${window.location.origin}/stats`,
        page_referrer: 'https://ref.example/privacy',
      }),
    ]);
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('fails closed on event dispatch and revokes pending client IDs', async () => {
    let commandsThrow = false;
    analyticsWindow().gtag = (..._command: GtagCommand) => {
      if (commandsThrow) {
        throw new Error(PRIVATE_VALUE);
      }
    };
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');
    const pendingId = analytics.getAnonymousId();

    commandsThrow = true;

    expect(() => analytics.track({ name: 'goal_created' })).not.toThrow();
    await expect(pendingId).resolves.toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('clears identifiers when consent denial dispatch throws', async () => {
    document.cookie = '_ga=GA1.1.123.456; path=/';
    localStorage.setItem('_ga_TEST', 'session');
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');
    analyticsWindow().gtag = () => {
      throw new Error(PRIVATE_VALUE);
    };

    await expect(analytics.setConsent('denied')).resolves.toBeUndefined();

    expect(document.cookie).not.toMatch(/(?:^|;\s*)_ga(?:_|=)/);
    expect(localStorage.getItem('_ga_TEST')).toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('clears identifiers when reset consent dispatch throws', async () => {
    document.cookie = '_ga=GA1.1.123.456; path=/';
    localStorage.setItem('_ga_TEST', 'session');
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');
    analyticsWindow().gtag = () => {
      throw new Error(PRIVATE_VALUE);
    };

    await expect(analytics.reset()).resolves.toBeUndefined();

    expect(document.cookie).not.toMatch(/(?:^|;\s*)_ga(?:_|=)/);
    expect(localStorage.getItem('_ga_TEST')).toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('stops tracking, denies consent, and clears GA identifiers on reset', async () => {
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_ga_TEST=GS1.1.123.456; path=/';
    localStorage.setItem('_ga', 'client');
    localStorage.setItem('_ga_TEST', 'session');
    localStorage.setItem('product-state', 'keep');
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    await analytics.reset();
    const commandCount = dataLayerCommands().length;
    analytics.track({ name: 'goal_created' });

    expect(dataLayerCommands()).toHaveLength(commandCount);
    expect(dataLayerCommands().at(-1)).toEqual([
      'consent',
      'update',
      {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ]);
    expect(document.cookie).not.toMatch(/(?:^|;\s*)_ga(?:_|=)/);
    expect(localStorage.getItem('_ga')).toBeNull();
    expect(localStorage.getItem('_ga_TEST')).toBeNull();
    expect(localStorage.getItem('product-state')).toBe('keep');
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
  });

  it('expires GA cookies for host-only and parent-domain variants', async () => {
    const cookieWrites: string[] = [];
    const fakeDocument = {
      referrer: '',
      head: document.head,
      createElement: document.createElement.bind(document),
      get cookie() {
        return '_ga=client; _ga_TEST=session; product=value';
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    } as unknown as Document;
    const fakeWindow = windowForHostname('app.example.test');
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
      window: fakeWindow,
      document: fakeDocument,
    });
    await analytics.setConsent('granted');

    await analytics.reset();

    expect(cookieWrites).toEqual(expect.arrayContaining([
      expect.stringContaining('_ga=; Max-Age=0; path=/'),
      expect.stringContaining('domain=app.example.test'),
      expect.stringContaining('domain=.app.example.test'),
      expect.stringContaining('domain=example.test'),
      expect.stringContaining('domain=.example.test'),
    ]));
    expect(cookieWrites.join('\n')).not.toContain('product=');
  });

  it('restores dispatch after reset without adding another script', async () => {
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');
    await analytics.reset();
    await analytics.setConsent('granted');

    analytics.track({ name: 'goal_created' });

    expect(document.querySelectorAll('[data-apnea-ga4]')).toHaveLength(1);
    expect(analyticsWindow()[DISABLE_KEY]).toBe(false);
    expect(dataLayerCommands()).toContainEqual([
      'consent',
      'update',
      { analytics_storage: 'granted' },
    ]);
    expect(dataLayerCommands()).toContainEqual([
      'event',
      'goal_created',
      expect.any(Object),
    ]);
  });

  it('returns the GA client id and clears its timeout', async () => {
    vi.useFakeTimers();
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();
    const command = dataLayerCommands().find(
      (entry) => entry[0] === 'get' && entry[2] === 'client_id',
    );
    const callback = command?.[3] as ((value: unknown) => void) | undefined;
    callback?.('client-123');

    await expect(result).resolves.toBe('client-123');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one-shot settlement for synchronous client id callbacks', async () => {
    vi.useFakeTimers();
    analyticsWindow().gtag = (...command: GtagCommand) => {
      if (command[0] === 'get') {
        const callback = command[3] as (value: unknown) => void;
        callback('first-client-id');
        callback('second-client-id');
      }
    };
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();

    await expect(result).resolves.toBe('first-client-id');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when gtag invokes the client id callback and then throws', async () => {
    vi.useFakeTimers();
    let callback: ((value: unknown) => void) | undefined;
    analyticsWindow().gtag = (...command: GtagCommand) => {
      if (command[0] === 'get') {
        callback = command[3] as (value: unknown) => void;
        callback('client-123');
        throw new Error(PRIVATE_VALUE);
      }
    };
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();

    await expect(result).resolves.toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    callback?.('late-client-id');
    await expect(result).resolves.toBeNull();
  });

  it('fails closed when the client id gtag invocation throws directly', async () => {
    vi.useFakeTimers();
    analyticsWindow().gtag = (...command: GtagCommand) => {
      if (command[0] === 'get') {
        throw new Error(PRIVATE_VALUE);
      }
    };
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();

    await expect(result).resolves.toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns null when the GA client id request times out', async () => {
    vi.useFakeTimers();
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('revokes a pending client id request when consent is denied', async () => {
    vi.useFakeTimers();
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();
    await analytics.setConsent('denied');

    await expect(result).resolves.toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('revokes a pending client id request on reset', async () => {
    vi.useFakeTimers();
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();
    await analytics.reset();

    await expect(result).resolves.toBeNull();
    expect(analyticsWindow()[DISABLE_KEY]).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a late client id callback after null settlement', async () => {
    vi.useFakeTimers();
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: true,
    });
    await analytics.setConsent('granted');

    const result = analytics.getAnonymousId();
    const command = dataLayerCommands().find(
      (entry) => entry[0] === 'get' && entry[2] === 'client_id',
    );
    const callback = command?.[3] as ((value: unknown) => void) | undefined;
    callback?.(undefined);

    await expect(result).resolves.toBeNull();
    callback?.('late-client-id');
    await expect(result).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains production context failures and never logs rejected values', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const analytics = createGa4Analytics({
      measurementId: MEASUREMENT_ID,
      strict: false,
      context: () => {
        throw new Error(PRIVATE_VALUE);
      },
    });

    await expect(analytics.setConsent('granted')).resolves.toBeUndefined();
    expect(() => analytics.track({ name: 'goal_created' })).not.toThrow();

    expect(dataLayerCommands()).toContainEqual([
      'event',
      'goal_created',
      expect.objectContaining({
        page_location: `${window.location.origin}/`,
      }),
    ]);
    expect(JSON.stringify(dataLayerCommands())).not.toContain(PRIVATE_VALUE);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(PRIVATE_VALUE);
  });
});
