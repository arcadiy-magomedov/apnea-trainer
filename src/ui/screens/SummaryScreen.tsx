import { useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '../../domain/models/types';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';

export function SummaryScreen() {
  const navigate = useNavigate();
  const session = (useLocation().state as { session: Session } | null)?.session;
  if (!session) return <p className="p-6">No session data. <Button onClick={() => navigate('/')}>Home</Button></p>;
  const best = session.rounds.reduce((m, r) => Math.max(m, r.achievedHoldSec), 0);
  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <h2 className="text-2xl font-bold">Session complete</h2>
      <Card>
        <div className="flex justify-between text-sm"><span>Type</span><span>{session.type}</span></div>
        <div className="flex justify-between text-sm"><span>Completed rounds</span><span>{session.completedRounds}/{session.rounds.length}</span></div>
        <div className="flex justify-between text-sm"><span>Tap-outs</span><span>{session.tapOuts}</span></div>
        <div className="flex justify-between text-sm"><span>Best hold</span><span className="tabular-nums">{formatMMSS(best)}</span></div>
      </Card>
      <Button onClick={() => navigate('/')}>Done</Button>
    </div>
  );
}
