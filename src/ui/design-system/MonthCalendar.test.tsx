import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthCalendar } from './MonthCalendar';
import type { TrainingCalendarEvent } from '../../application/calendar/trainingCalendar';

const JULY_2026 = new Date(2026, 6, 1).getTime();
const TODAY = new Date(2026, 6, 10).getTime();
const SELECTED_DAY_KEY = '2026-07-10';

const co2CompletedEvent: TrainingCalendarEvent = {
  id: 'evt-co2',
  at: TODAY,
  dayKey: '2026-07-10',
  dayType: 'CO2',
  status: 'completed',
  source: 'session',
  quality: 'clean',
  completedRounds: 8,
  plannedRounds: 8,
  tapOuts: 0,
  bestHoldSec: 90,
  difficultyLevel: 3,
  firstContractionSec: 50,
  adjustment: null,
  postponed: false,
};

const o2PlannedEvent: TrainingCalendarEvent = {
  id: 'evt-o2-planned',
  at: new Date(2026, 6, 12).getTime(),
  dayKey: '2026-07-12',
  dayType: 'O2',
  status: 'planned',
  source: 'projection',
  quality: null,
  completedRounds: null,
  plannedRounds: 6,
  tapOuts: null,
  bestHoldSec: 80,
  difficultyLevel: 2,
  firstContractionSec: null,
  adjustment: null,
  postponed: false,
};

function renderCalendar(overrides: Partial<Parameters<typeof MonthCalendar>[0]> = {}) {
  const onSelectDay = vi.fn();
  const onPreviousMonth = vi.fn();
  const onNextMonth = vi.fn();
  render(
    <MonthCalendar
      visibleMonth={JULY_2026}
      today={TODAY}
      selectedDayKey={SELECTED_DAY_KEY}
      events={[co2CompletedEvent, o2PlannedEvent]}
      onSelectDay={onSelectDay}
      onPreviousMonth={onPreviousMonth}
      onNextMonth={onNextMonth}
      {...overrides}
    />,
  );
  return { onSelectDay, onPreviousMonth, onNextMonth };
}

describe('MonthCalendar', () => {
  it('1. fixed six-week grid has exactly 42 gridcells', () => {
    renderCalendar();
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('2. today button has accessible name containing "July 10" and "today"', () => {
    renderCalendar();
    const todayBtn = screen.getByRole('button', { name: /July 10.*today|today.*July 10/i });
    expect(todayBtn).toBeInTheDocument();
  });

  it('3. completed CO2 event renders marker-completed with filled cyan class', () => {
    renderCalendar();
    const marker = screen.getByTestId('marker-completed');
    expect(marker).toBeInTheDocument();
    expect(marker.className).toContain('bg-[color:var(--cyan)]');
  });

  it('4. planned O2 event renders marker-planned with border and transparent bg', () => {
    renderCalendar();
    const marker = screen.getByTestId('marker-planned');
    expect(marker).toBeInTheDocument();
    expect(marker.className).toContain('border');
    expect(marker.className).toContain('bg-transparent');
  });

  it('5. clicking July 15 calls onSelectDay("2026-07-15")', async () => {
    const { onSelectDay } = renderCalendar();
    await userEvent.click(screen.getByRole('button', { name: /July 15/i }));
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-15');
  });

  it('6. previous/next controls have accessible names; clicking next calls callback', async () => {
    const { onNextMonth } = renderCalendar();
    const prevBtn = screen.getByRole('button', { name: /previous month/i });
    const nextBtn = screen.getByRole('button', { name: /next month/i });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();
    await userEvent.click(nextBtn);
    expect(onNextMonth).toHaveBeenCalledOnce();
  });

  it('7. selected day has aria-pressed="true"', () => {
    renderCalendar();
    const selectedBtn = screen.getByRole('button', { name: /July 10.*selected|selected.*July 10/i });
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('8. grid has 1 header row + 6 week rows = 7 total role="row" elements', () => {
    renderCalendar();
    expect(screen.getAllByRole('row')).toHaveLength(7);
  });

  it('9. selected gridcell has aria-selected="true"; non-selected gridcell has aria-selected="false"', () => {
    renderCalendar();
    const gridcells = screen.getAllByRole('gridcell');
    const selectedCell = gridcells.find(
      (cell) => cell.querySelector('[aria-pressed="true"]') !== null,
    );
    expect(selectedCell).toHaveAttribute('aria-selected', 'true');

    const nonSelectedCell = gridcells.find(
      (cell) => cell.querySelector('[aria-pressed="false"]') !== null,
    );
    expect(nonSelectedCell).toHaveAttribute('aria-selected', 'false');
  });

  it('10. today\'s button has aria-current="date"; another day\'s button does not', () => {
    renderCalendar();
    const todayBtn = screen.getByRole('button', { name: /July 10.*today|today.*July 10/i });
    expect(todayBtn).toHaveAttribute('aria-current', 'date');

    const otherBtn = screen.getByRole('button', { name: /July 15/i });
    expect(otherBtn).not.toHaveAttribute('aria-current');
  });

  it('11. same-day multi-event: both markers and both event summaries in aria-label', () => {
    const sameDayTs = new Date(2026, 6, 20).getTime();
    const sameDayKey = '2026-07-20';

    const co2Completed: TrainingCalendarEvent = {
      id: 'evt-same-1',
      at: sameDayTs,
      dayKey: sameDayKey,
      dayType: 'CO2',
      status: 'completed',
      source: 'session',
      quality: 'clean',
      completedRounds: 6,
      plannedRounds: 6,
      tapOuts: 0,
      bestHoldSec: 85,
      difficultyLevel: 2,
      firstContractionSec: 45,
      adjustment: null,
      postponed: false,
    };

    const restPlanned: TrainingCalendarEvent = {
      id: 'evt-same-2',
      at: sameDayTs,
      dayKey: sameDayKey,
      dayType: 'REST',
      status: 'planned',
      source: 'projection',
      quality: null,
      completedRounds: null,
      plannedRounds: null,
      tapOuts: null,
      bestHoldSec: null,
      difficultyLevel: null,
      firstContractionSec: null,
      adjustment: null,
      postponed: false,
    };

    renderCalendar({ events: [co2Completed, restPlanned] });

    // Both marker dots present
    expect(screen.getByTestId('marker-completed')).toBeInTheDocument();
    expect(screen.getByTestId('marker-planned')).toBeInTheDocument();

    // Aria-label on the July 20 button includes both event summaries
    const dayBtn = screen.getByRole('button', { name: /July 20/i });
    expect(dayBtn).toHaveAccessibleName(/CO₂.*completed/i);
    expect(dayBtn).toHaveAccessibleName(/REST.*planned/i);
  });
});
