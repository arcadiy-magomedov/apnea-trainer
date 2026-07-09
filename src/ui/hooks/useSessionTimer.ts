import { useEffect, useRef, useState } from 'react';
import type { SessionPlan } from '../../domain/models/types';
import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';

interface Options {
  breatheUpSec?: number;
  onPhaseChange?: (phase: RunnerPhase) => void;
  onTick?: (phase: RunnerPhase, remaining: number) => void;
}

export function useSessionTimer(plan: SessionPlan, opts: Options = {}) {
  const breatheUpSec = opts.breatheUpSec ?? APNEA_DEFAULTS.breatheUpSec;
  const [roundIndex, setRoundIndex] = useState(0);
  const [phase, setPhase] = useState<RunnerPhase>('breatheUp');
  const [remaining, setRemaining] = useState(breatheUpSec);
  const [active, setActive] = useState(false);
  const holdElapsed = useRef(0);

  function toPhase(next: RunnerPhase, seconds: number) {
    setPhase(next);
    setRemaining(seconds);
    opts.onPhaseChange?.(next);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        const next = r - 1;
        opts.onTick?.(phase, Math.max(0, next));
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [active, phase]);

  useEffect(() => {
    if (!active || remaining > 0) return;
    if (phase === 'breatheUp') {
      holdElapsed.current = 0;
      toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999);
    }
    if (phase === 'recover') {
      toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999);
    }
  }, [remaining, active, phase, roundIndex]);

  return {
    roundIndex,
    phase,
    remaining,
    begin: () => { setActive(true); toPhase('breatheUp', breatheUpSec); },
    // advanceHoldToRecover / nextRound are driven by the Runner screen on user tap.
    endHold: () => {
      const nextIdx = roundIndex + 1;
      if (nextIdx >= plan.rounds.length) { setActive(false); toPhase('done', 0); return; }
      setRoundIndex(nextIdx);
      toPhase('recover', plan.rounds[nextIdx].restBeforeSec);
    },
    recoverToNextHold: () => toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999),
    startHold: () => toPhase('hold', plan.rounds[roundIndex].targetHoldSec || 9999),
    stop: () => setActive(false),
  };
}
