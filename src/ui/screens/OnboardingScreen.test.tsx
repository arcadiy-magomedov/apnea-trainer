import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingScreen } from './OnboardingScreen';

function renderScreen() {
  return render(<MemoryRouter><OnboardingScreen /></MemoryRouter>);
}

describe('OnboardingScreen', () => {
  it('keeps continue disabled until the safety disclaimer is acknowledged', async () => {
    renderScreen();
    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /dry land only/i }));
    expect(cont).toBeEnabled();
  });

  it('shows the never-in-water warning', () => {
    renderScreen();
    expect(screen.getByText(/never.*water.*alone/i)).toBeInTheDocument();
  });
});
