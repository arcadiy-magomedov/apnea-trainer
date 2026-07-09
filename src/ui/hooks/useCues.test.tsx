import { describe, it, expect, vi } from 'vitest';
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

it('gates speak on the voiceCues setting (default on)', () => {
  const speak = vi.fn();
  const { result } = renderHook(() => useCues(), { wrapper: wrap({ ...noopCues, speak }) });
  result.current.phaseCue('Hold');
  expect(speak).toHaveBeenCalledWith('Hold');
});