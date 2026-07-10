import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Rpe, Session } from '../../domain/models/types';
import type { SessionCompletion } from '../../application/usecases/finishSession';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { formatMMSS } from '../design-system/format';
import { useAppStore } from '../app/stores';
import { useServices } from '../app/services';
import { assessmentSchedule } from '../../domain/apnea/assessmentSchedule';

const RATINGS: Array<{ value: Rpe; label: string }> = [
  { value: 'easy', label: 'Easy and controlled' },
  { value: 'normal', label: 'Normal effort' },
  { value: 'hard', label: 'Hard or lost relaxation' },
  { value: 'failed', label: 'Could not complete the plan' },
];

export function SummaryScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const completeSession = useAppStore((state) => state.completeSession);
  const session = (useLocation().state as { session: Session } | null)?.session;
  const alreadySaved = useAppStore((state) =>
    session
      ? state.state.sessions.some((existing) => existing.id === session.id)
      : false,
  );
  const [completion, setCompletion] = useState<SessionCompletion | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const schedule = completion
    ? assessmentSchedule(completion.state, clock.now())
    : null;

  if (!session) {
    return (
      <p className="p-6">
        No session data. <Button onClick={() => navigate('/')}>Home</Button>
      </p>
    );
  }

  const draft = session;
  const best = draft.rounds.reduce(
    (value, round) => Math.max(value, round.achievedHoldSec),
    0,
  );

  async function rate(rpe: Rpe) {
    if (savingRef.current || completion !== null) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await completeSession({ ...draft, rpe });
      setCompletion(result);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save the session',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <h2 className="text-2xl font-bold">Session complete</h2>
      <Card>
        <div className="flex justify-between text-sm">
          <span>Completed rounds</span>
          <span>{draft.completedRounds}/{draft.rounds.length}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Best hold</span>
          <span>{formatMMSS(best)}</span>
        </div>
      </Card>

      {completion === null && !alreadySaved ? (
        <Card>
          <div className="mb-3 font-semibold">How did the session feel?</div>
          <div className="grid gap-2">
            {RATINGS.map((rating) => (
              <Button
                key={rating.value}
                variant="ghost"
                disabled={saving}
                onClick={() => void rate(rating.value)}
              >
                {rating.label}
              </Button>
            ))}
          </div>
          {saveError && (
            <p role="alert" className="mt-3 text-sm text-[color:var(--danger)]">
              {saveError}
            </p>
          )}
        </Card>
      ) : (
        <>
          <Card>
            {completion === null ? (
              <>
                <div className="font-semibold">Session already saved</div>
                <p className="text-sm text-[color:var(--text-dim)]">
                  This workout is already in your training history.
                </p>
              </>
            ) : (
              <>
                <div className="font-semibold">Session quality</div>
                <p className="text-sm text-[color:var(--text-dim)]">
                  {completion.quality === 'clean'
                    ? 'Clean session: all prescribed work stayed controlled.'
                    : completion.quality === 'strained'
                      ? draft.adjustment?.reason === 'early-contractions'
                        ? 'Contractions began earlier than your personal range.'
                        : 'The session was completed under high strain.'
                      : completion.quality === 'failed'
                        ? 'The planned work was incomplete or included a tap-out.'
                        : 'MAX assessment recorded.'}
                </p>
                {completion.previousLevel !== null
                  && completion.nextLevel !== null
                  && completion.action !== null && (
                  <p className="mt-1 text-sm">
                    {completion.action === 'progress'
                      ? `${draft.type} level increased from ${completion.previousLevel} to ${completion.nextLevel} after two clean sessions.`
                      : completion.action === 'deload'
                        ? completion.nextLevel < completion.previousLevel
                          ? `${draft.type} level reduced from ${completion.previousLevel} to ${completion.nextLevel} after repeated strain or failure.`
                          : `${draft.type} level stays at 0, the minimum, after repeated strain or failure.`
                        : `${draft.type} level stays at ${completion.nextLevel} until the quality signal is clearer.`}
                  </p>
                )}
                {completion.suggestRetest && (
                  <p className="mt-1 text-sm text-[color:var(--warn)]">
                    Three failed sessions in a row. Schedule a new MAX assessment
                    after recovery.
                  </p>
                )}
                {completion.profileChangedTo && (
                  <p className="mt-1 text-sm">
                    Weekly profile changed to {completion.profileChangedTo}.
                  </p>
                )}
                {completion.profileQueuedFor && (
                  <p className="mt-1 text-sm">
                    Next microcycle: {completion.profileQueuedFor}.
                  </p>
                )}
                {schedule?.due && (
                  <p className="mt-1 text-sm text-[color:var(--warn)]">
                    {schedule.postponed
                      ? 'MAX assessment is due but postponed for recovery.'
                      : 'MAX assessment is due and ready.'}
                  </p>
                )}
              </>
            )}
          </Card>
          <Button onClick={() => navigate('/', { replace: true })}>Done</Button>
        </>
      )}
    </div>
  );
}
