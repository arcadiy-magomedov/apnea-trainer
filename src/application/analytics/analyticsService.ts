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
