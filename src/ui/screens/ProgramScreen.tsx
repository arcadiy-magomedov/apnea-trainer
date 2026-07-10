import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { syncRestDays, trainedToday } from '../../domain/apnea/courseEngine';
import { startTodaySession } from '../../application/usecases/startTodaySession';
import { shareOrDownloadIcs } from '../icsShare';

export function ProgramScreen() {
  const { clock, ics } = useServices();
  const state = useAppStore((s) => s.state);
  const now = clock.now();
  const syncedCourse = syncRestDays(state.courseState, now);
  const days = syncedCourse.template.days;
  const synced = syncedCourse.position % days.length;
  const today = startTodaySession(state, now);
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
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Training profile
        </div>
        <div className="mt-1 font-semibold">{syncedCourse.microcycleProfile}</div>
        {syncedCourse.pendingMicrocycleProfile && (
          <div className="text-sm text-[color:var(--text-dim)]">
            Next cycle: {syncedCourse.pendingMicrocycleProfile}
          </div>
        )}
      </Card>
      {today.assessmentSchedule.due && (
        <Card className={today.assessmentSchedule.postponed
          ? 'border-[color:var(--warn)]'
          : 'border-[color:var(--cyan)]'}>
          <div className="font-semibold">
            {today.assessmentSchedule.postponed
              ? 'MAX assessment postponed'
              : 'MAX assessment due'}
          </div>
          <div className="text-sm text-[color:var(--text-dim)]">
            {today.assessmentSchedule.postponed
              ? 'Recovery gate is active.'
              : today.decision.dayType === 'REST'
                ? "Today's planned rest remains. MAX will replace the next training session."
                : `Current cadence: ${today.assessmentSchedule.intervalDays} days.`}
          </div>
        </Card>
      )}
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">This week</div>
        <ol className="space-y-1 text-sm">
          {days.map((d, i) => {
            const isCompleted = i === completedIdx;
            const isCurrent = i === synced && !didTrainToday;
            const isNext = i === synced && didTrainToday;
            const displayedDay = isCurrent ? today.decision.dayType : d;
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
                <span>{isCompleted ? '✓ ' : ''}{displayedDay}{suffix}</span>
              </li>
            );
          })}
        </ol>
      </Card>
      <Button variant="ghost" onClick={exportIcs}>Export reminders (.ics)</Button>
    </div>
  );
}
