import type {
  AnalyticsConsentStore,
} from '../../application/analytics/analyticsService';
import {
  normalizePrivacyContactEmail,
} from '../../application/privacy/privacyContact';
import type { Services } from '../../ui/app/services';
import { createGa4Analytics } from '../analytics/ga4Analytics';
import { noopAnalytics } from '../analytics/noopAnalytics';
import { createLocalAnalyticsConsentStore } from '../analytics/localAnalyticsConsentStore';
import { systemClock } from './systemClock';
import { createWakeLock } from './wakeLock';
import { withReacquire } from './wakeLockWithReacquire';
import { createCues } from './cues';
import { createLocalNotifications } from '../notifications/localNotifications';
import { createIndexedDbRepository } from '../persistence/indexedDbRepository';

let warnedAboutInvalidAnalyticsConfig = false;

function unavailableAnalyticsConsentStore(error: unknown): AnalyticsConsentStore {
  return {
    read() {
      return null;
    },
    write() {
      throw error;
    },
  };
}

function createAnalyticsConsentStore(): AnalyticsConsentStore {
  try {
    return createLocalAnalyticsConsentStore(
      window.localStorage,
      () => Date.now(),
    );
  } catch (error) {
    return unavailableAnalyticsConsentStore(error);
  }
}

export function productionServices(): Services {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() ?? '';
  const privacyContact = normalizePrivacyContactEmail(
    import.meta.env.VITE_PRIVACY_CONTACT_EMAIL,
  );
  const analyticsConfigured =
    /^G-[A-Z0-9]+$/.test(measurementId)
    && privacyContact !== null;

  if (!analyticsConfigured && import.meta.env.DEV && !warnedAboutInvalidAnalyticsConfig) {
    warnedAboutInvalidAnalyticsConfig = true;
    console.info(
      '[analytics] Valid GA4 and privacy-contact configuration is missing; using no-op analytics.',
    );
  }

  const analytics = analyticsConfigured
    ? createGa4Analytics({
        measurementId,
        strict: import.meta.env.DEV,
      })
    : noopAnalytics;

  return {
    clock: systemClock,
    wakeLock: withReacquire(createWakeLock()),
    cues: createCues(),
    notifications: createLocalNotifications(),
    repository: createIndexedDbRepository(),
    analytics,
    analyticsConsent: createAnalyticsConsentStore(),
  };
}
