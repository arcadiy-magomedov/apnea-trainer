import { afterEach, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { RunnerScreen } from './RunnerScreen';
import { SummaryScreen } from './SummaryScreen';
import { noopWakeLock } from '../../infrastructure/device/noopServices';
import { emptyAppState } from '../../domain/models/appState';
import type { SessionPlan } from '../../domain/models/types';
import { FakeClock } from '../../test/fakeClock';

const shortPlan: SessionPlan = {
  type: 'CO2',
  rounds: [{ index: 0, targetHoldSec: 60, restBeforeSec: 0 }],
};

function renderRunner({
  plan = shortPlan,
  clock = new FakeClock(1_000),
  setState = vi.fn(async () => {}),
  wakeLock = noopWakeLock,
} = {}) {
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

async function advanceToHold() {
  await act(async () => { vi.advanceTimersByTime(120_000); });
  expect(screen.getByText(/^hold$/i)).toBeInTheDocument();
}

async function flushAsyncWork() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('acquires a wake lock when the runner mounts', async () => {
  const acquire = vi.fn(async () => {});
  renderRunner({ wakeLock: { ...noopWakeLock, acquire } });
  await waitFor(() => expect(acquire).toHaveBeenCalled());
  expect(screen.getByText(/breathe up/i)).toBeInTheDocument();
});

it('persists once and navigates to summary when the final hold ends without a render loop', async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const setState = vi.fn(async () => {});
  renderRunner({ setState });

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

  await advanceToHold();
  clock.advance(40_000);
  await act(async () => { vi.advanceTimersByTime(40_000); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /end hold/i })); });
  await flushAsyncWork();

  expect(screen.getByRole('heading', { name: /session complete/i })).toBeInTheDocument();
  expect(screen.getByText('0:40')).toBeInTheDocument();
  expect(screen.queryByText('1:00')).not.toBeInTheDocument();
});
