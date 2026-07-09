import type { AppState } from '../models/types';
export interface StateRepository {
  getState(): Promise<AppState>;
  setState(state: AppState): Promise<void>;
}
