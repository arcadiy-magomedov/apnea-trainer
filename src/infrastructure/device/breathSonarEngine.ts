import {
  BreathSignalProcessor,
  selectCarrier,
  type CarrierProbe,
  type SelectedCarrier,
  type SignalOutput,
} from './breathSignal';
import type { BreathSonarSession } from './breathSonarSession';
import { createBrowserSonarSession } from './breathSonarSession';
import {
  BreathSonarError,
  type BreathSonarEngine,
  type BreathSonarSnapshot,
  type BreathSonarDiagnostics,
  type BreathSonarStatus,
  type DemodulatedFrame,
  type WaveformPoint,
} from './breathSonarTypes';

const CARRIER_CANDIDATES_HZ = [
  18_000,
  18_500,
  19_000,
  19_500,
  20_000,
] as const;
const MAX_SAMPLE_RATE_RATIO = 0.45;
const SIGNAL_SAMPLE_RATE_HZ = 20;
const DEFAULT_PROBE_DURATION_MS = 400;
const DEFAULT_STILL_CALIBRATION_DURATION_MS = 1_500;
const DEFAULT_INHALE_CALIBRATION_DURATION_MS = 4_000;
const DEFAULT_EXHALE_CALIBRATION_DURATION_MS = 4_000;
const DEFAULT_FRAME_TIMEOUT_MS = 1_500;

export interface EngineOptions {
  createSession?: (signal?: AbortSignal) => Promise<BreathSonarSession>;
  delay?: (durationMs: number) => Promise<void>;
  probeDurationMs?: number;
  stillCalibrationDurationMs?: number;
  inhaleCalibrationDurationMs?: number;
  exhaleCalibrationDurationMs?: number;
  frameTimeoutMs?: number;
  scheduleTimeout?: (
    callback: () => void,
    durationMs: number,
  ) => unknown;
  cancelTimeout?: (handle: unknown) => void;
}

function freezeWaveform(
  waveform: readonly WaveformPoint[],
): BreathSonarSnapshot['waveform'] {
  return Object.freeze(
    waveform.map((point) => Object.freeze({ ...point })),
  ) as unknown as BreathSonarSnapshot['waveform'];
}

function freezeError(
  error: BreathSonarError | null,
): BreathSonarError | null {
  if (!error) {
    return null;
  }

  const clone = new BreathSonarError(
    error.code,
    error.message,
    { cause: error.cause },
  );
  clone.name = error.name;
  return Object.freeze(clone);
}

function freezeSnapshot(
  snapshot: BreathSonarSnapshot,
): BreathSonarSnapshot {
  return Object.freeze({
    ...snapshot,
    waveform: freezeWaveform(snapshot.waveform),
    diagnostics: Object.freeze({ ...snapshot.diagnostics }),
    error: freezeError(snapshot.error),
  });
}

function initialSnapshot(): BreathSonarSnapshot {
  return freezeSnapshot({
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
}

function defaultDelay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function defaultScheduleTimeout(
  callback: () => void,
  durationMs: number,
): unknown {
  return setTimeout(callback, durationMs);
}

function defaultCancelTimeout(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function audioStartError(error: unknown): BreathSonarError {
  if (error instanceof BreathSonarError) {
    return error;
  }
  return new BreathSonarError(
    'audio-start-failed',
    'Could not start the breath sonar audio session.',
    { cause: error },
  );
}

function carrierUnsupportedError(): BreathSonarError {
  return new BreathSonarError(
    'carrier-unsupported',
    'This device or placement could not produce a stable ultrasonic carrier.',
  );
}

function calibrationFailedError(message: string): BreathSonarError {
  return new BreathSonarError('calibration-failed', message);
}

export function createBreathSonarEngine(
  options: EngineOptions = {},
): BreathSonarEngine {
  const listeners = new Set<(snapshot: BreathSonarSnapshot) => void>();
  const stoppedSessions = new WeakMap<BreathSonarSession, Promise<void>>();
  const createSession = options.createSession
    ?? ((signal?: AbortSignal) => createBrowserSonarSession(
      undefined,
      signal,
    ));
  const delay = options.delay ?? defaultDelay;
  const scheduleTimeout = options.scheduleTimeout
    ?? defaultScheduleTimeout;
  const cancelTimeout = options.cancelTimeout
    ?? defaultCancelTimeout;
  const probeDurationMs = options.probeDurationMs
    ?? DEFAULT_PROBE_DURATION_MS;
  const frameTimeoutMs = Number.isFinite(options.frameTimeoutMs)
    && options.frameTimeoutMs! >= 0
    ? options.frameTimeoutMs!
    : DEFAULT_FRAME_TIMEOUT_MS;
  const calibrationDurations = {
    still: options.stillCalibrationDurationMs
      ?? DEFAULT_STILL_CALIBRATION_DURATION_MS,
    inhale: options.inhaleCalibrationDurationMs
      ?? DEFAULT_INHALE_CALIBRATION_DURATION_MS,
    exhale: options.exhaleCalibrationDurationMs
      ?? DEFAULT_EXHALE_CALIBRATION_DURATION_MS,
  };

  let snapshot = initialSnapshot();
  let runVersion = 0;
  let operationVersion = 0;
  let activeSession: BreathSonarSession | null = null;
  let activeSessionRunVersion: number | null = null;
  let unsubscribeFrames: (() => void) | null = null;
  let unsubscribeErrors: (() => void) | null = null;
  let processor: BreathSignalProcessor | null = null;
  let selectedCarrier: SelectedCarrier | null = null;
  let calibrationOperationVersion: number | null = null;
  let calibrationFailure: BreathSonarError | null = null;
  let cleanupPromise: Promise<void> = Promise.resolve();
  let cleanupPendingCount = 0;
  let pendingSessionCreation: Promise<void> | null = null;
  let pendingStartupController: AbortController | null = null;
  let frameHeartbeatHandle: unknown;
  let frameHeartbeatToken: object | null = null;

  const notifyListeners = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        continue;
      }
    }
  };

  const publishSnapshot = (next: BreathSonarSnapshot): void => {
    snapshot = freezeSnapshot(next);
    notifyListeners();
  };

  const publish = (
    patch: Partial<Omit<BreathSonarSnapshot, 'diagnostics'>> & {
      diagnostics?: Partial<BreathSonarDiagnostics>;
    },
  ): void => {
    publishSnapshot({
      ...snapshot,
      ...patch,
      diagnostics: {
        ...snapshot.diagnostics,
        ...patch.diagnostics,
      },
    });
  };

  const isCurrentOperation = (
    expectedRunVersion: number,
    expectedOperationVersion: number,
  ): boolean => (
    runVersion === expectedRunVersion
    && operationVersion === expectedOperationVersion
  );

  const isActiveSession = (
    expectedRunVersion: number,
    session: BreathSonarSession,
  ): boolean => (
    runVersion === expectedRunVersion
    && activeSessionRunVersion === expectedRunVersion
    && activeSession === session
  );

  const cancelFrameHeartbeat = (): void => {
    if (frameHeartbeatToken === null) {
      return;
    }

    const handle = frameHeartbeatHandle;
    frameHeartbeatToken = null;
    frameHeartbeatHandle = undefined;
    try {
      cancelTimeout(handle);
    } catch {
      return;
    }
  };

  const stopSessionOnce = (
    session: BreathSonarSession,
  ): Promise<void> => {
    const existing = stoppedSessions.get(session);
    if (existing) {
      return existing;
    }

    let finishStopping!: () => void;
    const stopping = new Promise<void>((resolve) => {
      finishStopping = resolve;
    });
    stoppedSessions.set(session, stopping);
    try {
      void Promise.resolve(session.stop()).then(
        finishStopping,
        finishStopping,
      );
    } catch {
      finishStopping();
    }
    return stopping;
  };

  const trackCleanup = (cleanup: Promise<void>): Promise<void> => {
    cleanupPendingCount += 1;
    const trackedCleanup = Promise.all([
      cleanupPromise,
      cleanup,
    ]).then(() => undefined);
    const observedCleanup = trackedCleanup.finally(() => {
      cleanupPendingCount -= 1;
    });
    cleanupPromise = observedCleanup;
    return observedCleanup;
  };

  const detachActiveSession = (
    expectedSession?: BreathSonarSession,
  ): Promise<void> => {
    cancelFrameHeartbeat();
    if (
      activeSession === null
      || (expectedSession && activeSession !== expectedSession)
    ) {
      return cleanupPromise;
    }

    const session = activeSession;
    const removeFrameListener = unsubscribeFrames;
    const removeErrorListener = unsubscribeErrors;

    activeSession = null;
    activeSessionRunVersion = null;
    unsubscribeFrames = null;
    unsubscribeErrors = null;
    processor = null;
    selectedCarrier = null;
    calibrationOperationVersion = null;

    removeFrameListener?.();
    removeErrorListener?.();
    return trackCleanup(stopSessionOnce(session));
  };

  const stopUnownedSession = (
    session: BreathSonarSession,
  ): Promise<void> => {
    if (activeSession === session) {
      return cleanupPromise;
    }
    return trackCleanup(stopSessionOnce(session));
  };

  const publishFailure = (
    error: BreathSonarError,
    diagnostics: BreathSonarDiagnostics,
  ): void => {
    const unsupported = error.code === 'carrier-unsupported';
    publishSnapshot({
      status: unsupported ? 'unsupported' : 'error',
      quality: 'unknown',
      waveform: [],
      diagnostics: {
        frequencyHz: unsupported ? null : diagnostics.frequencyHz,
        sampleRateHz: diagnostics.sampleRateHz,
        snrDb: unsupported ? null : diagnostics.snrDb,
        phaseAmplitude: null,
        qualityScore: null,
        movement: false,
      },
      error,
    });
  };

  const failCurrentOperation = async (
    expectedRunVersion: number,
    expectedOperationVersion: number,
    error: unknown,
  ): Promise<void> => {
    if (!isCurrentOperation(
      expectedRunVersion,
      expectedOperationVersion,
    )) {
      return;
    }

    const typedError = audioStartError(error);
    const diagnostics = snapshot.diagnostics;
    await detachActiveSession();
    if (isCurrentOperation(
      expectedRunVersion,
      expectedOperationVersion,
    )) {
      publishFailure(typedError, diagnostics);
    }
  };

  const publishLiveOutput = (
    output: SignalOutput,
    session: BreathSonarSession,
    carrier: SelectedCarrier,
  ): void => {
    let status: BreathSonarStatus;
    if (calibrationFailure) {
      status = 'poor-signal';
    } else if (output.movement) {
      status = 'movement';
    } else if (output.quality === 'poor' || output.phase === null) {
      status = 'poor-signal';
    } else {
      status = output.phase;
    }

    publishSnapshot({
      status,
      quality: output.quality,
      waveform: output.waveform,
      diagnostics: {
        frequencyHz: carrier.frequencyHz,
        sampleRateHz: session.sampleRateHz,
        snrDb: output.carrierSnrDb,
        phaseAmplitude: output.phaseAmplitude,
        qualityScore: output.qualityScore,
        movement: output.movement,
      },
      error: calibrationFailure,
    });
  };

  const armFrameHeartbeat = (
    expectedRunVersion: number,
    session: BreathSonarSession,
    expectedProcessor: BreathSignalProcessor,
  ): void => {
    cancelFrameHeartbeat();
    if (
      !isActiveSession(expectedRunVersion, session)
      || processor !== expectedProcessor
      || calibrationOperationVersion !== null
    ) {
      return;
    }

    const token = {};
    frameHeartbeatToken = token;
    frameHeartbeatHandle = scheduleTimeout(() => {
      if (
        frameHeartbeatToken !== token
        || !isActiveSession(expectedRunVersion, session)
        || processor !== expectedProcessor
        || calibrationOperationVersion !== null
      ) {
        return;
      }

      frameHeartbeatToken = null;
      frameHeartbeatHandle = undefined;
      expectedProcessor.markSignalLost();
      publish({
        status: 'poor-signal',
        quality: 'poor',
        diagnostics: {
          snrDb: null,
          phaseAmplitude: null,
          qualityScore: 0,
          movement: false,
        },
      });
    }, frameTimeoutMs);
  };

  const handleRuntimeError = (
    expectedRunVersion: number,
    session: BreathSonarSession,
    error: unknown,
  ): void => {
    if (!isActiveSession(expectedRunVersion, session)) {
      return;
    }

    const typedError = audioStartError(error);
    const diagnostics = snapshot.diagnostics;
    const failureRunVersion = ++runVersion;
    const failureOperationVersion = ++operationVersion;
    const cleanup = detachActiveSession(session);

    void cleanup.then(() => {
      if (isCurrentOperation(
        failureRunVersion,
        failureOperationVersion,
      )) {
        publishFailure(typedError, diagnostics);
      }
    });
  };

  const handleFrame = (
    expectedRunVersion: number,
    session: BreathSonarSession,
    frame: DemodulatedFrame,
    collectProbeFrame: (frame: DemodulatedFrame) => boolean,
  ): void => {
    if (!isActiveSession(expectedRunVersion, session)) {
      return;
    }
    if (collectProbeFrame(frame)) {
      return;
    }
    if (!processor || !selectedCarrier) {
      return;
    }

    let output: SignalOutput;
    try {
      output = processor.ingest(frame);
    } catch (error) {
      handleRuntimeError(expectedRunVersion, session, error);
      return;
    }

    if (calibrationOperationVersion !== null) {
      publish({
        diagnostics: {
          snrDb: output.carrierSnrDb,
          phaseAmplitude: output.phaseAmplitude,
          qualityScore: output.qualityScore,
          movement: output.movement,
        },
      });
      return;
    }
    armFrameHeartbeat(expectedRunVersion, session, processor);
    publishLiveOutput(output, session, selectedCarrier);
  };

  const attachSession = (
    expectedRunVersion: number,
    session: BreathSonarSession,
    collectProbeFrame: (frame: DemodulatedFrame) => boolean,
  ): void => {
    activeSession = session;
    activeSessionRunVersion = expectedRunVersion;
    unsubscribeFrames = session.subscribe((frame) => {
      handleFrame(
        expectedRunVersion,
        session,
        frame,
        collectProbeFrame,
      );
    });
    unsubscribeErrors = session.subscribeError((error) => {
      handleRuntimeError(expectedRunVersion, session, error);
    });
  };

  const runCalibration = async (
    expectedRunVersion: number,
    expectedOperationVersion: number,
    session: BreathSonarSession,
  ): Promise<void> => {
    cancelFrameHeartbeat();
    const calibrationProcessor = processor;
    const carrier = selectedCarrier;
    if (!calibrationProcessor || !carrier) {
      throw calibrationFailedError(
        'Breath sonar must select a carrier before calibration.',
      );
    }

    calibrationOperationVersion = expectedOperationVersion;
    const stages = [
      ['still', 'calibrating-still', calibrationDurations.still],
      ['inhale', 'calibrating-inhale', calibrationDurations.inhale],
      ['exhale', 'calibrating-exhale', calibrationDurations.exhale],
    ] as const;

    try {
      for (const [stage, status, durationMs] of stages) {
        if (
          !isCurrentOperation(
            expectedRunVersion,
            expectedOperationVersion,
          )
          || !isActiveSession(expectedRunVersion, session)
          || processor !== calibrationProcessor
        ) {
          return;
        }

        calibrationProcessor.beginCalibrationStage(stage);
        publishSnapshot({
          status,
          quality: 'unknown',
          waveform: [],
          diagnostics: {
            frequencyHz: carrier.frequencyHz,
            sampleRateHz: session.sampleRateHz,
            snrDb: snapshot.diagnostics.snrDb ?? carrier.snrDb,
            phaseAmplitude: null,
            qualityScore: null,
            movement: false,
          },
          error: calibrationFailure,
        });
        await delay(durationMs);
      }

      if (
        !isCurrentOperation(
          expectedRunVersion,
          expectedOperationVersion,
        )
        || !isActiveSession(expectedRunVersion, session)
        || processor !== calibrationProcessor
      ) {
        return;
      }

      const calibrated = calibrationProcessor.completeCalibration();
      calibrationOperationVersion = null;
      calibrationFailure = calibrated
        ? null
        : calibrationFailedError(
          'Calibration could not detect clear, opposite inhale and exhale motion.',
        );
      if (calibrated) {
        armFrameHeartbeat(
          expectedRunVersion,
          session,
          calibrationProcessor,
        );
      } else {
        cancelFrameHeartbeat();
      }
      publishSnapshot({
        status: 'poor-signal',
        quality: 'poor',
        waveform: [],
        diagnostics: {
          frequencyHz: carrier.frequencyHz,
          sampleRateHz: session.sampleRateHz,
          snrDb: snapshot.diagnostics.snrDb ?? carrier.snrDb,
          phaseAmplitude: null,
          qualityScore: null,
          movement: false,
        },
        error: calibrationFailure,
      });
    } finally {
      if (calibrationOperationVersion === expectedOperationVersion) {
        calibrationOperationVersion = null;
      }
    }
  };

  const beginSessionCreation = (
    expectedRunVersion: number,
    expectedOperationVersion: number,
    startupController: AbortController,
    priorWork: Promise<void> | null,
    collectProbeFrame: (frame: DemodulatedFrame) => boolean,
  ): Promise<BreathSonarSession | null> => {
    let finishTracking!: () => void;
    const trackedCreation = new Promise<void>((resolve) => {
      finishTracking = resolve;
    });
    pendingSessionCreation = trackedCreation;

    publishSnapshot({
      ...initialSnapshot(),
      status: 'requesting-microphone',
    });
    let createdSession: Promise<BreathSonarSession>;
    try {
      createdSession = createSession(startupController.signal);
    } catch (error) {
      createdSession = Promise.reject(error);
    }
    const settledCreation = createdSession.then(
      (session) => ({ status: 'fulfilled' as const, session }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    const creation = (async () => {
      const [result] = await Promise.all([
        settledCreation,
        priorWork ?? Promise.resolve(),
      ]);
      if (result.status === 'rejected') {
        throw result.error;
      }
      const session = result.session;
      if (!isCurrentOperation(
        expectedRunVersion,
        expectedOperationVersion,
      )) {
        await stopUnownedSession(session);
        return null;
      }

      attachSession(expectedRunVersion, session, collectProbeFrame);
      return session;
    })();

    void creation.then(finishTracking, finishTracking);
    void trackedCreation.then(() => {
      if (pendingSessionCreation === trackedCreation) {
        pendingSessionCreation = null;
      }
      if (pendingStartupController === startupController) {
        pendingStartupController = null;
      }
    });
    return creation;
  };

  const start = async (): Promise<void> => {
    cancelFrameHeartbeat();
    pendingStartupController?.abort();
    const startupController = new AbortController();
    pendingStartupController = startupController;
    const expectedRunVersion = ++runVersion;
    const expectedOperationVersion = ++operationVersion;
    calibrationFailure = null;
    calibrationOperationVersion = null;
    let activeProbeFrames: DemodulatedFrame[] | null = null;
    const collectProbeFrame = (frame: DemodulatedFrame): boolean => {
      if (!activeProbeFrames) {
        return false;
      }
      activeProbeFrames.push(frame);
      return true;
    };

    const previousSessionCreation = pendingSessionCreation;
    const mustWaitForOwnedWork = (
      previousSessionCreation !== null
      || cleanupPendingCount > 0
      || activeSession !== null
    );
    const cleanup = detachActiveSession();
    const priorWork = mustWaitForOwnedWork
      ? Promise.all([
          previousSessionCreation ?? Promise.resolve(),
          cleanup,
        ]).then(() => undefined)
      : null;

    let session: BreathSonarSession | null = null;
    try {
      session = await beginSessionCreation(
        expectedRunVersion,
        expectedOperationVersion,
        startupController,
        priorWork,
        collectProbeFrame,
      );
      if (!session) {
        return;
      }
      if (!isCurrentOperation(
        expectedRunVersion,
        expectedOperationVersion,
      )) {
        await stopUnownedSession(session);
        return;
      }

      publish({
        status: 'checking-device',
        diagnostics: {
          sampleRateHz: session.sampleRateHz,
        },
      });

      const sampleRateHz = session.sampleRateHz;
      const candidates = CARRIER_CANDIDATES_HZ.filter(
        (frequencyHz) => (
          frequencyHz < sampleRateHz * MAX_SAMPLE_RATE_RATIO
        ),
      );
      if (candidates.length === 0) {
        throw carrierUnsupportedError();
      }

      const probes: CarrierProbe[] = [];
      for (const frequencyHz of candidates) {
        if (!isCurrentOperation(
          expectedRunVersion,
          expectedOperationVersion,
        )) {
          return;
        }

        session.setFrequency(frequencyHz);
        const probeFrames: DemodulatedFrame[] = [];
        activeProbeFrames = probeFrames;
        await delay(probeDurationMs);
        if (!isCurrentOperation(
          expectedRunVersion,
          expectedOperationVersion,
        )) {
          activeProbeFrames = null;
          return;
        }
        probes.push({
          frequencyHz,
          frames: probeFrames,
        });
        activeProbeFrames = null;
      }

      const carrier = selectCarrier(probes);
      if (!carrier) {
        throw carrierUnsupportedError();
      }

      session.setFrequency(carrier.frequencyHz);
      selectedCarrier = carrier;
      processor = new BreathSignalProcessor(SIGNAL_SAMPLE_RATE_HZ);
      processor.setCarrierSnrDb(carrier.snrDb);
      publish({
        status: 'checking-device',
        diagnostics: {
          frequencyHz: carrier.frequencyHz,
          sampleRateHz: session.sampleRateHz,
          snrDb: carrier.snrDb,
        },
      });

      await runCalibration(
        expectedRunVersion,
        expectedOperationVersion,
        session,
      );
    } catch (error) {
      activeProbeFrames = null;
      if (!isCurrentOperation(
        expectedRunVersion,
        expectedOperationVersion,
      )) {
        if (session) {
          await stopUnownedSession(session);
        }
        return;
      }
      await failCurrentOperation(
        expectedRunVersion,
        expectedOperationVersion,
        error,
      );
    }
  };

  const recalibrate = async (): Promise<void> => {
    cancelFrameHeartbeat();
    const session = activeSession;
    const expectedRunVersion = activeSessionRunVersion;
    if (
      !session
      || expectedRunVersion === null
      || !processor
      || !selectedCarrier
    ) {
      publishFailure(
        calibrationFailedError(
          'Breath sonar must select a carrier before recalibration.',
        ),
        snapshot.diagnostics,
      );
      return;
    }

    const expectedOperationVersion = ++operationVersion;
    try {
      await runCalibration(
        expectedRunVersion,
        expectedOperationVersion,
        session,
      );
    } catch (error) {
      await failCurrentOperation(
        expectedRunVersion,
        expectedOperationVersion,
        error,
      );
    }
  };

  const stop = (): Promise<void> => {
    cancelFrameHeartbeat();
    pendingStartupController?.abort();
    const expectedRunVersion = ++runVersion;
    const expectedOperationVersion = ++operationVersion;
    calibrationFailure = null;
    calibrationOperationVersion = null;
    const sessionCreation = pendingSessionCreation;
    const cleanup = detachActiveSession();
    const stopping = (async () => {
      await Promise.all([
        cleanup,
        sessionCreation ?? Promise.resolve(),
      ]);
      if (isCurrentOperation(
        expectedRunVersion,
        expectedOperationVersion,
      )) {
        publishSnapshot(initialSnapshot());
      }
    })();
    return stopping;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    recalibrate,
    stop,
  };
}
