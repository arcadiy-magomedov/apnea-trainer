import { useNavigate } from 'react-router-dom';
import { StatCard } from '../design-system/StatCard';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { ProgressChart } from '../design-system/ProgressChart';
import { ProgressRing } from '../design-system/ProgressRing';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { assessmentHistory } from '../../domain/apnea/assessmentHistory';
import {
  goalForecast,
  projectedTrajectory,
  trajectoryStatus,
} from '../../domain/apnea/goalEngine';
import {
  adherencePct,
  currentStreakDays,
  latestSessionQuality,
  medianContractionOnsetPct,
  personalBestSec,
  weeklySessionCount,
} from '../../application/stats';
import { AdOpportunityProbe } from '../analytics/AdOpportunityProbe';

export function StatsScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  const forecast = state.goal ? goalForecast(state, state.goal, now) : null;
  const co2OnsetPct = medianContractionOnsetPct(state, 'CO2');
  const o2OnsetPct = medianContractionOnsetPct(state, 'O2');
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Stats</h2>
      <StatCard label="Personal best" value={formatMMSS(personalBestSec(state))} accent="var(--cyan)" />
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="CO₂ level" value={`${state.courseState.difficultyByType.CO2}`} />
        <StatCard label="O₂ level" value={`${state.courseState.difficultyByType.O2}`} />
      </div>
      <Card>
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Weekly profile
        </div>
        <div className="mt-1 text-lg font-semibold">
          {state.courseState.microcycleProfile === 'co2-heavy'
            ? 'CO₂-heavy'
            : state.courseState.microcycleProfile === 'o2-heavy'
              ? 'O₂-heavy'
              : 'Balanced'}
        </div>
        <div className="text-sm text-[color:var(--text-dim)]">
          Latest quality: {latestSessionQuality(state) ?? 'No rated sessions'}
        </div>
        <div className="mt-2 text-sm text-[color:var(--text-dim)]">
          CO₂ contraction onset: {
            co2OnsetPct === null
              ? 'Not enough data'
              : `${co2OnsetPct}% of target`
          }
        </div>
        <div className="text-sm text-[color:var(--text-dim)]">
          O₂ contraction onset: {
            o2OnsetPct === null
              ? 'Not enough data'
              : `${o2OnsetPct}% of target`
          }
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${weeklySessionCount(state, now)}`} />
        <StatCard label="Streak" value={`${currentStreakDays(state, now)}d`} />
        <StatCard label="Adherence" value={`${adherencePct(state, now)}%`} />
        <StatCard label="Sessions" value={`${state.sessions.length}`} />
      </div>
      {state.goal && forecast ? (
        <Card>
          <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
            Goal progress
          </div>
          <ProgressRing
            progress={forecast.progressPct / 100}
            label={`${Math.round(forecast.progressPct)}%`}
            sublabel={`${formatMMSS(forecast.bestSec)} / ${formatMMSS(forecast.targetSec)}`}
            color="var(--cyan)"
          />
          <ProgressChart
            actual={assessmentHistory(state)}
            projected={projectedTrajectory(state, state.goal, now)}
            targetSec={state.goal.targetHoldSec}
          />
          <div className="flex justify-between text-sm text-[color:var(--text-dim)]">
            <span>{trajectoryStatus(state, state.goal)}</span>
            <span>{forecast.confidence} confidence</span>
          </div>
        </Card>
      ) : (
        <Button variant="ghost" onClick={() => navigate('/goal')}>
          Set a goal
        </Button>
      )}
      <AdOpportunityProbe placement="stats_inline" surface="stats" />
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
