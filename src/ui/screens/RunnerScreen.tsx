import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SessionPlan } from '../../domain/models/types';
import { ProgressRing } from '../design-system/ProgressRing';
import { PhaseBadge, PHASE_COLOR } from '../design-system/PhaseBadge';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { useServices } from '../app/services';
import { useAppStore, useRunnerStore } from '../app/stores';

interface RunnerNavState { plan: SessionPlan; difficultyLevel: number; }

export function RunnerScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = location.state as RunnerNavState | null;
  const { clock, wakeLock, cues } = useServices();
  const start = useRunnerStore((s) => s.start);
  const recordRound = useRunnerStore((s) => s.recordRound);
  const finish = useRunnerStore((s) => s.finish);
  const complete = useAppStore((s) => s.completeSession);
  const [contractions, setContractions] = useState(0);
  const holdStartedAt = useRef<number | null>(null);
  const hasFinished = useRef(false);

  const plan = nav?.plan ?? { type: 'CO2', rounds: [] };
  const timer = useSessionTimer(plan, {
    onPhaseChange: (p) => { cues.speak(p); cues.beep(); },
  });

  useEffect(() => {
    wakeLock.acquire();
    start(plan, nav?.difficultyLevel ?? 0);
    timer.begin();
    return () => { wakeLock.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timer.phase === 'hold') holdStartedAt.current = clock.now();
  }, [clock, timer.phase, timer.roundIndex]);

  useEffect(() => {
    if (timer.phase !== 'done' || hasFinished.current) return;
    hasFinished.current = true;
    void (async () => {
      const session = finish('normal');
      await complete(session);
      navigate('/summary', { state: { session } });
    })();
  }, [complete, finish, navigate, timer.phase]);

  function achievedHoldSec() {
    if (holdStartedAt.current === null) return 0;
    return Math.max(0, Math.round((clock.now() - holdStartedAt.current) / 1000));
  }

  function tapOut() {
    recordRound(achievedHoldSec(), contractions, true);
    setContractions(0);
    timer.endHold();
  }
  function endHold() {
    recordRound(achievedHoldSec(), contractions, false);
    setContractions(0);
    timer.endHold();
  }

  if (timer.phase === 'done') {
    return <p className="p-6">Saving…</p>;
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <div className="flex justify-between text-xs text-[color:var(--text-dim)]">
        <span>{plan.type} Table</span>
        <span>Round {timer.roundIndex + 1} / {plan.rounds.length}</span>
      </div>
      <PhaseBadge phase={timer.phase} />
      <ProgressRing
        progress={0.5}
        label={formatMMSS(timer.remaining)}
        sublabel={timer.phase === 'hold' ? `target ${formatMMSS(plan.rounds[timer.roundIndex]?.targetHoldSec ?? 0)}` : undefined}
        color={PHASE_COLOR[timer.phase]}
      />
      {timer.phase === 'hold' && (
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => setContractions((c) => c + 1)}>
            Contraction · {contractions}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={endHold}>End hold</Button>
        </div>
      )}
      <Button variant="danger" onClick={tapOut}>I tapped out</Button>
    </div>
  );
}
