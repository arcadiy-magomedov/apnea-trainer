import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { BaselineScreen } from './BaselineScreen';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter>{children}</MemoryRouter>
      </AppProviders>
    </ServicesProvider>
  );
}

describe('BaselineScreen', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('counts up while holding and records an attempt on stop', async () => {
    const user = userEvent.setup();
    render(<Wrapper><BaselineScreen /></Wrapper>);
    await user.click(screen.getByRole('button', { name: /start hold/i }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/0:0[23]/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(screen.getByText(/attempt 1/i)).toBeInTheDocument();
  });
});
