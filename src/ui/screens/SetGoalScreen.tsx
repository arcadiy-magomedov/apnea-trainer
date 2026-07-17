import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APNEA_DEFAULTS } from '../../domain/apnea/config';
import { bestAssessedMaxSec } from '../../domain/apnea/assessmentHistory';
import { useAppStore } from '../app/stores';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { formatMMSS, parseMMSS } from '../design-system/format';
import { useServices } from '../app/services';

export function SetGoalScreen() {
  const navigate = useNavigate();
  const { analytics } = useServices();
  const hydrated = useAppStore((store) => store.hydrated);
  const state = useAppStore((store) => store.state);
  const saveGoal = useAppStore((store) => store.setGoal);
  const editing = state.goal !== null && state.goal.achievedAt === null;
  const initialValue = editing && state.goal
    ? formatMMSS(state.goal.targetHoldSec)
    : '';
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const displayedValue = value ?? initialValue;
  const target = useMemo(
    () => parseMMSS(displayedValue),
    [displayedValue],
  );
  const invalid = displayedValue.trim() !== '' && target === null;
  const current = bestAssessedMaxSec(state);
  const ambitious =
    target !== null
    && target > current * APNEA_DEFAULTS.goal.implausibleFactor;

  async function save() {
    if (target === null || savingRef.current) return;
    const wasEditing = editing;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await saveGoal(target);
      analytics.track({ name: wasEditing ? 'goal_updated' : 'goal_created' });
      navigate('/');
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save the goal',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!hydrated) return null;

  if (current <= 0) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
        <h2 className="text-2xl font-bold">
          {editing ? 'Edit goal' : 'Set your goal'}
        </h2>
        <Card>
          <p className="text-sm text-[color:var(--text-dim)]">
            Measure a baseline before setting a max-hold goal.
          </p>
        </Card>
        <Button onClick={() => navigate('/baseline')}>Measure baseline</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 px-6 py-6">
      <h2 className="text-2xl font-bold">
        {editing ? 'Edit goal' : 'Set your goal'}
      </h2>
      <Card>
        <div className="text-sm text-[color:var(--text-dim)]">
          Assessed max: {formatMMSS(current)}
        </div>
        <label className="mt-3 block text-sm">
          Target hold
          <input
            aria-label="Target hold"
            inputMode="text"
            autoCapitalize="none"
            placeholder="4:00"
            value={displayedValue}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-xl bg-[color:var(--surface-2)] px-3 py-2"
          />
        </label>
        {ambitious && (
          <p className="mt-2 text-sm text-[color:var(--warn)]">
            This is an ambitious target. ETA will remain low-confidence until new assessments.
          </p>
        )}
        {invalid && (
          <p className="mt-2 text-sm text-[color:var(--danger)]">
            Use minutes:seconds with 00-59 seconds, for example 4:30.
          </p>
        )}
        {target !== null && target > current && (
          <p className="mt-2 text-sm text-[color:var(--text-dim)]">
            Proposed improvement: {formatMMSS(target - current)}
          </p>
        )}
        {target !== null && target <= current && (
          <p className="mt-2 text-sm text-[color:var(--success)]">
            This goal will be recorded as already achieved.
          </p>
        )}
      </Card>
      {saveError && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {saveError}
        </p>
      )}
      <Button disabled={target === null || saving} onClick={() => void save()}>
        Save goal
      </Button>
      <Button variant="ghost" onClick={() => navigate('/')}>
        {editing ? 'Cancel' : 'Skip for now'}
      </Button>
    </div>
  );
}
