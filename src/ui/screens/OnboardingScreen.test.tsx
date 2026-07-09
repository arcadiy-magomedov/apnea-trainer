import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { OnboardingScreen } from './OnboardingScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';

function memoryRepo(): StateRepository & { saved: AppState[] } {
  let current = emptyAppState();
  const saved: AppState[] = [];
  return {
    saved,
    async getState() { return current; },
    async setState(s) { current = s; saved.push(s); },
  };
}

function renderScreen(repo: StateRepository = memoryRepo()) {
  render(
    <ServicesProvider value={{ repository: repo }}>
      <AppProviders>
        <MemoryRouter><OnboardingScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

describe('OnboardingScreen', () => {
  it('keeps continue disabled until the safety disclaimer is acknowledged', async () => {
    renderScreen();
    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    expect(cont).toBeEnabled();
  });

  it('shows the never-in-water warning', () => {
    renderScreen();
    expect(screen.getByText(/never.*water.*alone/i)).toBeInTheDocument();
  });

  it('persists the onboarded flag when acknowledged so it is not shown again', async () => {
    const repo = memoryRepo();
    renderScreen(repo);
    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(repo.saved.at(-1)?.settings.onboarded).toBe(true));
  });
});
