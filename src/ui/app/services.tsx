import { createContext, useContext, type ReactNode } from 'react';
import type { Clock } from '../../domain/ports/clock';
import type { WakeLockService } from '../../domain/ports/wakeLockService';
import type { CueService } from '../../domain/ports/cueService';
import type { NotificationService } from '../../domain/ports/notificationService';
import type { IcsExporter } from '../../domain/ports/icsExporter';
import type { StateRepository } from '../../domain/ports/stateRepository';
import { systemClock } from '../../infrastructure/device/systemClock';
import { noopWakeLock, noopCues, noopNotifications } from '../../infrastructure/device/noopServices';
import { createIndexedDbRepository } from '../../infrastructure/persistence/indexedDbRepository';

export interface Services {
  clock: Clock;
  wakeLock: WakeLockService;
  cues: CueService;
  notifications: NotificationService;
  ics: IcsExporter;
  repository: StateRepository;
}

function defaultServices(): Services {
  return {
    clock: systemClock,
    wakeLock: noopWakeLock,
    cues: noopCues,
    notifications: noopNotifications,
    ics: { build: () => '' },
    repository: createIndexedDbRepository(),
  };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ children, value }: { children: ReactNode; value?: Partial<Services> }) {
  const services = { ...defaultServices(), ...value };
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within ServicesProvider');
  return ctx;
}
