import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';

vi.stubGlobal('__APP_VERSION__', 'test-sha');

it('displays the build version', async () => {
  render(
    <ServicesProvider><AppProviders>
      <MemoryRouter><SettingsScreen /></MemoryRouter>
    </AppProviders></ServicesProvider>,
  );
  expect(await screen.findByText(/test-sha/)).toBeInTheDocument();
});