import { afterEach, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { RunnerScreen } from './RunnerScreen';
import { SummaryScreen } from './SummaryScreen';
import { noopCues, noopWakeLock } from '../../infrastructure/device/noopServices';
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
  cues?: typeof noopCues;
}

function renderRunner({
  plan = shortPlan,
  clock = new FakeClock(1_000),
  setState = vi.fn(async (_state: AppState) => {}),
  wakeLock = noopWakeLock,
  cues = noopCues,
}: RenderRunnerOptions = {}) {
  const repository = {
    getState: vi.fn(async () => emptyAppState()),
    setState,
  };

  render(
    <ServicesProvider value={{ clock, repository, wakeLock, cues }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{ pathname: '/runner', state: { plan, difficultyLevel: 0 } }]}>
          <Routes>
            <Route path="/runner" element={<RunnerScreen />} />
            <Route path="/summary" element={<SummaryScreen />} />
            <Route path="/" element={<div>home-root</div>} />
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
            <Route path="/" element={<div>home-root</div>} />
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

// The runner gates the session behind an explicit Start tap so the wake lock and
// audio are unlocked inside a user gesture (required by iOS).
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

it('acquires a wake lock only after the user taps Start', async () => {
  const acquire = vi.fn(async () => {});
  renderRunner({ wakeLock: { ...noopWakeLock, acquire } });
  expect(acquire).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
  });
  await waitFor(() => expect(acquire).toHaveBeenCalled());
  expect(screen.getByText(/breathe up/i)).toBeInTheDocument();
});

it('navigates with an unrated draft and persists only after Summary rating', async () => {
  vi.useFakeTimers();
  const setState = vi.fn(async () => {});
  renderRunner({ setState });

  await startSession();
  await advanceToHold();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /end hold/i }));
  });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i }))
    .toBeInTheDocument();
  expect(setState).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /normal effort/i }));
  });
  await flushAsyncWork();

  expect(setState).toHaveBeenCalledOnce();
});

it('records the first contraction time once and shows it during the hold', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(10_000);
  renderRunner({ clock });

  await startSession();
  await advanceToHold();
  clock.advance(30_000);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /contraction/i }));
  });
  clock.advance(10_000);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /contraction/i }));
  });

  expect(screen.getByText(/first contraction · 0:30/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /contraction · 2/i }))
    .toBeInTheDocument();
});

it('shows why recovery changed after two early-contraction rounds', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(10_000);
  const plan: SessionPlan = {
    type: 'CO2',
    rounds: [
      { index: 0, targetHoldSec: 60, restBeforeSec: 0 },
      { index: 1, targetHoldSec: 60, restBeforeSec: 45 },
      { index: 2, targetHoldSec: 60, restBeforeSec: 45 },
    ],
  };
  renderRunner({ plan, clock });

  await startSession();
  await advanceToHold();
  for (let round = 0; round < 2; round += 1) {
    clock.advance(20_000);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /contraction/i }));
    });
    clock.advance(40_000);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /end hold/i }));
    });
    await flushAsyncWork();
    if (round === 0) {
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /start next hold/i }),
        );
      });
      await flushAsyncWork();
    }
  }

  expect(screen.getByText(/recovery increased by 15s/i)).toBeInTheDocument();
  expect(screen.getByText('1:00')).toBeInTheDocument();
});

it('records a round once when End hold is tapped twice rapidly', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock(1_000);
  renderRunner({ plan: twoRoundPlan, clock });

  await startSession();
  await advanceToHold();
  clock.advance(60_000);
  await act(async () => {
    const endHold = screen.getByRole('button', { name: /end hold/i });
    fireEvent.click(endHold);
    fireEvent.click(endHold);
  });
  await flushAsyncWork();

  expect(screen.getByText(/^recover$/i)).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start next hold/i }));
  });
  clock.advance(60_000);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /end hold/i }));
  });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i }))
    .toBeInTheDocument();
  expect(screen.getByText('2/2')).toBeInTheDocument();
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
});

it('shows the tap-out control only during the hold, never during recover', async () => {
  vi.useFakeTimers();
  renderRunner({ plan: twoRoundPlan });

  await startSession();
  // Breathe-up: no tap-out yet.
  expect(screen.queryByRole('button', { name: /i tapped out/i })).not.toBeInTheDocument();

  await advanceToHold();
  // Hold: tap-out available.
  expect(screen.getByRole('button', { name: /i tapped out/i })).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /end hold/i })); });
  expect(screen.getByText(/^recover$/i)).toBeInTheDocument();

  // Recover: tap-out is gone; a clear "start next hold" control is shown instead.
  expect(screen.queryByRole('button', { name: /i tapped out/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /start next hold/i })).toBeInTheDocument();
});

it('eases the recover duration after tapping out a hold', async () => {
  vi.useFakeTimers();
  renderRunner({ plan: twoRoundPlan });

  await startSession();
  await advanceToHold();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /i tapped out/i })); });

  expect(screen.getByText(/^recover$/i)).toBeInTheDocument();
  expect(screen.getByText('1:00')).toBeInTheDocument();
  expect(screen.queryByText('0:45')).not.toBeInTheDocument();
});

it('redirects home when opened without a navigation plan', async () => {
  expect(() => renderRunnerWithoutNavigationState()).not.toThrow();
  await waitFor(() => expect(screen.getByText('home-root')).toBeInTheDocument());
});

it('auto-advances a prescribed hold to recovery when the target time elapses', async () => {
  vi.useFakeTimers();
  renderRunner({ plan: twoRoundPlan }); // round 0 target 60s

  await startSession();
  await advanceToHold();
  // Let the full prescribed 60s hold elapse.
  await act(async () => { vi.advanceTimersByTime(60_000); });
  await flushAsyncWork();

  expect(screen.getByText(/^recover$/i)).toBeInTheDocument();
});

it('beeps the 3-2-1 countdown and go signal leading into the hold', async () => {
  vi.useFakeTimers();
  const beep = vi.fn();
  renderRunner({ cues: { ...noopCues, beep } });

  await startSession();
  await advanceToHold(); // passes remaining 10, 3, 2, 1, 0 during breathe-up

  // warn(10) + three 3-2-1 ticks + go(0) = at least 4 beeps.
  expect(beep.mock.calls.length).toBeGreaterThanOrEqual(4);
});

it('lets the user cancel and leave the session at any time', async () => {
  vi.useFakeTimers();
  renderRunner();

  await startSession();
  await advanceToHold();
  expect(screen.getByRole('button', { name: /cancel session/i })).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /cancel session/i })); });

  expect(screen.getByText('home-root')).toBeInTheDocument();
});
