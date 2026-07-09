import type { WakeLockService } from '../../domain/ports/wakeLockService';

export function withReacquire(inner: WakeLockService, doc: Document = document): WakeLockService {
  let held = false;
  const onVisible = () => { if (held && doc.visibilityState === 'visible') void inner.acquire(); };
  return {
    async acquire() { held = true; await inner.acquire(); doc.addEventListener('visibilitychange', onVisible); },
    async release() { held = false; doc.removeEventListener('visibilitychange', onVisible); await inner.release(); },
  };
}