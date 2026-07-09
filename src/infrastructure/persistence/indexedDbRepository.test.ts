import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { createIndexedDbRepository } from './indexedDbRepository';
import { emptyAppState } from '../../domain/models/appState';

describe('IndexedDbRepository', () => {
  beforeEach(async () => {
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase('apnea-trainer');
      req.onsuccess = () => res();
      req.onerror = () => res();
    });
  });

  it('returns a fresh empty state when nothing is stored', async () => {
    const repo = createIndexedDbRepository();
    const state = await repo.getState();
    expect(state.version).toBe(1);
    expect(state.sessions).toEqual([]);
  });

  it('round-trips a saved state', async () => {
    const repo = createIndexedDbRepository();
    const s = emptyAppState();
    s.settings.reminderTimes = ['19:00'];
    await repo.setState(s);
    const loaded = await repo.getState();
    expect(loaded.settings.reminderTimes).toEqual(['19:00']);
  });
});
