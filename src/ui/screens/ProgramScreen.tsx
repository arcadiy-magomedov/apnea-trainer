import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { syncRestDays, trainedToday } from '../../domain/apnea/courseEngine';
import { shareOrDownloadIcs } from '../icsShare';

export function ProgramScreen() {
  const { clock, ics } = useServices();
  const state = useAppStore((s) => s.state);
  const days = state.courseState.template.days;
  const now = clock.now();
  const synced = syncRestDays(state.courseState, now).position % days.length;
  const didTrainToday = trainedToday(state.courseState, now);
  const completedIdx = didTrainToday ? (synced - 1 + days.length) % days.length : -1;

  function exportIcs() {
    const content = ics.build(state.settings.reminderTimes, state.courseState.template, now);
    void shareOrDownloadIcs(content);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Program</h2>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">This week</div>
        <ol className="space-y-1 text-sm">
          {days.map((d, i) => {
            const isCompleted = i === completedIdx;
            const isCurrent = i === synced && !didTrainToday;
            const isNext = i === synced && didTrainToday;
            const cls = isCompleted
              ? 'font-semibold text-[color:var(--success)]'
              : isCurrent
                ? 'font-semibold text-[color:var(--cyan)]'
                : '';
            const suffix = isCompleted
              ? ' · done today'
              : isCurrent
                ? ' · today'
                : isNext
                  ? ' · next'
                  : '';
            return (
              <li key={i} className={`flex justify-between ${cls}`}>
                <span>Day {i + 1}</span>
                <span>{isCompleted ? '✓ ' : ''}{d}{suffix}</span>
              </li>
            );
          })}
        </ol>
      </Card>
      <Button variant="ghost" onClick={exportIcs}>Export reminders (.ics)</Button>
    </div>
  );
}
