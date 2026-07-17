import { useEffect, useState } from 'react';
import { createBreathSonarEngine } from '../../infrastructure/device/breathSonarEngine';
import type {
  BreathSonarEngine,
  BreathSonarSnapshot,
} from '../../infrastructure/device/breathSonarTypes';

export function useBreathSonar(
  createEngine: () => BreathSonarEngine = createBreathSonarEngine,
) {
  const [engine] = useState(() => createEngine());
  const [snapshot, setSnapshot] = useState(() => engine.getSnapshot());

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        void engine.stop();
      }
    };

    const unsubscribe = engine.subscribe(setSnapshot);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
      void engine.stop();
    };
  }, [engine]);

  return {
    snapshot,
    start: () => engine.start(),
    stop: () => engine.stop(),
    recalibrate: () => engine.recalibrate(),
  } satisfies {
    snapshot: BreathSonarSnapshot;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    recalibrate: () => Promise<void>;
  };
}
