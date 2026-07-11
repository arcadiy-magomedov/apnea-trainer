import type { HomeDayModel } from '../../application/usecases/homeDayModel';
import { formatMMSS } from '../design-system/format';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';

function label(dayType: 'CO2' | 'O2' | 'MAX'): string {
  if (dayType === 'CO2') return 'CO₂';
  if (dayType === 'O2') return 'O₂';
  return 'MAX';
}

function nextCopy(model: HomeDayModel): string {
  if (!model.nextTraining) return 'Next training will appear here';
  return `Next: ${label(model.nextTraining.dayType)} · ${new Date(model.nextTraining.at).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })}`;
}

interface HomeHeroDockProps {
  model: HomeDayModel;
  onLaunch: () => void;
  onMeasureBaseline: () => void;
}

export function HomeHeroDock({ model, onLaunch, onMeasureBaseline }: HomeHeroDockProps) {
  const { today, doneToday } = model;

  if (doneToday) {
    return (
      <Card className="border-[color:var(--success)]">
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
        <div className="mt-1 text-lg font-semibold text-[color:var(--success)]">
          {label(doneToday.type)} session complete
        </div>
        <div className="text-sm text-[color:var(--text-dim)]">{nextCopy(model)}</div>
      </Card>
    );
  }

  if (today.needsBaseline) {
    return (
      <Button
        className="min-h-16 w-full text-lg shadow-[0_10px_28px_rgba(34,211,238,0.25)]"
        onClick={onMeasureBaseline}
      >
        Measure baseline
      </Button>
    );
  }

  if (today.decision.dayType === 'REST' || today.decision.blocked) {
    return (
      <Card className={today.assessmentSchedule.postponed ? 'border-[color:var(--warn)]' : ''}>
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
        <div className="mt-1 text-lg font-semibold">
          {today.assessmentSchedule.postponed ? 'MAX assessment postponed' : 'Rest day'}
        </div>
        {today.assessmentSchedule.postponed && (
          <div className="text-sm text-[color:var(--warn)]">Recovery gate is active.</div>
        )}
        <div className="text-sm text-[color:var(--text-dim)]">{nextCopy(model)}</div>
      </Card>
    );
  }

  const plan = today.plan;
  const type = today.decision.dayType;
  const rounds = plan?.rounds.length ?? 0;
  const bestTarget = plan && plan.rounds.length > 0
    ? Math.max(...plan.rounds.map((round) => round.targetHoldSec))
    : 0;

  return (
    <Card className="border-[color:var(--cyan)] bg-[color:var(--surface)]">
      <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
      <div className="mt-1 text-lg font-semibold">
        {type === 'MAX' ? 'MAX assessment' : `${label(type)} session`}
      </div>
      <div className="text-sm text-[color:var(--text-dim)]">
        {type === 'MAX'
          ? `${rounds} attempt${rounds === 1 ? '' : 's'}`
          : `${rounds} rounds · L${today.appliedDifficulty}`}
      </div>
      {type !== 'MAX' && (
        <div className="text-sm text-[color:var(--text-dim)]">up to {formatMMSS(bestTarget)}</div>
      )}
      <Button
        className="mt-3 min-h-16 w-full text-lg shadow-[0_10px_28px_rgba(34,211,238,0.25)]"
        onClick={onLaunch}
      >
        {type === 'MAX' ? 'Start MAX assessment' : `Start ${label(type)} session`}
      </Button>
    </Card>
  );
}
