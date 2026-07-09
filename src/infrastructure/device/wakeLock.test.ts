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
});