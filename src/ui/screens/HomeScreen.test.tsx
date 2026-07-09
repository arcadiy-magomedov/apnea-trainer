import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { HomeScreen } from './HomeScreen';

it('shows the personal-best stat card', async () => {
  render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter><HomeScreen /></MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByText(/personal best/i)).toBeInTheDocument());
});
