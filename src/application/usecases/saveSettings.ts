import type { AppState, Settings } from '../../domain/models/types';

export function saveSettings(state: AppState, patch: Partial<Settings>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } };
}
