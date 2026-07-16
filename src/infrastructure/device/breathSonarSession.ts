import {
  BreathSonarError,
  type DemodulatedFrame,
} from './breathSonarTypes';

const PROCESSOR_NAME = 'breath-sonar-processor';
const OUTPUT_GAIN = 0.02;
const GAIN_RAMP_SECONDS = 0.05;
const GAIN_RAMP_MS = GAIN_RAMP_SECONDS * 1_000;

export interface BreathSonarSession {
  readonly sampleRateHz: number;
  setFrequency(frequencyHz: number): void;
  subscribe(listener: (frame: DemodulatedFrame) => void): () => void;
  subscribeError(listener: (error: BreathSonarError) => void): () => void;
  stop(): Promise<void>;
}

export interface BreathSonarMediaConstraints {
  audio: {
    channelCount: 1;
    echoCancellation: false;
    noiseSuppression: false;
    autoGainControl: false;
  };
}

export interface BreathSonarMediaTrack {
  readonly readyState?: 'live' | 'ended';
  addEventListener(type: 'ended', listener: () => void): void;
  removeEventListener(type: 'ended', listener: () => void): void;
  stop(): void;
}

export interface BreathSonarMediaStream {
  getTracks(): BreathSonarMediaTrack[];
}

export interface BreathSonarAudioParam {
  value: number;
  cancelAndHoldAtTime?(cancelTime: number): void;
  cancelScheduledValues?(cancelTime: number): void;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

export interface BreathSonarAudioNode {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface BreathSonarOscillatorNode extends BreathSonarAudioNode {
  readonly frequency: BreathSonarAudioParam;
  start(): void;
  stop(): void;
}

export interface BreathSonarGainNode extends BreathSonarAudioNode {
  readonly gain: BreathSonarAudioParam;
}

export interface BreathSonarMessagePort {
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  postMessage(message: unknown): void;
  start(): void;
}

export interface BreathSonarWorkletNode extends BreathSonarAudioNode {
  readonly port: BreathSonarMessagePort;
}

export interface BreathSonarAudioContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  state: string;
  readonly destination: unknown;
  readonly audioWorklet?: {
    addModule(url: string): Promise<void>;
  };
  createMediaStreamSource(
    stream: BreathSonarMediaStream,
  ): BreathSonarAudioNode;
  createOscillator(): BreathSonarOscillatorNode;
  createGain(): BreathSonarGainNode;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface BreathSonarBrowserEnvironment {
  isSecureContext: boolean;
  getUserMedia?: (
    constraints: BreathSonarMediaConstraints,
  ) => Promise<BreathSonarMediaStream>;
  createAudioContext?: () => BreathSonarAudioContext;
  createAudioWorkletNode?: (
    context: BreathSonarAudioContext,
  ) => BreathSonarWorkletNode;
  delay(durationMs: number): Promise<void>;
  workletUrl: string;
}

type BreathSonarWindow = Window & {
  AudioContext?: typeof AudioContext;
  AudioWorkletNode?: typeof AudioWorkletNode;
};

interface BreathSonarNavigator {
  mediaDevices?: {
    getUserMedia?: (
      constraints: MediaStreamConstraints,
    ) => Promise<MediaStream>;
  };
}

function unsupported(
  code:
    | 'insecure-context'
    | 'media-unsupported'
    | 'audio-context-unsupported'
    | 'audio-worklet-unsupported',
  message: string,
): BreathSonarError {
  return new BreathSonarError(code, message);
}

function mediaError(error: unknown): BreathSonarError {
  if (error instanceof BreathSonarError) {
    return error;
  }
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : '';
  if (name === 'NotAllowedError') {
    return new BreathSonarError(
      'permission-denied',
      'Microphone permission was denied.',
      { cause: error },
    );
  }
  if (name === 'NotFoundError') {
    return new BreathSonarError(
      'microphone-missing',
      'No microphone is available.',
      { cause: error },
    );
  }
  return new BreathSonarError(
    'audio-start-failed',
    'Could not start the breath sonar audio session.',
    { cause: error },
  );
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

function cancelGainAutomation(
  gain: BreathSonarAudioParam,
  currentTime: number,
): void {
  if (gain.cancelAndHoldAtTime) {
    gain.cancelAndHoldAtTime(currentTime);
    return;
  }
  gain.cancelScheduledValues?.(currentTime);
  gain.setValueAtTime(gain.value, currentTime);
}

export function browserSonarEnvironment(): BreathSonarBrowserEnvironment {
  const browserWindow = window as BreathSonarWindow;
  const browserNavigator = navigator as unknown as BreathSonarNavigator;
  const audioContextConstructor = browserWindow.AudioContext;
  const audioWorkletNodeConstructor = browserWindow.AudioWorkletNode;
  const mediaDevices = browserNavigator.mediaDevices;
  const getUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);

  return {
    isSecureContext: browserWindow.isSecureContext,
    getUserMedia: getUserMedia
      ? async (constraints) => getUserMedia(
        constraints as MediaStreamConstraints,
      ) as unknown as BreathSonarMediaStream
      : undefined,
    createAudioContext: audioContextConstructor
      ? () => new audioContextConstructor() as unknown as BreathSonarAudioContext
      : undefined,
    createAudioWorkletNode: audioWorkletNodeConstructor
      ? (context) => new audioWorkletNodeConstructor(
        context as unknown as AudioContext,
        PROCESSOR_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        },
      ) as unknown as BreathSonarWorkletNode
      : undefined,
    delay: (durationMs) => new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    }),
    workletUrl: new URL(
      './breathSonarWorklet.js?no-inline',
      import.meta.url,
    ).href,
  };
}

export async function createBrowserSonarSession(
  env: BreathSonarBrowserEnvironment = browserSonarEnvironment(),
  signal?: AbortSignal,
): Promise<BreathSonarSession> {
  if (!env.isSecureContext) {
    throw unsupported(
      'insecure-context',
      'Breath sonar requires HTTPS or localhost.',
    );
  }
  if (!env.getUserMedia) {
    throw unsupported(
      'media-unsupported',
      'Microphone capture is not supported in this browser.',
    );
  }
  if (!env.createAudioContext) {
    throw unsupported(
      'audio-context-unsupported',
      'Web Audio is not supported in this browser.',
    );
  }
  if (!env.createAudioWorkletNode) {
    throw unsupported(
      'audio-worklet-unsupported',
      'Audio worklets are not supported in this browser.',
    );
  }

  const frameListeners = new Set<(frame: DemodulatedFrame) => void>();
  const errorListeners = new Set<(error: BreathSonarError) => void>();
  let tracks: BreathSonarMediaTrack[] = [];
  let context: BreathSonarAudioContext | null = null;
  let source: BreathSonarAudioNode | null = null;
  let oscillator: BreathSonarOscillatorNode | null = null;
  let outputGain: BreathSonarGainNode | null = null;
  let worklet: BreathSonarWorkletNode | null = null;
  let silentGain: BreathSonarGainNode | null = null;
  let oscillatorStarted = false;
  let messageListenerAttached = false;
  let trackListenersAttached = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let latestGeneration = 0;
  let startupDeviceLostError: BreathSonarError | null = null;
  let startupAbortError: BreathSonarError | null = null;
  let abortListenerAttached = false;

  const getStartupAbortError = (): BreathSonarError => {
    startupAbortError ??= new BreathSonarError(
      'audio-start-failed',
      'Breath sonar audio startup was cancelled.',
    );
    return startupAbortError;
  };

  const removeAbortListener = (): void => {
    if (signal && abortListenerAttached) {
      signal.removeEventListener('abort', onAbort);
      abortListenerAttached = false;
    }
  };

  const throwIfAborted = (): void => {
    if (signal?.aborted || startupAbortError) {
      throw getStartupAbortError();
    }
  };

  const raceStartup = <T>(promise: Promise<T>): Promise<T> => {
    if (!signal) {
      return promise;
    }
    if (signal.aborted) {
      return Promise.reject(getStartupAbortError());
    }

    return new Promise<T>((resolve, reject) => {
      const rejectForAbort = (): void => {
        signal.removeEventListener('abort', rejectForAbort);
        reject(getStartupAbortError());
      };
      signal.addEventListener('abort', rejectForAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', rejectForAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', rejectForAbort);
          reject(error);
        },
      );
    });
  };

  const onMessage = (event: { data: unknown }): void => {
    const data = event.data as {
      type?: string;
      generation?: number;
      frame?: DemodulatedFrame;
    };
    if (
      data?.type !== 'frame'
      || data.generation !== latestGeneration
      || !data.frame
    ) {
      return;
    }
    for (const listener of frameListeners) {
      listener(data.frame);
    }
  };

  const onTrackEnded = (): void => {
    const error = startupDeviceLostError ?? new BreathSonarError(
      'device-lost',
      'The microphone disconnected during breath sonar.',
    );
    startupDeviceLostError = error;
    void cleanup().catch(() => undefined);
    for (const listener of errorListeners) {
      listener(error);
    }
  };

  const cleanup = (): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }
    stopped = true;
    removeAbortListener();
    stopPromise = (async () => {
      if (worklet && messageListenerAttached) {
        worklet.port.removeEventListener('message', onMessage);
        messageListenerAttached = false;
      }
      if (trackListenersAttached) {
        for (const track of tracks) {
          track.removeEventListener('ended', onTrackEnded);
        }
        trackListenersAttached = false;
      }
      for (const track of tracks) {
        track.stop();
      }
      const shouldFadeOutput = Boolean(
        context
        && outputGain
        && oscillator
        && oscillatorStarted,
      );
      if (shouldFadeOutput && context && outputGain) {
        cancelGainAutomation(outputGain.gain, context.currentTime);
        outputGain.gain.linearRampToValueAtTime(
          0,
          context.currentTime + GAIN_RAMP_SECONDS,
        );
      }
      try {
        if (shouldFadeOutput) {
          await env.delay(GAIN_RAMP_MS);
        }
      } finally {
        if (oscillator && oscillatorStarted) {
          oscillator.stop();
          oscillatorStarted = false;
        }
        oscillator?.disconnect();
        outputGain?.disconnect();
        source?.disconnect();
        worklet?.disconnect();
        silentGain?.disconnect();
      }
      try {
        if (context) {
          await context.close();
        }
      } finally {
        frameListeners.clear();
        errorListeners.clear();
      }
    })();
    return stopPromise;
  };

  const onAbort = (): void => {
    getStartupAbortError();
    removeAbortListener();
    void cleanup().catch(() => undefined);
  };

  if (signal?.aborted) {
    throw getStartupAbortError();
  }
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
    abortListenerAttached = true;
  }

  try {
    context = env.createAudioContext();
    const resumePromise = context.state === 'suspended'
      ? context.resume()
      : Promise.resolve();
    void resumePromise.catch(() => undefined);

    const mediaPromise = env.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    }).then(
      (acquiredStream) => {
        const acquiredTracks = acquiredStream.getTracks();
        if (stopped || signal?.aborted || startupAbortError) {
          for (const track of acquiredTracks) {
            track.stop();
          }
          if (signal?.aborted || startupAbortError) {
            throw getStartupAbortError();
          }
          throw new BreathSonarError(
            'audio-start-failed',
            'Breath sonar audio startup is no longer active.',
          );
        }

        tracks = acquiredTracks;
        trackListenersAttached = true;
        for (const track of tracks) {
          track.addEventListener('ended', onTrackEnded);
        }
        if (tracks.some((track) => track.readyState === 'ended')) {
          startupDeviceLostError = new BreathSonarError(
            'device-lost',
            'The microphone disconnected during breath sonar.',
          );
          throw startupDeviceLostError;
        }
        return acquiredStream;
      },
      (error: unknown) => {
        throw mediaError(error);
      },
    );
    void mediaPromise.catch(() => undefined);

    if (!context.audioWorklet?.addModule) {
      throw unsupported(
        'audio-worklet-unsupported',
        'Audio worklets are not supported in this browser.',
      );
    }
    const [, acquiredStream] = await Promise.all([
      raceStartup(resumePromise),
      raceStartup(mediaPromise),
    ]);
    throwIfAborted();
    if (startupDeviceLostError) {
      throw startupDeviceLostError;
    }
    await raceStartup(context.audioWorklet.addModule(env.workletUrl));
    throwIfAborted();
    if (startupDeviceLostError) {
      throw startupDeviceLostError;
    }

    source = context.createMediaStreamSource(acquiredStream);
    throwIfAborted();
    oscillator = context.createOscillator();
    outputGain = context.createGain();
    worklet = env.createAudioWorkletNode(context);
    silentGain = context.createGain();
    throwIfAborted();

    outputGain.gain.value = 0;
    outputGain.gain.setValueAtTime(0, context.currentTime);
    silentGain.gain.value = 0;
    source.connect(worklet);
    worklet.connect(silentGain);
    silentGain.connect(context.destination);
    oscillator.connect(outputGain);
    outputGain.connect(context.destination);

    worklet.port.addEventListener('message', onMessage);
    messageListenerAttached = true;
    worklet.port.start();
    throwIfAborted();
    oscillator.start();
    oscillatorStarted = true;
    removeAbortListener();
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw startupDeviceLostError
      ?? startupAbortError
      ?? audioStartError(error);
  }

  return {
    sampleRateHz: context.sampleRate,
    setFrequency(frequencyHz: number): void {
      if (
        !Number.isFinite(frequencyHz)
        || frequencyHz <= 0
        || frequencyHz >= context.sampleRate / 2
      ) {
        throw new RangeError(
          'Breath sonar frequency must be finite, positive, and below Nyquist.',
        );
      }
      if (stopped) {
        throw new BreathSonarError(
          'device-lost',
          'The breath sonar audio session is no longer active.',
        );
      }
      latestGeneration += 1;
      oscillator.frequency.setValueAtTime(
        frequencyHz,
        context.currentTime,
      );
      worklet.port.postMessage({
        type: 'set-frequency',
        frequencyHz,
        generation: latestGeneration,
      });
      cancelGainAutomation(outputGain.gain, context.currentTime);
      outputGain.gain.linearRampToValueAtTime(
        OUTPUT_GAIN,
        context.currentTime + GAIN_RAMP_SECONDS,
      );
    },
    subscribe(listener): () => void {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    subscribeError(listener): () => void {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },
    stop: cleanup,
  };
}
