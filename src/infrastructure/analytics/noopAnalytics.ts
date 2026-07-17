import type { AnalyticsService } from '../../application/analytics/analyticsService';

export const noopAnalytics: AnalyticsService = {
  available: false,
  async setConsent() {},
  track() {},
  async getAnonymousId() {
    return null;
  },
  async reset() {},
};
