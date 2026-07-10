import type { AppState } from '../../domain/models/types';
import { migrateAppState } from '../../domain/models/migrateAppState';

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid backup: not valid JSON');
  }

  try {
    return migrateAppState(parsed);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid backup: ${error.message}`);
    }
    throw new Error('Invalid backup: unknown error');
  }
}
