import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStore } from './appStore';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';
import { makeRound, makeSession } from '../../test/fixtures';

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
    await store.getState().completeSession(makeSession({
      id: 's',
      type: 'CO2',
      rounds: [makeRound()],
      startedAt: 0,
      finishedAt: 2000,
    }));
    expect(store.getState().state.courseState.position).toBe(1);
    expect(repo.saved.length).toBeGreaterThan(0);
  });

  it('does not advance in-memory state when persistence fails', async () => {
    const failingRepo = memoryRepo();
    failingRepo.setState = async () => {
      throw new Error('storage unavailable');
    };
    const store = createAppStore(failingRepo, () => 2_000);
    await store.getState().hydrate();

    await expect(
      store.getState().completeSession(makeSession({ rpe: 'normal' })),
    ).rejects.toThrow(/storage unavailable/i);
    expect(store.getState().state.sessions).toEqual([]);
    expect(store.getState().state.courseState.position).toBe(0);
  });

  it('serializes concurrent mutations without losing earlier changes', async () => {
    const delayedRepo = memoryRepo();
    const persist = delayedRepo.setState.bind(delayedRepo);
    let releaseFirstWrite: (() => void) | undefined;
    let signalFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      signalFirstWriteStarted = resolve;
    });
    let writeCount = 0;
    delayedRepo.setState = async (state) => {
      writeCount += 1;
      if (writeCount === 1) {
        signalFirstWriteStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
      await persist(state);
    };
    const store = createAppStore(delayedRepo, () => 2_000);
    await store.getState().hydrate();

    const first = store.getState().completeSession(makeSession({ id: 'first' }));
    await firstWriteStarted;
    const second = store.getState().completeSession(makeSession({ id: 'second' }));
    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(store.getState().state.sessions.map((session) => session.id))
      .toEqual(['first', 'second']);
  });

  it('rejects an already persisted session id without writing again', async () => {
    const store = createAppStore(repo, () => 2_000);
    await store.getState().hydrate();
    const session = makeSession({ id: 'same-session' });

    await store.getState().completeSession(session);
    const writesAfterFirstSave = repo.saved.length;

    await expect(store.getState().completeSession(session))
      .rejects.toThrow(/already saved/i);
    expect(store.getState().state.sessions).toHaveLength(1);
    expect(repo.saved).toHaveLength(writesAfterFirstSave);
  });

  it('persists setting and clearing a goal without resetting adaptation', async () => {
    const initial = emptyAppState();
    initial.baselines = [{
      id: 'baseline',
      maxHoldSec: 180,
      firstContractionSec: null,
      measuredAt: 1_000,
    }];
    initial.courseState.difficultyByType = { CO2: 3, O2: 2 };
    repo = memoryRepo(initial);
    const store = createAppStore(repo, () => 2_000);
    await store.getState().hydrate();

    await store.getState().setGoal(240);
    expect(store.getState().state.goal?.targetHoldSec).toBe(240);
    expect(store.getState().state.courseState.difficultyByType)
      .toEqual({ CO2: 3, O2: 2 });

    await store.getState().clearGoal();
    expect(store.getState().state.goal).toBeNull();
    expect(repo.saved).toHaveLength(2);
  });
});
