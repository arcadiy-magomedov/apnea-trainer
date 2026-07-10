import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SetGoalScreen } from './SetGoalScreen';
import { makeBaseline, makeState } from '../../test/fixtures';
import type { AppState } from '../../domain/models/types';

function renderGoal(state = makeState({
  baselines: [makeBaseline({ maxHoldSec: 180 })],
}), setState = vi.fn(async (_state: AppState) => {})) {
  const repository = {
    getState: vi.fn(async () => state),
    setState,
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/goal']}>
          <Routes>
            <Route path="/goal" element={<SetGoalScreen />} />
            <Route path="/" element={<div>home-root</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return setState;
}

it('saves a valid mm:ss goal', async () => {
  const setState = renderGoal();
  await userEvent.type(await screen.findByLabelText(/target hold/i), '4:00');
  await userEvent.click(screen.getByRole('button', { name: /save goal/i }));

  await waitFor(() => expect(setState).toHaveBeenCalledOnce());
});

it('shows a soft warning above twice the current max', async () => {
  renderGoal();
  await userEvent.type(await screen.findByLabelText(/target hold/i), '7:00');
  expect(screen.getByText(/ambitious target/i)).toBeInTheDocument();
  expect(screen.getByText(/proposed improvement: 4:00/i)).toBeInTheDocument();
});

it('rejects malformed duration input with an explicit message', async () => {
  renderGoal();
  await userEvent.type(await screen.findByLabelText(/target hold/i), '4:75');
  expect(screen.getByText(/use minutes:seconds/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /save goal/i })).toBeDisabled();
});

it('allows the optional post-baseline step to be skipped', async () => {
  renderGoal();
  await userEvent.click(
    await screen.findByRole('button', { name: /skip for now/i }),
  );
  expect(screen.getByText('home-root')).toBeInTheDocument();
});

it('prefills an active goal for editing after hydration', async () => {
  const state = makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
    goal: {
      id: 'goal-1',
      targetHoldSec: 240,
      createdAt: 1,
      startMaxSec: 180,
      achievedAt: null,
    },
  });
  renderGoal(state);
  expect(await screen.findByRole('heading', { name: /edit goal/i }))
    .toBeInTheDocument();
  expect(screen.getByLabelText(/target hold/i)).toHaveValue('4:00');
});

it('surfaces a goal persistence failure without navigating away', async () => {
  const setState = vi.fn(async () => {
    throw new Error('storage unavailable');
  });
  renderGoal(makeState({
    baselines: [makeBaseline({ maxHoldSec: 180 })],
  }), setState);
  await userEvent.type(await screen.findByLabelText(/target hold/i), '4:00');
  await userEvent.click(screen.getByRole('button', { name: /save goal/i }));

  expect(await screen.findByText(/storage unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText('home-root')).not.toBeInTheDocument();
});
