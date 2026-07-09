import { useEffect, useRef, useState } from 'react';

export function useCountUp() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      return () => {
        if (ref.current) clearInterval(ref.current);
      };
    }
  }, [running]);

  return {
    seconds,
    running,
    start: () => setRunning(true),
    stop: () => setRunning(false),
    reset: () => setSeconds(0),
  };
}
