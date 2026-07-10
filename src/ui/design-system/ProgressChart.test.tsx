import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressChart } from './ProgressChart';

it('renders actual points, a goal line, and projected path', () => {
  render(
    <ProgressChart
      actual={[
        { id: 'a', at: 1_000, sec: 180 },
        { id: 'b', at: 2_000, sec: 190 },
      ]}
      projected={[
        { at: 2_000, sec: 190 },
        { at: 3_000, sec: 210 },
      ]}
      targetSec={210}
    />,
  );

  expect(screen.getAllByTestId('actual-point')).toHaveLength(2);
  expect(screen.getByTestId('goal-line')).toBeInTheDocument();
  expect(screen.getByTestId('projected-path')).toBeInTheDocument();
  expect(screen.getAllByTestId('axis-label')).toHaveLength(4);
});
