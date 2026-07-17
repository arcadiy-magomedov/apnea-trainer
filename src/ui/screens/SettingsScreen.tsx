import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../app/stores';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { exportJson, importJson } from '../../infrastructure/persistence/jsonBackup';
import { formatMMSS } from '../design-system/format';
import { useAnalyticsConsent } from '../analytics/AnalyticsConsentProvider';
import { useServices } from '../app/services';

type AnalyticsIdentifierState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'success'; value: string }
  | { status: 'error' };

const ANALYTICS_IDENTIFIER_ERROR =
  'Could not load the pseudonymous analytics identifier.';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { analytics } = useServices();
  const hydrated = useAppStore((s) => s.hydrated);
  const state = useAppStore((s) => s.state);
  const update = useAppStore((s) => s.updateSettings);
  const replaceState = useAppStore((s) => s.replaceState);
  const clearGoal = useAppStore((store) => store.clearGoal);
  const [clearingGoal, setClearingGoal] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const clearingGoalRef = useRef(false);
  const {
    active: analyticsActive,
    available: analyticsAvailable,
    consent,
    ready: analyticsReady,
    error: analyticsError,
    choose,
    getAnonymousId,
  } = useAnalyticsConsent();
  const [analyticsIdentifier, setAnalyticsIdentifier] =
    useState<AnalyticsIdentifierState>({ status: 'hidden' });
  const { settings } = state;
  const appVersion = (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ ?? __APP_VERSION__;

  useEffect(() => {
    let cancelled = false;
    if (
      !analyticsAvailable
      || !analyticsActive
      || !analyticsReady
      || consent !== 'granted'
    ) {
      setAnalyticsIdentifier({ status: 'hidden' });
      return;
    }

    setAnalyticsIdentifier({ status: 'loading' });
    void getAnonymousId()
      .then((id) => {
        if (cancelled) return;
        setAnalyticsIdentifier(
          id
            ? { status: 'success', value: id }
            : { status: 'error' },
        );
      })
      .catch(() => {
        if (!cancelled) setAnalyticsIdentifier({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [
    analyticsActive,
    analyticsAvailable,
    analyticsReady,
    consent,
    getAnonymousId,
  ]);

  async function retryAnalyticsIdentifier() {
    setAnalyticsIdentifier({ status: 'loading' });
    try {
      const id = await getAnonymousId();
      setAnalyticsIdentifier(
        id
          ? { status: 'success', value: id }
          : { status: 'error' },
      );
    } catch {
      setAnalyticsIdentifier({ status: 'error' });
    }
  }

  const toggle = (key: 'voiceCues' | 'beepCues' | 'vibrationCues', label: string) => (
    <label className="flex items-center justify-between py-1 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        aria-label={label}
        checked={settings[key]}
        onChange={(e) => update({ [key]: e.target.checked })}
      />
    </label>
  );

  function doExport() {
    const url = URL.createObjectURL(new Blob([exportJson(state)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'apnea-backup.json'; a.click();
    URL.revokeObjectURL(url);
  }

  async function onClearGoal() {
    if (clearingGoalRef.current) return;
    clearingGoalRef.current = true;
    setClearingGoal(true);
    setGoalError(null);
    try {
      await clearGoal();
      analytics.track({ name: 'goal_cleared' });
    } catch (error) {
      setGoalError(
        error instanceof Error ? error.message : 'Could not clear the goal',
      );
    } finally {
      clearingGoalRef.current = false;
      setClearingGoal(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Settings</h2>
      {!hydrated && <Card><p className="text-sm">Loading settings…</p></Card>}
      {hydrated && (
        <>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Cues</div>
        {toggle('voiceCues', 'Voice cues')}
        {toggle('beepCues', 'Beep cues')}
        {toggle('vibrationCues', 'Vibration cues')}
      </Card>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Goal
        </div>
        {state.goal ? (
          <div className="grid gap-2">
            <div className="text-sm">
              Target: {formatMMSS(state.goal.targetHoldSec)}
            </div>
            <Button variant="ghost" onClick={() => navigate('/goal')}>Edit goal</Button>
            <Button
              variant="danger"
              disabled={clearingGoal}
              onClick={() => void onClearGoal()}
            >
              Clear goal
            </Button>
            {goalError && (
              <p role="alert" className="text-sm text-[color:var(--danger)]">
                {goalError}
              </p>
            )}
          </div>
        ) : (
          <Button variant="ghost" onClick={() => navigate('/goal')}>Set a goal</Button>
        )}
      </Card>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">Data</div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={doExport}>Export backup</Button>
          <label className="flex-1 cursor-pointer rounded-2xl bg-surface px-5 py-3 text-center font-semibold" >
            Import
            <input
              type="file" accept="application/json" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const restored = importJson(await file.text());
                await replaceState(restored);
              }}
            />
          </label>
        </div>
      </Card>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Privacy
        </div>
        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span>Share anonymous usage analytics</span>
          <input
            type="checkbox"
            aria-label="Share anonymous usage analytics"
            checked={consent === 'granted'}
            disabled={!analyticsAvailable || !analyticsReady}
            onChange={(event) => {
              void choose(event.target.checked ? 'granted' : 'denied');
            }}
          />
        </label>
        {analyticsAvailable
          && analyticsActive
          && consent === 'granted'
          && analyticsIdentifier.status !== 'hidden'
          && (
          <div className="mt-2 text-xs text-[color:var(--text-dim)]">
            <div>Pseudonymous analytics identifier</div>
            {analyticsIdentifier.status === 'loading' && (
              <p role="status" className="mt-1">
                Loading analytics identifier…
              </p>
            )}
            {analyticsIdentifier.status === 'error' && (
              <>
                <p role="alert" className="mt-1 text-[color:var(--danger)]">
                  {ANALYTICS_IDENTIFIER_ERROR}
                </p>
                <Button
                  variant="ghost"
                  className="mt-2 px-3 py-2 text-sm"
                  onClick={() => void retryAnalyticsIdentifier()}
                >
                  Retry loading analytics identifier
                </Button>
              </>
            )}
            {analyticsIdentifier.status === 'success' && (
              <label className="block">
                <span className="sr-only">
                  Pseudonymous analytics identifier
                </span>
                <input
                  readOnly
                  aria-label="Pseudonymous analytics identifier"
                  value={analyticsIdentifier.value}
                  className="mt-1 w-full rounded-lg bg-[color:var(--surface-2)] px-2 py-1 font-mono"
                />
                <span className="mt-1 block">
                  Copy this before turning analytics off if you want to request
                  deletion.
                </span>
              </label>
            )}
          </div>
        )}
        {analyticsError && (
          <p role="alert" className="mt-2 text-sm text-[color:var(--danger)]">
            {analyticsError}
          </p>
        )}
        {!analyticsAvailable && (
          <p className="mt-2 text-xs text-[color:var(--text-dim)]">
            Analytics is not configured in this build. No usage analytics will
            leave this device.
          </p>
        )}
        <Link
          className="mt-3 inline-block text-sm text-[color:var(--cyan)]"
          to="/privacy"
        >
          Privacy details
        </Link>
      </Card>
      <Card className="border-[color:var(--danger)]">
        <p className="text-xs text-[color:var(--text-dim)]">
          Dry land only. Never train in or near water alone. No hyperventilation.
        </p>
      </Card>
        </>
      )}
      <p className="pt-2 text-center text-xs text-[color:var(--text-mute)]">Version {appVersion}</p>
    </div>
  );
}
