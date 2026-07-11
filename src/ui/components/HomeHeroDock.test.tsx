import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { emptyAppState } from '../../domain/models/appState';
import { homeDayModel } from '../../application/usecases/homeDayModel';
import { makeBaseline, makeSession } from '../../test/fixtures';
import { HomeHeroDock } from './HomeHeroDock';

const D = (iso: string) => new Date(iso).getTime();
const DAY_MS = 86_400_000;

function renderDock(
  now: string | number,
  mutate?: (state: ReturnType<typeof emptyAppState>) => void,
) {
  const state = emptyAppState();
  mutate?.(state);
  const model = homeDayModel(state, typeof now === 'string' ? D(now) : now);
  const onLaunch = vi.fn();
  const onMeasureBaseline = vi.fn();

  render(
    <HomeHeroDock
      model={model}
      onLaunch={onLaunch}
      onMeasureBaseline={onMeasureBaseline}
    />,
  );

  return { onLaunch, onMeasureBaseline, model };
}

describe('HomeHeroDock', () => {
  it('renders the trainable session as the dominant action', async () => {
    const state = emptyAppState();
    state.baselines = [makeBaseline()];
    const onLaunch = vi.fn();
    render(
      <HomeHeroDock
        model={homeDayModel(state, D('2026-07-09T10:00:00'))}
        onLaunch={onLaunch}
        onMeasureBaseline={vi.fn()}
      />,
    );

    expect(screen.getByText(/^CO₂ session$/i)).toBeInTheDocument();
    expect(screen.getByText(/8 rounds/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /start CO₂ session/i }));
    expect(onLaunch).toHaveBeenCalledOnce();
  });

  it('renders a baseline action when no baseline exists', () => {
    renderDock('2026-07-09T10:00:00');
    expect(screen.getByRole('button', { name: /measure baseline/i })).toBeInTheDocument();
  });

  it('renders a rest day with the next O2 copy when REST is due', () => {
    const { model } = renderDock('2026-07-10T10:00:00', (state) => {
      state.baselines = [makeBaseline()];
      state.courseState.position = 1;
      state.courseState.lastAdvanceAt = D('2026-07-10T00:00:00');
    });

    expect(screen.getByText(/Rest day/i)).toBeInTheDocument();
    expect(screen.getByText(/Next: O₂ ·/i)).toBeInTheDocument();
    expect(model.today.decision.dayType).toBe('REST');
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /train anyway/i })).not.toBeInTheDocument();
  });

  it('renders postponed MAX guidance after a recent hard session', () => {
    renderDock(15 * DAY_MS, (state) => {
      state.baselines = [makeBaseline({ measuredAt: 0 })];
      state.courseState.lastMaxTestAt = 0;
      state.sessions = [makeSession({ rpe: 'hard', finishedAt: 14 * 86_400_000 })];
    });

    expect(screen.getByText(/^MAX assessment postponed$/i)).toBeInTheDocument();
    expect(screen.getByText(/Recovery gate is active/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /train anyway/i })).not.toBeInTheDocument();
  });

  it('renders completed today state without a start action', () => {
    renderDock('2026-07-09T18:00:00', (state) => {
      state.baselines = [makeBaseline()];
      state.sessions = [makeSession({ finishedAt: D('2026-07-09T09:00:00') })];
    });

    expect(screen.getByText(/CO₂ session complete/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
  });

  it('renders an eligible MAX assessment without a difficulty level', () => {
    renderDock(15 * DAY_MS, (state) => {
      state.baselines = [makeBaseline({ measuredAt: 0 })];
      state.courseState.lastMaxTestAt = 0;
    });

    expect(screen.getByText(/^MAX assessment$/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 attempt$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start MAX assessment/i })).toBeInTheDocument();
    expect(screen.queryByText(/· L0/)).not.toBeInTheDocument();
  });
});
