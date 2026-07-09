import { describe, it, expect, vi } from 'vitest';
import { createWakeLock } from './wakeLock';

describe('createWakeLock', () => {
  it('uses the Screen Wake Lock API when available', async () => {
    const release = vi.fn();
    const request = vi.fn(async () => ({ release, addEventListener() {} }));
    const nav = { wakeLock: { request } } as unknown as Navigator;
    const wl = createWakeLock(nav, () => ({ enable: vi.fn(), disable: vi.fn() }));
    await wl.acquire();
    expect(request).toHaveBeenCalledWith('screen');
    await wl.release();
    expect(release).toHaveBeenCalled();
  });

  it('falls back to NoSleep when the API is missing', async () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const nav = {} as Navigator;
    const wl = createWakeLock(nav, () => ({ enable, disable }));
    await wl.acquire();
    expect(enable).toHaveBeenCalled();
    await wl.release();
    expect(disable).toHaveBeenCalled();
  });

  it('falls back to NoSleep when the Wake Lock API request rejects (iOS)', async () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const request = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    const nav = { wakeLock: { request } } as unknown as Navigator;
    const wl = createWakeLock(nav, () => ({ enable, disable }));
    await wl.acquire();
    expect(request).toHaveBeenCalledWith('screen');
    expect(enable).toHaveBeenCalled();
    await wl.release();
    expect(disable).toHaveBeenCalled();
  });

  it('does not leak a previously-enabled NoSleep fallback on re-acquire', async () => {
    const instances: Array<{ enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> }> = [];
    const nav = {} as Navigator;
    const wl = createWakeLock(nav, () => {
      const instance = { enable: vi.fn(), disable: vi.fn() };
      instances.push(instance);
      return instance;
    });

    await wl.acquire();
    await wl.acquire();

    const priorInstances = instances.slice(0, -1);
    expect(instances.length === 1 || priorInstances.every((instance) => instance.disable.mock.calls.length > 0)).toBe(true);
  });
});
