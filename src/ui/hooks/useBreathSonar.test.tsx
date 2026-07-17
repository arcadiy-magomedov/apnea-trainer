import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBreathSonar } from './useBreathSonar';
import type {
  BreathSonarEngine,
  BreathSonarSnapshot,
} from '../../infrastructure/device/breathSonarTypes';

function snapshot(overrides: Partial<BreathSonarSnapshot> = {}): BreathSonarSnapshot {
  return {
    status: 'idle',
    quality: 'unknown',
    waveform: [],
    diagnostics: {
      frequencyHz: null,
      sampleRateHz: null,
      snrDb: null,
      phaseAmplitude: null,
      qualityScore: null,
      movement: false,
    },
    error: null,
    ...overrides,
  };
}

function createEngine(initialSnapshot = snapshot()) {
  let listener: ((value: BreathSonarSnapshot) => void) | undefined;
  const unsubscribe = vi.fn();

  const engine = {
    getSnapshot: vi.fn(() => initialSnapshot),
    subscribe: vi.fn((next: (value: BreathSonarSnapshot) => void) => {
      listener = next;
      return unsubscribe;
    }),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    recalibrate: vi.fn(async () => undefined),
  } satisfies BreathSonarEngine;

  return {
    engine,
    unsubscribe,
    emit(next: BreathSonarSnapshot) {
      listener?.(next);
    },
  };
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'hidden');
});

describe('useBreathSonar', () => {
  it('initializes from the engine snapshot and subscribes once', () => {
    const setup = createEngine();

    const { result } = renderHook(() => useBreathSonar(() => setup.engine));

    expect(setup.engine.getSnapshot).toHaveBeenCalledTimes(1);
    expect(setup.engine.subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toEqual(snapshot());
  });

  it('replaces state when the engine subscriber emits', () => {
    const setup = createEngine();
    const next = snapshot({ status: 'inhale', quality: 'good' });

    const { result } = renderHook(() => useBreathSonar(() => setup.engine));

    act(() => {
      setup.emit(next);
    });

    expect(result.current.snapshot).toEqual(next);
  });

  it('delegates start, stop, and recalibrate to the same engine', async () => {
    const setup = createEngine();
    const { result } = renderHook(() => useBreathSonar(() => setup.engine));

    await act(async () => {
      await result.current.start();
      await result.current.stop();
      await result.current.recalibrate();
    });

    expect(setup.engine.start).toHaveBeenCalledTimes(1);
    expect(setup.engine.stop).toHaveBeenCalledTimes(1);
    expect(setup.engine.recalibrate).toHaveBeenCalledTimes(1);
  });

  it('creates one engine per mount across rerenders', () => {
    const setup = createEngine();
    const createEngineMock = vi.fn(() => setup.engine);

    const { rerender } = renderHook(() => useBreathSonar(createEngineMock));

    rerender();

    expect(createEngineMock).toHaveBeenCalledTimes(1);
  });

  it('stops when the page becomes hidden', () => {
    const setup = createEngine();
    const { unmount } = renderHook(() => useBreathSonar(() => setup.engine));

    setDocumentHidden(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(setup.engine.stop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not stop when the page stays visible', () => {
    const setup = createEngine();
    const { unmount } = renderHook(() => useBreathSonar(() => setup.engine));

    setDocumentHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(setup.engine.stop).not.toHaveBeenCalled();
    unmount();
  });

  it('unsubscribes, removes the page listener, and stops on unmount', () => {
    const setup = createEngine();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useBreathSonar(() => setup.engine));

    unmount();

    expect(setup.unsubscribe).toHaveBeenCalledTimes(1);
    expect(setup.engine.stop).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
