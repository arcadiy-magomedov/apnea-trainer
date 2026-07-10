import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalCard } from './GoalCard';

const active = {
  latestSec: 200,
  bestSec: 210,
  targetSec: 240,
  startSec: 180,
  progressPct: 50,
  ratePerDay: 0.5,
  etaMs: new Date('2026-08-20T00:00:00').getTime(),
  confidence: 'medium' as const,
  stalled: false,
  achieved: false,
};

it('shows progress, ETA confidence, and opens details', async () => {
  const onOpen = vi.fn();
  render(<GoalCard forecast={active} onOpen={onOpen} />);
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText(/medium confidence/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /view goal progress/i }));
  expect(onOpen).toHaveBeenCalledOnce();
});

it('labels a prior-only forecast as low confidence', () => {
  render(
    <GoalCard
      forecast={{ ...active, confidence: 'low' }}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
});

it('shows achieved and stalled states without a fake ETA', () => {
  const { rerender } = render(
    <GoalCard
      forecast={{ ...active, achieved: true, etaMs: null, progressPct: 100 }}
      onOpen={() => {}}
      onSetGoal={() => {}}
    />,
  );
  expect(screen.getByText(/goal reached/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /view goal progress/i }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: /set a higher goal/i }))
    .toBeInTheDocument();

  rerender(
    <GoalCard forecast={{ ...active, stalled: true, etaMs: null }} onOpen={() => {}} />,
  );
  expect(screen.getByText(/progress stalled/i)).toBeInTheDocument();
});
