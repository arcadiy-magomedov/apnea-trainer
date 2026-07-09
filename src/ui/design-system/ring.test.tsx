import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';
import { dashOffset } from './ProgressRing';

describe('dashOffset', () => {
  it('is full circumference at 0% and 0 at 100%', () => {
    const c = 2 * Math.PI * 98;
    expect(dashOffset(0, 98)).toBeCloseTo(c);
    expect(dashOffset(1, 98)).toBeCloseTo(0);
    expect(dashOffset(0.5, 98)).toBeCloseTo(c / 2);
  });
});

describe('ProgressRing', () => {
  it('renders the centered label', () => {
    const { getByText } = render(<ProgressRing progress={0.5} label="1:04" sublabel="of 1:00" color="#fbbf24" />);
    expect(getByText('1:04')).toBeInTheDocument();
    expect(getByText('of 1:00')).toBeInTheDocument();
  });
});
