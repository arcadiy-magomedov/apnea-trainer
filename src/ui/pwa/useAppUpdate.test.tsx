import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import { makeAppUpdate } from './useAppUpdate';

it('exposes needRefresh and applies the update when not in session', async () => {
  const updateSW = vi.fn(async () => {});
  const { getNeedRefresh, setNeedRefresh, apply } = makeAppUpdate(updateSW);
  act(() => setNeedRefresh(true));
  expect(getNeedRefresh()).toBe(true);
  await act(async () => { await apply(false); });
  expect(updateSW).toHaveBeenCalledWith(true);
});

it('defers the update while a session is active', async () => {
  const updateSW = vi.fn(async () => {});
  const { apply } = makeAppUpdate(updateSW);
  await act(async () => { await apply(true); }); // sessionActive = true
  expect(updateSW).not.toHaveBeenCalled();
});