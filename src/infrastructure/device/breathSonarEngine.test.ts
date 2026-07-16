import { describe, expect, it, vi } from 'vitest';
import {
  createBreathSonarEngine as createProductionBreathSonarEngine,
  type EngineOptions,
} from './breathSonarEngine';
import type { BreathSonarSession } from './breathSonarSession';
import {
  BreathSonarError,
  type BreathSonarEngine,
  type BreathSonarSnapshot,
  type DemodulatedFrame,
} from './breathSonarTypes';

const PROBE_DURATION_MS = 1;
const STILL_DURATION_MS = 2;
const INHALE_DURATION_MS = 3;
const EXHALE_DURATION_MS = 4;

class FakeSession implements BreathSonarSession {
  readonly frequencies: number[] = [];
  readonly subscribedFrameListeners:
    ((frame: DemodulatedFrame) => void)[] = [];
  private readonly frameListeners =
    new Set<(frame: DemodulatedFrame) => void>();
  private readonly errorListeners =
    new Set<(error: BreathSonarError) => void>();
  readonly sampleRateHz: number;
  stopCalls = 0;
  stopCompletion: Promise<void> = Promise.resolve();
  currentFrequencyHz: number | null = null;

  constructor(sampleRateHz = 48_000) {
    this.sampleRateHz = sampleRateHz;
  }

  setFrequency(frequencyHz: number): void {
    this.currentFrequencyHz = frequencyHz;
    this.frequencies.push(frequencyHz);
  }

  subscribe(listener: (frame: DemodulatedFrame) => void): () => void {
    this.frameListeners.add(listener);
    this.subscribedFrameListeners.push(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  subscribeError(
    listener: (error: BreathSonarError) => void,
  ): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    await this.stopCompletion;
  }

  emit(frame: DemodulatedFrame): void {
    for (const listener of this.frameListeners) {
      listener(frame);
    }
  }

  emitError(error: BreathSonarError): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  get frameListenerCount(): number {
    return this.frameListeners.size;
  }

  get errorListenerCount(): number {
    return this.errorListeners.size;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function frame(
  timeMs: number,
  phaseRad: number,
  carrierMagnitude = 0.2,
  sidebandMagnitude = 0.01,
  broadbandRms = 0.05,
  clipped = false,
): DemodulatedFrame {
  return {
    timeMs,
    i: Math.cos(phaseRad) * carrierMagnitude,
    q: Math.sin(phaseRad) * carrierMagnitude,
    sidebandMagnitude,
    broadbandRms,
    clipped,
  };
}

function emitRamp(
  session: FakeSession,
  fromMs: number,
  fromPhase: number,
  toPhase: number,
  count = 80,
): void {
  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0 : index / (count - 1);
    session.emit(frame(
      fromMs + index * 50,
      fromPhase + (toPhase - fromPhase) * ratio,
    ));
  }
}

function emitProbe(
  session: FakeSession,
  carrierMagnitude: number,
  valid = true,
): void {
  for (let index = 0; index < 5; index += 1) {
    session.emit(frame(
      index * 50,
      index * 0.02,
      carrierMagnitude,
      valid ? 0.1 : carrierMagnitude,
      carrierMagnitude + 0.1,
    ));
  }
}

interface AutomaticHarness {
  engine: BreathSonarEngine;
  session: FakeSession;
  createSession: ReturnType<typeof vi.fn>;
  scheduler: ManualTimeoutScheduler;
  setCalibrationSucceeds(value: boolean): void;
}

interface TestTimeoutHandle {
  callback: () => void;
  durationMs: number;
  cancelled: boolean;
}

class ManualTimeoutScheduler {
  readonly handles: TestTimeoutHandle[] = [];
  readonly scheduleTimeout = vi.fn((
    callback: () => void,
    durationMs: number,
  ): TestTimeoutHandle => {
    const handle = {
      callback,
      durationMs,
      cancelled: false,
    };
    this.handles.push(handle);
    return handle;
  });
  readonly cancelTimeout = vi.fn((handle: unknown): void => {
    (handle as TestTimeoutHandle).cancelled = true;
  });

  get latest(): TestTimeoutHandle {
    const handle = this.handles.at(-1);
    if (!handle) {
      throw new Error('No timeout has been scheduled');
    }
    return handle;
  }

  fire(handle = this.latest): void {
    handle.callback();
  }
}

function createBreathSonarEngine(
  options: EngineOptions = {},
): BreathSonarEngine {
  const scheduler = new ManualTimeoutScheduler();
  return createProductionBreathSonarEngine({
    scheduleTimeout: scheduler.scheduleTimeout,
    cancelTimeout: scheduler.cancelTimeout,
    ...options,
  });
}

function automaticHarness(options: {
  sampleRateHz?: number;
  probeMagnitudes?: Record<number, number>;
  validProbe?: boolean;
  calibrationSucceeds?: boolean;
  frameTimeoutMs?: number;
  scheduler?: ManualTimeoutScheduler;
} = {}): AutomaticHarness {
  const session = new FakeSession(options.sampleRateHz);
  const createSession = vi.fn(async () => session);
  const scheduler = options.scheduler ?? new ManualTimeoutScheduler();
  let calibrationSucceeds = options.calibrationSucceeds ?? true;
  const probeMagnitudes = options.probeMagnitudes ?? {
    18_000: 1,
    18_500: 2,
    19_000: 5,
    19_500: 3,
    20_000: 1.5,
  };
  const delay = vi.fn(async (durationMs: number) => {
    if (durationMs === PROBE_DURATION_MS) {
      const frequencyHz = session.currentFrequencyHz;
      if (frequencyHz === null) {
        throw new Error('Probe began without a frequency');
      }
      emitProbe(
        session,
        probeMagnitudes[frequencyHz] ?? 1,
        options.validProbe ?? true,
      );
      return;
    }
    if (durationMs === STILL_DURATION_MS) {
      emitRamp(session, 0, 0, calibrationSucceeds ? 0.005 : 0);
      return;
    }
    if (durationMs === INHALE_DURATION_MS) {
      emitRamp(
        session,
        4_000,
        calibrationSucceeds ? 0.005 : 0,
        calibrationSucceeds ? 0.6 : 0,
      );
      return;
    }
    if (durationMs === EXHALE_DURATION_MS) {
      emitRamp(
        session,
        8_000,
        calibrationSucceeds ? 0.6 : 0,
        calibrationSucceeds ? 0.02 : 0,
      );
    }
  });
  const engine = createBreathSonarEngine({
    createSession,
    delay,
    probeDurationMs: PROBE_DURATION_MS,
    stillCalibrationDurationMs: STILL_DURATION_MS,
    inhaleCalibrationDurationMs: INHALE_DURATION_MS,
    exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
    frameTimeoutMs: options.frameTimeoutMs,
    scheduleTimeout: scheduler.scheduleTimeout,
    cancelTimeout: scheduler.cancelTimeout,
  });

  return {
    engine,
    session,
    createSession,
    scheduler,
    setCalibrationSucceeds(value): void {
      calibrationSucceeds = value;
    },
  };
}

function collapseStatuses(
  snapshots: readonly BreathSonarSnapshot[],
): string[] {
  return snapshots.reduce<string[]>((statuses, snapshot) => {
    if (statuses.at(-1) !== snapshot.status) {
      statuses.push(snapshot.status);
    }
    return statuses;
  }, []);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Condition was not reached');
}

describe('createBreathSonarEngine', () => {
  it('exposes an immutable exact initial snapshot and an unsubscribe function', () => {
    const engine = createBreathSonarEngine();
    const listener = vi.fn();

    expect(engine.getSnapshot()).toEqual({
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
    });
    expect(Object.isFrozen(engine.getSnapshot())).toBe(true);
    expect(Object.isFrozen(engine.getSnapshot().waveform)).toBe(true);
    expect(Object.isFrozen(engine.getSnapshot().diagnostics)).toBe(true);

    const unsubscribe = engine.subscribe(listener);

    expect(unsubscribe).toEqual(expect.any(Function));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('publishes the full startup order with fresh snapshots', async () => {
    const { engine } = automaticHarness();
    const snapshots: BreathSonarSnapshot[] = [];
    const unsubscribe = engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    await engine.start();

    expect(collapseStatuses(snapshots)).toEqual([
      'requesting-microphone',
      'checking-device',
      'calibrating-still',
      'calibrating-inhale',
      'calibrating-exhale',
      'poor-signal',
    ]);
    expect(new Set(snapshots).size).toBe(snapshots.length);
    expect(snapshots.every((snapshot) => Object.isFrozen(snapshot))).toBe(true);
    unsubscribe();
  });

  it('filters candidates by sample rate and selects the strongest valid carrier', async () => {
    const { engine, session } = automaticHarness({
      sampleRateHz: 42_000,
      probeMagnitudes: {
        18_000: 1,
        18_500: 4,
      },
    });

    await engine.start();

    expect(session.frequencies).toEqual([18_000, 18_500, 18_500]);
    expect(engine.getSnapshot().diagnostics).toMatchObject({
      frequencyHz: 18_500,
      sampleRateHz: 42_000,
      snrDb: expect.closeTo(20 * Math.log10(20), 8),
    });
  });

  it('stops and publishes unsupported when no carrier candidate is valid', async () => {
    const { engine, session } = automaticHarness({ validProbe: false });

    await engine.start();

    expect(session.stopCalls).toBe(1);
    expect(session.frameListenerCount).toBe(0);
    expect(session.errorListenerCount).toBe(0);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'unsupported',
      error: { code: 'carrier-unsupported' },
      diagnostics: {
        frequencyHz: null,
        sampleRateHz: 48_000,
        snrDb: null,
      },
    });
  });

  it('stops and publishes unsupported when sample rate leaves no candidates', async () => {
    const { engine, session } = automaticHarness({
      sampleRateHz: 40_000,
    });

    await engine.start();

    expect(session.frequencies).toEqual([]);
    expect(session.stopCalls).toBe(1);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'unsupported',
      error: { code: 'carrier-unsupported' },
    });
  });

  it('calibrates with the real processor then publishes live inhale and exhale', async () => {
    const { engine, session } = automaticHarness();

    await engine.start();

    expect(engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: null,
      diagnostics: {
        frequencyHz: 19_000,
        sampleRateHz: 48_000,
        movement: false,
      },
    });

    emitRamp(session, 12_000, 0.02, 0.8, 40);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'inhale',
      error: null,
    });

    emitRamp(session, 14_000, 0.8, 0.02, 40);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'exhale',
      error: null,
    });
    expect(engine.getSnapshot().waveform.length).toBeGreaterThan(0);
    expect(engine.getSnapshot().diagnostics).toMatchObject({
      snrDb: expect.closeTo(20 * Math.log10(20), 8),
      phaseAmplitude: expect.any(Number),
      qualityScore: expect.any(Number),
      movement: false,
    });
  });

  it('publishes poor signal and clears stale phase when frames time out', async () => {
    const { engine, session, scheduler } = automaticHarness({
      frameTimeoutMs: 1_500,
    });
    await engine.start();
    emitRamp(session, 12_000, 0.02, 0.8, 40);
    expect(engine.getSnapshot().status).toBe('inhale');
    const beforeTimeout = engine.getSnapshot();

    scheduler.fire();

    expect(engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      quality: 'poor',
      waveform: beforeTimeout.waveform,
      diagnostics: {
        frequencyHz: 19_000,
        sampleRateHz: 48_000,
        snrDb: null,
        phaseAmplitude: null,
        qualityScore: 0,
        movement: false,
      },
      error: null,
    });

    emitRamp(session, 16_000, 0.8, 1.16, 10);
    expect(engine.getSnapshot().status).toBe('poor-signal');

    emitRamp(session, 16_500, 1.2, 1.8, 16);
    expect(engine.getSnapshot().status).toBe('inhale');
    expect(engine.getSnapshot().diagnostics).toMatchObject({
      snrDb: expect.any(Number),
      phaseAmplitude: expect.any(Number),
      qualityScore: expect.any(Number),
      movement: false,
    });
  });

  it('resets and cancels the heartbeat on every live frame', async () => {
    const { engine, session, scheduler } = automaticHarness({
      frameTimeoutMs: 1_234,
    });
    await engine.start();
    const afterCalibration = scheduler.latest;

    session.emit(frame(12_000, 0.02));
    const afterFirstFrame = scheduler.latest;
    session.emit(frame(12_050, 0.04));
    const afterSecondFrame = scheduler.latest;

    expect(afterCalibration.durationMs).toBe(1_234);
    expect(afterCalibration.cancelled).toBe(true);
    expect(afterFirstFrame.cancelled).toBe(true);
    expect(afterSecondFrame.cancelled).toBe(false);
    expect(scheduler.cancelTimeout).toHaveBeenCalledWith(
      afterCalibration,
    );
    expect(scheduler.cancelTimeout).toHaveBeenCalledWith(
      afterFirstFrame,
    );
  });

  it('ignores a stopped run heartbeat callback', async () => {
    const { engine, scheduler } = automaticHarness();
    await engine.start();
    const staleHeartbeat = scheduler.latest;

    await engine.stop();
    const stoppedSnapshot = engine.getSnapshot();
    scheduler.fire(staleHeartbeat);

    expect(staleHeartbeat.cancelled).toBe(true);
    expect(engine.getSnapshot()).toBe(stoppedSnapshot);
    expect(engine.getSnapshot().status).toBe('idle');
  });

  it('ignores a replaced run heartbeat callback', async () => {
    const { engine, scheduler } = automaticHarness();
    await engine.start();
    const staleHeartbeat = scheduler.latest;

    const replacement = engine.start();
    const replacementSnapshot = engine.getSnapshot();
    scheduler.fire(staleHeartbeat);

    expect(staleHeartbeat.cancelled).toBe(true);
    expect(engine.getSnapshot()).toBe(replacementSnapshot);
    await replacement;
  });

  it('ignores an old heartbeat while recalibrating', async () => {
    const { engine, scheduler } = automaticHarness();
    await engine.start();
    const staleHeartbeat = scheduler.latest;

    const recalibration = engine.recalibrate();
    const calibratingSnapshot = engine.getSnapshot();
    scheduler.fire(staleHeartbeat);

    expect(staleHeartbeat.cancelled).toBe(true);
    expect(engine.getSnapshot()).toBe(calibratingSnapshot);
    await recalibration;
  });

  it('does not arm a heartbeat after calibration failure', async () => {
    const { engine, scheduler } = automaticHarness({
      calibrationSucceeds: false,
    });

    await engine.start();

    expect(engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: { code: 'calibration-failed' },
    });
    expect(scheduler.scheduleTimeout).not.toHaveBeenCalled();
  });

  it('publishes finite live SNR from calibration and live frames', async () => {
    const { engine, session } = automaticHarness();
    await engine.start();

    expect(engine.getSnapshot().diagnostics.snrDb)
      .toBeCloseTo(20 * Math.log10(20), 8);

    for (let index = 0; index < 20; index += 1) {
      session.emit({
        ...frame(
          12_000 + index * 50,
          0.02 + index * 0.02,
          0.2,
          0.05,
        ),
        broadbandRms: 0.05,
      });
    }

    expect(engine.getSnapshot().diagnostics.snrDb)
      .toBeCloseTo(20 * Math.log10(4), 8);
    expect(Number.isFinite(engine.getSnapshot().diagnostics.snrDb))
      .toBe(true);
  });

  it('keeps the carrier alive after calibration failure and recalibrates without a new session', async () => {
    const harness = automaticHarness({ calibrationSucceeds: false });

    await harness.engine.start();

    expect(harness.engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: { code: 'calibration-failed' },
    });
    expect(harness.session.stopCalls).toBe(0);

    harness.setCalibrationSucceeds(true);
    await harness.engine.recalibrate();

    expect(harness.createSession).toHaveBeenCalledTimes(1);
    expect(harness.session.stopCalls).toBe(0);
    expect(harness.engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: null,
    });
  });

  it('preserves calibration failure while live frames update until recalibration succeeds', async () => {
    const harness = automaticHarness({ calibrationSucceeds: false });

    await harness.engine.start();
    const calibrationError = harness.engine.getSnapshot().error;
    expect(calibrationError).toBeInstanceOf(BreathSonarError);
    expect(Object.isFrozen(calibrationError)).toBe(true);

    emitRamp(harness.session, 12_000, 0, 0.8, 40);

    expect(harness.engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      waveform: expect.arrayContaining([
        expect.objectContaining({
          timeMs: expect.any(Number),
          value: expect.any(Number),
        }),
      ]),
      diagnostics: {
        phaseAmplitude: expect.any(Number),
        qualityScore: expect.any(Number),
      },
      error: { code: 'calibration-failed' },
    });
    expect(harness.engine.getSnapshot().error).toEqual(calibrationError);
    expect(harness.engine.getSnapshot().error).not.toBe(calibrationError);
    expect(harness.engine.getSnapshot().error).toBeInstanceOf(BreathSonarError);
    expect(Object.isFrozen(harness.engine.getSnapshot().error)).toBe(true);

    harness.setCalibrationSucceeds(true);
    await harness.engine.recalibrate();

    expect(harness.engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: null,
    });
  });

  it('publishes an explicit error when recalibration has no selected session', async () => {
    const engine = createBreathSonarEngine();

    await engine.recalibrate();

    expect(engine.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'calibration-failed' },
    });
  });

  it('invokes the first session factory before start returns', async () => {
    const pendingSession = deferred<BreathSonarSession>();
    const lateSession = new FakeSession();
    const calls: string[] = [];
    const createSession = vi.fn(() => {
      calls.push('create-session');
      return pendingSession.promise;
    });
    const engine = createBreathSonarEngine({
      createSession,
      delay: async () => undefined,
    });

    const startPromise = engine.start();
    calls.push('after-start');

    expect(calls).toEqual(['create-session', 'after-start']);

    const stopPromise = engine.stop();
    pendingSession.resolve(lateSession);
    await Promise.all([startPromise, stopPromise]);
  });

  it('aborts pending session creation synchronously when stopped', async () => {
    let startupSignal: AbortSignal | undefined;
    const cancellation = new BreathSonarError(
      'audio-start-failed',
      'Session creation cancelled.',
    );
    const createSession = vi.fn((signal?: AbortSignal) => {
      startupSignal = signal;
      if (!signal) {
        return Promise.reject(new Error('Missing startup signal.'));
      }
      return new Promise<BreathSonarSession>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(cancellation);
        }, { once: true });
      });
    });
    const engine = createBreathSonarEngine({ createSession });
    const snapshots: BreathSonarSnapshot[] = [];
    engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    const startPromise = engine.start();
    expect(startupSignal).toBeDefined();

    const stopPromise = engine.stop();
    expect(startupSignal?.aborted).toBe(true);

    await Promise.all([startPromise, stopPromise]);

    expect(engine.getSnapshot()).toMatchObject({
      status: 'idle',
      error: null,
    });
    expect(snapshots.every((snapshot) => snapshot.error === null)).toBe(true);
  });

  it('aborts prior session creation synchronously on replacement start', async () => {
    const signals: AbortSignal[] = [];
    const createSession = vi.fn((signal?: AbortSignal) => {
      if (!signal) {
        return Promise.reject(new Error('Missing startup signal.'));
      }
      signals.push(signal);
      return new Promise<BreathSonarSession>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new BreathSonarError(
            'audio-start-failed',
            'Session creation cancelled.',
          ));
        }, { once: true });
      });
    });
    const engine = createBreathSonarEngine({ createSession });

    const firstStart = engine.start();
    expect(signals).toHaveLength(1);

    const replacementStart = engine.start();
    expect(signals[0].aborted).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);

    const stopPromise = engine.stop();
    expect(signals[1].aborted).toBe(true);
    await Promise.all([firstStart, replacementStart, stopPromise]);
  });

  it('never publishes cancellation failures from stale startups', async () => {
    const staleCancellation = new BreathSonarError(
      'audio-start-failed',
      'First startup cancelled.',
    );
    const signals: AbortSignal[] = [];
    const createSession = vi.fn((signal?: AbortSignal) => {
      if (!signal) {
        return Promise.reject(new Error('Missing startup signal.'));
      }
      const callIndex = signals.length;
      signals.push(signal);
      return new Promise<BreathSonarSession>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(callIndex === 0
            ? staleCancellation
            : new BreathSonarError(
              'audio-start-failed',
              'Replacement startup cancelled.',
            ));
        }, { once: true });
      });
    });
    const engine = createBreathSonarEngine({ createSession });
    const snapshots: BreathSonarSnapshot[] = [];
    engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    const firstStart = engine.start();
    const replacementStart = engine.start();
    expect(signals).toHaveLength(2);

    expect(engine.getSnapshot()).toMatchObject({
      status: 'requesting-microphone',
      error: null,
    });
    expect(snapshots.every((snapshot) => snapshot.error === null)).toBe(true);

    const stopPromise = engine.stop();
    await Promise.all([firstStart, replacementStart, stopPromise]);

    expect(engine.getSnapshot()).toMatchObject({
      status: 'idle',
      error: null,
    });
    expect(snapshots.every((snapshot) => snapshot.error === null)).toBe(true);
  });

  it('keeps immediate stop pending until late session creation is disposed', async () => {
    const pendingSession = deferred<BreathSonarSession>();
    const pendingSessionStop = deferred<void>();
    const lateSession = new FakeSession();
    lateSession.stopCompletion = pendingSessionStop.promise;
    const createSession = vi.fn(() => pendingSession.promise);
    const engine = createBreathSonarEngine({
      createSession,
      delay: async () => undefined,
    });
    const snapshots: BreathSonarSnapshot[] = [];
    engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    const startPromise = engine.start();
    const stopPromise = engine.stop();
    let stopSettled = false;
    const observedStop = stopPromise.then(() => {
      stopSettled = true;
    });
    await Promise.resolve();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(stopSettled).toBe(false);

    pendingSession.resolve(lateSession);
    await waitUntil(() => lateSession.stopCalls === 1);

    expect(stopSettled).toBe(false);

    pendingSessionStop.resolve();
    await Promise.all([startPromise, observedStop]);

    expect(lateSession.stopCalls).toBe(1);
    expect(engine.getSnapshot().status).toBe('idle');
    expect(collapseStatuses(snapshots)).toEqual([
      'requesting-microphone',
      'idle',
    ]);
  });

  it('disposes late startup before activating its replacement session', async () => {
    const firstPendingSession = deferred<BreathSonarSession>();
    const secondPendingSession = deferred<BreathSonarSession>();
    const firstPendingStop = deferred<void>();
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    firstSession.stopCompletion = firstPendingStop.promise;
    const createSession = vi.fn()
      .mockImplementationOnce(() => firstPendingSession.promise)
      .mockImplementationOnce(() => secondPendingSession.promise);
    const engine = createBreathSonarEngine({
      createSession,
      delay: async () => undefined,
    });

    const firstStart = engine.start();
    await waitUntil(() => createSession.mock.calls.length === 1);
    const secondStart = engine.start();

    expect(createSession).toHaveBeenCalledTimes(2);
    secondPendingSession.resolve(secondSession);
    await Promise.resolve();
    expect(secondSession.frameListenerCount).toBe(0);
    expect(secondSession.errorListenerCount).toBe(0);
    expect(secondSession.frequencies).toEqual([]);

    firstPendingSession.resolve(firstSession);
    await waitUntil(() => firstSession.stopCalls === 1);

    expect(secondSession.frameListenerCount).toBe(0);
    expect(secondSession.errorListenerCount).toBe(0);
    expect(secondSession.frequencies).toEqual([]);

    firstPendingStop.resolve();
    await Promise.all([firstStart, secondStart]);

    expect(firstSession.stopCalls).toBe(1);
    expect(secondSession.stopCalls).toBe(1);
  });

  it('keeps a failed replacement chained before activating the next startup', async () => {
    const firstPendingSession = deferred<BreathSonarSession>();
    const firstSession = new FakeSession();
    const thirdSession = new FakeSession();
    const staleFailure = new BreathSonarError(
      'audio-start-failed',
      'Replacement session failed.',
    );
    const createSession = vi.fn()
      .mockImplementationOnce(() => firstPendingSession.promise)
      .mockImplementationOnce(() => Promise.reject(staleFailure))
      .mockImplementationOnce(async () => thirdSession);
    const engine = createBreathSonarEngine({
      createSession,
      delay: async () => undefined,
      probeDurationMs: PROBE_DURATION_MS,
    });
    const snapshots: BreathSonarSnapshot[] = [];
    engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    const firstStart = engine.start();
    const failedReplacement = engine.start();

    expect(createSession).toHaveBeenCalledTimes(2);

    await Promise.resolve();
    let thirdStartSettled = false;
    const thirdStart = engine.start();
    const observedThirdStart = thirdStart.then(() => {
      thirdStartSettled = true;
    });

    expect(createSession).toHaveBeenCalledTimes(3);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }

    expect(thirdStartSettled).toBe(false);
    expect(thirdSession.frameListenerCount).toBe(0);
    expect(thirdSession.errorListenerCount).toBe(0);
    expect(thirdSession.frequencies).toEqual([]);
    expect(snapshots.some(
      (snapshot) => snapshot.error?.message === staleFailure.message,
    )).toBe(false);

    firstPendingSession.resolve(firstSession);
    await Promise.all([
      firstStart,
      failedReplacement,
      observedThirdStart,
    ]);

    expect(firstSession.stopCalls).toBe(1);
    expect(thirdSession.frequencies).not.toEqual([]);
    expect(snapshots.some(
      (snapshot) => snapshot.error?.message === staleFailure.message,
    )).toBe(false);
  });

  it('keeps stop pending when a replacement fails before prior creation settles', async () => {
    const firstPendingSession = deferred<BreathSonarSession>();
    const firstSession = new FakeSession();
    const replacementFailure = new BreathSonarError(
      'audio-start-failed',
      'Replacement session failed.',
    );
    const createSession = vi.fn()
      .mockImplementationOnce(() => firstPendingSession.promise)
      .mockImplementationOnce(() => Promise.reject(replacementFailure));
    const engine = createBreathSonarEngine({
      createSession,
      delay: async () => undefined,
    });

    const firstStart = engine.start();
    const failedReplacement = engine.start();

    expect(createSession).toHaveBeenCalledTimes(2);

    await Promise.resolve();
    let stopSettled = false;
    const stopPromise = engine.stop();
    const observedStop = stopPromise.then(() => {
      stopSettled = true;
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }

    expect(stopSettled).toBe(false);
    expect(firstSession.stopCalls).toBe(0);

    firstPendingSession.resolve(firstSession);
    await Promise.all([
      firstStart,
      failedReplacement,
      observedStop,
    ]);

    expect(firstSession.stopCalls).toBe(1);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'idle',
      error: null,
    });
  });

  it('does not swallow the final stop in a stop-start-stop race', async () => {
    const firstPendingSession = deferred<BreathSonarSession>();
    const secondPendingSession = deferred<BreathSonarSession>();
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    const createSession = vi.fn()
      .mockImplementationOnce(() => firstPendingSession.promise)
      .mockImplementationOnce(() => secondPendingSession.promise);
    const engine = createBreathSonarEngine({
      createSession,
      delay: async () => undefined,
    });
    const snapshots: BreathSonarSnapshot[] = [];
    engine.subscribe((nextSnapshot) => {
      snapshots.push(nextSnapshot);
    });

    const firstStart = engine.start();
    await waitUntil(() => createSession.mock.calls.length === 1);
    const firstStop = engine.stop();
    const secondStart = engine.start();
    const finalStop = engine.stop();
    let finalStopSettled = false;
    const observedFinalStop = finalStop.then(() => {
      finalStopSettled = true;
    });
    await Promise.resolve();

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(finalStopSettled).toBe(false);
    firstPendingSession.resolve(firstSession);
    await waitUntil(() => firstSession.stopCalls === 1);
    expect(finalStopSettled).toBe(false);
    secondPendingSession.resolve(secondSession);
    await Promise.all([
      firstStart,
      firstStop,
      secondStart,
      observedFinalStop,
    ]);
    const publishCountAfterFinalStop = snapshots.length;

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(firstSession.stopCalls).toBe(1);
    expect(secondSession.stopCalls).toBe(1);
    expect(engine.getSnapshot().status).toBe('idle');
    expect(snapshots).toHaveLength(publishCountAfterFinalStop);
  });

  it.each([
    ['probe', PROBE_DURATION_MS, 'checking-device'],
    ['calibration', STILL_DURATION_MS, 'calibrating-still'],
  ])(
    'stops cleanly during %s and ignores the pending continuation',
    async (_label, blockedDurationMs, expectedStatus) => {
      const session = new FakeSession();
      const blockedDelay = deferred<void>();
      const delay = vi.fn(async (durationMs: number) => {
        if (durationMs === blockedDurationMs) {
          await blockedDelay.promise;
          return;
        }
        if (durationMs === PROBE_DURATION_MS) {
          emitProbe(session, session.currentFrequencyHz === 19_000 ? 5 : 1);
        }
      });
      const engine = createBreathSonarEngine({
        createSession: async () => session,
        delay,
        probeDurationMs: PROBE_DURATION_MS,
        stillCalibrationDurationMs: STILL_DURATION_MS,
        inhaleCalibrationDurationMs: INHALE_DURATION_MS,
        exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
      });
      const startPromise = engine.start();
      await waitUntil(() => engine.getSnapshot().status === expectedStatus);

      await engine.stop();
      blockedDelay.resolve();
      await startPromise;

      expect(session.stopCalls).toBe(1);
      expect(engine.getSnapshot().status).toBe('idle');
    },
  );

  it('isolates a replacement probe from stale startup cleanup and frames', async () => {
    const firstSession = new FakeSession();
    const replacementSession = new FakeSession();
    const firstStop = deferred<void>();
    const firstProbe = deferred<void>();
    const replacementProbe = deferred<void>();
    firstSession.stopCompletion = firstStop.promise;
    let currentSession: FakeSession | null = null;
    let firstProbeWaiting = false;
    let replacementProbeCalls = 0;
    const createSession = vi.fn()
      .mockImplementationOnce(async () => {
        currentSession = firstSession;
        return firstSession;
      })
      .mockImplementationOnce(async () => {
        currentSession = replacementSession;
        return replacementSession;
      });
    const delay = vi.fn(async (durationMs: number) => {
      if (durationMs === PROBE_DURATION_MS) {
        if (currentSession === firstSession) {
          firstProbeWaiting = true;
          await firstProbe.promise;
          return;
        }

        replacementProbeCalls += 1;
        if (replacementProbeCalls === 1) {
          await replacementProbe.promise;
          return;
        }
        emitProbe(
          replacementSession,
          replacementSession.currentFrequencyHz === 19_000 ? 5 : 1,
        );
        return;
      }
      if (durationMs === STILL_DURATION_MS) {
        emitRamp(replacementSession, 0, 0, 0.005);
      } else if (durationMs === INHALE_DURATION_MS) {
        emitRamp(replacementSession, 4_000, 0.005, 0.6);
      } else if (durationMs === EXHALE_DURATION_MS) {
        emitRamp(replacementSession, 8_000, 0.6, 0.02);
      }
    });
    const engine = createBreathSonarEngine({
      createSession,
      delay,
      probeDurationMs: PROBE_DURATION_MS,
      stillCalibrationDurationMs: STILL_DURATION_MS,
      inhaleCalibrationDurationMs: INHALE_DURATION_MS,
      exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
    });

    const firstStart = engine.start();
    await waitUntil(() => firstProbeWaiting);
    const staleFrameListener = firstSession.subscribedFrameListeners[0];
    const replacementStart = engine.start();
    await waitUntil(() => firstSession.stopCalls === 1);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(replacementSession.frameListenerCount).toBe(0);
    expect(replacementSession.errorListenerCount).toBe(0);
    expect(replacementSession.frequencies).toEqual([]);
    expect(replacementProbeCalls).toBe(0);

    firstStop.resolve();
    await waitUntil(() => replacementProbeCalls === 1);

    firstProbe.resolve();
    await firstStart;
    staleFrameListener(frame(0, 0, 100, 0.01, 0.1));
    emitProbe(replacementSession, 1);
    replacementProbe.resolve();
    await replacementStart;

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(firstSession.stopCalls).toBe(1);
    expect(replacementSession.stopCalls).toBe(0);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: null,
      diagnostics: {
        frequencyHz: 19_000,
      },
    });
  });

  it('a repeated start fully disposes the prior active session', async () => {
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    let currentSession = firstSession;
    const createSession = vi.fn(async () => currentSession);
    const delay = vi.fn(async (durationMs: number) => {
      if (durationMs === PROBE_DURATION_MS) {
        emitProbe(
          currentSession,
          currentSession.currentFrequencyHz === 19_000 ? 5 : 1,
        );
        return;
      }
      if (durationMs === STILL_DURATION_MS) {
        emitRamp(currentSession, 0, 0, 0.005);
      } else if (durationMs === INHALE_DURATION_MS) {
        emitRamp(currentSession, 4_000, 0.005, 0.6);
      } else if (durationMs === EXHALE_DURATION_MS) {
        emitRamp(currentSession, 8_000, 0.6, 0.02);
      }
    });
    const engine = createBreathSonarEngine({
      createSession,
      delay,
      probeDurationMs: PROBE_DURATION_MS,
      stillCalibrationDurationMs: STILL_DURATION_MS,
      inhaleCalibrationDurationMs: INHALE_DURATION_MS,
      exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
    });

    await engine.start();
    currentSession = secondSession;
    await engine.start();

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(firstSession.stopCalls).toBe(1);
    expect(firstSession.frameListenerCount).toBe(0);
    expect(secondSession.stopCalls).toBe(0);
    expect(engine.getSnapshot().status).toBe('poor-signal');
  });

  it('creates a replacement synchronously but waits for prior cleanup before activation', async () => {
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    const deferredStop = deferred<void>();
    const callOrder: string[] = [];
    let currentSession = firstSession;
    const originalFirstStop = firstSession.stop.bind(firstSession);
    vi.spyOn(firstSession, 'stop').mockImplementation(async () => {
      callOrder.push('stop-first');
      await originalFirstStop();
    });
    const createSession = vi.fn(async () => {
      callOrder.push(
        currentSession === firstSession ? 'create-first' : 'create-second',
      );
      return currentSession;
    });
    const delay = vi.fn(async (durationMs: number) => {
      if (durationMs === PROBE_DURATION_MS) {
        callOrder.push(
          currentSession === firstSession ? 'probe-first' : 'probe-second',
        );
        emitProbe(
          currentSession,
          currentSession.currentFrequencyHz === 19_000 ? 5 : 1,
        );
        return;
      }
      if (durationMs === STILL_DURATION_MS) {
        emitRamp(currentSession, 0, 0, 0.005);
      } else if (durationMs === INHALE_DURATION_MS) {
        emitRamp(currentSession, 4_000, 0.005, 0.6);
      } else if (durationMs === EXHALE_DURATION_MS) {
        emitRamp(currentSession, 8_000, 0.6, 0.02);
      }
    });
    const engine = createBreathSonarEngine({
      createSession,
      delay,
      probeDurationMs: PROBE_DURATION_MS,
      stillCalibrationDurationMs: STILL_DURATION_MS,
      inhaleCalibrationDurationMs: INHALE_DURATION_MS,
      exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
    });
    await engine.start();
    firstSession.stopCompletion = deferredStop.promise;
    currentSession = secondSession;

    const replacementStart = engine.start();
    callOrder.push('after-replacement-start');

    expect(callOrder.slice(-3)).toEqual([
      'stop-first',
      'create-second',
      'after-replacement-start',
    ]);
    expect(firstSession.stopCalls).toBe(1);
    expect(secondSession.frameListenerCount).toBe(0);
    expect(secondSession.errorListenerCount).toBe(0);
    expect(secondSession.frequencies).toEqual([]);
    expect(callOrder).not.toContain('probe-second');
    expect(engine.getSnapshot().status).toBe('requesting-microphone');

    deferredStop.resolve();
    await replacementStart;

    expect(secondSession.frameListenerCount).toBe(1);
    expect(secondSession.errorListenerCount).toBe(1);
    expect(secondSession.frequencies).not.toEqual([]);
    expect(callOrder).toContain('probe-second');
    expect(engine.getSnapshot().status).toBe('poor-signal');
  });

  it.each([
    new BreathSonarError('device-lost', 'Microphone disconnected.'),
    new BreathSonarError('audio-start-failed', 'Runtime graph failed.'),
  ])('stops for runtime $code and preserves the typed error', async (error) => {
    const { engine, session } = automaticHarness();
    await engine.start();

    session.emitError(error);
    await waitUntil(() => engine.getSnapshot().error?.code === error.code);

    expect(session.stopCalls).toBe(1);
    expect(session.frameListenerCount).toBe(0);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'error',
      error,
    });
    expect(engine.getSnapshot().error).not.toBe(error);
    expect(engine.getSnapshot().error).toBeInstanceOf(BreathSonarError);
    expect(Object.isFrozen(engine.getSnapshot().error)).toBe(true);
    expect(Object.isFrozen(error)).toBe(false);
  });

  it('publishes an immutable error clone without mutating the source error', async () => {
    const { engine, session } = automaticHarness();
    const cause = new Error('microphone transport closed');
    const sourceError = new BreathSonarError(
      'device-lost',
      'Microphone disconnected.',
      { cause },
    );
    sourceError.name = 'CustomBreathSonarError';
    await engine.start();

    session.emitError(sourceError);
    await waitUntil(() => engine.getSnapshot().error !== null);

    const snapshotBeforeMutation = engine.getSnapshot();
    const publishedError = snapshotBeforeMutation.error;
    expect(publishedError).toBeInstanceOf(BreathSonarError);
    expect(publishedError).not.toBe(sourceError);
    expect(publishedError).toMatchObject({
      code: sourceError.code,
      message: sourceError.message,
      cause,
      name: sourceError.name,
    });
    expect(Object.isFrozen(publishedError)).toBe(true);
    expect(Object.isFrozen(sourceError)).toBe(false);

    expect(() => {
      (publishedError as BreathSonarError).message = 'mutated message';
    }).toThrow(TypeError);
    expect(() => {
      (publishedError as unknown as { code: string }).code = 'mutated-code';
    }).toThrow(TypeError);

    expect(engine.getSnapshot()).toBe(snapshotBeforeMutation);
    expect(engine.getSnapshot().error).toMatchObject({
      code: 'device-lost',
      message: 'Microphone disconnected.',
      cause,
      name: 'CustomBreathSonarError',
    });
    expect(sourceError).toMatchObject({
      code: 'device-lost',
      message: 'Microphone disconnected.',
      cause,
      name: 'CustomBreathSonarError',
    });
  });

  it('awaits runtime cleanup before activating a replacement session', async () => {
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    const deferredStop = deferred<void>();
    const createSession = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    let currentSession = firstSession;
    const delay = vi.fn(async (durationMs: number) => {
      if (durationMs === PROBE_DURATION_MS) {
        emitProbe(
          currentSession,
          currentSession.currentFrequencyHz === 19_000 ? 5 : 1,
        );
        return;
      }
      if (durationMs === STILL_DURATION_MS) {
        emitRamp(currentSession, 0, 0, 0.005);
      } else if (durationMs === INHALE_DURATION_MS) {
        emitRamp(currentSession, 4_000, 0.005, 0.6);
      } else if (durationMs === EXHALE_DURATION_MS) {
        emitRamp(currentSession, 8_000, 0.6, 0.02);
      }
    });
    const engine = createBreathSonarEngine({
      createSession,
      delay,
      probeDurationMs: PROBE_DURATION_MS,
      stillCalibrationDurationMs: STILL_DURATION_MS,
      inhaleCalibrationDurationMs: INHALE_DURATION_MS,
      exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
    });
    await engine.start();
    firstSession.stopCompletion = deferredStop.promise;
    currentSession = secondSession;

    firstSession.emitError(
      new BreathSonarError('device-lost', 'Microphone disconnected.'),
    );
    const restartPromise = engine.start();
    await waitUntil(() => firstSession.stopCalls === 1);
    await Promise.resolve();

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(secondSession.frameListenerCount).toBe(0);
    expect(secondSession.errorListenerCount).toBe(0);
    expect(secondSession.frequencies).toEqual([]);

    deferredStop.resolve();
    await restartPromise;

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(firstSession.stopCalls).toBe(1);
    expect(firstSession.frameListenerCount).toBe(0);
    expect(firstSession.errorListenerCount).toBe(0);
    expect(secondSession.frameListenerCount).toBe(1);
    expect(secondSession.errorListenerCount).toBe(1);
    expect(engine.getSnapshot()).toMatchObject({
      status: 'poor-signal',
      error: null,
    });
  });

  it('maps an unknown startup failure to audio-start-failed with its cause', async () => {
    const cause = new Error('raw startup failure');
    const engine = createBreathSonarEngine({
      createSession: async () => {
        throw cause;
      },
    });

    await engine.start();

    expect(engine.getSnapshot()).toMatchObject({
      status: 'error',
      error: {
        code: 'audio-start-failed',
        cause,
      },
    });
  });

  it('ignores frames captured from a stale disposed session', async () => {
    const firstSession = new FakeSession();
    const secondHarness = automaticHarness();
    const createSession = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondHarness.session);
    let activeSession = firstSession;
    const delay = vi.fn(async (durationMs: number) => {
      if (durationMs === PROBE_DURATION_MS) {
        emitProbe(
          activeSession,
          activeSession.currentFrequencyHz === 19_000 ? 5 : 1,
        );
        return;
      }
      if (durationMs === STILL_DURATION_MS) {
        emitRamp(activeSession, 0, 0, 0.005);
      } else if (durationMs === INHALE_DURATION_MS) {
        emitRamp(activeSession, 4_000, 0.005, 0.6);
      } else if (durationMs === EXHALE_DURATION_MS) {
        emitRamp(activeSession, 8_000, 0.6, 0.02);
      }
    });
    const engine = createBreathSonarEngine({
      createSession,
      delay,
      probeDurationMs: PROBE_DURATION_MS,
      stillCalibrationDurationMs: STILL_DURATION_MS,
      inhaleCalibrationDurationMs: INHALE_DURATION_MS,
      exhaleCalibrationDurationMs: EXHALE_DURATION_MS,
    });
    await engine.start();
    const staleListener = firstSession.subscribedFrameListeners[0];
    activeSession = secondHarness.session;
    await engine.start();
    const beforeStaleFrame = engine.getSnapshot();

    staleListener(frame(20_000, 3, 0.2, 0.01, 10, true));

    expect(engine.getSnapshot()).toBe(beforeStaleFrame);
  });

  it('stop is idempotent and stops the active session exactly once', async () => {
    const { engine, session } = automaticHarness();
    await engine.start();

    await Promise.all([engine.stop(), engine.stop()]);
    await engine.stop();

    expect(session.stopCalls).toBe(1);
    expect(session.frameListenerCount).toBe(0);
    expect(session.errorListenerCount).toBe(0);
    expect(engine.getSnapshot()).toEqual({
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
    });
  });
});
