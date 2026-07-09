import { StatCard } from '../design-system/StatCard';
import { Card } from '../design-system/Card';
import { formatMMSS } from '../design-system/format';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { personalBestSec, weeklySessionCount, currentStreakDays, adherencePct } from '../../application/stats';

export function StatsScreen() {
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Stats</h2>
      <StatCard label="Personal best" value={formatMMSS(personalBestSec(state))} accent="var(--cyan)" />
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${weeklySessionCount(state, now)}`} />
        <StatCard label="Streak" value={`${currentStreakDays(state, now)}d`} />
        <StatCard label="Adherence" value={`${adherencePct(state, now)}%`} />
        <StatCard label="Sessions" value={`${state.sessions.length}`} />
      </div>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Recent sessions</div>
        {state.sessions.slice(-8).reverse().map((s) => (
          <div key={s.id} className="flex justify-between border-b border-[color:var(--border)] py-1 text-sm last:border-0">
            <span>{s.type}</span>
            <span className="tabular-nums">{s.completedRounds}/{s.rounds.length} · {s.tapOuts} tap-outs</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
