import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { OnboardingScreen } from './OnboardingScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';
import { FakeAnalyticsService } from '../../test/fakeAnalytics';

function memoryRepo(): StateRepository & { saved: AppState[] } {
  let current = emptyAppState();
  const saved: AppState[] = [];
  return {
    saved,
    async getState() { return current; },
    async setState(s) { current = s; saved.push(s); },
  };
}

function renderScreen(
  repo: StateRepository = memoryRepo(),
  analytics = new FakeAnalyticsService(),
) {
  render(
    <ServicesProvider value={{ repository: repo, analytics }}>
      <AppProviders>
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingScreen />} />
            <Route path="/baseline" element={<div>baseline-route</div>} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  return { analytics, repo };
}

describe('OnboardingScreen', () => {
  it('keeps continue disabled until the safety disclaimer is acknowledged', async () => {
    renderScreen();
    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    expect(cont).toBeEnabled();
  });

  it('shows the never-in-water warning', async () => {
    await act(async () => {
      renderScreen();
    });
    expect(screen.getByText(/never.*water.*alone/i)).toBeInTheDocument();
  });

  it('persists the onboarded flag when acknowledged so it is not shown again', async () => {
    const repo = memoryRepo();
    renderScreen(repo);
    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(repo.saved.at(-1)?.settings.onboarded).toBe(true));
  });

  it('tracks onboarding completion only after persistence', async () => {
    let persist!: () => void;
    const repo = memoryRepo();
    repo.setState = async (state) => {
      await new Promise<void>((resolve) => {
        persist = resolve;
      });
      repo.saved.push(state);
    };
    const { analytics } = renderScreen(repo);

    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    expect(analytics.events).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(analytics.events).toEqual([]);
    expect(screen.queryByText('baseline-route')).not.toBeInTheDocument();

    persist();
    await waitFor(() => expect(analytics.events).toEqual([
      { name: 'onboarding_completed' },
    ]));
    expect(screen.getByText('baseline-route')).toBeInTheDocument();
  });

  it('does not complete or navigate when onboarding persistence fails', async () => {
    const repo = memoryRepo();
    repo.setState = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const { analytics } = renderScreen(repo);

    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(repo.setState).toHaveBeenCalledOnce());

    expect(analytics.events).toEqual([]);
    expect(screen.queryByText('baseline-route')).not.toBeInTheDocument();
  });

  it('does not duplicate completion while onboarding persistence is in flight', async () => {
    const resolvers: Array<() => void> = [];
    const repo = memoryRepo();
    repo.setState = vi.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    const { analytics } = renderScreen(repo);
    const user = userEvent.setup();

    await user.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    const continueButton = screen.getByRole('button', { name: /continue/i });
    await user.click(continueButton);
    await user.click(continueButton);

    expect(repo.setState).toHaveBeenCalledOnce();
    resolvers[0]();
    await waitFor(() => expect(analytics.events).toContainEqual({
      name: 'onboarding_completed',
    }));
    await Promise.resolve();

    expect(repo.setState).toHaveBeenCalledOnce();
    expect(analytics.events).toEqual([{ name: 'onboarding_completed' }]);
  });
});
