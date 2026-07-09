import { describe, it, expect, vi } from 'vitest';
import { createLocalNotifications } from './localNotifications';

describe('createLocalNotifications', () => {
  it('reports unsupported when Notification is absent', () => {
    const svc = createLocalNotifications({} as Window);
    expect(svc.isSupported()).toBe(false);
  });

  it('requests permission and returns granted', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    const win = { Notification: Object.assign(function () {}, { requestPermission, permission: 'default' }) } as unknown as Window;
    const svc = createLocalNotifications(win);
    expect(svc.isSupported()).toBe(true);
    expect(await svc.requestPermission()).toBe(true);
  });
});