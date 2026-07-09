import { createStore } from 'zustand/vanilla';
import type { AppState, Session, Settings } from '../../domain/models/types';
import type { StateRepository } from '../../domain/ports/stateRepository';
import { emptyAppState } from '../../domain/models/appState';
import { finishSession } from '../usecases/finishSession';
import { recordBaseline } from '../usecases/recordBaseline';
import { saveSettings } from '../usecases/saveSettings';

export interface AppStore {
  state: AppState;
  hydrated: boolean;
  hydrate(): Promise<void>;
  completeSession(session: Session): Promise<void>;
  recordBaseline(attempts: number[], firstContraction: number | null): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  replaceState(state: AppState): Promise<void>;
}

export function createAppStore(repo: StateRepository, now: () => number) {
  return createStore<AppStore>((set, get) => {
    async function commit(next: AppState) {
      set({ state: next });
      await repo.setState(next);
    }
    return {
      state: emptyAppState(),
      hydrated: false,
      async hydrate() {
        const loaded = await repo.getState();
        set({ state: loaded, hydrated: true });
      },
      async completeSession(session) {
        await commit(finishSession(get().state, session, now()));
      },
      async recordBaseline(attempts, firstContraction) {
        await commit(recordBaseline(get().state, attempts, firstContraction, now()));
      },
      async updateSettings(patch) {
        await commit(saveSettings(get().state, patch));
      },
      async replaceState(next) {
        await commit(next);
      },
    };
  });
}
