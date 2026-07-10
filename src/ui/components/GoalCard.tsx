import type { GoalForecast } from '../../domain/apnea/goalEngine';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { ProgressRing } from '../design-system/ProgressRing';
import { formatMMSS } from '../design-system/format';

function etaText(forecast: GoalForecast): string {
  if (forecast.achieved) return 'Goal reached';
  if (forecast.stalled) return 'Progress stalled';
  if (forecast.etaMs === null) return 'ETA unavailable';
  return `ETA ${new Date(forecast.etaMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`;
}

export function GoalCard({
  forecast,
  onOpen,
  onSetGoal,
}: {
  forecast: GoalForecast;
  onOpen: () => void;
  onSetGoal?: () => void;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
        Max-hold goal
      </div>
      <ProgressRing
        progress={forecast.progressPct / 100}
        label={`${Math.round(forecast.progressPct)}%`}
        sublabel={`${formatMMSS(forecast.bestSec)} / ${formatMMSS(forecast.targetSec)}`}
        color="var(--cyan)"
      />
      <div className="text-center font-semibold">{etaText(forecast)}</div>
      {!forecast.achieved && !forecast.stalled && (
        <div className="text-center text-xs text-[color:var(--text-dim)]">
          {forecast.confidence} confidence
        </div>
      )}
      {forecast.stalled && (
        <p className="mt-2 text-center text-sm text-[color:var(--text-dim)]">
          Recent assessments are flat or declining. Consolidate, recover, then reassess.
        </p>
      )}
      <Button variant="ghost" className="mt-3 w-full" onClick={onOpen}>
        View goal progress
      </Button>
      {forecast.achieved && onSetGoal && (
        <Button className="mt-2 w-full" onClick={onSetGoal}>
          Set a higher goal
        </Button>
      )}
    </Card>
  );
}
