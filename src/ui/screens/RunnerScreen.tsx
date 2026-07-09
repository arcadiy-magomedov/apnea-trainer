import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { SessionPlan } from '../../domain/models/types';
import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';
import { ProgressRing } from '../design-system/ProgressRing';
import { PHASE_COLOR } from '../design-system/PhaseBadge';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';
import { useServices } from '../app/services';
import { useAppStore, useRunnerStore } from '../app/stores';
import { useCues } from '../hooks/useCues';

interface RunnerNavState { plan: SessionPlan; difficultyLevel: number; }

const EMPTY_PLAN: SessionPlan = { type: 'CO2', rounds: [] };

const PHASE_LABEL: Record<RunnerPhase, string> = {
  breatheUp: 'Breathe up',
  hold: 'Hold',
  recover: 'Recover',
  done: 'Done',
};

const PHASE_HINT: Record<RunnerPhase, string> = {
  breatheUp: 'Relax. Slow, calm breaths — no hyperventilation. The hold starts on the beeps.',
  hold: 'Hold your breath. Tap when you feel a contraction.',
  recover: 'Breathe and recover. The next hold starts on the beeps.',
  done: '',
};

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

  const [started, setStarted] = useState(false);
  const [contractions, setContractions] = useState(0);
  const [holdElapsed, setHoldElapsed] = useState(0);
  const [pendingRecoverAdvance, setPendingRecoverAdvance] = useState(false);
  const holdStartedAt = useRef<number | null>(null);
  const hasFinished = useRef(false);
  const lastTick = useRef<number | null>(null);

  const navPlan = nav?.plan;
  const hasUsablePlan = !!navPlan && navPlan.rounds.length > 0;
  const plan = storePlan ?? navPlan ?? EMPTY_PLAN;

  const timer = useSessionTimer(plan, {
    onPhaseChange: (p) => {
      lastTick.current = null;
      cue.announce(p);
    },
    onTick: (phase, remaining) => {
      if (phase === 'hold') { setHoldElapsed((e) => e + 1); return; }
      if (phase === 'done') return;
      // Countdown cues toward the next hold (breathe-up / recover only).
      if (lastTick.current === remaining) return;
      lastTick.current = remaining;
      if (remaining === 10) cue.warn();
      else if (remaining >= 1 && remaining <= 3) cue.tick();  // 3-2-1, one beep per second
      else if (remaining === 0) cue.go();                     // hold starts
    },
  });

  // Release the wake lock when leaving the runner.
  useEffect(() => {
    return () => { void wakeLock.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginSession() {
    if (started || !navPlan) return;
    // Inside the user gesture: unlock audio + acquire the wake lock (both required by iOS).
    cue.prime();
    await wakeLock.acquire();
    start(navPlan, nav?.difficultyLevel ?? 0);
    timer.begin();
    setStarted(true);
  }

  // Deferred advance after a tap-out, so the store update lands before the phase change.
  useEffect(() => {
    if (!pendingRecoverAdvance) return;
    setPendingRecoverAdvance(false);
    timer.endHold();
  }, [pendingRecoverAdvance, timer]);

  // Track the real hold start (for accurate achieved-hold recording) and reset
  // the elapsed counter whenever a hold begins.
  useEffect(() => {
    if (timer.phase === 'hold') {
      holdStartedAt.current = clock.now();
      setHoldElapsed(0);
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

  function startHoldNow() {
    cue.go();
    timer.startHold();
  }
  function endHold() {
    recordRound(achievedHoldSec(), contractions, false);
    setContractions(0);
    timer.endHold();
  }
  function tapOut() {
    recordRound(achievedHoldSec(), contractions, true);
    setContractions(0);
    setPendingRecoverAdvance(true);
  }

  if (!hasUsablePlan) {
    return <Navigate to="/" replace />;
  }

  if (!started) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 px-6 py-6">
        <h2 className="text-2xl font-bold">{plan.type} session</h2>
        <p className="text-sm text-[color:var(--text-dim)]">
          {plan.rounds.length} rounds: breathe up, hold, recover — repeat.
          The screen stays awake and you'll hear a 3-2-1 countdown before each hold.
          Dry land only — never in or near water alone.
        </p>
        <Button onClick={beginSession}>Start session</Button>
      </div>
    );
  }

  if (timer.phase === 'done') {
    return <p className="p-6">Saving…</p>;
  }

  const color = PHASE_COLOR[timer.phase];
  const isHold = timer.phase === 'hold';
  const target = plan.rounds[timer.roundIndex]?.targetHoldSec ?? 0;

  let progress = 0;
  if (isHold) {
    progress = target > 0 ? Math.min(1, holdElapsed / target) : 0;
  } else {
    const total = timer.phase === 'breatheUp'
      ? APNEA_DEFAULTS.breatheUpSec
      : (plan.rounds[timer.roundIndex]?.restBeforeSec || 1);
    progress = total > 0 ? Math.min(1, (total - timer.remaining) / total) : 0;
  }

  const ringLabel = isHold ? formatMMSS(holdElapsed) : formatMMSS(timer.remaining);
  const ringSub = isHold
    ? `target ${formatMMSS(target)}`
    : (timer.phase === 'recover' ? 'until next hold' : 'until hold');

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <div className="flex justify-between text-xs text-[color:var(--text-dim)]">
        <span>{plan.type} Table</span>
        <span>Round {timer.roundIndex + 1} / {plan.rounds.length}</span>
      </div>

      <div
        className="rounded-2xl py-3 text-center text-lg font-bold uppercase tracking-[0.2em]"
        style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
      >
        {PHASE_LABEL[timer.phase]}
      </div>

      <ProgressRing progress={progress} label={ringLabel} sublabel={ringSub} color={color} />

      <p className="min-h-[2.5rem] text-center text-sm text-[color:var(--text-dim)]">
        {PHASE_HINT[timer.phase]}
      </p>

      {timer.phase === 'breatheUp' && (
        <Button onClick={startHoldNow}>I'm ready — start hold</Button>
      )}

      {timer.phase === 'recover' && (
        <Button onClick={startHoldNow}>Start next hold</Button>
      )}

      {isHold && (
        <>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setContractions((c) => c + 1)}>
              Contraction · {contractions}
            </Button>
            <Button className="flex-1" onClick={endHold}>End hold</Button>
          </div>
          <Button variant="danger" onClick={tapOut}>I tapped out</Button>
        </>
      )}
    </div>
  );
}
