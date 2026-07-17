import type {
  AnalyticsConsent,
  AnalyticsService,
} from '../../application/analytics/analyticsService';
import type {
  AnalyticsEvent,
  SerializedAnalyticsEvent,
} from '../../application/analytics/events';
import {
  normalizeAnalyticsPath,
  serializeAnalyticsEvent,
} from '../../application/analytics/events';

const DENIED_CONSENT = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const;

const GRANTED_ANALYTICS_CONSENT = {
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

const CAMPAIGN_VALUE_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const APP_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/;
const SCRIPT_FAILURE_WARNING =
  'GA4 failed to load; analytics is disabled for this page.';
const INVALID_EVENT_WARNING = 'An invalid analytics event was dropped.';
const CONTEXT_WARNING =
  'Analytics context was unavailable; safe defaults were used.';
const GA4_CONFIGURATION_ERROR =
  'GA4 analytics is already configured for this document.';
const GA4_REGISTRY_KEY = Symbol('apnea-trainer.ga4-analytics-registry');

interface CommonAnalyticsContext {
  app_version: string;
  install_mode: 'browser' | 'standalone';
  network_state: 'online' | 'offline';
}

interface AnalyticsContext extends CommonAnalyticsContext {
  page_location: string;
  page_referrer?: string;
  campaign_source: string;
  campaign_medium: string;
  campaign_name: string;
  campaign_id: string;
  campaign_term: string;
  campaign_content: string;
}

type EventParameters = AnalyticsContext & Record<string, string>;

type GtagCommand =
  | ['consent', 'default', typeof DENIED_CONSENT]
  | ['consent', 'update', typeof DENIED_CONSENT]
  | ['consent', 'update', typeof GRANTED_ANALYTICS_CONSENT]
  | ['js', Date]
  | ['set', AnalyticsContext]
  | [
    'config',
    string,
    AnalyticsContext & {
      send_page_view: false;
      allow_google_signals: false;
      allow_ad_personalization_signals: false;
    },
  ]
  | ['event', string, EventParameters]
  | ['get', string, 'client_id', (value: unknown) => void];

type GaDisableFlags = {
  [key in `ga-disable-${string}`]?: boolean;
};

type AnalyticsWindow = Window & GaDisableFlags & {
  dataLayer?: unknown;
  gtag?: unknown;
};

interface Ga4AnalyticsRegistryEntry {
  measurementId: string;
  service: AnalyticsService;
}

type AnalyticsDocument = Document & {
  [GA4_REGISTRY_KEY]?: Ga4AnalyticsRegistryEntry;
};

const fallbackRegistries = new WeakMap<Document, Ga4AnalyticsRegistryEntry>();

export interface Ga4AnalyticsOptions {
  measurementId: string;
  strict: boolean;
  window?: Window;
  document?: Document;
  context?: () => CommonAnalyticsContext;
}

interface PendingAnonymousIdRequest {
  finish(value: string | null): void;
}

function safeWarn(message: string): void {
  try {
    console.warn(message);
  } catch {
    // Diagnostics must never affect product behavior.
  }
}

function safeCampaignValue(value: string | null): string {
  const trimmed = value?.trim();
  if (
    !trimmed
    || trimmed.length > 80
    || !CAMPAIGN_VALUE_PATTERN.test(trimmed)
  ) {
    return '';
  }
  return trimmed;
}

function safeAppVersion(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 80
    || !APP_VERSION_PATTERN.test(value)
  ) {
    return 'dev';
  }
  return value;
}

function defaultCommonContext(win: Window): CommonAnalyticsContext {
  let standalone = false;
  try {
    const navigatorWithStandalone = win.navigator as Navigator & {
      standalone?: boolean;
    };
    standalone =
      win.matchMedia?.('(display-mode: standalone)').matches === true
      || navigatorWithStandalone.standalone === true;
  } catch {
    standalone = false;
  }

  let online = false;
  try {
    online = win.navigator.onLine;
  } catch {
    online = false;
  }

  return {
    app_version: safeAppVersion(
      typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    ),
    install_mode: standalone ? 'standalone' : 'browser',
    network_state: online ? 'online' : 'offline',
  };
}

function sanitizeCommonContext(
  value: CommonAnalyticsContext,
  fallback: CommonAnalyticsContext,
): CommonAnalyticsContext {
  return {
    app_version: safeAppVersion(value.app_version),
    install_mode: value.install_mode === 'browser'
      || value.install_mode === 'standalone'
      ? value.install_mode
      : fallback.install_mode,
    network_state: value.network_state === 'online'
      || value.network_state === 'offline'
      ? value.network_state
      : fallback.network_state,
  };
}

function sanitizedLocation(origin: string, pathname: string): string {
  const parsedOrigin = new URL(origin);
  if (
    (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:')
    || parsedOrigin.origin === 'null'
  ) {
    throw new Error('Analytics page context is unavailable.');
  }
  return `${parsedOrigin.origin}${normalizeAnalyticsPath(pathname)}`;
}

function currentPageLocation(win: Window): string {
  try {
    return sanitizedLocation(win.location.origin, win.location.pathname);
  } catch {
    throw new Error('Analytics page context is unavailable.');
  }
}

function sanitizedReferrer(value: string): string {
  if (value === '') {
    return '';
  }

  try {
    const referrer = new URL(value);
    return sanitizedLocation(referrer.origin, referrer.pathname);
  } catch {
    return '';
  }
}

function campaignContext(win: Window): Pick<
  AnalyticsContext,
  | 'campaign_source'
  | 'campaign_medium'
  | 'campaign_name'
  | 'campaign_id'
  | 'campaign_term'
  | 'campaign_content'
> {
  const result = {
    campaign_source: '',
    campaign_medium: '',
    campaign_name: '',
    campaign_id: '',
    campaign_term: '',
    campaign_content: '',
  };

  let search = '';
  try {
    search = win.location.search;
  } catch {
    return result;
  }

  let parameters: URLSearchParams;
  try {
    parameters = new URLSearchParams(search);
  } catch {
    return result;
  }

  for (
    const queryName of Object.keys(CAMPAIGN_PARAMETERS) as Array<
      keyof typeof CAMPAIGN_PARAMETERS
    >
  ) {
    const contextName = CAMPAIGN_PARAMETERS[queryName];
    result[contextName] = safeCampaignValue(parameters.get(queryName));
  }
  return result;
}

function documentReferrer(doc: Document): string {
  try {
    return sanitizedReferrer(doc.referrer);
  } catch {
    return '';
  }
}

function cookieDomains(hostname: string): Array<string | null> {
  const domains = new Set<string | null>([null]);
  const isIpAddress =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  const parts = hostname.split('.').filter(Boolean);

  if (!isIpAddress) {
    for (let index = 0; index < parts.length - 1; index += 1) {
      const domain = parts.slice(index).join('.');
      domains.add(domain);
      domains.add(`.${domain}`);
    }
  }

  return Array.from(domains);
}

function clearAnalyticsIdentifiers(win: Window, doc: Document): void {
  let cookieNames: string[] = [];
  try {
    cookieNames = doc.cookie
      .split(';')
      .map((cookie) => cookie.split('=')[0]?.trim() ?? '')
      .filter((name) => name === '_ga' || name.startsWith('_ga_'));
  } catch {
    cookieNames = [];
  }

  let hostname = '';
  try {
    hostname = win.location.hostname;
  } catch {
    hostname = '';
  }

  for (const name of cookieNames) {
    for (const domain of cookieDomains(hostname)) {
      const domainAttribute = domain ? `; domain=${domain}` : '';
      try {
        doc.cookie =
          `${name}=; Max-Age=0; path=/${domainAttribute}; SameSite=Lax`;
      } catch {
        // Best-effort cleanup continues across remaining domain variants.
      }
    }
  }

  try {
    for (let index = win.localStorage.length - 1; index >= 0; index -= 1) {
      const key = win.localStorage.key(index);
      if (key === '_ga' || key?.startsWith('_ga_')) {
        win.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be unavailable in privacy-restricted browsers.
  }
}

function registryEntry(doc: Document): Ga4AnalyticsRegistryEntry | undefined {
  try {
    return (doc as AnalyticsDocument)[GA4_REGISTRY_KEY]
      ?? fallbackRegistries.get(doc);
  } catch {
    return fallbackRegistries.get(doc);
  }
}

function storeRegistryEntry(
  doc: Document,
  entry: Ga4AnalyticsRegistryEntry,
): void {
  try {
    Object.defineProperty(doc, GA4_REGISTRY_KEY, {
      configurable: true,
      value: entry,
    });
  } catch {
    fallbackRegistries.set(doc, entry);
  }
}

function createGa4AnalyticsService(
  options: Ga4AnalyticsOptions,
  win: AnalyticsWindow,
  doc: Document,
): AnalyticsService {
  const disableKey = `ga-disable-${options.measurementId}` as const;
  const pendingAnonymousIdRequests = new Set<PendingAnonymousIdRequest>();
  let consented = false;
  let initialized = false;
  let failed = false;
  let scriptFailureWarned = false;
  let invalidEventWarned = false;
  let contextWarned = false;
  const initialPageReferrer = documentReferrer(doc);
  let currentPageReferrer = initialPageReferrer;
  let lastTrackedPageLocation: string | null = null;

  function setDisabled(disabled: boolean): void {
    try {
      win[disableKey] = disabled;
    } catch {
      // The local consent gate remains authoritative if the flag is blocked.
    }
  }

  function warnContextOnce(): void {
    if (contextWarned) {
      return;
    }
    contextWarned = true;
    safeWarn(CONTEXT_WARNING);
  }

  function commonContext(): CommonAnalyticsContext {
    const fallback = defaultCommonContext(win);
    if (!options.context) {
      return fallback;
    }

    try {
      return sanitizeCommonContext(options.context(), fallback);
    } catch (error) {
      if (options.strict) {
        throw error;
      }
      warnContextOnce();
      return fallback;
    }
  }

  function context(pageReferrer = currentPageReferrer): AnalyticsContext {
    return {
      ...commonContext(),
      page_location: currentPageLocation(win),
      ...(pageReferrer ? { page_referrer: pageReferrer } : {}),
      ...campaignContext(win),
    };
  }

  function finishPendingAnonymousIdRequests(): void {
    for (const request of Array.from(pendingAnonymousIdRequests)) {
      try {
        request.finish(null);
      } catch {
        // Pending product requests must still be revoked best-effort.
      }
    }
  }

  function invokeGtagCommand(command: GtagCommand): boolean {
    try {
      const gtag = win.gtag;
      if (typeof gtag !== 'function') {
        return false;
      }
      Reflect.apply(gtag, win, command);
      return true;
    } catch {
      return false;
    }
  }

  function failClosed(): void {
    failed = true;
    consented = false;
    setDisabled(true);
    try {
      invokeGtagCommand(['consent', 'update', DENIED_CONSENT]);
    } catch {
      // Consent denial is best-effort after the external command path failed.
    }
    try {
      finishPendingAnonymousIdRequests();
    } catch {
      // Failure containment must never affect product behavior.
    }
  }

  function dispatchCommand(command: GtagCommand): boolean {
    if (invokeGtagCommand(command)) {
      return true;
    }
    failClosed();
    return false;
  }

  function ensureCommandQueue(): boolean {
    try {
      if (win.dataLayer === undefined) {
        win.dataLayer = [];
      }
      if (!Array.isArray(win.dataLayer)) {
        return false;
      }
      if (win.gtag === undefined) {
        win.gtag = function gtag() {
          const dataLayer = win.dataLayer;
          if (!Array.isArray(dataLayer)) {
            throw new Error('GA4 command queue is unavailable.');
          }
          // Google's loader expects the documented arguments-object queue.
          dataLayer.push(arguments);
        };
      }
      return typeof win.gtag === 'function';
    } catch {
      return false;
    }
  }

  function clearIdentifiers(): void {
    try {
      clearAnalyticsIdentifiers(win, doc);
    } catch {
      // Identifier cleanup is best-effort in restricted browser environments.
    }
  }

  function handleScriptFailure(): void {
    if (failed) {
      return;
    }
    failClosed();
    if (options.strict && !scriptFailureWarned) {
      scriptFailureWarned = true;
      safeWarn(SCRIPT_FAILURE_WARNING);
    }
  }

  function createScript(): HTMLScriptElement {
    const script = doc.createElement('script');
    script.async = true;
    script.src =
      `https://www.googletagmanager.com/gtag/js?id=${
        encodeURIComponent(options.measurementId)
      }`;
    script.setAttribute('data-apnea-ga4', '');
    script.addEventListener('error', handleScriptFailure);
    return script;
  }

  function ensureInitialized(): void {
    if (initialized || failed) {
      return;
    }

    let initialContext: AnalyticsContext;
    try {
      initialContext = context();
    } catch (error) {
      failClosed();
      if (options.strict) {
        throw error;
      }
      warnContextOnce();
      return;
    }

    let script: HTMLScriptElement;
    try {
      script = createScript();
    } catch {
      failClosed();
      return;
    }

    if (!ensureCommandQueue()) {
      failClosed();
      return;
    }
    if (!dispatchCommand(['consent', 'default', DENIED_CONSENT])) {
      return;
    }
    if (!dispatchCommand([
      'consent',
      'update',
      GRANTED_ANALYTICS_CONSENT,
    ])) {
      return;
    }
    if (!dispatchCommand(['js', new Date()])) {
      return;
    }
    if (!dispatchCommand(['set', initialContext])) {
      return;
    }
    if (!dispatchCommand([
      'config',
      options.measurementId,
      {
        ...initialContext,
        // Keep GA4 stream Enhanced Measurement disabled; manual sanitized
        // page views are required by docs/analytics-setup.md.
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    ])) {
      return;
    }

    try {
      doc.head.append(script);
      initialized = true;
    } catch {
      failClosed();
    }
  }

  function serializedEvent(event: AnalyticsEvent): SerializedAnalyticsEvent | null {
    try {
      return serializeAnalyticsEvent(event);
    } catch (error) {
      if (options.strict) {
        throw error;
      }
      if (!invalidEventWarned) {
        invalidEventWarned = true;
        safeWarn(INVALID_EVENT_WARNING);
      }
      return null;
    }
  }

  function eventContext(pageReferrer: string): AnalyticsContext | null {
    try {
      return context(pageReferrer);
    } catch (error) {
      failClosed();
      if (options.strict) {
        throw error;
      }
      warnContextOnce();
      return null;
    }
  }

  setDisabled(true);

  return {
    available: true,
    async setConsent(consent: AnalyticsConsent) {
      if (consent !== 'granted') {
        consented = false;
        setDisabled(true);
        finishPendingAnonymousIdRequests();
        try {
          if (initialized) {
            dispatchCommand(['consent', 'update', DENIED_CONSENT]);
          }
        } finally {
          if (consent === 'denied') {
            clearIdentifiers();
          }
        }
        return;
      }

      if (failed) {
        consented = false;
        setDisabled(true);
        return;
      }

      consented = true;
      setDisabled(false);
      if (initialized) {
        dispatchCommand([
          'consent',
          'update',
          GRANTED_ANALYTICS_CONSENT,
        ]);
        return;
      }

      ensureInitialized();
    },
    track(event) {
      if (!consented || failed || !initialized) {
        return;
      }

      const serialized = serializedEvent(event);
      if (!serialized) {
        return;
      }
      const pageView = serialized.name === 'page_view';
      const pageReferrer = pageView
        ? lastTrackedPageLocation ?? initialPageReferrer
        : currentPageReferrer;
      const currentContext = eventContext(pageReferrer);
      if (!currentContext || failed || !consented) {
        return;
      }

      if (pageView) {
        if (!dispatchCommand(['set', currentContext])) {
          return;
        }
        if (!dispatchCommand(['event', serialized.name, {
          ...currentContext,
          ...serialized.properties,
        }])) {
          return;
        }
        currentPageReferrer = pageReferrer;
        lastTrackedPageLocation = currentContext.page_location;
        return;
      }
      dispatchCommand(['event', serialized.name, {
        ...currentContext,
        ...serialized.properties,
      }]);
    },
    async getAnonymousId() {
      if (!consented || failed || !initialized) {
        return null;
      }

      return new Promise<string | null>((resolve) => {
        let settled = false;
        let timeout = 0;
        const request: PendingAnonymousIdRequest = {
          finish(value) {
            if (settled) {
              return;
            }
            settled = true;
            try {
              win.clearTimeout(timeout);
            } catch {
              // Timer cleanup is best-effort in restricted environments.
            }
            pendingAnonymousIdRequests.delete(request);
            resolve(value);
          },
        };

        try {
          timeout = win.setTimeout(() => request.finish(null), 5_000);
        } catch {
          failClosed();
          request.finish(null);
          return;
        }
        pendingAnonymousIdRequests.add(request);
        let invocationComplete = false;
        let hasBufferedValue = false;
        let bufferedValue: string | null = null;
        const dispatched = dispatchCommand([
          'get',
          options.measurementId,
          'client_id',
          (value: unknown) => {
            const clientId = typeof value === 'string' ? value : null;
            if (!invocationComplete) {
              if (!hasBufferedValue) {
                hasBufferedValue = true;
                bufferedValue = clientId;
              }
              return;
            }
            request.finish(clientId);
          },
        ]);
        invocationComplete = true;
        if (!dispatched) {
          request.finish(null);
        } else if (hasBufferedValue) {
          request.finish(bufferedValue);
        }
      });
    },
    async reset() {
      consented = false;
      setDisabled(true);
      finishPendingAnonymousIdRequests();
      try {
        if (initialized) {
          dispatchCommand(['consent', 'update', DENIED_CONSENT]);
        }
      } finally {
        clearIdentifiers();
      }
    },
  };
}

export function createGa4Analytics(
  options: Ga4AnalyticsOptions,
): AnalyticsService {
  const win = (options.window ?? window) as AnalyticsWindow;
  const doc = options.document ?? document;
  const existing = registryEntry(doc);

  if (existing) {
    if (existing.measurementId !== options.measurementId) {
      throw new Error(GA4_CONFIGURATION_ERROR);
    }
    return existing.service;
  }

  const service = createGa4AnalyticsService(options, win, doc);
  storeRegistryEntry(doc, {
    measurementId: options.measurementId,
    service,
  });
  return service;
}
