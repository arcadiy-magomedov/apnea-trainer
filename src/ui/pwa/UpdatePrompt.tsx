import { useRunnerStore } from '../app/stores';
import { Button } from '../design-system/Button';
import { useAppUpdate } from './useAppUpdate';

export function UpdatePrompt() {
  const phase = useRunnerStore((s) => s.phase);
  const plan = useRunnerStore((s) => s.plan);
  const sessionActive = plan !== null && phase !== 'done';
  const { needRefresh, apply, dismiss } = useAppUpdate(sessionActive);
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-0 bottom-16 z-50 mx-auto max-w-md px-4">
      <div className="flex items-center justify-between rounded-2xl border border-[color:var(--border)] bg-surface-2 p-3 text-sm">
        <span>New version available{sessionActive ? ' — will update after your session' : ''}.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={dismiss}>Later</Button>
          <Button disabled={sessionActive} onClick={apply}>Update</Button>
        </div>
      </div>
    </div>
  );
}