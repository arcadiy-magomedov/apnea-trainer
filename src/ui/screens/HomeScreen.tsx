import { useNavigate } from 'react-router-dom';
import { StatCard } from '../design-system/StatCard';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { personalBestSec, weeklySessionCount, currentStreakDays } from '../../application/stats';
import { startTodaySession } from '../../application/usecases/startTodaySession';
import { isSameCalendarDay } from '../../domain/apnea/time';
import { DAY_MS } from '../../domain/apnea/config';
import { goalForecast } from '../../domain/apnea/goalEngine';
import { GoalCard } from '../components/GoalCard';

export function HomeScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  const today = startTodaySession(state, now);
  const forecast = state.goal ? goalForecast(state, state.goal, now) : null;
  const doneToday = [...state.sessions].reverse().find((s) => isSameCalendarDay(s.finishedAt, now));
  const tomorrow = startTodaySession(state, now + DAY_MS).decision;
  const doneSubtitle = tomorrow.dayType === 'REST'
    ? 'Nice work. Tomorrow is a rest day — recover.'
    : `Nice work. Next session tomorrow: ${tomorrow.dayType}.`;

  function launch() {
    navigate('/runner', {
      state: {
        plan: today.plan,
        difficultyLevel: today.appliedDifficulty,
        earlyContractionThresholds: today.earlyContractionThresholds,
      },
    });
  }

  const todayTitle = today.needsBaseline
    ? 'Measure your baseline'
    : today.decision.dayType === 'REST'
      ? 'Rest day'
      : `${today.decision.dayType} session`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-[color:var(--text-dim)]">Ready to train?</div>
        <h2 className="text-xl font-bold">Apnea Trainer</h2>
      </div>

      <StatCard label="Personal best · static" value={formatMMSS(personalBestSec(state))} accent="var(--cyan)" />
      {forecast ? (
        <GoalCard
          forecast={forecast}
          onOpen={() => navigate('/stats', { state: { focus: 'goal' } })}
          onSetGoal={forecast.achieved ? () => navigate('/goal') : undefined}
        />
      ) : (
        <Button variant="ghost" onClick={() => navigate('/goal')}>
          Set a max-hold goal
        </Button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="This week" value={`${weeklySessionCount(state, now)}`} />
        <StatCard label="Streak" value={`${currentStreakDays(state, now)}d`} />
      </div>

      {doneToday ? (
        <>
          <Card className="border-[color:var(--success)]">
            <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--success)]">
              <span aria-hidden>✓</span> {doneToday.type} session · done
            </div>
            <div className="text-sm text-[color:var(--text-dim)]">{doneSubtitle}</div>
          </Card>
          <Button variant="ghost" onClick={() => navigate('/stats')}>View stats</Button>
        </>
      ) : (
        <>
          <Card>
            <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Today</div>
            <div className="mt-1 text-lg font-semibold">{todayTitle}</div>
            {today.decision.reason && (
              <div className="text-sm text-[color:var(--text-dim)]">{today.decision.reason}</div>
            )}
            {today.decision.deload && (
              <div className="mt-1 text-sm text-[color:var(--warn)]">Eased after time off.</div>
            )}
            {today.decision.suggestRetest && (
              <div className="mt-1 text-sm text-[color:var(--warn)]">Consider retesting your baseline.</div>
            )}
          </Card>

          {today.needsBaseline ? (
            <Button onClick={() => navigate('/baseline')}>Measure baseline</Button>
          ) : today.decision.blocked ? (
            <Button variant="ghost" disabled={!today.plan} onClick={launch}>Train anyway</Button>
          ) : (
            <Button disabled={!today.plan} onClick={launch}>Start {today.decision.dayType} session</Button>
          )}
        </>
      )}
    </div>
  );
}
