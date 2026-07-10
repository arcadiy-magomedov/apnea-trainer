import { createStore } from 'zustand/vanilla';
import type { AppState, Session, Settings } from '../../domain/models/types';
import type { StateRepository } from '../../domain/ports/stateRepository';
import { emptyAppState } from '../../domain/models/appState';
import {
  finishRatedSession,
  type SessionCompletion,
} from '../usecases/finishSession';
import { recordBaseline } from '../usecases/recordBaseline';
import { saveSettings } from '../usecases/saveSettings';
import {
  clearGoal as clearGoalUseCase,
  setGoal as setGoalUseCase,
} from '../usecases/manageGoal';

export interface AppStore {
  state: AppState;
  hydrated: boolean;
  hydrate(): Promise<void>;
  completeSession(session: Session): Promise<SessionCompletion>;
  recordBaseline(attempts: number[], firstContraction: number | null): Promise<void>;
  setGoal(targetHoldSec: number): Promise<void>;
  clearGoal(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  replaceState(state: AppState): Promise<void>;
}

export function createAppStore(repo: StateRepository, now: () => number) {
  return createStore<AppStore>((set, get) => {
    let pendingMutation: Promise<void> = Promise.resolve();

    function enqueueMutation<T>(
      build: (state: AppState) => { next: AppState; result: T },
    ): Promise<T> {
      const operation = pendingMutation.then(async () => {
        const { next, result } = build(get().state);
        await repo.setState(next);
        set({ state: next });
        return result;
      });

      pendingMutation = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    }

    return {
      state: emptyAppState(),
      hydrated: false,
      async hydrate() {
        const loaded = await repo.getState();
        set({ state: loaded, hydrated: true });
      },
      completeSession(session) {
        const completedAt = now();
        return enqueueMutation((state) => {
          const result = finishRatedSession(
            state,
            session,
            completedAt,
          );
          return { next: result.state, result };
        });
      },
      recordBaseline(attempts, firstContraction) {
        const measuredAt = now();
        return enqueueMutation((state) => ({
          next: recordBaseline(state, attempts, firstContraction, measuredAt),
          result: undefined,
        }));
      },
      setGoal(targetHoldSec) {
        const createdAt = now();
        return enqueueMutation((state) => ({
          next: setGoalUseCase(state, targetHoldSec, createdAt),
          result: undefined,
        }));
      },
      clearGoal() {
        return enqueueMutation((state) => ({
          next: clearGoalUseCase(state),
          result: undefined,
        }));
      },
      updateSettings(patch) {
        return enqueueMutation((state) => ({
          next: saveSettings(state, patch),
          result: undefined,
        }));
      },
      replaceState(next) {
        return enqueueMutation(() => ({
          next,
          result: undefined,
        }));
      },
    };
  });
}
