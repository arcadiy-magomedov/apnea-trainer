export interface WakeLockService {
  acquire(): Promise<void>;
  release(): Promise<void>;
}
