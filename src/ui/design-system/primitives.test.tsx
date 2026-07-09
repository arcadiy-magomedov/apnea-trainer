import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { StatCard } from './StatCard';

describe('Button', () => {
  it('renders children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Start</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('StatCard', () => {
  it('shows a label and value', () => {
    render(<StatCard label="Personal best" value="3:42" />);
    expect(screen.getByText('Personal best')).toBeInTheDocument();
    expect(screen.getByText('3:42')).toBeInTheDocument();
  });
});
