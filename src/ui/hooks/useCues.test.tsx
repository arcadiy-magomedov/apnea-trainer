import { it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ServicesProvider } from '../app/services';
import { AppProviders } from '../app/stores';
import { useCues } from './useCues';
import { noopCues } from '../../infrastructure/device/noopServices';

function wrap(cues = noopCues) {
  return ({ children }: { children: React.ReactNode }) => (
    <ServicesProvider value={{ cues }}>
      <AppProviders>{children}</AppProviders>
    </ServicesProvider>
  );
}

it('announces the phase name via speech when voice cues are on (default)', () => {
  const speak = vi.fn();
  const { result } = renderHook(() => useCues(), { wrapper: wrap({ ...noopCues, speak }) });
  result.current.announce('hold');
  expect(speak).toHaveBeenCalledWith('Hold');
});

it('emits exactly one beep per countdown tick when beep cues are on', () => {
  const beep = vi.fn();
  const { result } = renderHook(() => useCues(), { wrapper: wrap({ ...noopCues, beep }) });
  result.current.tick();
  expect(beep).toHaveBeenCalledTimes(1);
});

it('primes audio through to the underlying service', () => {
  const prime = vi.fn();
  const { result } = renderHook(() => useCues(), { wrapper: wrap({ ...noopCues, prime }) });
  result.current.prime();
  expect(prime).toHaveBeenCalled();
});
