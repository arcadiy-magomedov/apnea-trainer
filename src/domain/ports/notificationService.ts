export interface NotificationService {
  isSupported(): boolean;
  requestPermission(): Promise<boolean>;
  scheduleDailyReminders(times: string[]): Promise<void>;
  cancelAll(): Promise<void>;
}
