import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AnalyticsConsentStore,
  AnalyticsService,
} from '../../application/analytics/analyticsService';
import type { Clock } from '../../domain/ports/clock';
import type { WakeLockService } from '../../domain/ports/wakeLockService';
import type { CueService } from '../../domain/ports/cueService';
import type { NotificationService } from '../../domain/ports/notificationService';
import type { StateRepository } from '../../domain/ports/stateRepository';
import { productionServices } from '../../infrastructure/device/productionServices';

export interface Services {
  clock: Clock;
  wakeLock: WakeLockService;
  cues: CueService;
  notifications: NotificationService;
  repository: StateRepository;
  analytics: AnalyticsService;
  analyticsConsent: AnalyticsConsentStore;
}

function defaultServices(): Services {
  return productionServices();
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ children, value }: { children: ReactNode; value?: Partial<Services> }) {
  const [defaults] = useState(defaultServices);
  const services = useMemo<Services>(() => ({
    clock: value?.clock ?? defaults.clock,
    wakeLock: value?.wakeLock ?? defaults.wakeLock,
    cues: value?.cues ?? defaults.cues,
    notifications: value?.notifications ?? defaults.notifications,
    repository: value?.repository ?? defaults.repository,
    analytics: value?.analytics ?? defaults.analytics,
    analyticsConsent: value?.analyticsConsent ?? defaults.analyticsConsent,
  }), [
    defaults,
    value?.analytics,
    value?.analyticsConsent,
    value?.clock,
    value?.cues,
    value?.notifications,
    value?.repository,
    value?.wakeLock,
  ]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within ServicesProvider');
  return ctx;
}
