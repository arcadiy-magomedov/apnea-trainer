import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { SessionPlan } from '../../domain/models/types';
import { ProgressRing } from '../design-system/ProgressRing';
import { PhaseBadge, PHASE_COLOR } from '../design-system/PhaseBadge';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { useServices } from '../app/services';
import { useAppStore, useRunnerStore } from '../app/stores';
import { useCues } from '../hooks/useCues';

interface RunnerNavState { plan: SessionPlan; difficultyLevel: number; }

const EMPTY_PLAN: SessionPlan = { type: 'CO2', rounds: [] };

export function RunnerScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = location.state as RunnerNavState | null;
  const { clock, wakeLock } = useServices();
  const cue = useCues();
  const start = useRunnerStore((s) => s.start);
  const storePlan = useRunnerStore((s) => s.plan);
  const recordRound = useRunnerStore((s) => s.recordRound);
  const finish = useRunnerStore((s) => s.finish);
  const complete = useAppStore((s) => s.completeSession);
  const [contractions, setContractions] = useState(0);
  const [started, setStarted] = useState(false);
  const [pendingRecoverAdvance, setPendingRecoverAdvance] = useState(false);
  const holdStartedAt = useRef<number | null>(null);
  const hasFinished = useRef(false);

  const navPlan = nav?.plan;
  const hasUsablePlan = !!navPlan && navPlan.rounds.length > 0;
  const plan = storePlan ?? navPlan ?? EMPTY_PLAN;
  const timer = useSessionTimer(plan, {
    onPhaseChange: (p) => cue.phaseCue(p),
  });

  // Release the wake lock when leaving the runner.
  useEffect(() => {
    return () => { void wakeLock.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginSession() {
    if (started || !navPlan) return;
    // Acquire the wake lock inside this user gesture: iOS requires a user
    // activation for navigator.wakeLock.request and for the NoSleep fallback.
    await wakeLock.acquire();
    start(navPlan, nav?.difficultyLevel ?? 0);
    timer.begin();
    setStarted(true);
  }

  useEffect(() => {
    if (!pendingRecoverAdvance) return;
    setPendingRecoverAdvance(false);
    timer.endHold();
  }, [pendingRecoverAdvance, timer]);

  useEffect(() => {
    if (timer.phase === 'hold') {
      holdStartedAt.current = clock.now();
      return;
    }
    holdStartedAt.current = null;
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
    setPendingRecoverAdvance(true);
  }
  function endHold() {
    recordRound(achievedHoldSec(), contractions, false);
    setContractions(0);
    timer.endHold();
  }

  if (!hasUsablePlan) {
    return <Navigate to="/train" replace />;
  }

  if (!started) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 px-6 py-6">
        <h2 className="text-2xl font-bold">{plan.type} session</h2>
        <p className="text-sm text-[color:var(--text-dim)]">
          {plan.rounds.length} rounds. The screen stays awake during the session.
          Dry land only — never in or near water alone.
        </p>
        <Button onClick={beginSession}>Start session</Button>
      </div>
    );
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
