import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { BaselineScreen } from './BaselineScreen';
import { SetGoalScreen } from './SetGoalScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter>{children}</MemoryRouter>
      </AppProviders>
    </ServicesProvider>
  );
}

function renderBaselineFlow(state: AppState) {
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (_state: AppState) => {}),
  };
  render(
    <ServicesProvider value={{ repository }}>
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
});
