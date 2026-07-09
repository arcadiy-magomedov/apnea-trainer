import { useNavigate } from 'react-router-dom';
import { StatCard } from '../design-system/StatCard';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { personalBestSec, weeklySessionCount, currentStreakDays } from '../../application/stats';
import { startTodaySession } from '../../application/usecases/startTodaySession';

export function HomeScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  const today = startTodaySession(state, now);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-[color:var(--text-dim)]">Ready to train?</div>
        <h2 className="text-xl font-bold">Apnea Trainer</h2>
      </div>
      <StatCard label="Personal best · static" value={formatMMSS(personalBestSec(state))} accent="var(--cyan)" />
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${weeklySessionCount(state, now)}`} />
        <StatCard label="Streak" value={`${currentStreakDays(state, now)}d`} />
      </div>
      <Card>
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
        <div className="mt-1 text-lg font-semibold">
          {today.needsBaseline ? 'Measure your baseline' : today.decision.dayType}
        </div>
        {today.decision.reason && <div className="text-sm text-[color:var(--text-dim)]">{today.decision.reason}</div>}
      </Card>
      <Button onClick={() => navigate(today.needsBaseline ? '/baseline' : '/train')}>
        {today.needsBaseline ? 'Start baseline' : 'Train'}
      </Button>
    </div>
  );
}
