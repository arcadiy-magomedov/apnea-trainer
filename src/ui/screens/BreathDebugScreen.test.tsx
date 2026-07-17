import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BreathDebugScreen } from './BreathDebugScreen';
import {
  BreathSonarError,
  type BreathSonarEngine,
  type BreathSonarSnapshot,
} from '../../infrastructure/device/breathSonarTypes';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

type SnapshotOverrides = Omit<Partial<BreathSonarSnapshot>, 'diagnostics'> & {
  diagnostics?: Partial<BreathSonarSnapshot['diagnostics']>;
};

function makeSnapshot(
  overrides: SnapshotOverrides = {},
): BreathSonarSnapshot {
  const base: BreathSonarSnapshot = {
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
  };
  const snapshot: BreathSonarSnapshot = {
    ...base,
    ...overrides,
    diagnostics: {
      ...base.diagnostics,
      ...overrides.diagnostics,
    },
  };
  return deepFreeze(snapshot);
}

function createControllableEngine(
  initialSnapshot: BreathSonarSnapshot = makeSnapshot(),
): BreathSonarEngine & {
  emit(next: SnapshotOverrides): void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  recalibrate: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<(snapshot: BreathSonarSnapshot) => void>();
  let snapshot = initialSnapshot;
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const recalibrate = vi.fn(async () => undefined);

  return {
    getSnapshot: vi.fn(() => snapshot),
    subscribe(listener: (next: BreathSonarSnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    recalibrate,
    emit(next: SnapshotOverrides) {
      snapshot = makeSnapshot({
        ...snapshot,
        ...next,
        diagnostics: {
          ...snapshot.diagnostics,
          ...next.diagnostics,
        },
      });
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
  };
}

function createDeferredStopEngine(
  initialSnapshot: BreathSonarSnapshot = makeSnapshot({
    status: 'inhale',
    diagnostics: {
      frequencyHz: 18_500,
    },
  }),
): BreathSonarEngine & {
  emit(next: SnapshotOverrides): void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  recalibrate: ReturnType<typeof vi.fn>;
  resolveStop(): void;
} {
  const engine = createControllableEngine(initialSnapshot);
  let resolveStop!: () => void;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  return {
    ...engine,
    stop: vi.fn(() => stopPromise),
    resolveStop,
  };
}

function renderScreen(
  engine = createControllableEngine(),
) {
  render(<BreathDebugScreen createEngine={() => engine} />);
  return { engine };
}

function statusCopy(status: BreathSonarSnapshot['status']): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'requesting-microphone':
      return 'Requesting microphone';
    case 'checking-device':
      return 'Checking device';
    case 'calibrating-still':
      return 'Calibrating - stay still';
    case 'calibrating-inhale':
      return 'Calibrating - inhale';
    case 'calibrating-exhale':
      return 'Calibrating - exhale';
    case 'inhale':
      return 'Inhale';
    case 'exhale':
      return 'Exhale';
    case 'movement':
      return 'Movement detected - hold still';
    case 'poor-signal':
      return 'Poor signal';
    case 'unsupported':
      return 'Unsupported on this device or placement';
    case 'error':
      return 'Error';
  }
}

async function clickButton(name: RegExp | string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name }));
}

const SETUP_INSTRUCTIONS = [
  'Use a quiet room and keep still.',
  'Hold the phone 15-30 cm from your face or upper chest.',
  'Point the phone speaker and microphone toward your body.',
  'Use the phone speaker, not headphones or earbuds.',
  'The carrier may be audible to children or nearby animals.',
  'Stop if you hear a high-frequency tone or feel uncomfortable.',
] as const;

const ACTIVE_STATUSES: ReadonlyArray<BreathSonarSnapshot['status']> = [
  'requesting-microphone',
  'checking-device',
  'calibrating-still',
  'calibrating-inhale',
  'calibrating-exhale',
  'inhale',
  'exhale',
  'movement',
  'poor-signal',
] as const;

const INACTIVE_STATUSES: ReadonlyArray<BreathSonarSnapshot['status']> = [
  'idle',
  'unsupported',
  'error',
];

const ALL_STATUSES = [...ACTIVE_STATUSES, ...INACTIVE_STATUSES] as const;

function expectsRecalibrateEnabled(status: BreathSonarSnapshot['status']): boolean {
  return (
    status === 'requesting-microphone'
    || status === 'checking-device'
    || status === 'inhale'
    || status === 'exhale'
    || status === 'movement'
    || status === 'poor-signal'
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BreathDebugScreen', () => {
  it('shows the local-only, not-a-medical-device copy and every setup instruction', () => {
    const engine = createControllableEngine();
    renderScreen(engine);

    expect(screen.getByText(/experimental/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /breath sonar/i, level: 2 }))
      .toBeInTheDocument();
    expect(screen.getByText(/processing stays local on your device/i))
      .toBeInTheDocument();
    expect(screen.getByText(/not a medical device/i)).toBeInTheDocument();
    for (const instruction of SETUP_INSTRUCTIONS) {
      expect(screen.getByText(instruction)).toBeInTheDocument();
    }
  });

  it('shows the audible-carrier warning in idle setup guidance', () => {
    renderScreen();

    expect(
      screen.getByText('The carrier may be audible to children or nearby animals.'),
    ).toBeInTheDocument();
  });

  it('shows idle guidance and starts sonar on tap', async () => {
    const engine = createControllableEngine();
    renderScreen(engine);

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveTextContent('Idle');
    expect(screen.getByRole('button', { name: /start sonar/i }))
      .toBeInTheDocument();

    await clickButton(/start sonar/i);

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    'calibrating-still',
    'calibrating-inhale',
    'calibrating-exhale',
    'movement',
  ] as const)('maps %s to ASCII-dash status copy', (status) => {
    const engine = createControllableEngine();
    renderScreen(engine);

    act(() => {
      engine.emit({ status });
    });

    expect(screen.getByRole('status')).toHaveTextContent(statusCopy(status));
  });

  it.each([
    'idle',
    'requesting-microphone',
    'checking-device',
    'calibrating-still',
    'calibrating-inhale',
    'calibrating-exhale',
    'inhale',
    'exhale',
    'movement',
    'poor-signal',
    'unsupported',
    'error',
  ] as const)('maps %s to the correct current status copy', (status) => {
    const engine = createControllableEngine();
    renderScreen(engine);

    act(() => {
      engine.emit({ status });
    });

    expect(screen.getByRole('status')).toHaveTextContent(statusCopy(status));
  });

  it('shows live inhale details, waveform, and formatted diagnostics', () => {
    const engine = createControllableEngine(
      makeSnapshot({
        status: 'inhale',
        quality: 'good',
        waveform: [
          { timeMs: 1_000, value: -0.25 },
          { timeMs: 2_000, value: 0.5 },
        ],
        diagnostics: {
          frequencyHz: 18_000,
          sampleRateHz: 48_000,
          snrDb: 32.45,
          phaseAmplitude: 0.1234,
          qualityScore: 0.98,
          movement: true,
        },
      }),
    );
    renderScreen(engine);

    expect(screen.getByRole('status')).toHaveTextContent('Inhale');
    expect(screen.getByText('Good signal')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /live breathing motion waveform/i }))
      .toBeInTheDocument();
    expect(screen.getByText('18.0 kHz')).toBeInTheDocument();
    expect(screen.getByText('48.0 kHz')).toBeInTheDocument();
    expect(screen.getByText('32.5 dB')).toBeInTheDocument();
    expect(screen.getByText('0.123')).toBeInTheDocument();
    expect(screen.getByText('0.98')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();
  });

  it.each(['poor-signal', 'movement', 'error', 'unsupported', 'calibrating-still', 'calibrating-inhale', 'calibrating-exhale'] as const)(
    'does not keep exact large inhale/exhale status when status becomes %s',
    (status) => {
      const engine = createControllableEngine(
        makeSnapshot({
          status: 'inhale',
          quality: 'good',
        }),
      );
      renderScreen(engine);

      act(() => {
        engine.emit({ status });
      });

      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toHaveTextContent(statusCopy(status));
      expect(within(statusRegion).queryByText(/^Inhale$/)).not.toBeInTheDocument();
      expect(within(statusRegion).queryByText(/^Exhale$/)).not.toBeInTheDocument();
    },
  );

  it.each(
    ALL_STATUSES.flatMap((status) => [null, 18_500].map((frequencyHz) => ({
      status,
      frequencyHz,
    }))),
  )(
    'renders the correct control matrix for %s with frequency %s',
    ({ status, frequencyHz }) => {
      const engine = createControllableEngine(
        makeSnapshot({
          status,
          diagnostics: {
            frequencyHz,
          },
        }),
      );
      renderScreen(engine);

      const startButton = screen.queryByRole('button', { name: /start sonar/i });
      const stopButton = screen.queryByRole('button', { name: /^stop$/i });
      const recalibrateButton = screen.queryByRole('button', { name: /^recalibrate$/i });

      if (INACTIVE_STATUSES.includes(status)) {
        expect(startButton).toBeInTheDocument();
        expect(startButton).toHaveClass('w-full');
        expect(stopButton).not.toBeInTheDocument();
        expect(recalibrateButton).not.toBeInTheDocument();
      } else {
        expect(startButton).not.toBeInTheDocument();
        expect(stopButton).toBeInTheDocument();
        expect(recalibrateButton).toBeInTheDocument();
        if (expectsRecalibrateEnabled(status) && frequencyHz !== null) {
          expect(recalibrateButton).toBeEnabled();
        } else {
          expect(recalibrateButton).toBeDisabled();
        }
      }
    },
  );

  it('invokes stop and recalibrate once from the active controls', async () => {
    const engine = createControllableEngine(
      makeSnapshot({
        status: 'inhale',
        diagnostics: {
          frequencyHz: 18_500,
        },
      }),
    );
    renderScreen(engine);

    await clickButton(/^recalibrate$/i);
    await clickButton(/^stop$/i);

    expect(engine.recalibrate).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });

  it('disables stop and recalibrate while stop is pending and re-enables them after resolve', async () => {
    const engine = createDeferredStopEngine();
    renderScreen(engine);

    const stopButton = screen.getByRole('button', { name: /^stop$/i });
    const recalibrateButton = screen.getByRole('button', { name: /^recalibrate$/i });

    await clickButton(/^stop$/i);

    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(stopButton).toBeDisabled();
    expect(recalibrateButton).toBeDisabled();

    await clickButton(/^stop$/i);
    await clickButton(/^recalibrate$/i);

    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.recalibrate).toHaveBeenCalledTimes(0);

    await act(async () => {
      engine.resolveStop();
    });

    expect(stopButton).toBeEnabled();
    expect(recalibrateButton).toBeEnabled();
  });

  it('invokes start once from the idle control', async () => {
    const engine = createControllableEngine();
    renderScreen(engine);

    await clickButton(/start sonar/i);

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('shows an unsupported start state and alerts with the engine message', () => {
    const unsupported = new BreathSonarError(
      'carrier-unsupported',
      'This device or placement could not produce a stable ultrasonic carrier.',
    );
    const engine = createControllableEngine(
      makeSnapshot({ status: 'unsupported', error: unsupported }),
    );
    renderScreen(engine);

    expect(screen.getByRole('button', { name: /start sonar/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This device or placement could not produce a stable ultrasonic carrier.',
    );
  });

  it('shows an error start state and alerts with the exact engine message', () => {
    const error = new BreathSonarError(
      'audio-start-failed',
      'Microphone access failed.',
    );
    const engine = createControllableEngine(
      makeSnapshot({ status: 'error', error }),
    );
    renderScreen(engine);

    expect(screen.getByRole('button', { name: /start sonar/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access failed.');
  });

  it('suppresses stale calibration alerts while calibration status is shown', () => {
    const error = new BreathSonarError(
      'calibration-failed',
      'Calibration could not detect clear, opposite inhale and exhale motion.',
    );
    const engine = createControllableEngine(
      makeSnapshot({
        status: 'poor-signal',
        error,
      }),
    );
    renderScreen(engine);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Calibration could not detect clear, opposite inhale and exhale motion.',
    );

    act(() => {
      engine.emit({ status: 'calibrating-inhale' });
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      engine.emit({ status: 'poor-signal' });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Calibration could not detect clear, opposite inhale and exhale motion.',
    );
  });

  it('renders null diagnostics as dashes', () => {
    const engine = createControllableEngine(
      makeSnapshot({
        diagnostics: {
          frequencyHz: null,
          sampleRateHz: null,
          snrDb: null,
          phaseAmplitude: null,
          qualityScore: null,
          movement: false,
        },
      }),
    );
    renderScreen(engine);

    expect(screen.getAllByText('-')).toHaveLength(5);
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it.each([
    {
      quality: 'unknown' as const,
      expectedText: 'Signal not measured',
      expectedClasses: ['border-[color:var(--border)]', 'text-[color:var(--text-dim)]'],
    },
    {
      quality: 'good' as const,
      expectedText: 'Good signal',
      expectedClasses: ['border-success', 'text-success'],
    },
    {
      quality: 'fair' as const,
      expectedText: 'Fair signal',
      expectedClasses: ['border-warn', 'text-warn'],
    },
    {
      quality: 'poor' as const,
      expectedText: 'Poor signal',
      expectedClasses: ['border-danger', 'text-danger'],
    },
  ])('shows the %s quality badge with the right text and token classes', ({ quality, expectedText, expectedClasses }) => {
    const engine = createControllableEngine(
      makeSnapshot({ quality }),
    );
    renderScreen(engine);

    const badge = screen.getByText(expectedText);
    expect(badge).toHaveClass(...expectedClasses);
  });

  it('stops the engine when the screen unmounts', () => {
    const engine = createControllableEngine();
    const { unmount } = render(<BreathDebugScreen createEngine={() => engine} />);

    unmount();

    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});
