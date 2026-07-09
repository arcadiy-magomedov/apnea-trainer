import type { RunnerPhase } from '../../application/stores/sessionRunnerStore';

export const PHASE_COLOR: Record<RunnerPhase, string> = {
  breatheUp: 'var(--teal)',
  hold: 'var(--warn)',
  recover: 'var(--success)',
  done: 'var(--cyan)',
};

const LABEL: Record<RunnerPhase, string> = {
  breatheUp: 'Breathe up', hold: 'Hold', recover: 'Recover', done: 'Done',
};

export function PhaseBadge({ phase }: { phase: RunnerPhase }) {
  return (
    <div
      className="text-center text-xs uppercase tracking-[0.16em]"
      style={{ color: PHASE_COLOR[phase] }}
    >
      {LABEL[phase]}
    </div>
  );
}
