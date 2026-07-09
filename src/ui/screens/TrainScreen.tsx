import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { startTodaySession } from '../../application/usecases/startTodaySession';

export function TrainScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((s) => s.state);
  const today = startTodaySession(state, clock.now());

  if (today.needsBaseline) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">Train</h2>
        <Card><p className="text-sm">Measure your baseline first.</p></Card>
        <Button onClick={() => navigate('/baseline')}>Start baseline</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Today · {today.decision.dayType}</h2>
      {today.decision.deload && <Card><p className="text-sm text-[color:var(--warn)]">Eased session after time off.</p></Card>}
      {today.decision.suggestRetest && <Card><p className="text-sm text-[color:var(--warn)]">Consider retesting your baseline.</p></Card>}
      {today.decision.blocked ? (
        <>
          <Card><p className="text-sm">{today.decision.reason}</p></Card>
          <Button
            variant="ghost"
            disabled={!today.plan}
            onClick={() => navigate('/runner', { state: { plan: today.plan, difficultyLevel: today.appliedDifficulty } })}
          >
            Train anyway
          </Button>
        </>
      ) : (
        <Button
          disabled={!today.plan}
          onClick={() => navigate('/runner', { state: { plan: today.plan, difficultyLevel: today.appliedDifficulty } })}
        >
          Start {today.decision.dayType} session
        </Button>
      )}
    </div>
  );
}
