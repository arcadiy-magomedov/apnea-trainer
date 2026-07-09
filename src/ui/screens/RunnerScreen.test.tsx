import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { RunnerScreen } from './RunnerScreen';
import { noopWakeLock } from '../../infrastructure/device/noopServices';

it('acquires a wake lock when the runner mounts', async () => {
  const acquire = vi.fn(async () => {});
  render(
    <ServicesProvider value={{ wakeLock: { ...noopWakeLock, acquire } }}>
      <AppProviders>
        <MemoryRouter initialEntries={[{ pathname: '/runner', state: { plan: { type: 'CO2', rounds: [{ index: 0, targetHoldSec: 60, restBeforeSec: 0 }] }, difficultyLevel: 0 } }]}>
          <RunnerScreen />
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  await waitFor(() => expect(acquire).toHaveBeenCalled());
  expect(screen.getByText(/breathe up/i)).toBeInTheDocument();
});
