import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreathWaveform } from './BreathWaveform';

describe('BreathWaveform', () => {
  it('renders an accessible SVG with a centerline', () => {
    render(<BreathWaveform waveform={[]} />);

    const svg = screen.getByRole('img', {
      name: /live breathing motion waveform/i,
    });

    expect(svg).toHaveClass('w-full');
    expect(screen.getByTestId('breath-centerline')).toBeInTheDocument();
    expect(screen.getByText(/inhale/i)).toBeInTheDocument();
    expect(screen.getByText(/exhale/i)).toBeInTheDocument();
  });

  it('draws a finite path with inhale above center and exhale below center', () => {
    render(
      <BreathWaveform
        waveform={[
          { timeMs: 0, value: 0 },
          { timeMs: 10_000, value: 1 },
          { timeMs: 20_000, value: -1 },
        ]}
      />,
    );

    const path = screen.getByTestId('breath-wave-path');
    const numbers = path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

    expect(path).toHaveAttribute('d');
    expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
    expect(numbers).toHaveLength(6);
    expect(numbers[3]).toBeLessThan(90);
    expect(numbers[5]).toBeGreaterThan(90);
  });

  it('omits points older than 20 seconds', () => {
    render(
      <BreathWaveform
        waveform={[
          { timeMs: 0, value: -1 },
          { timeMs: 5_000, value: 0 },
          { timeMs: 25_000, value: 1 },
        ]}
      />,
    );

    expect(screen.getByTestId('breath-wave-path')).toHaveAttribute(
      'd',
      expect.stringMatching(/^M 16(?:\.0+)? /),
    );
  });

  it('clamps values and ignores non-finite points', () => {
    render(
      <BreathWaveform
        waveform={[
          { timeMs: 0, value: 3 },
          { timeMs: 10_000, value: -3 },
          { timeMs: Number.POSITIVE_INFINITY, value: 0 },
          { timeMs: Number.NaN, value: 1 },
        ]}
      />,
    );

    const path = screen.getByTestId('breath-wave-path');
    const numbers = path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

    expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
    expect(numbers).toHaveLength(4);
    expect(numbers[1]).toBeCloseTo(16, 0);
    expect(numbers[3]).toBeCloseTo(164, 0);
  });

  it('renders an empty path safely', () => {
    render(<BreathWaveform waveform={[]} />);

    expect(screen.getByTestId('breath-wave-path')).toHaveAttribute('d', '');
  });
});
