import type { WakeLockService } from '../../domain/ports/wakeLockService';
import type { CueService } from '../../domain/ports/cueService';
import type { NotificationService } from '../../domain/ports/notificationService';

export const noopWakeLock: WakeLockService = {
  async acquire() {},
  async release() {},
};

export const noopCues: CueService = {
  speak() {},
  beep() {},
  vibrate() {},
  prime() {},
};

export const noopNotifications: NotificationService = {
  isSupported: () => false,
  async requestPermission() { return false; },
  async scheduleDailyReminders() {},
  async cancelAll() {},
};
