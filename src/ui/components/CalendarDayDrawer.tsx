import { Card } from '../design-system/Card';
import { formatMMSS } from '../design-system/format';
import type { TrainingCalendarEvent } from '../../application/calendar/trainingCalendar';

export interface CalendarDayDrawerProps {
  dayKey: string;
  events: readonly TrainingCalendarEvent[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const typeLabels: Record<TrainingCalendarEvent['dayType'], string> = {
  CO2: 'CO₂ session',
  O2: 'O₂ session',
  MAX: 'MAX assessment',
  REST: 'Rest day',
};

function localizedDateHeading(dayKey: string): string {
  // Parse dayKey as local date (avoid UTC off-by-one).
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function statusLabel(event: TrainingCalendarEvent): string {
  if (event.status === 'completed') return 'Completed';
  if (event.postponed) return 'Postponed';
  return 'Planned';
}

function qualityLabel(event: TrainingCalendarEvent): string | null {
  if (event.status !== 'completed') return null;
  if (event.quality === null) return null;
  if (event.quality === 'unavailable') return 'Quality unavailable';
  return event.quality;
}

function plannedSummary(event: TrainingCalendarEvent): string | null {
  if (event.status === 'completed') return null;
  if (event.dayType === 'REST') return null;
  if (event.dayType === 'MAX') {
    // MAX planned: show attempt count / best target but no level
    const parts: string[] = [];
    if (event.plannedRounds != null) parts.push(`${event.plannedRounds} attempts`);
    if (event.bestHoldSec != null) parts.push(`${formatMMSS(event.bestHoldSec)} target`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  // CO2/O2 planned: Level <n> · <rounds> rounds
  const parts: string[] = [];
  if (event.difficultyLevel != null) parts.push(`Level ${event.difficultyLevel}`);
  if (event.plannedRounds != null) parts.push(`${event.plannedRounds} rounds`);
  return parts.join(' · ') || null;
}

export function CalendarDayDrawer({ dayKey, events }: CalendarDayDrawerProps) {
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-[color:var(--text-dim)]">
        {localizedDateHeading(dayKey)}
      </h3>

      {events.length === 0 && (
        <p className="text-sm text-[color:var(--text-mute)]">No training or assessment</p>
      )}

      {events.map((event) => (
        <div key={event.id} data-testid="calendar-day-event" className="mb-3 last:mb-0">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[color:var(--text)]">
              {typeLabels[event.dayType]}
            </span>
            <span className="text-xs text-[color:var(--text-dim)]">
              {statusLabel(event)}
            </span>
          </div>

          {qualityLabel(event) && (
            <p className="text-sm text-[color:var(--text-mute)]">{qualityLabel(event)}</p>
          )}

          {event.status === 'completed' && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[color:var(--text-dim)]">
              {event.completedRounds != null && event.plannedRounds != null && (
                <span>{event.completedRounds}/{event.plannedRounds} rounds</span>
              )}
              {event.tapOuts != null && (
                <span>{event.tapOuts} tap-outs</span>
              )}
              {event.bestHoldSec != null && (
                <span>{formatMMSS(event.bestHoldSec)} best hold</span>
              )}
              {event.firstContractionSec != null && (
                <span>{formatMMSS(event.firstContractionSec)} first contraction</span>
              )}
            </div>
          )}

          {event.status === 'planned' && plannedSummary(event) && (
            <p className="mt-1 text-xs text-[color:var(--text-dim)]">
              {plannedSummary(event)}
            </p>
          )}
        </div>
      ))}
    </Card>
  );
}
