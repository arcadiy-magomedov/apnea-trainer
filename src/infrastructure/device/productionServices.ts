import type { Services } from '../../ui/app/services';
import { systemClock } from './systemClock';
import { createWakeLock } from './wakeLock';
import { withReacquire } from './wakeLockWithReacquire';
import { createCues } from './cues';
import { createLocalNotifications } from '../notifications/localNotifications';
import { createIndexedDbRepository } from '../persistence/indexedDbRepository';

export function productionServices(): Services {
  return {
    clock: systemClock,
    wakeLock: withReacquire(createWakeLock()),
    cues: createCues(),
    notifications: createLocalNotifications(),
    repository: createIndexedDbRepository(),
  };
}
