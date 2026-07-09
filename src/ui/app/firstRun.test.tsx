import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from './services';
import { AppProviders } from './stores';
import { AppRoutes } from './routes';

it('redirects to onboarding when there is no baseline', async () => {
  render(
    <ServicesProvider><AppProviders>
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders></ServicesProvider>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: /apnea trainer/i })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
});