import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';

it('toggles voice cues and persists', async () => {
  render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter><SettingsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  const toggle = await screen.findByRole('checkbox', { name: /voice cues/i });
  expect(toggle).toBeChecked();
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
});

it('clears an active goal', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 1,
  }];
  state.goal = {
    id: 'g',
    targetHoldSec: 240,
    createdAt: 1,
    startMaxSec: 180,
    achievedAt: null,
  };
  const saved: AppState[] = [];
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (next: AppState) => { saved.push(next); }),
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter><SettingsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );

  await userEvent.click(
    await screen.findByRole('button', { name: /clear goal/i }),
  );
  await waitFor(() => expect(saved.at(-1)?.goal).toBeNull());
});

it('reports clear-goal persistence failures and prevents duplicate writes', async () => {
  const state = emptyAppState();
  state.baselines = [{
    id: 'b',
    maxHoldSec: 180,
    firstContractionSec: null,
    measuredAt: 1,
  }];
  state.goal = {
    id: 'g',
    targetHoldSec: 240,
    createdAt: 1,
    startMaxSec: 180,
    achievedAt: null,
  };
  let rejectWrite: ((error: Error) => void) | undefined;
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    })),
  };
  render(
    <ServicesProvider value={{ repository }}>
      <AppProviders>
        <MemoryRouter><SettingsScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );

  const clearButton = await screen.findByRole('button', { name: /clear goal/i });
  await userEvent.click(clearButton);
  expect(clearButton).toBeDisabled();

  await userEvent.click(clearButton);
  expect(repository.setState).toHaveBeenCalledTimes(1);

  rejectWrite?.(new Error('storage unavailable'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/storage unavailable/i);
  expect(clearButton).toBeEnabled();
  expect(screen.getByText(/target: 4:00/i)).toBeInTheDocument();
});
