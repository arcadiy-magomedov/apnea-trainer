import { it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';
import { emptyAppState } from '../../domain/models/appState';
import type { AppState } from '../../domain/models/types';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type {
  AnalyticsService,
} from '../../application/analytics/analyticsService';
import { noopAnalytics } from '../../infrastructure/analytics/noopAnalytics';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import {
  AnalyticsConsentProvider,
} from '../analytics/AnalyticsConsentProvider';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function memoryRepository(
  initialState = emptyAppState(),
): StateRepository {
  let state = initialState;
  return {
    async getState() {
      return state;
    },
    async setState(next) {
      state = next;
    },
  };
}

interface RenderSettingsOptions {
  repository?: StateRepository;
  analytics?: AnalyticsService;
  analyticsConsent?: MemoryAnalyticsConsentStore;
}

function renderSettings({
  repository = memoryRepository(),
  analytics = new FakeAnalyticsService(),
  analyticsConsent = new MemoryAnalyticsConsentStore(),
}: RenderSettingsOptions = {}) {
  render(
    <ServicesProvider value={{
      repository,
      analytics,
      analyticsConsent,
    }}>
      <AnalyticsConsentProvider>
        <AppProviders>
          <MemoryRouter initialEntries={['/settings']}>
            <Routes>
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/breath-debug" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  return { analytics, analyticsConsent, repository };
}

it('toggles voice cues and persists', async () => {
  renderSettings();
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
  let releaseWrite!: () => void;
  const saved: AppState[] = [];
  const repository = {
    getState: vi.fn(async () => state),
    setState: vi.fn((next: AppState) => new Promise<void>((resolve) => {
      saved.push(next);
      releaseWrite = resolve;
    })),
  };
  const analytics = new FakeAnalyticsService();
  renderSettings({ analytics, repository });

  const clearButton = await screen.findByRole('button', { name: /clear goal/i });
  await userEvent.dblClick(clearButton);
  expect(repository.setState).toHaveBeenCalledOnce();
  expect(analytics.events).toEqual([]);

  await act(async () => {
    releaseWrite();
  });
  await waitFor(() => expect(saved.at(-1)?.goal).toBeNull());
  expect(analytics.events).toEqual([{ name: 'goal_cleared' }]);
  expect(JSON.stringify(analytics.events)).not.toMatch(
    /target|baseline|goalId|"g"|240|180/i,
  );
});

it('navigates to breath sonar from the experiments card', async () => {
  renderSettings();

  const button = await screen.findByRole('button', { name: /breath sonar/i });
  await userEvent.click(button);
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/breath-debug'));
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
  const analytics = new FakeAnalyticsService();
  renderSettings({ analytics, repository });

  const clearButton = await screen.findByRole('button', { name: /clear goal/i });
  await userEvent.click(clearButton);
  expect(clearButton).toBeDisabled();

  await userEvent.click(clearButton);
  expect(repository.setState).toHaveBeenCalledTimes(1);

  rejectWrite?.(new Error('storage unavailable'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/storage unavailable/i);
  expect(clearButton).toBeEnabled();
  expect(screen.getByText(/target: 4:00/i)).toBeInTheDocument();
  expect(analytics.events).not.toContainEqual({ name: 'goal_cleared' });
});

it('can enable analytics and display the anonymous identifier', async () => {
  const analytics = new FakeAnalyticsService();
  const { analyticsConsent } = renderSettings({ analytics });

  const toggle = await screen.findByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).not.toBeChecked();

  await userEvent.click(toggle);

  await waitFor(() => expect(toggle).toBeChecked());
  expect(analyticsConsent.read()?.status).toBe('granted');
  expect(await screen.findByDisplayValue('analytics-test-id'))
    .toBeInTheDocument();
  expect(screen.getByText(/copy this before turning analytics off/i))
    .toBeInTheDocument();
});

it('keeps persisted consent checked but hides the identifier when activation fails', async () => {
  class RejectingGrantAnalytics extends FakeAnalyticsService {
    anonymousIdCalls = 0;

    override async setConsent(consent: 'unknown' | 'granted' | 'denied') {
      this.consentChanges.push(consent);
      if (consent === 'granted') {
        throw new Error('private adapter detail');
      }
    }

    override async getAnonymousId(): Promise<string | null> {
      this.anonymousIdCalls += 1;
      return super.getAnonymousId();
    }
  }
  const analytics = new RejectingGrantAnalytics();
  renderSettings({
    analytics,
    analyticsConsent: new MemoryAnalyticsConsentStore({
      status: 'granted',
      decidedAt: 1,
    }),
  });

  const toggle = await screen.findByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  });
  await waitFor(() => expect(toggle).toBeEnabled());

  expect(toggle).toBeChecked();
  expect(await screen.findByText(
    /could not apply the analytics preference/i,
  )).toBeInTheDocument();
  expect(analytics.resetCalls).toBe(1);
  expect(analytics.anonymousIdCalls).toBe(0);
  expect(screen.queryByLabelText(/pseudonymous analytics identifier/i))
    .not.toBeInTheDocument();
});

it('withdraws analytics consent, resets analytics, and hides the identifier', async () => {
  const analytics = new FakeAnalyticsService();
  const analyticsConsent = new MemoryAnalyticsConsentStore({
    status: 'granted',
    decidedAt: 1,
  });
  renderSettings({ analytics, analyticsConsent });

  const toggle = await screen.findByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toBeChecked();
  expect(await screen.findByDisplayValue('analytics-test-id'))
    .toBeInTheDocument();

  await userEvent.click(toggle);

  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(analyticsConsent.read()?.status).toBe('denied');
  expect(analytics.resetCalls).toBe(1);
  expect(screen.queryByLabelText(/pseudonymous analytics identifier/i))
    .not.toBeInTheDocument();
});

it('explains when analytics is unavailable in this build', async () => {
  renderSettings({
    analytics: noopAnalytics,
    analyticsConsent: new MemoryAnalyticsConsentStore(),
  });

  const toggle = await screen.findByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  });
  expect(toggle).toBeDisabled();
  expect(screen.getByText(/analytics is not configured in this build/i))
    .toBeInTheDocument();
  expect(screen.getByRole('link', { name: /privacy details/i }))
    .toHaveAttribute('href', '/privacy');
});

it('shows a retryable identifier error without exposing private details', async () => {
  class FailsOnceIdAnalytics extends FakeAnalyticsService {
    anonymousIdCalls = 0;

    override async getAnonymousId(): Promise<string | null> {
      this.anonymousIdCalls += 1;
      if (this.anonymousIdCalls === 1) {
        throw new Error('private identifier failure');
      }
      return super.getAnonymousId();
    }
  }
  const analytics = new FailsOnceIdAnalytics();
  renderSettings({
    analytics,
    analyticsConsent: new MemoryAnalyticsConsentStore({
      status: 'granted',
      decidedAt: 1,
    }),
  });

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /could not load the pseudonymous analytics identifier/i,
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent(/private/i);
  const retry = screen.getByRole('button', {
    name: /retry loading analytics identifier/i,
  });
  expect(analytics.anonymousIdCalls).toBe(1);
  expect(screen.queryByText(/copy this before turning analytics off/i))
    .not.toBeInTheDocument();

  await userEvent.click(retry);

  expect(await screen.findByDisplayValue('analytics-test-id'))
    .toBeInTheDocument();
  expect(analytics.anonymousIdCalls).toBe(2);
  expect(screen.queryByRole('button', {
    name: /retry loading analytics identifier/i,
  })).not.toBeInTheDocument();
});

it('hides an identifier error after analytics consent is withdrawn', async () => {
  class FailingIdAnalytics extends FakeAnalyticsService {
    override async getAnonymousId(): Promise<string | null> {
      throw new Error('private identifier failure');
    }
  }
  renderSettings({
    analytics: new FailingIdAnalytics(),
    analyticsConsent: new MemoryAnalyticsConsentStore({
      status: 'granted',
      decidedAt: 1,
    }),
  });

  expect(await screen.findByRole('button', {
    name: /retry loading analytics identifier/i,
  })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('checkbox', {
    name: /share anonymous usage analytics/i,
  }));

  await waitFor(() => {
    expect(screen.queryByRole('button', {
      name: /retry loading analytics identifier/i,
    })).not.toBeInTheDocument();
  });
  expect(screen.queryByText(/could not load the pseudonymous/i))
    .not.toBeInTheDocument();
});
