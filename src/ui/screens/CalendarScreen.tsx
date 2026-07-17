import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { MonthCalendar } from '../design-system/MonthCalendar';
import { Button } from '../design-system/Button';
import { CalendarDayDrawer } from '../components/CalendarDayDrawer';
import { completedCalendarEvents, plannedCalendarEvents } from '../../application/calendar/trainingCalendar';
import { addCalendarMonths, localDateKey, startOfDay, startOfLocalMonth } from '../../domain/apnea/time';
import { dayRelation } from '../../application/analytics/events';
import { AdOpportunityProbe } from '../analytics/AdOpportunityProbe';

export function CalendarScreen() {
  const navigate = useNavigate();
  const { analytics, clock } = useServices();
  const state = useAppStore((store) => store.state);
  const hydrated = useAppStore((store) => store.hydrated);
  const now = startOfDay(clock.now());

  const [visibleMonth, setVisibleMonth] = useState(() => startOfLocalMonth(now));
  const [selectedDayKey, setSelectedDayKey] = useState(() => localDateKey(now));

  const events = useMemo(
    () => [...completedCalendarEvents(state), ...plannedCalendarEvents(state, now)],
    [state, now],
  );

  if (!hydrated) return null;

  const selectedEvents = events.filter((event) => event.dayKey === selectedDayKey);
  const hasBaseline = state.baselines.length > 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 1. Heading */}
      <h2 className="text-xl font-bold text-[color:var(--text)]">Calendar</h2>

      {/* 2. Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-[color:var(--text-dim)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--cyan)]" />
          Completed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border border-[color:var(--cyan)] bg-transparent" />
          Planned
        </span>
        <span className="flex items-center gap-1">
          <span
            data-testid="legend-co2"
            className="inline-block h-2 w-2 rounded-full bg-[color:var(--cyan)]"
          />
          CO₂
        </span>
        <span className="flex items-center gap-1">
          <span
            data-testid="legend-o2"
            className="inline-block h-2 w-2 rounded-full bg-[color:var(--teal)]"
          />
          O₂
        </span>
        <span className="flex items-center gap-1">
          <span
            data-testid="legend-max"
            className="inline-block h-2 w-2 rounded-full bg-[color:var(--warn)]"
          />
          MAX
        </span>
        <span className="flex items-center gap-1">
          <span
            data-testid="legend-rest"
            className="inline-block h-2 w-2 rounded-full bg-[color:var(--text-mute)]"
          />
          REST
        </span>
      </div>

      {/* 3. MonthCalendar */}
      <MonthCalendar
        visibleMonth={visibleMonth}
        today={now}
        selectedDayKey={selectedDayKey}
        events={events}
        onSelectDay={(dayKey) => {
          setSelectedDayKey(dayKey);
          analytics.track({
            name: 'calendar_day_opened',
            dayRelation: dayRelation(dayKey, localDateKey(now)),
          });
        }}
        onPreviousMonth={() => setVisibleMonth((m) => addCalendarMonths(m, -1))}
        onNextMonth={() => setVisibleMonth((m) => addCalendarMonths(m, 1))}
      />

      {/* 4. Provisional plan text */}
      {hasBaseline && (
        <p className="text-sm text-[color:var(--text-dim)]">Provisional plan · 6 weeks</p>
      )}

      {/* 5. Baseline guidance CTA */}
      {!hasBaseline && (
        <Button variant="ghost" onClick={() => navigate('/baseline')}>
          Measure a baseline to create your plan
        </Button>
      )}

      {/* 6. Day drawer */}
      <AdOpportunityProbe placement="calendar_inline" surface="calendar" />
      <CalendarDayDrawer dayKey={selectedDayKey} events={selectedEvents} />
    </div>
  );
}
