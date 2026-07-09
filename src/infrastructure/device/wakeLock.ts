import NoSleep from 'nosleep.js';
import type { WakeLockService } from '../../domain/ports/wakeLockService';

interface NoSleepLike { enable(): void; disable(): void; }
type SentinelLike = { release(): Promise<void> | void; addEventListener?: (t: string, cb: () => void) => void };

type WakeLockNavigator = Navigator & {
  wakeLock?: { request?: (type: 'screen') => Promise<SentinelLike> };
};

export function createWakeLock(
  nav: Navigator = navigator,
  makeNoSleep: () => NoSleepLike = () => new NoSleep(),
): WakeLockService {
  let sentinel: SentinelLike | null = null;
  let noSleep: NoSleepLike | null = null;
  const supported = typeof (nav as WakeLockNavigator).wakeLock?.request === 'function';

  async function acquire(): Promise<void> {
    if (supported) {
      sentinel = await (nav as WakeLockNavigator).wakeLock!.request!('screen');
      return;
    }
    noSleep ??= makeNoSleep();
    noSleep.enable();
  }

  return {
    async acquire() { await acquire(); },
    async release() {
      if (sentinel) { await sentinel.release(); sentinel = null; }
      if (noSleep) { noSleep.disable(); noSleep = null; }
    },
  };
}
