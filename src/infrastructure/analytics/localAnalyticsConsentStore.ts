import type {
  AnalyticsConsentDecision,
  AnalyticsConsentStore,
} from '../../application/analytics/analyticsService';

export const ANALYTICS_CONSENT_STORAGE_KEY = 'apnea-trainer.analytics-consent.v1';

type StoredConsent = AnalyticsConsentDecision;

function isStoredConsent(value: unknown): value is StoredConsent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (record.status === 'granted' || record.status === 'denied')
    && typeof record.decidedAt === 'number'
    && Number.isFinite(record.decidedAt);
}

export function createLocalAnalyticsConsentStore(
  storage: Storage,
  now: () => number,
): AnalyticsConsentStore {
  return {
    read() {
      const raw = storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
      if (raw === null) {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        if (error instanceof SyntaxError) {
          storage.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
          return null;
        }

        throw error;
      }

      if (!isStoredConsent(parsed)) {
        storage.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
        return null;
      }

      return {
        status: parsed.status,
        decidedAt: parsed.decidedAt,
      };
    },
    write(status) {
      const decision: AnalyticsConsentDecision = {
        status,
        decidedAt: now(),
      };

      storage.setItem(
        ANALYTICS_CONSENT_STORAGE_KEY,
        JSON.stringify(decision),
      );
      return decision;
    },
  };
}
