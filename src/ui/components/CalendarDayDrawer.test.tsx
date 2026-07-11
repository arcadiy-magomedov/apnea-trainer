import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarDayDrawer } from './CalendarDayDrawer';
import type { TrainingCalendarEvent } from '../../application/calendar/trainingCalendar';

const co2Completed: TrainingCalendarEvent = {
  id: 'evt-co2-done',
  at: new Date(2026, 6, 9, 18, 0).getTime(),
  dayKey: '2026-07-09',
  dayType: 'CO2',
  status: 'completed',
  source: 'session',
  quality: 'clean',
  completedRounds: 8,
  plannedRounds: 8,
  tapOuts: 0,
  bestHoldSec: 92,
  difficultyLevel: 3,
  firstContractionSec: 50,
  adjustment: null,
  postponed: false,
};

const o2Planned: TrainingCalendarEvent = {
  id: 'evt-o2-plan',
  at: new Date(2026, 6, 9, 0, 0).getTime(),
  dayKey: '2026-07-09',
  dayType: 'O2',
  status: 'planned',
  source: 'projection',
  quality: null,
  completedRounds: null,
  plannedRounds: 8,
  tapOuts: null,
  bestHoldSec: 80,
  difficultyLevel: 2,
  firstContractionSec: null,
  adjustment: null,
  postponed: false,
};

describe('CalendarDayDrawer', () => {
  it('1. completed CO₂ event shows session label, status, quality, rounds, tap-outs, best hold, and first contraction', () => {
    render(<CalendarDayDrawer dayKey="2026-07-09" events={[co2Completed]} />);

    expect(screen.getByText(/CO₂ session/)).toBeInTheDocument();
    expect(screen.getByText(/Completed/)).toBeInTheDocument();
    expect(screen.getByText(/clean/i)).toBeInTheDocument();
    expect(screen.getByText(/8\/8 rounds/)).toBeInTheDocument();
    expect(screen.getByText(/0 tap-outs/)).toBeInTheDocument();
    expect(screen.getByText(/1:32 best hold/)).toBeInTheDocument();
    expect(screen.getByText(/0:50 first contraction/)).toBeInTheDocument();
  });

  it('2. multiple events on selected date produce two calendar-day-event blocks', () => {
    render(<CalendarDayDrawer dayKey="2026-07-09" events={[co2Completed, o2Planned]} />);

    const blocks = screen.getAllByTestId('calendar-day-event');
    expect(blocks).toHaveLength(2);
  });

  it('3. planned event shows Planned, level/rounds summary, and no tap-out metric', () => {
    render(<CalendarDayDrawer dayKey="2026-07-09" events={[o2Planned]} />);

    expect(screen.getByText(/Planned/)).toBeInTheDocument();
    expect(screen.getByText(/Level 2 · 8 rounds/)).toBeInTheDocument();
    expect(screen.queryByText(/tap-out/i)).not.toBeInTheDocument();
  });

  it('4. postponed REST/MAX projection uses status Postponed', () => {
    const postponedMax: TrainingCalendarEvent = {
      id: 'evt-max-postponed',
      at: new Date(2026, 6, 11, 0, 0).getTime(),
      dayKey: '2026-07-11',
      dayType: 'MAX',
      status: 'planned',
      source: 'projection',
      quality: null,
      completedRounds: null,
      plannedRounds: 3,
      tapOuts: null,
      bestHoldSec: 180,
      difficultyLevel: null,
      firstContractionSec: null,
      adjustment: null,
      postponed: true,
    };

    render(<CalendarDayDrawer dayKey="2026-07-11" events={[postponedMax]} />);

    expect(screen.getByText(/Postponed/)).toBeInTheDocument();
    expect(screen.queryByText(/Planned/)).not.toBeInTheDocument();
  });

  it('5. empty event list shows a compact no-training message', () => {
    render(<CalendarDayDrawer dayKey="2026-07-09" events={[]} />);

    expect(screen.getByText(/No training or assessment/)).toBeInTheDocument();
  });
});
