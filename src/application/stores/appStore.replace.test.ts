import { it, expect } from 'vitest';
import { createAppStore } from './appStore';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';

function memoryRepo(): StateRepository & { saved: unknown[] } {
  let current = emptyAppState();
  const saved: unknown[] = [];
  return { saved, async getState() { return current; }, async setState(s) { current = s; saved.push(s); } };
}

it('replaceState persists a whole imported state', async () => {
  const repo = memoryRepo();
  const store = createAppStore(repo, () => 0);
  await store.getState().hydrate();
  const imported = emptyAppState();
  imported.settings.reminderTimes = ['07:30'];
  await store.getState().replaceState(imported);
  expect(store.getState().state.settings.reminderTimes).toEqual(['07:30']);
  expect(repo.saved.length).toBe(1);
});