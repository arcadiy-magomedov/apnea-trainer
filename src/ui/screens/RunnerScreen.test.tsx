import { afterEach, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { RunnerScreen } from './RunnerScreen';
import { SummaryScreen } from './SummaryScreen';
import { TrainScreen } from './TrainScreen';
import { noopWakeLock } from '../../infrastructure/device/noopServices';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState, SessionPlan } from '../../domain/models/types';
import { FakeClock } from '../../test/fakeClock';

const shortPlan: SessionPlan = {
  type: 'CO2',
  rounds: [{ index: 0, targetHoldSec: 60, restBeforeSec: 0 }],
};

const twoRoundPlan: SessionPlan = {
  type: 'CO2',
  rounds: [
    { index: 0, targetHoldSec: 60, restBeforeSec: 0 },
    { index: 1, targetHoldSec: 60, restBeforeSec: 45 },
  ],
};

interface RenderRunnerOptions {
  plan?: SessionPlan;
  clock?: FakeClock;
  setState?: (state: AppState) => Promise<void>;
  wakeLock?: typeof noopWakeLock;
}

function renderRunner({
  plan = shortPlan,
  clock = new FakeClock(1_000),
  setState = vi.fn(async (_state: AppState) => {}),
  wakeLock = noopWakeLock,
}: RenderRunnerOptions = {}) {
  const repository = {
    getState: vi.fn(async () => emptyAppState()),
    setState,
  };

  render(
    <ServicesProvider value={{ clock, repository, wakeLock }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{ pathname: '/runner', state: { plan, difficultyLevel: 0 } }]}>
          <Routes>
            <Route path="/runner" element={<RunnerScreen />} />
            <Route path="/summary" element={<SummaryScreen />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );

  return { clock, repository, setState };
}

function renderRunnerWithoutNavigationState() {
  const repository = {
    getState: vi.fn(async () => emptyAppState()),
    setState: vi.fn(async (_state: AppState) => {}),
  };

  render(
    <ServicesProvider value={{ repository, wakeLock: noopWakeLock }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/runner']}>
          <Routes>
            <Route path="/runner" element={<RunnerScreen />} />
            <Route path="/train" element={<TrainScreen />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

async function flushAsyncWork() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// The runner gates the session behind an explicit Start tap so the wake lock is
// acquired inside a user gesture (required by iOS).
async function startSession() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
  });
  await flushAsyncWork();
}

async function advanceToHold() {
  await act(async () => { vi.advanceTimersByTime(120_000); });
  expect(screen.getByText(/^hold$/i)).toBeInTheDocument();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('acquires a wake lock when the session starts (from a user gesture)', async () => {
  const acquire = vi.fn(async () => {});
  renderRunner({ wakeLock: { ...noopWakeLock, acquire } });
  // Not acquired on mount — only after the user taps Start.
  expect(acquire).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
  });
  await waitFor(() => expect(acquire).toHaveBeenCalled());
  expect(screen.getByText(/breathe up/i)).toBeInTheDocument();
});

it('persists once and navigates to summary when the final hold ends without a render loop', async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const setState = vi.fn(async () => {});
  renderRunner({ setState });

  await startSession();
  await advanceToHold();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /end hold/i })); });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i })).toBeInTheDocument();
  expect(setState).toHaveBeenCalledOnce();
  expect(consoleError.mock.calls.flat().join('\n')).not.toContain('Maximum update depth exceeded');
});

it('records the actual hold duration instead of the target hold duration', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(10_000);
  renderRunner({ clock });

  await startSession();
  await advanceToHold();
  clock.advance(40_000);
  await act(async () => { vi.advanceTimersByTime(40_000); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /end hold/i })); });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i })).toBeInTheDocument();
  expect(screen.getByText('0:40')).toBeInTheDocument();
  expect(screen.queryByText('1:00')).not.toBeInTheDocument();
});

it('records zero achieved hold when tapping out during recover before the next hold starts', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(10_000);
  const savedStates: AppState[] = [];
  const setState = vi.fn(async (state: AppState) => { savedStates.push(state); });
  renderRunner({ plan: twoRoundPlan, clock, setState });

  await startSession();
  await advanceToHold();
  clock.advance(60_000);
  await act(async () => { vi.advanceTimersByTime(60_000); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /end hold/i })); });
  expect(screen.getByText(/^recover$/i)).toBeInTheDocument();

  clock.advance(30_000);
  await act(async () => { vi.advanceTimersByTime(30_000); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /i tapped out/i })); });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i })).toBeInTheDocument();
  expect(setState).toHaveBeenCalledOnce();
  const savedState = savedStates[0];
  expect(savedState.sessions[0]?.rounds[1]).toMatchObject({
    achievedHoldSec: 0,
    tappedOut: true,
  });
  expect(screen.getByText('1:00')).toBeInTheDocument();
  expect(screen.queryByText('1:30')).not.toBeInTheDocument();
});

it('uses the eased recover duration after tapping out a hold', async () => {
  vi.useFakeTimers();
  renderRunner({ plan: twoRoundPlan });

  await startSession();
  await advanceToHold();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /i tapped out/i })); });

  expect(screen.getByText(/^recover$/i)).toBeInTheDocument();
  expect(screen.getByText('1:00')).toBeInTheDocument();
  expect(screen.queryByText('0:45')).not.toBeInTheDocument();
});

it('redirects to train when opened without a navigation plan', async () => {
  expect(() => renderRunnerWithoutNavigationState()).not.toThrow();

  await waitFor(() => expect(screen.getByRole('heading', { name: /train/i })).toBeInTheDocument());
});
