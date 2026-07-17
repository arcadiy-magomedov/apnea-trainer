import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { ProgressRing } from '../design-system/ProgressRing';
import { formatMMSS } from '../design-system/format';
import { useCountUp } from '../hooks/useCountUp';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';

export function BaselineScreen() {
  const navigate = useNavigate();
  const { analytics } = useServices();
  const record = useAppStore((s) => s.recordBaseline);
  const hydrated = useAppStore((state) => state.hydrated);
  const hadBaseline = useAppStore((state) => state.state.baselines.length > 0);
  const { seconds, running, start, stop, reset } = useCountUp();
  const [attempts, setAttempts] = useState<number[]>([]);
  const [firstContraction, setFirstContraction] = useState<number | null>(null);
  const baselineStarted = useRef(false);
  const baselineSaving = useRef(false);
  const baselineCompleted = useRef(false);
  const baselineMounted = useRef(true);

  useEffect(() => {
    baselineMounted.current = true;
    return () => {
      baselineMounted.current = false;
      if (baselineStarted.current && !baselineCompleted.current) {
        analytics.track({ name: 'baseline_abandoned' });
      }
    };
  }, [analytics]);

  if (!hydrated) return null;

  function onStop() {
    stop();
    setAttempts((a) => [...a, seconds]);
    reset();
  }

  function startBaseline() {
    if (!baselineStarted.current) {
      baselineStarted.current = true;
      analytics.track({ name: 'baseline_started' });
    }
    start();
  }

  async function finish() {
    if (baselineSaving.current || baselineCompleted.current) return;
    baselineSaving.current = true;
    try {
      await record(attempts, firstContraction);
    } catch {
      baselineSaving.current = false;
      return;
    }
    if (!baselineMounted.current) return;
    baselineCompleted.current = true;
    analytics.track({ name: 'baseline_completed' });
    navigate(hadBaseline ? '/' : '/goal');
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-5 px-6 py-6">
      <h2 className="text-2xl font-bold">Baseline · Max hold</h2>
      <p className="text-sm text-[color:var(--text-dim)]">
        Relax, take a few calm breaths (no hyperventilation), then hold as long as is comfortable.
        Do two attempts with full recovery between.
      </p>
      <ProgressRing progress={0} label={formatMMSS(seconds)} sublabel={running ? 'holding' : 'ready'} color="var(--teal)" />
      {running && firstContraction === null && (
        <Button variant="ghost" onClick={() => setFirstContraction(seconds)}>Mark first contraction</Button>
      )}
      {!running
        ? <Button onClick={startBaseline}>Start hold</Button>
        : <Button variant="danger" onClick={onStop}>Stop</Button>}
      <Card>
        {attempts.length === 0
          ? <p className="text-sm text-[color:var(--text-mute)]">No attempts yet.</p>
          : attempts.map((a, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>Attempt {i + 1}</span><span className="tabular-nums">{formatMMSS(a)}</span>
              </div>
            ))}
      </Card>
      <Button disabled={attempts.length < 1} onClick={finish}>Save baseline</Button>
    </div>
  );
}
