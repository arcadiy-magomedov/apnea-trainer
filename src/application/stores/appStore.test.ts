import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStore } from './appStore';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';

function memoryRepo(initial: AppState = emptyAppState()): StateRepository & { saved: AppState[] } {
  let current = initial;
  const saved: AppState[] = [];
  return {
    saved,
    async getState() { return current; },
    async setState(s) { current = s; saved.push(s); },
  };
}

describe('appStore', () => {
  let repo: ReturnType<typeof memoryRepo>;
  beforeEach(() => { repo = memoryRepo(); });

  it('hydrates from the repository', async () => {
    const initial = emptyAppState();
    initial.settings.reminderTimes = ['08:00'];
    repo = memoryRepo(initial);
    const store = createAppStore(repo, () => 1000);
    await store.getState().hydrate();
    expect(store.getState().state.settings.reminderTimes).toEqual(['08:00']);
  });

  it('updateSettings persists via the repository', async () => {
    const store = createAppStore(repo, () => 1000);
    await store.getState().hydrate();
    await store.getState().updateSettings({ voiceCues: false });
    expect(store.getState().state.settings.voiceCues).toBe(false);
    expect(repo.saved.at(-1)?.settings.voiceCues).toBe(false);
  });

  it('completeSession persists and advances the course', async () => {
    const store = createAppStore(repo, () => 2000);
    await store.getState().hydrate();
    await store.getState().completeSession({
      id: 's', type: 'CO2',
      rounds: [{ index: 0, targetHoldSec: 60, achievedHoldSec: 60, restBeforeSec: 0, contractions: 0, tappedOut: false }],
      startedAt: 0, finishedAt: 2000, completedRounds: 1, tapOuts: 0, rpe: 'normal', difficultyLevel: 0,
    });
    expect(store.getState().state.courseState.position).toBe(1);
    expect(repo.saved.length).toBeGreaterThan(0);
  });
});
