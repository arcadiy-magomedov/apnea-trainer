import { describe, expect, it, vi } from 'vitest';
import {
  browserSonarEnvironment,
  createBrowserSonarSession,
  type BreathSonarBrowserEnvironment,
} from './breathSonarSession';
import {
  BreathSonarError,
  type DemodulatedFrame,
} from './breathSonarTypes';

function testEnvironment(
  overrides: Partial<BreathSonarBrowserEnvironment> = {},
) {
  let messageListener:
    | ((event: { data: unknown }) => void)
    | undefined;
  const endedListeners = new Map<object, () => void>();
  const createTrack = () => {
    const track = {
      readyState: 'live' as 'live' | 'ended',
      stop: vi.fn(),
      addEventListener: vi.fn((
        type: 'ended',
        listener: () => void,
      ) => {
        if (type === 'ended') endedListeners.set(track, listener);
      }),
      removeEventListener: vi.fn((
        type: 'ended',
        listener: () => void,
      ) => {
        if (type === 'ended' && endedListeners.get(track) === listener) {
          endedListeners.delete(track);
        }
      }),
    };
    return track;
  };
  const tracks = [createTrack(), createTrack()];
  const stream = {
    getTracks: vi.fn(() => tracks),
  };
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const oscillator = {
    frequency: {
      value: 440,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const outputGain = {
    gain: {
      value: 1,
      cancelAndHoldAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const silentGain = {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const port = {
    addEventListener: vi.fn((
      type: 'message',
      listener: (event: { data: unknown }) => void,
    ) => {
      if (type === 'message') messageListener = listener;
    }),
    removeEventListener: vi.fn((
      type: 'message',
      listener: (event: { data: unknown }) => void,
    ) => {
      if (type === 'message' && messageListener === listener) {
        messageListener = undefined;
      }
    }),
    postMessage: vi.fn(),
    start: vi.fn(),
  };
  const worklet = {
    port,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const audioWorklet = {
    addModule: vi.fn(async () => undefined),
  };
  const context = {
    sampleRate: 48_000,
    currentTime: 12.5,
    state: 'running',
    destination: { name: 'destination' },
    audioWorklet,
    createMediaStreamSource: vi.fn(() => source),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn()
      .mockReturnValueOnce(outputGain)
      .mockReturnValueOnce(silentGain),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const getUserMedia = vi.fn(async () => stream);
  const createAudioContext = vi.fn(() => context);
  const createAudioWorkletNode = vi.fn(() => worklet);
  const delay = vi.fn(async () => undefined);
  const env = {
    isSecureContext: true,
    getUserMedia,
    createAudioContext,
    createAudioWorkletNode,
    delay,
    workletUrl: '/assets/breathSonarWorklet.js',
    ...overrides,
  } satisfies BreathSonarBrowserEnvironment;

  return {
    env,
    stream,
    tracks,
    source,
    oscillator,
    outputGain,
    silentGain,
    port,
    worklet,
    audioWorklet,
    context,
    getUserMedia,
    createAudioContext,
    createAudioWorkletNode,
    delay: env.delay,
    emitMessage(data: unknown) {
      messageListener?.({ data });
    },
    emitTrackEnded(track = tracks[0]) {
      endedListeners.get(track)?.();
    },
  };
}

const frame: DemodulatedFrame = {
  timeMs: 50,
  i: 0.2,
  q: -0.1,
  sidebandMagnitude: 0.01,
  broadbandRms: 0.15,
  clipped: false,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

type PromiseOutcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; error: unknown };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function observePromise<T>(promise: Promise<T>): Promise<PromiseOutcome<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (error: unknown) => ({ status: 'rejected', error }),
  );
}

async function expectPromptOutcome<T>(
  outcomePromise: Promise<PromiseOutcome<T>>,
): Promise<PromiseOutcome<T>> {
  let outcome: PromiseOutcome<T> | undefined;
  void outcomePromise.then((nextOutcome) => {
    outcome = nextOutcome;
  });
  for (let attempt = 0; attempt < 10 && !outcome; attempt += 1) {
    await Promise.resolve();
  }
  expect(outcome).toBeDefined();
  return outcome as PromiseOutcome<T>;
}

async function rejectedBreathSonarError(
  promise: Promise<unknown>,
): Promise<BreathSonarError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BreathSonarError);
    return error as BreathSonarError;
  }
  throw new Error('Expected BreathSonarError rejection.');
}

describe('browserSonarEnvironment', () => {
  it('uses the colocated non-inline worklet asset URL', () => {
    expect(browserSonarEnvironment().workletUrl).toBe(
      new URL('./breathSonarWorklet.js?no-inline', import.meta.url).href,
    );
  });

  it('provides a timer-backed delay', async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const wait = browserSonarEnvironment().delay(50).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(49);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await wait;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createBrowserSonarSession capabilities', () => {
  it('rejects an insecure context before requesting permission', async () => {
    const setup = testEnvironment({ isSecureContext: false });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('insecure-context');
    expect(setup.getUserMedia).not.toHaveBeenCalled();
  });

  it('reports unsupported microphone capture without requesting permission', async () => {
    const setup = testEnvironment({ getUserMedia: undefined });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('media-unsupported');
    expect(setup.getUserMedia).not.toHaveBeenCalled();
  });

  it('reports an unsupported audio context before requesting permission', async () => {
    const setup = testEnvironment({ createAudioContext: undefined });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('audio-context-unsupported');
    expect(setup.getUserMedia).not.toHaveBeenCalled();
  });

  it('reports an unsupported AudioWorklet before requesting permission', async () => {
    const setup = testEnvironment({ createAudioWorkletNode: undefined });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('audio-worklet-unsupported');
    expect(setup.getUserMedia).not.toHaveBeenCalled();
  });

  it('reports a context without AudioWorklet support and releases resources', async () => {
    const setup = testEnvironment();
    const unsupportedContext = {
      ...setup.context,
      audioWorklet: undefined,
    };
    setup.env.createAudioContext = vi.fn(() => unsupportedContext);

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('audio-worklet-unsupported');
    for (const track of setup.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(setup.context.close).toHaveBeenCalledTimes(1);
  });
});

describe('createBrowserSonarSession setup', () => {
  it('starts context resume and microphone permission synchronously in activation order', async () => {
    const setup = testEnvironment();
    const calls: string[] = [];
    const pendingResume = deferred<undefined>();
    const pendingMedia = deferred<typeof setup.stream>();
    setup.context.state = 'suspended';
    setup.env.createAudioContext = vi.fn(() => {
      calls.push('create-audio-context');
      return setup.context;
    });
    setup.context.resume.mockImplementation(() => {
      calls.push('resume');
      return pendingResume.promise;
    });
    setup.env.getUserMedia = vi.fn(() => {
      calls.push('get-user-media');
      return pendingMedia.promise;
    });

    const sessionPromise = createBrowserSonarSession(setup.env);

    expect(calls).toEqual([
      'create-audio-context',
      'resume',
      'get-user-media',
    ]);

    pendingResume.resolve(undefined);
    pendingMedia.resolve(setup.stream);
    const session = await sessionPromise;
    await session.stop();
  });

  it('requests exactly unprocessed mono microphone audio', async () => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);

    expect(setup.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    await session.stop();
  });

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'microphone-missing'],
  ])('maps %s from microphone setup to %s', async (name, code) => {
    const cause = new DOMException('media failure', name);
    const setup = testEnvironment({
      getUserMedia: vi.fn(async () => {
        throw cause;
      }),
    });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe(code);
    expect(error.cause).toBe(cause);
    expect(setup.context.close).toHaveBeenCalledTimes(1);
  });

  it('maps other setup failures to audio-start-failed', async () => {
    const cause = new Error('device busy');
    const setup = testEnvironment({
      getUserMedia: vi.fn(async () => {
        throw cause;
      }),
    });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('audio-start-failed');
    expect(error.cause).toBe(cause);
  });

  it('resumes one suspended context before loading the worklet', async () => {
    const setup = testEnvironment();
    setup.context.state = 'suspended';

    const session = await createBrowserSonarSession(setup.env);

    expect(setup.createAudioContext).toHaveBeenCalledTimes(1);
    expect(setup.context.resume).toHaveBeenCalledTimes(1);
    expect(setup.context.resume.mock.invocationCallOrder[0])
      .toBeLessThan(setup.audioWorklet.addModule.mock.invocationCallOrder[0]);
    await session.stop();
  });

  it('aborts while microphone permission is pending and stops a late stream', async () => {
    const setup = testEnvironment();
    const pendingMedia = deferred<typeof setup.stream>();
    setup.env.getUserMedia = vi.fn(() => pendingMedia.promise);
    const controller = new AbortController();
    const outcomePromise = observePromise(
      createBrowserSonarSession(setup.env, controller.signal),
    );

    controller.abort();

    try {
      const outcome = await expectPromptOutcome(outcomePromise);
      expect(outcome).toMatchObject({
        status: 'rejected',
        error: { code: 'audio-start-failed' },
      });
      expect(setup.context.close).toHaveBeenCalledTimes(1);
      expect(setup.context.createMediaStreamSource).not.toHaveBeenCalled();

      pendingMedia.resolve(setup.stream);
      await vi.waitFor(() => {
        for (const track of setup.tracks) {
          expect(track.stop).toHaveBeenCalledTimes(1);
        }
      });
      expect(setup.context.createOscillator).not.toHaveBeenCalled();
      expect(setup.createAudioWorkletNode).not.toHaveBeenCalled();
    } finally {
      pendingMedia.resolve(setup.stream);
      const outcome = await outcomePromise;
      if (outcome.status === 'fulfilled') {
        await outcome.value.stop();
      }
    }
  });

  it('aborts while resume is pending without creating the audio graph', async () => {
    const setup = testEnvironment();
    const pendingResume = deferred<undefined>();
    const unhandledRejection = vi.fn();
    setup.context.state = 'suspended';
    setup.context.resume.mockImplementation(() => pendingResume.promise);
    const controller = new AbortController();
    process.on('unhandledRejection', unhandledRejection);

    const outcomePromise = observePromise(
      createBrowserSonarSession(setup.env, controller.signal),
    );
    await vi.waitFor(() => {
      expect(setup.context.resume).toHaveBeenCalledTimes(1);
    });
    controller.abort();

    try {
      const outcome = await expectPromptOutcome(outcomePromise);
      expect(outcome).toMatchObject({
        status: 'rejected',
        error: { code: 'audio-start-failed' },
      });
      for (const track of setup.tracks) {
        expect(track.stop).toHaveBeenCalledTimes(1);
      }
      expect(setup.context.close).toHaveBeenCalledTimes(1);
      expect(setup.audioWorklet.addModule).not.toHaveBeenCalled();
      expect(setup.context.createOscillator).not.toHaveBeenCalled();

      pendingResume.reject(new Error('late resume failure'));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
      pendingResume.reject(new Error('late resume failure'));
      await outcomePromise;
    }
  });

  it('aborts while the worklet loads and handles its late rejection', async () => {
    const setup = testEnvironment();
    const pendingModule = deferred<undefined>();
    const unhandledRejection = vi.fn();
    setup.audioWorklet.addModule.mockImplementation(
      () => pendingModule.promise,
    );
    const controller = new AbortController();
    process.on('unhandledRejection', unhandledRejection);

    const outcomePromise = observePromise(
      createBrowserSonarSession(setup.env, controller.signal),
    );
    await vi.waitFor(() => {
      expect(setup.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    });
    controller.abort();

    try {
      const outcome = await expectPromptOutcome(outcomePromise);
      expect(outcome).toMatchObject({
        status: 'rejected',
        error: { code: 'audio-start-failed' },
      });
      for (const track of setup.tracks) {
        expect(track.removeEventListener).toHaveBeenCalledTimes(1);
        expect(track.stop).toHaveBeenCalledTimes(1);
      }
      expect(setup.context.close).toHaveBeenCalledTimes(1);
      expect(setup.context.createMediaStreamSource).not.toHaveBeenCalled();
      expect(setup.context.createOscillator).not.toHaveBeenCalled();
      expect(setup.createAudioWorkletNode).not.toHaveBeenCalled();
      expect(setup.oscillator.start).not.toHaveBeenCalled();

      pendingModule.reject(new Error('late worklet failure'));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
      pendingModule.reject(new Error('late worklet failure'));
      await outcomePromise;
    }
  });

  it('rejects before loading the worklet when a track ends during resume', async () => {
    let finishResume: (() => void) | undefined;
    const setup = testEnvironment();
    setup.context.state = 'suspended';
    setup.context.resume.mockImplementation(() => (
      new Promise<undefined>((resolve) => {
        finishResume = () => resolve(undefined);
      })
    ));

    const sessionPromise = createBrowserSonarSession(setup.env);
    await vi.waitFor(() => {
      expect(setup.context.resume).toHaveBeenCalledTimes(1);
    });

    setup.emitTrackEnded();

    for (const track of setup.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    finishResume?.();

    const error = await rejectedBreathSonarError(sessionPromise);
    expect(error.code).toBe('device-lost');
    expect(setup.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(setup.context.close).toHaveBeenCalledTimes(1);
  });

  it('rejects and cleans up when an acquired track is already ended', async () => {
    const setup = testEnvironment();
    setup.tracks[0].readyState = 'ended';

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );

    expect(error.code).toBe('device-lost');
    expect(setup.createAudioContext).toHaveBeenCalledTimes(1);
    expect(setup.context.close).toHaveBeenCalledTimes(1);
    for (const track of setup.tracks) {
      expect(track.addEventListener).toHaveBeenCalledTimes(1);
      expect(track.removeEventListener).toHaveBeenCalledTimes(1);
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects and cleans up when a track ends while the worklet loads', async () => {
    let failAddModule: (() => void) | undefined;
    const setup = testEnvironment();
    setup.audioWorklet.addModule.mockImplementation(() => (
      new Promise<undefined>((_resolve, reject) => {
        failAddModule = () => reject(new Error('context closed'));
      })
    ));

    const sessionPromise = createBrowserSonarSession(setup.env);
    await vi.waitFor(() => {
      expect(setup.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    });

    setup.emitTrackEnded();

    for (const track of setup.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    failAddModule?.();

    const error = await rejectedBreathSonarError(sessionPromise);
    expect(error.code).toBe('device-lost');
    for (const track of setup.tracks) {
      expect(track.addEventListener).toHaveBeenCalledTimes(1);
      expect(track.removeEventListener).toHaveBeenCalledTimes(1);
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(setup.context.close).toHaveBeenCalledTimes(1);
    expect(setup.context.createMediaStreamSource).not.toHaveBeenCalled();
  });

  it('loads the worklet and constructs the pulled audio graph at zero output', async () => {
    const setup = testEnvironment();

    const session = await createBrowserSonarSession(setup.env);

    expect(setup.audioWorklet.addModule)
      .toHaveBeenCalledWith(setup.env.workletUrl);
    expect(setup.source.connect).toHaveBeenCalledWith(setup.worklet);
    expect(setup.worklet.connect).toHaveBeenCalledWith(setup.silentGain);
    expect(setup.silentGain.connect)
      .toHaveBeenCalledWith(setup.context.destination);
    expect(setup.oscillator.connect).toHaveBeenCalledWith(setup.outputGain);
    expect(setup.outputGain.connect)
      .toHaveBeenCalledWith(setup.context.destination);
    expect(setup.outputGain.gain.setValueAtTime)
      .toHaveBeenCalledWith(0, setup.context.currentTime);
    expect(setup.silentGain.gain.value).toBe(0);
    expect(setup.port.start).toHaveBeenCalledTimes(1);
    expect(setup.oscillator.start).toHaveBeenCalledTimes(1);
    expect(session.sampleRateHz).toBe(48_000);
    await session.stop();
  });

  it('releases every acquired resource when setup fails', async () => {
    const cause = new Error('node construction failed');
    const setup = testEnvironment({
      createAudioWorkletNode: vi.fn(() => {
        throw cause;
      }),
    });

    const error = await rejectedBreathSonarError(
      createBrowserSonarSession(setup.env),
    );
    expect(error.code).toBe('audio-start-failed');
    expect(error.cause).toBe(cause);
    expect(setup.source.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.outputGain.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.oscillator.stop).not.toHaveBeenCalled();
    expect(setup.delay).not.toHaveBeenCalled();
    for (const track of setup.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(setup.context.close).toHaveBeenCalledTimes(1);
  });

  it('preserves an already typed setup error', async () => {
    const typedError = new BreathSonarError(
      'audio-worklet-unsupported',
      'Worklet unavailable.',
    );
    const setup = testEnvironment({
      createAudioWorkletNode: vi.fn(() => {
        throw typedError;
      }),
    });

    await expect(createBrowserSonarSession(setup.env))
      .rejects.toBe(typedError);
  });
});

describe('BreathSonarSession', () => {
  it('sets frequency and cancels prior automation before fading in', async () => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);
    setup.oscillator.frequency.setValueAtTime.mockClear();
    setup.outputGain.gain.cancelAndHoldAtTime.mockClear();
    setup.outputGain.gain.setValueAtTime.mockClear();
    setup.outputGain.gain.linearRampToValueAtTime.mockClear();

    session.setFrequency(19_000);

    expect(setup.oscillator.frequency.setValueAtTime)
      .toHaveBeenCalledWith(19_000, 12.5);
    expect(setup.port.postMessage).toHaveBeenCalledWith({
      type: 'set-frequency',
      frequencyHz: 19_000,
      generation: 1,
    });
    expect(setup.outputGain.gain.cancelAndHoldAtTime)
      .toHaveBeenCalledWith(12.5);
    expect(setup.outputGain.gain.setValueAtTime).not.toHaveBeenCalled();
    expect(setup.outputGain.gain.linearRampToValueAtTime)
      .toHaveBeenCalledWith(0.02, 12.55);
    expect(
      setup.outputGain.gain.cancelAndHoldAtTime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      setup.outputGain.gain.linearRampToValueAtTime.mock.invocationCallOrder[0],
    );
    await session.stop();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    24_000,
    25_000,
  ])('rejects invalid frequency %s without touching audio nodes', async (frequencyHz) => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);
    setup.oscillator.frequency.setValueAtTime.mockClear();
    setup.port.postMessage.mockClear();
    setup.outputGain.gain.linearRampToValueAtTime.mockClear();

    expect(() => session.setFrequency(frequencyHz)).toThrow(RangeError);
    expect(setup.oscillator.frequency.setValueAtTime).not.toHaveBeenCalled();
    expect(setup.port.postMessage).not.toHaveBeenCalled();
    expect(setup.outputGain.gain.linearRampToValueAtTime)
      .not.toHaveBeenCalled();
    await session.stop();
  });

  it('notifies frame subscribers until they unsubscribe', async () => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    setup.emitMessage({ type: 'ignored' });
    setup.emitMessage({ type: 'frame', generation: 0, frame });
    unsubscribe();
    setup.emitMessage({
      type: 'frame',
      generation: 0,
      frame: { ...frame, timeMs: 100 },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(frame);
    await session.stop();
  });

  it('drops stale frame generations and delivers the current frame', async () => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);
    const listener = vi.fn();
    session.subscribe(listener);
    session.setFrequency(19_000);
    session.setFrequency(18_000);
    const currentFrame = { ...frame, timeMs: 100 };

    setup.emitMessage({ type: 'frame', generation: 1, frame });
    setup.emitMessage({
      type: 'frame',
      generation: 2,
      frame: currentFrame,
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(currentFrame);
    await session.stop();
  });

  it('cleans up an ended track before notifying device-lost listeners', async () => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);
    const listenerError = new Error('listener failed');
    const listener = vi.fn((error: BreathSonarError) => {
      expect(error).toBeInstanceOf(BreathSonarError);
      expect(error).toMatchObject({ code: 'device-lost' });
      throw listenerError;
    });
    session.subscribeError(listener);

    expect(() => setup.emitTrackEnded()).toThrow(listenerError);

    expect(listener).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(setup.context.close).toHaveBeenCalledTimes(1);
    });
    for (const track of setup.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(setup.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(setup.source.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.worklet.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.context.close).toHaveBeenCalledTimes(1);
  });

  it('waits for the stop fade before tearing down the output graph', async () => {
    let finishDelay: (() => void) | undefined;
    const delay = vi.fn(() => new Promise<void>((resolve) => {
      finishDelay = resolve;
    }));
    const setup = testEnvironment({ delay });
    const session = await createBrowserSonarSession(setup.env);
    session.setFrequency(19_000);
    setup.outputGain.gain.cancelAndHoldAtTime.mockClear();
    setup.outputGain.gain.setValueAtTime.mockClear();
    setup.outputGain.gain.linearRampToValueAtTime.mockClear();

    const firstStop = session.stop();
    const secondStop = session.stop();

    expect(secondStop).toBe(firstStop);
    expect(delay).toHaveBeenCalledWith(50);
    expect(setup.port.removeEventListener).toHaveBeenCalledTimes(1);
    for (const track of setup.tracks) {
      expect(track.removeEventListener).toHaveBeenCalledTimes(1);
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(setup.outputGain.gain.cancelAndHoldAtTime)
      .toHaveBeenCalledWith(12.5);
    expect(setup.outputGain.gain.setValueAtTime).not.toHaveBeenCalled();
    expect(setup.outputGain.gain.linearRampToValueAtTime)
      .toHaveBeenCalledWith(0, 12.55);
    expect(
      setup.outputGain.gain.cancelAndHoldAtTime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      setup.outputGain.gain.linearRampToValueAtTime.mock.invocationCallOrder[0],
    );
    expect(setup.oscillator.stop).not.toHaveBeenCalled();
    expect(setup.oscillator.disconnect).not.toHaveBeenCalled();
    expect(setup.outputGain.disconnect).not.toHaveBeenCalled();
    expect(setup.source.disconnect).not.toHaveBeenCalled();
    expect(setup.worklet.disconnect).not.toHaveBeenCalled();
    expect(setup.context.close).not.toHaveBeenCalled();

    finishDelay?.();
    await firstStop;

    expect(setup.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(setup.oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.outputGain.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.source.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.worklet.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.context.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to cancelling and anchoring gain automation before stop', async () => {
    let finishDelay: (() => void) | undefined;
    const delay = vi.fn(() => new Promise<void>((resolve) => {
      finishDelay = resolve;
    }));
    const setup = testEnvironment({ delay });
    Object.assign(setup.outputGain.gain, {
      cancelAndHoldAtTime: undefined,
    });
    const session = await createBrowserSonarSession(setup.env);
    session.setFrequency(19_000);
    setup.outputGain.gain.cancelScheduledValues.mockClear();
    setup.outputGain.gain.setValueAtTime.mockClear();
    setup.outputGain.gain.linearRampToValueAtTime.mockClear();

    const stopping = session.stop();

    expect(setup.outputGain.gain.cancelScheduledValues)
      .toHaveBeenCalledWith(12.5);
    expect(setup.outputGain.gain.setValueAtTime)
      .toHaveBeenCalledWith(setup.outputGain.gain.value, 12.5);
    expect(setup.outputGain.gain.linearRampToValueAtTime)
      .toHaveBeenCalledWith(0, 12.55);
    expect(
      setup.outputGain.gain.cancelScheduledValues.mock.invocationCallOrder[0],
    ).toBeLessThan(
      setup.outputGain.gain.setValueAtTime.mock.invocationCallOrder[0],
    );
    expect(
      setup.outputGain.gain.setValueAtTime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      setup.outputGain.gain.linearRampToValueAtTime.mock.invocationCallOrder[0],
    );

    finishDelay?.();
    await stopping;
  });

  it('performs full cleanup exactly once and clears subscribers', async () => {
    const setup = testEnvironment();
    const session = await createBrowserSonarSession(setup.env);
    const frameListener = vi.fn();
    const errorListener = vi.fn();
    session.subscribe(frameListener);
    session.subscribeError(errorListener);
    setup.outputGain.gain.cancelAndHoldAtTime.mockClear();
    setup.outputGain.gain.setValueAtTime.mockClear();
    setup.outputGain.gain.linearRampToValueAtTime.mockClear();

    await Promise.all([session.stop(), session.stop()]);
    setup.emitMessage({ type: 'frame', frame });
    setup.emitTrackEnded();

    expect(setup.port.removeEventListener).toHaveBeenCalledTimes(1);
    for (const track of setup.tracks) {
      expect(track.removeEventListener).toHaveBeenCalledTimes(1);
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(setup.outputGain.gain.cancelAndHoldAtTime)
      .toHaveBeenCalledWith(12.5);
    expect(setup.outputGain.gain.setValueAtTime).not.toHaveBeenCalled();
    expect(setup.outputGain.gain.linearRampToValueAtTime)
      .toHaveBeenCalledWith(0, 12.55);
    expect(setup.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(setup.oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.outputGain.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.source.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.worklet.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.silentGain.disconnect).toHaveBeenCalledTimes(1);
    expect(setup.context.close).toHaveBeenCalledTimes(1);
    expect(frameListener).not.toHaveBeenCalled();
    expect(errorListener).not.toHaveBeenCalled();
  });
});
