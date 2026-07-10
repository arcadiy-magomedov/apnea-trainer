import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { SessionPlan } from '../../domain/models/types';
import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';
import { ProgressRing } from '../design-system/ProgressRing';
import { PHASE_COLOR } from '../design-system/PhaseBadge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { formatMMSS } from '../design-system/format';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';
import { useServices } from '../app/services';
import { useRunnerStore } from '../app/stores';
import { useCues } from '../hooks/useCues';

interface RunnerNavState {
  plan: SessionPlan;
  difficultyLevel: number;
  earlyContractionThresholds: number[];
}

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
  const adjustment = useRunnerStore((s) => s.adjustment);
  const finishDraft = useRunnerStore((s) => s.finishDraft);

  const [started, setStarted] = useState(false);
  const [contractions, setContractions] = useState(0);
  const [firstContractionSec, setFirstContractionSec] = useState<number | null>(null);
  const [holdElapsed, setHoldElapsed] = useState(0);
  const [pendingRecoverAdvance, setPendingRecoverAdvance] = useState(false);
  const holdStartedAt = useRef<number | null>(null);
  const hasFinished = useRef(false);
  const roundEnding = useRef(false);
  const lastTick = useRef<number | null>(null);
  const holdAutoEnded = useRef(false);

  const navPlan = nav?.plan;
  const hasUsablePlan = !!navPlan && navPlan.rounds.length > 0;
  const plan = storePlan ?? navPlan ?? EMPTY_PLAN;
  const isMax = plan.type === 'MAX';

  const timer = useSessionTimer(plan, {
    onPhaseChange: (p) => {
      lastTick.current = null;
      cue.announce(p);
    },
    onTick: (phase, remaining) => {
      if (phase === 'hold') {
        setHoldElapsed((e) => e + 1);
        if (isMax) return; // MAX hold is open-ended: no countdown cues
      }
      if (phase === 'done') return;
      // Countdown cues toward the end of the phase (prep countdowns and prescribed holds).
      if (lastTick.current === remaining) return;
      lastTick.current = remaining;
      if (remaining === 10) cue.warn();
      else if (remaining >= 1 && remaining <= 3) cue.tick();  // 3-2-1, one beep per second
      else if (remaining === 0) cue.go();                     // hold starts / hold ends
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
    start(
      navPlan,
      nav?.difficultyLevel ?? 0,
      nav?.earlyContractionThresholds ?? navPlan.rounds.map(() => 0.5),
    );
    timer.begin();
    setStarted(true);
  }

  // Advance only after the store update lands so recovery uses an adjusted plan.
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
      setFirstContractionSec(null);
      roundEnding.current = false;
      holdAutoEnded.current = false;
      return;
    }
    holdStartedAt.current = null;
  }, [clock, timer.phase, timer.roundIndex]);

  // A prescribed (CO2/O2) hold auto-ends and advances to recovery when its
  // target time elapses. MAX holds are open-ended and end only on user action.
  useEffect(() => {
    if (!started || isMax) return;
    if (timer.phase === 'hold' && timer.remaining <= 0 && !holdAutoEnded.current) {
      holdAutoEnded.current = true;
      endHold();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, isMax, timer.phase, timer.remaining]);

  useEffect(() => {
    if (timer.phase !== 'done' || hasFinished.current) return;
    hasFinished.current = true;
    const session = finishDraft();
    navigate('/summary', { replace: true, state: { session } });
  }, [finishDraft, navigate, timer.phase]);

  function achievedHoldSec() {
    if (holdStartedAt.current === null) return 0;
    return Math.max(0, Math.round((clock.now() - holdStartedAt.current) / 1000));
  }

  function startHoldNow() {
    cue.go();
    timer.startHold();
  }
  function endHold() {
    if (roundEnding.current) return;
    roundEnding.current = true;
    recordRound(
      achievedHoldSec(),
      contractions,
      firstContractionSec,
      false,
    );
    setContractions(0);
    setPendingRecoverAdvance(true);
  }
  function tapOut() {
    if (roundEnding.current) return;
    roundEnding.current = true;
    recordRound(
      achievedHoldSec(),
      contractions,
      firstContractionSec,
      true,
    );
    setContractions(0);
    setPendingRecoverAdvance(true);
  }
  function markContraction() {
    const elapsed = achievedHoldSec();
    setContractions((count) => count + 1);
    setFirstContractionSec((current) => current ?? elapsed);
  }

  function cancel() {
    // Abort the session and leave; the wake lock is released on unmount and the
    // in-progress (unsaved) session is discarded.
    navigate('/');
  }

  if (!hasUsablePlan) {
    return <Navigate to="/" replace />;
  }

  if (!started) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col px-6 py-4">
        <div className="flex justify-end">
          <button
            onClick={cancel}
            aria-label="Cancel session"
            className="rounded-lg px-2 py-1 text-sm text-[color:var(--text-dim)]"
          >
            Cancel ✕
          </button>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-6">
          <h2 className="text-2xl font-bold">{plan.type} session</h2>
          <p className="text-sm text-[color:var(--text-dim)]">
            {plan.rounds.length} rounds: breathe up, hold, recover — repeat.
            The screen stays awake and you'll hear a 3-2-1 countdown before each hold.
            Dry land only — never in or near water alone.
          </p>
        </div>
        <Button className="w-full" onClick={beginSession}>Start session</Button>
      </div>
    );
  }

  if (timer.phase === 'done') {
    return <p className="p-6">Preparing summary…</p>;
  }

  const color = PHASE_COLOR[timer.phase];
  const isHold = timer.phase === 'hold';
  const target = plan.rounds[timer.roundIndex]?.targetHoldSec ?? 0;

  let progress = 0;
  let ringLabel: string;
  let ringSub: string;
  if (isHold && isMax) {
    // MAX: open-ended, count up.
    ringLabel = formatMMSS(holdElapsed);
    ringSub = 'hold as long as you can';
    progress = target > 0 ? Math.min(1, holdElapsed / target) : 0;
  } else if (isHold) {
    // Prescribed CO2/O2 hold: count down to the target.
    const rem = Math.max(0, timer.remaining);
    ringLabel = formatMMSS(rem);
    ringSub = `target ${formatMMSS(target)}`;
    progress = target > 0 ? Math.min(1, (target - rem) / target) : 0;
  } else {
    ringLabel = formatMMSS(Math.max(0, timer.remaining));
    ringSub = timer.phase === 'recover' ? 'until next hold' : 'until hold';
    const total = timer.phase === 'breatheUp'
      ? APNEA_DEFAULTS.breatheUpSec
      : (plan.rounds[timer.roundIndex]?.restBeforeSec || 1);
    progress = total > 0 ? Math.min(1, (total - timer.remaining) / total) : 0;
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-6 py-4">
      <div className="flex items-center justify-between text-xs text-[color:var(--text-dim)]">
        <span>{plan.type} · Round {timer.roundIndex + 1}/{plan.rounds.length}</span>
        <button
          onClick={cancel}
          aria-label="Cancel session"
          className="rounded-lg px-2 py-1 text-[color:var(--text-dim)]"
        >
          Cancel ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <div
          className="rounded-2xl px-6 py-2 text-center text-lg font-bold uppercase tracking-[0.2em]"
          style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
        >
          {PHASE_LABEL[timer.phase]}
        </div>

        <ProgressRing progress={progress} label={ringLabel} sublabel={ringSub} color={color} />

        <p className="min-h-[2.5rem] max-w-xs text-center text-sm text-[color:var(--text-dim)]">
          {PHASE_HINT[timer.phase]}
        </p>
        {firstContractionSec !== null && (
          <div className="text-xs text-[color:var(--text-dim)]">
            First contraction · {formatMMSS(firstContractionSec)}
          </div>
        )}
      </div>

      {adjustment?.reason === 'early-contractions' && (
        <Card className="border-[color:var(--warn)]">
          <p className="text-sm text-[color:var(--warn)]">
            {plan.type === 'O2'
              ? `Next hold increases paused; recovery increased by ${adjustment.restAddedSec}s.`
              : `Recovery increased by ${adjustment.restAddedSec}s — contractions started earlier than your normal.`}
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3 pb-2">
        {timer.phase === 'breatheUp' && (
          <Button className="w-full" onClick={startHoldNow}>I'm ready — start hold</Button>
        )}
        {timer.phase === 'recover' && (
          <Button className="w-full" onClick={startHoldNow}>Start next hold</Button>
        )}
        {isHold && (
          <>
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={markContraction}>
                Contraction · {contractions}
              </Button>
              <Button className="flex-1" onClick={endHold}>End hold</Button>
            </div>
            <Button variant="danger" className="w-full" onClick={tapOut}>I tapped out</Button>
          </>
        )}
      </div>
    </div>
  );
}
