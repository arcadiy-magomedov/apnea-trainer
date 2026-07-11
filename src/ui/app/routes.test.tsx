import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from './services';
import { AppProviders } from './stores';
import { AppRoutes } from './routes';

function renderAt(path: string) {
  return render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );
}

describe('routing', () => {
  it('renders the Settings screen at /settings', async () => {
    renderAt('/settings');
    await waitFor(() => expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument());
  });

  it('renders the goal screen at /goal', async () => {
    renderAt('/goal');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /set your goal/i }))
        .toBeInTheDocument(),
    );
  });

  it('renders Calendar at /calendar', async () => {
    renderAt('/calendar');
    expect(await screen.findByRole('heading', { name: 'Calendar' }))
      .toBeInTheDocument();
  });

  it('redirects legacy /program links to Calendar', async () => {
    renderAt('/program');
    expect(await screen.findByRole('heading', { name: 'Calendar' }))
      .toBeInTheDocument();
  });
});
