import { useAppStore } from '../app/stores';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { exportJson, importJson } from '../../infrastructure/persistence/jsonBackup';

export function SettingsScreen() {
  const hydrated = useAppStore((s) => s.hydrated);
  const state = useAppStore((s) => s.state);
  const update = useAppStore((s) => s.updateSettings);
  const replaceState = useAppStore((s) => s.replaceState);
  const { settings } = state;

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
      <Card className="border-[color:var(--danger)]">
        <p className="text-xs text-[color:var(--text-dim)]">
          Dry land only. Never train in or near water alone. No hyperventilation.
        </p>
      </Card>
        </>
      )}
    </div>
  );
}
