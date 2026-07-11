import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from './services';
import { AppProviders } from './stores';
import { AppRoutes } from './routes';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';

function repoWith(state: AppState): StateRepository {
  return { async getState() { return state; }, async setState() {} };
}

it('redirects to onboarding until the safety disclaimer is acknowledged', async () => {
  render(
    <ServicesProvider value={{ repository: repoWith(emptyAppState()) }}><AppProviders>
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders></ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: /apnea trainer/i })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
});

it('shows Home once onboarded, even without a baseline (no safety wall on every start)', async () => {
  const state = emptyAppState();
  state.settings.onboarded = true;
  render(
    <ServicesProvider value={{ repository: repoWith(state) }}><AppProviders>
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders></ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /measure baseline/i })).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
});
