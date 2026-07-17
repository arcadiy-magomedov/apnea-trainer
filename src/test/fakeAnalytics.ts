import type {
  AnalyticsConsent,
  AnalyticsConsentDecision,
  AnalyticsConsentStore,
  AnalyticsService,
} from '../application/analytics/analyticsService';
import type { AnalyticsEvent } from '../application/analytics/events';

export class FakeAnalyticsService implements AnalyticsService {
  readonly available = true;

  readonly events: AnalyticsEvent[] = [];
  readonly consentChanges: AnalyticsConsent[] = [];
  resetCalls = 0;
  anonymousId: string | null = 'analytics-test-id';

  async setConsent(consent: AnalyticsConsent): Promise<void> {
    this.consentChanges.push(consent);
  }

  track(event: AnalyticsEvent): void {
    this.events.push({ ...event });
  }

  async getAnonymousId(): Promise<string | null> {
    return this.anonymousId;
  }

  async reset(): Promise<void> {
    this.resetCalls += 1;
    this.consentChanges.push('denied');
  }
}

export class MemoryAnalyticsConsentStore implements AnalyticsConsentStore {
  private decision: AnalyticsConsentDecision | null;
  private readonly now: () => number;

  constructor(
    decision: AnalyticsConsentDecision | null = null,
    now: () => number = () => 1,
  ) {
    this.decision = decision ? { ...decision } : null;
    this.now = now;
  }

  read(): AnalyticsConsentDecision | null {
    return this.decision ? { ...this.decision } : null;
  }

  write(status: AnalyticsConsentDecision['status']): AnalyticsConsentDecision {
    this.decision = {
      status,
      decidedAt: this.now(),
    };
    return { ...this.decision };
  }
}
