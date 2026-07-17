import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { BaselineScreen } from './BaselineScreen';
import { SetGoalScreen } from './SetGoalScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';
import { FakeAnalyticsService } from '../../test/fakeAnalytics';

function Wrapper({ children }: { children: React.ReactNode }) {
  const analytics = new FakeAnalyticsService();
  return (
    <ServicesProvider value={{ analytics }}>
      <AppProviders>
        <MemoryRouter>{children}</MemoryRouter>
      </AppProviders>
    </ServicesProvider>
  );
}

function renderBaselineFlow(
  state: AppState,
  analytics = new FakeAnalyticsService(),
  setState = vi.fn(async (_state: AppState) => {}),
) {
  const repository = {
    getState: vi.fn(async () => state),
    setState,
  };
  const view = render(
    <ServicesProvider value={{ repository, analytics }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/baseline']}>
          <Routes>
            <Route path="/baseline" element={<BaselineScreen />} />
            <Route path="/goal" element={<SetGoalScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return { ...view, analytics, repository };
}

async function saveOneSecondBaseline() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /start hold/i }));
  act(() => { vi.advanceTimersByTime(1_000); });
  await user.click(screen.getByRole('button', { name: /stop/i }));
  await user.click(screen.getByRole('button', { name: /save baseline/i }));
}

describe('BaselineScreen', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('counts up while holding and records an attempt on stop', async () => {
    const user = userEvent.setup();
    render(<Wrapper><BaselineScreen /></Wrapper>);
    await user.click(await screen.findByRole('button', { name: /start hold/i }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/0:0[23]/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(screen.getByText(/attempt 1/i)).toBeInTheDocument();
  });

  it('hides baseline controls until persisted state is hydrated', async () => {
    let release!: (state: AppState) => void;
    const repository = {
      getState: vi.fn(() => new Promise<AppState>((resolve) => {
        release = resolve;
      })),
      setState: vi.fn(async (_state: AppState) => {}),
    };
    render(
      <ServicesProvider value={{ repository }}>
        <AppProviders>
          <MemoryRouter><BaselineScreen /></MemoryRouter>
        </AppProviders>
      </ServicesProvider>,
    );

    expect(screen.queryByRole('button', { name: /start hold/i }))
      .not.toBeInTheDocument();
    await act(async () => {
      release(emptyAppState());
    });
    expect(await screen.findByRole('button', { name: /start hold/i }))
      .toBeInTheDocument();
  });

  it('offers the optional goal step after the first baseline', async () => {
    renderBaselineFlow(emptyAppState());
    await saveOneSecondBaseline();
    expect(await screen.findByRole('heading', { name: /set your goal/i }))
      .toBeInTheDocument();
  });

  it('returns home after a later baseline assessment', async () => {
    const state = emptyAppState();
    state.baselines = [{
      id: 'existing',
      maxHoldSec: 180,
      firstContractionSec: null,
      measuredAt: 1,
    }];
    renderBaselineFlow(state);
    await screen.findByRole('button', { name: /start hold/i });
    await saveOneSecondBaseline();
    expect(await screen.findByText('home-root')).toBeInTheDocument();
  });

  it('tracks baseline start and completion exactly once without values', async () => {
    const analytics = new FakeAnalyticsService();
    renderBaselineFlow(emptyAppState(), analytics);

    await saveOneSecondBaseline();

    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_completed' },
    ]);
  });

  it('tracks abandonment after an attempt starts but is not saved', async () => {
    const analytics = new FakeAnalyticsService();
    const view = renderBaselineFlow(emptyAppState(), analytics);

    await userEvent.click(
      await screen.findByRole('button', { name: /start hold/i }),
    );
    view.unmount();

    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_abandoned' },
    ]);
  });

  it('does not complete a failed save and abandons on later unmount', async () => {
    const analytics = new FakeAnalyticsService();
    const setState = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const view = renderBaselineFlow(emptyAppState(), analytics, setState);

    await saveOneSecondBaseline();
    await waitFor(() => expect(setState).toHaveBeenCalledOnce());
    expect(analytics.events).toEqual([{ name: 'baseline_started' }]);
    expect(screen.queryByRole('heading', { name: /set your goal/i }))
      .not.toBeInTheDocument();

    view.unmount();
    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_abandoned' },
    ]);
  });

  it('does not duplicate baseline start across repeated attempt controls', async () => {
    const analytics = new FakeAnalyticsService();
    renderBaselineFlow(emptyAppState(), analytics);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /start hold/i }));
    await user.click(screen.getByRole('button', { name: /stop/i }));
    await user.click(screen.getByRole('button', { name: /start hold/i }));

    expect(analytics.events).toEqual([{ name: 'baseline_started' }]);
  });

  it('does not abandon a baseline before an attempt starts', async () => {
    const analytics = new FakeAnalyticsService();
    const view = renderBaselineFlow(emptyAppState(), analytics);

    await screen.findByRole('button', { name: /start hold/i });
    view.unmount();

    expect(analytics.events).toEqual([]);
  });

  it('completes and navigates only after baseline persistence succeeds', async () => {
    let persist!: () => void;
    const setState = vi.fn(() => new Promise<void>((resolve) => {
      persist = resolve;
    }));
    const analytics = new FakeAnalyticsService();
    renderBaselineFlow(emptyAppState(), analytics, setState);

    await saveOneSecondBaseline();
    expect(analytics.events).toEqual([{ name: 'baseline_started' }]);
    expect(screen.queryByRole('heading', { name: /set your goal/i }))
      .not.toBeInTheDocument();

    persist();
    expect(await screen.findByRole('heading', { name: /set your goal/i }))
      .toBeInTheDocument();
    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_completed' },
    ]);
  });

  it('does not duplicate completion while a baseline save is in flight', async () => {
    const resolvers: Array<() => void> = [];
    const setState = vi.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    const analytics = new FakeAnalyticsService();
    renderBaselineFlow(emptyAppState(), analytics, setState);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /start hold/i }));
    await user.click(screen.getByRole('button', { name: /stop/i }));
    const save = screen.getByRole('button', { name: /save baseline/i });
    await user.click(save);
    await user.click(save);

    expect(setState).toHaveBeenCalledOnce();
    resolvers[0]();
    await waitFor(() => expect(analytics.events).toContainEqual({
      name: 'baseline_completed',
    }));
    await Promise.resolve();

    expect(setState).toHaveBeenCalledOnce();
    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_completed' },
    ]);
  });

  it('stays abandoned when unmounted before an in-flight save succeeds', async () => {
    let persist!: () => void;
    const setState = vi.fn(() => new Promise<void>((resolve) => {
      persist = resolve;
    }));
    const analytics = new FakeAnalyticsService();
    const view = renderBaselineFlow(emptyAppState(), analytics, setState);

    await saveOneSecondBaseline();
    view.unmount();
    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_abandoned' },
    ]);

    await act(async () => {
      persist();
    });
    expect(analytics.events).toEqual([
      { name: 'baseline_started' },
      { name: 'baseline_abandoned' },
    ]);
  });
});
