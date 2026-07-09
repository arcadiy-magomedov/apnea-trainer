import type { AppState } from '../../domain/models/types';

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
  const s = parsed as Partial<AppState>;
  if (s.version !== 1) {
    throw new Error(`Unsupported backup version: ${String(s.version)}`);
  }
  if (!s.settings || !Array.isArray(s.baselines) || !s.courseState || !Array.isArray(s.sessions)) {
    throw new Error('Invalid backup: missing required fields');
  }
  return s as AppState;
}
