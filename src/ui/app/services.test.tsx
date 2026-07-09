import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServicesProvider, useServices } from './services';

function Probe() {
  const { clock } = useServices();
  return <span>now:{clock.now() > 0 ? 'ok' : 'bad'}</span>;
}

describe('ServicesProvider', () => {
  it('provides a working clock by default', () => {
    render(<ServicesProvider><Probe /></ServicesProvider>);
    expect(screen.getByText('now:ok')).toBeInTheDocument();
  });
});
