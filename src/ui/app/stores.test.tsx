import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider } from './services';
import { AppProviders, useAppStore } from './stores';

function Probe() {
  const hydrated = useAppStore((s) => s.hydrated);
  return <span>{hydrated ? 'hydrated' : 'loading'}</span>;
}

describe('AppProviders', () => {
  it('hydrates the app store on mount', async () => {
    render(
      <ServicesProvider>
        <AppProviders><Probe /></AppProviders>
      </ServicesProvider>,
    );
    await waitFor(() => expect(screen.getByText('hydrated')).toBeInTheDocument());
  });
});
