import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';
import {
  AnalyticsConsentProvider,
} from '../analytics/AnalyticsConsentProvider';

vi.stubGlobal('__APP_VERSION__', 'test-sha');

it('displays the build version', async () => {
  render(
    <ServicesProvider>
      <AnalyticsConsentProvider>
        <AppProviders>
          <MemoryRouter><SettingsScreen /></MemoryRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  expect(await screen.findByText(/test-sha/)).toBeInTheDocument();
});