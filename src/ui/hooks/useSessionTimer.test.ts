import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionTimer } from './useSessionTimer';
import { generateCo2Table } from '../../domain/apnea/tableGenerator';

describe('useSessionTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts in breatheUp and counts down', () => {
    const plan = generateCo2Table(200, 0);
    const { result } = renderHook(() => useSessionTimer(plan, { breatheUpSec: 3 }));
    act(() => result.current.begin());
    expect(result.current.phase).toBe('breatheUp');
    expect(result.current.remaining).toBe(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(2);
  });

  it('transitions from breatheUp to hold when the countdown ends', () => {
    const plan = generateCo2Table(200, 0);
    const onPhase = vi.fn();
    const { result } = renderHook(() => useSessionTimer(plan, { breatheUpSec: 1, onPhaseChange: onPhase }));
    act(() => result.current.begin());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.phase).toBe('hold');
    expect(onPhase).toHaveBeenCalledWith('hold');
  });
});
