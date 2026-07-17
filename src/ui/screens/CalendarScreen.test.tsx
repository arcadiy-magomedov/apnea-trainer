import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { CalendarScreen } from './CalendarScreen';
import { emptyAppState } from '../../domain/models/appState';
import { FakeClock } from '../../test/fakeClock';
import { makeRound, makeSession } from '../../test/fixtures';
import type { AppState } from '../../domain/models/types';
import { FakeAnalyticsService } from '../../test/fakeAnalytics';

const D = (iso: string) => new Date(iso).getTime();

function renderCalendar(
  state: AppState,
  now: number,
  analytics = new FakeAnalyticsService(),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_s: AppState) => {}),
  };
  render(
    <ServicesProvider value={{
      analytics,
      clock: new FakeClock(now),
      repository,
    }}>
      <AppProviders>
        <MemoryRouter><CalendarScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

function stateWithBaselineAndSession(): AppState {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b1',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: D('2026-07-01T10:00:00'),
  }];
  state.sessions = [makeSession({
    id: 's1',
    type: 'CO2',
    rounds: Array.from({ length: 8 }, (_, i) => makeRound({
      index: i,
      targetHoldSec: 110,
      achievedHoldSec: 110,
      firstContractionSec: i === 7 ? 70 : null,
    })),
    startedAt: D('2026-07-09T10:00:00'),
    finishedAt: D('2026-07-09T10:20:00'),
    rpe: 'normal',
    difficultyLevel: 3,
  })];
  state.courseState.lastTrainedAt = D('2026-07-09T10:20:00');
  state.courseState.lastAdvanceAt = D('2026-07-09T00:00:00');
  return state;
}

describe('CalendarScreen', () => {
  it('1. renders heading, provisional plan text, completed and planned markers', async () => {
    const state = stateWithBaselineAndSession();
    renderCalendar(state, D('2026-07-10T10:00:00'));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Calendar/i })).toBeInTheDocument(),
    );
    expect(
      document.querySelector('[data-ad-opportunity="calendar_inline"]'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Provisional plan · 6 weeks/)).toBeInTheDocument();
    expect(screen.getAllByTestId('marker-completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('marker-planned').length).toBeGreaterThanOrEqual(1);
  });

  it('2. clicking a completed date opens drawer showing CO₂ session and clean quality', async () => {
    const state = stateWithBaselineAndSession();
    renderCalendar(state, D('2026-07-10T10:00:00'));

    // Wait for hydration (markers appear once state loads)
    await waitFor(() =>
      expect(screen.getAllByTestId('marker-completed').length).toBeGreaterThanOrEqual(1),
    );

    const dayButton = screen.getByRole('button', { name: /July 9.*CO₂/i });
    await userEvent.click(dayButton);

    await waitFor(() => {
      expect(screen.getByText(/CO₂ session/)).toBeInTheDocument();
      expect(screen.getByText(/clean/i)).toBeInTheDocument();
    });
  });

  it('3. empty state shows baseline guidance and no planned markers', async () => {
    renderCalendar(emptyAppState(), D('2026-07-10T10:00:00'));

    await waitFor(() =>
      expect(screen.getByText(/Measure a baseline to create your plan/)).toBeInTheDocument(),
    );
    expect(screen.queryAllByTestId('marker-planned')).toHaveLength(0);
  });

  it('4. clicking next month updates the displayed month heading', async () => {
    const state = stateWithBaselineAndSession();
    renderCalendar(state, D('2026-07-10T10:00:00'));

    await waitFor(() =>
      expect(screen.getByText(/July 2026/)).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();
  });

  it('5. hides all content before repository hydration resolves, shows heading and CTA after', async () => {
    let release!: (state: AppState) => void;
    const repository = {
      getState: vi.fn(() => new Promise<AppState>((resolve) => {
        release = resolve;
      })),
      setState: vi.fn(async (_s: AppState) => {}),
    };
    render(
      <ServicesProvider value={{ clock: new FakeClock(D('2026-07-10T10:00:00')), repository }}>
        <AppProviders>
          <MemoryRouter><CalendarScreen /></MemoryRouter>
        </AppProviders>
      </ServicesProvider>,
    );

    expect(screen.queryByRole('heading', { name: /Calendar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Measure a baseline to create your plan/)).not.toBeInTheDocument();

    await act(async () => {
      release(emptyAppState());
    });

    expect(screen.getByRole('heading', { name: /Calendar/i })).toBeInTheDocument();
    expect(screen.getByText(/Measure a baseline to create your plan/)).toBeInTheDocument();
  });

  it('6. type legend has a visible color indicator for each semantic type', async () => {
    renderCalendar(stateWithBaselineAndSession(), D('2026-07-10T10:00:00'));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Calendar/i })).toBeInTheDocument(),
    );

    const co2 = screen.getByTestId('legend-co2');
    const o2 = screen.getByTestId('legend-o2');
    const max = screen.getByTestId('legend-max');
    const rest = screen.getByTestId('legend-rest');

    expect(co2.className).toContain('var(--cyan)');
    expect(o2.className).toContain('var(--teal)');
    expect(max.className).toContain('var(--warn)');
    expect(rest.className).toContain('var(--text-mute)');
  });

  it('tracks one coarse relation event per selected day only', async () => {
    const analytics = new FakeAnalyticsService();
    renderCalendar(
      stateWithBaselineAndSession(),
      D('2026-07-10T10:00:00'),
      analytics,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId('marker-completed').length).toBeGreaterThanOrEqual(1),
    );
    expect(analytics.events).toEqual([]);

    await userEvent.click(
      screen.getByRole('button', { name: /July 9.*CO₂/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /July 10.*today/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /July 11/i }),
    );

    expect(analytics.events).toEqual([
      { name: 'calendar_day_opened', dayRelation: 'past' },
      { name: 'calendar_day_opened', dayRelation: 'today' },
      { name: 'calendar_day_opened', dayRelation: 'future' },
    ]);
    expect(JSON.stringify(analytics.events)).not.toMatch(
      /2026|07-0|07-1|dayKey|sessionId|"s1"|CO2/i,
    );
  });
});
