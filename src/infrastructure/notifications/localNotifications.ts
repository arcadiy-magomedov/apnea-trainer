import type { NotificationService } from '../../domain/ports/notificationService';

export function createLocalNotifications(win: Window = window): NotificationService {
  const Ctor = (win as Window & { Notification?: typeof Notification }).Notification;
  return {
    isSupported: () => typeof Ctor === 'function',
    async requestPermission() {
      if (typeof Ctor !== 'function') return false;
      const result = await Ctor.requestPermission();
      return result === 'granted';
    },
    async scheduleDailyReminders(times: string[]) {
      if (typeof Ctor !== 'function' || Ctor.permission !== 'granted') return;
      new Ctor('Apnea Trainer', { body: `Reminders set for ${times.join(', ') || 'no times'}` });
    },
    async cancelAll() {},
  };
}