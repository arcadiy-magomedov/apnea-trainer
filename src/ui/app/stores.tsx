import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createAppStore, type AppStore } from '../../application/stores/appStore';
import { createSessionRunnerStore, type SessionRunnerStore } from '../../application/stores/sessionRunnerStore';
import { useServices } from './services';

type AppStoreApi = ReturnType<typeof createAppStore>;
type RunnerStoreApi = ReturnType<typeof createSessionRunnerStore>;

const AppStoreContext = createContext<AppStoreApi | null>(null);
const RunnerStoreContext = createContext<RunnerStoreApi | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const { repository, clock } = useServices();
  const [ready, setReady] = useState(false);
  const appRef = useRef<AppStoreApi | null>(null);
  const runnerRef = useRef<RunnerStoreApi | null>(null);
  if (!appRef.current) appRef.current = createAppStore(repository, () => clock.now());
  if (!runnerRef.current) runnerRef.current = createSessionRunnerStore(() => clock.now());

  useEffect(() => {
    appRef.current!.getState().hydrate().then(() => setReady(true));
  }, []);

  // Render children immediately; screens read `hydrated` to gate content.
  void ready;
  return (
    <AppStoreContext.Provider value={appRef.current}>
      <RunnerStoreContext.Provider value={runnerRef.current}>
        {children}
      </RunnerStoreContext.Provider>
    </AppStoreContext.Provider>
  );
}

export function useAppStore<T>(selector: (s: AppStore) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('useAppStore requires AppProviders');
  return useStore(store, selector);
}

export function useRunnerStore<T>(selector: (s: SessionRunnerStore) => T): T {
  const store = useContext(RunnerStoreContext);
  if (!store) throw new Error('useRunnerStore requires AppProviders');
  return useStore(store, selector);
}
