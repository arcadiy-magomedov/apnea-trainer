import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SummaryScreen } from './SummaryScreen';
import { makeSession } from '../../test/fixtures';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState, Session } from '../../domain/models/types';
import { FakeClock } from '../../test/fakeClock';
import { DAY_MS } from '../../domain/apnea/config';

function renderSummary({
  state = emptyAppState(),
  session = makeSession({ rpe: null }),
  now = 2_000,
  setState = vi.fn(async (_state: AppState) => {}),
}: {
  state?: AppState;
  session?: Session;
  now?: number;
  setState?: (state: AppState) => Promise<void>;
} = {}) {
  const repository = {
    getState: vi.fn(async () => state),
    setState,
  };
  render(
    <ServicesProvider value={{ repository, clock: new FakeClock(now) }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{
          pathname: '/summary',
          state: { session },
        }]}>
          <Routes>
            <Route path="/summary" element={<SummaryScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return setState;
}

describe('SummaryScreen', () => {
  it('requires one quality choice before persistence', async () => {
    const setState = renderSummary();
    expect(setState).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: /normal effort/i }),
    );

    await waitFor(() => expect(setState).toHaveBeenCalledOnce());
    expect(screen.getByText(/session quality/i)).toBeInTheDocument();
  });

  it('ignores repeated rating clicks while persistence is in flight', async () => {
    let release!: () => void;
    const setState = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    renderSummary({ setState });
    const rating = screen.getByRole('button', { name: /normal effort/i });
    await userEvent.dblClick(rating);
    expect(setState).toHaveBeenCalledOnce();
    release();
    await waitFor(() => expect(screen.getByText(/session quality/i)).toBeInTheDocument());
  });

  it('surfaces a persistence error and allows another rating attempt', async () => {
    const setState = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    renderSummary({ setState });
    await userEvent.click(
      screen.getByRole('button', { name: /normal effort/i }),
    );

    expect(await screen.findByText(/storage unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /normal effort/i }))
      .toBeEnabled();
  });

  it('does not offer another rating for an already saved session', async () => {
    const draft = makeSession({ id: 'saved-session', rpe: null });
    const state = emptyAppState();
    state.sessions = [{ ...draft, rpe: 'normal' }];

    renderSummary({
      setState: vi.fn(async (_state: AppState) => {}),
      state,
      session: draft,
    });

    expect(await screen.findByText(/session already saved/i))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /normal effort/i }))
      .not.toBeInTheDocument();
  });

  it('shows a due assessment as postponed immediately after rated work', async () => {
    const now = 15 * DAY_MS;
    const state = emptyAppState();
    state.baselines = [{
      id: 'baseline',
      maxHoldSec: 180,
      firstContractionSec: null,
      measuredAt: 0,
    }];
    state.courseState.lastMaxTestAt = 0;
    renderSummary({
      state,
      now,
      session: makeSession({ rpe: null, finishedAt: now }),
    });

    await userEvent.click(
      screen.getByRole('button', { name: /normal effort/i }),
    );
    expect(await screen.findByText(/postponed for recovery/i))
      .toBeInTheDocument();
  });
});
