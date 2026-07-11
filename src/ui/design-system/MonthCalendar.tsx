import { addCalendarDays, localDateKey } from '../../domain/apnea/time';
import type { TrainingCalendarEvent } from '../../application/calendar/trainingCalendar';

export interface MonthCalendarProps {
  visibleMonth: number; // local month start timestamp
  today: number;
  selectedDayKey: string;
  events: readonly TrainingCalendarEvent[];
  onSelectDay: (dayKey: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const typeLabel: Record<TrainingCalendarEvent['dayType'], string> = {
  CO2: 'CO₂',
  O2: 'O₂',
  MAX: 'MAX',
  REST: 'REST',
};

const markerBorderColor = {
  CO2: 'border-[color:var(--cyan)]',
  O2: 'border-[color:var(--teal)]',
  MAX: 'border-[color:var(--warn)]',
  REST: 'border-[color:var(--text-mute)]',
} satisfies Record<TrainingCalendarEvent['dayType'], string>;

const markerBgColor = {
  CO2: 'bg-[color:var(--cyan)]',
  O2: 'bg-[color:var(--teal)]',
  MAX: 'bg-[color:var(--warn)]',
  REST: 'bg-[color:var(--text-mute)]',
} satisfies Record<TrainingCalendarEvent['dayType'], string>;

function markerClasses(event: TrainingCalendarEvent): string {
  const borderClass = markerBorderColor[event.dayType];
  const bgClass = event.status === 'completed' ? markerBgColor[event.dayType] : 'bg-transparent';
  return `rounded-full border ${borderClass} ${bgClass}`;
}

function monthCells(visibleMonth: number): number[] {
  const first = new Date(visibleMonth);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    addCalendarDays(visibleMonth, index - mondayOffset));
}

function formatMonthYear(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatMonthDay(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function MonthCalendar({
  visibleMonth,
  today,
  selectedDayKey,
  events,
  onSelectDay,
  onPreviousMonth,
  onNextMonth,
}: MonthCalendarProps) {
  const cells = monthCells(visibleMonth);
  const todayKey = localDateKey(today);
  const visibleMonthIndex = new Date(visibleMonth).getMonth();

  // Group events by dayKey for O(1) lookup per cell.
  const eventsByDay = new Map<string, TrainingCalendarEvent[]>();
  for (const event of events) {
    const list = eventsByDay.get(event.dayKey) ?? [];
    list.push(event);
    eventsByDay.set(event.dayKey, list);
  }

  // Split 42 cells into six rows of seven for valid ARIA grid row hierarchy.
  const weeks = Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <div>
      {/* Month navigation header */}
      <div className="flex items-center justify-between px-2 py-1">
        <button
          aria-label="Previous month"
          onClick={onPreviousMonth}
          className="rounded p-2 text-[color:var(--text-dim)] hover:text-[color:var(--text)]"
        >
          ‹
        </button>
        <span className="font-semibold text-[color:var(--text)]">
          {formatMonthYear(visibleMonth)}
        </span>
        <button
          aria-label="Next month"
          onClick={onNextMonth}
          className="rounded p-2 text-[color:var(--text-dim)] hover:text-[color:var(--text)]"
        >
          ›
        </button>
      </div>

      {/* Calendar grid — valid ARIA: grid > row > columnheader/gridcell */}
      <div role="grid">
        {/* Weekday column headers row */}
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              role="columnheader"
              className="py-1 text-center text-xs text-[color:var(--text-mute)]"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Six week rows — always exactly 42 gridcells total */}
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" className="grid grid-cols-7">
            {week.map((ts) => {
              const dayKey = localDateKey(ts);
              const dayEvents = eventsByDay.get(dayKey) ?? [];
              const isToday = dayKey === todayKey;
              const isSelected = dayKey === selectedDayKey;
              const isCurrentMonth = new Date(ts).getMonth() === visibleMonthIndex;

              // Build accessible label: date, then contextual tokens, then event summaries.
              const parts: string[] = [formatMonthDay(ts)];
              if (isToday) parts.push('today');
              if (isSelected) parts.push('selected');
              for (const e of dayEvents) {
                parts.push(`${typeLabel[e.dayType]} ${e.status}`);
              }
              const ariaLabel = parts.join(', ');

              return (
                <div key={dayKey} role="gridcell" aria-selected={isSelected}>
                  <button
                    aria-label={ariaLabel}
                    aria-pressed={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => onSelectDay(dayKey)}
                    className={[
                      'flex w-full flex-col items-center rounded py-1',
                      isCurrentMonth
                        ? 'text-[color:var(--text)]'
                        : 'text-[color:var(--text-mute)]',
                      isSelected ? 'bg-[color:var(--surface-2)]' : '',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-7 w-7 items-center justify-center rounded-full text-sm',
                        isToday
                          ? 'bg-[color:var(--cyan)] font-bold text-[#032430]'
                          : '',
                      ].join(' ')}
                    >
                      {new Date(ts).getDate()}
                    </span>

                    {/* Event markers */}
                    {dayEvents.length > 0 && (
                      <div className="mt-0.5 flex justify-center gap-0.5">
                        {dayEvents.map((e) => (
                          <span
                            key={e.id}
                            data-testid={e.status === 'completed' ? 'marker-completed' : 'marker-planned'}
                            className={`h-1.5 w-1.5 ${markerClasses(e)}`}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
