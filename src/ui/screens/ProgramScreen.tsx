import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { syncRestDays } from '../../domain/apnea/courseEngine';

export function ProgramScreen() {
  const { clock, ics } = useServices();
  const state = useAppStore((s) => s.state);
  const days = state.courseState.template.days;
  const position = syncRestDays(state.courseState, clock.now()).position % days.length;

  function exportIcs() {
    const content = ics.build(state.settings.reminderTimes, state.courseState.template, clock.now());
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'apnea-training.ics'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Program</h2>
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">This week</div>
        <ol className="space-y-1 text-sm">
          {days.map((d, i) => (
            <li key={i} className={`flex justify-between ${i === position ? 'font-semibold text-[color:var(--cyan)]' : ''}`}>
              <span>Day {i + 1}</span><span>{d}{i === position ? ' · today' : ''}</span>
            </li>
          ))}
        </ol>
      </Card>
      <Button variant="ghost" onClick={exportIcs}>Export reminders (.ics)</Button>
    </div>
  );
}
