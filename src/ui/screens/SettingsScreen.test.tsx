import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { SettingsScreen } from './SettingsScreen';

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
