# Breath Sonar Debug Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hidden, on-device active-sonar experiment that probes phone hardware, calibrates one breath cycle, and renders a live Inhale/Exhale phase-motion waveform with honest signal-quality diagnostics.

**Architecture:** A thin Web Audio session owns microphone, oscillator, worklet, and cleanup. A deterministic signal-processing core scores carriers and converts demodulated I/Q frames into calibrated waveform/state output. A stateful engine orchestrates probing and calibration, while a React hook and focused UI components render the experiment and stop it on lifecycle changes.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Web Audio API, MediaDevices API, AudioWorklet, SVG, Vitest, Testing Library.

**Repository rule:** Do not create a git commit without explicit user approval. At each checkpoint, stage only the files for that task if staging is useful.

---

## File map

**Create**

- `src/infrastructure/device/breathSonarTypes.ts` - shared experiment types, snapshots, errors, and engine contract.
- `src/infrastructure/device/breathSignal.ts` - deterministic carrier scoring, phase filtering, calibration, quality, movement, classifier, and waveform buffer.
- `src/infrastructure/device/breathSignal.test.ts` - synthetic DSP and state-machine tests.
- `src/infrastructure/device/breathSonarWorklet.js` - real-time I/Q and sideband demodulation off the UI thread.
- `src/infrastructure/device/breathSonarSession.ts` - browser capability checks, media/audio graph setup, worklet messaging, and resource cleanup.
- `src/infrastructure/device/breathSonarSession.test.ts` - mocked Web Audio and MediaDevices tests.
- `src/infrastructure/device/breathSonarEngine.ts` - carrier probe, guided calibration, live processing, snapshots, and typed failures.
- `src/infrastructure/device/breathSonarEngine.test.ts` - orchestration tests with a fake session and fake delay.
- `src/ui/hooks/useBreathSonar.ts` - React subscription and page-lifecycle cleanup.
- `src/ui/hooks/useBreathSonar.test.tsx` - unmount and hidden-page cleanup tests.
- `src/ui/design-system/BreathWaveform.tsx` - accessible rolling SVG motion chart.
- `src/ui/design-system/BreathWaveform.test.tsx` - path, centerline, and empty-state tests.
- `src/ui/screens/BreathDebugScreen.tsx` - setup guidance, status, controls, quality, diagnostics, and error UI.
- `src/ui/screens/BreathDebugScreen.test.tsx` - screen behavior through a fake engine.

**Modify**

- `src/ui/app/routes.tsx` - register `/breath-debug`.
- `src/ui/app/routes.test.tsx` - verify the hidden route renders.
- `src/ui/screens/SettingsScreen.tsx` - add the Experiments card and navigation.
- `src/ui/screens/SettingsScreen.test.tsx` - verify the Settings entry links to the experiment.

**Documentation**

- `docs/superpowers/specs/2026-07-16-breath-sonar-debug-design.md` - approved design, already present.
- `docs/superpowers/plans/2026-07-16-breath-sonar-debug.md` - this plan.

---

### Task 1: Define sonar types and carrier scoring

**Files:**
- Create: `src/infrastructure/device/breathSonarTypes.ts`
- Create: `src/infrastructure/device/breathSignal.ts`
- Test: `src/infrastructure/device/breathSignal.test.ts`

- [ ] **Step 1: Write failing carrier-scoring and phase-unwrapping tests**

Create `src/infrastructure/device/breathSignal.test.ts` with these first cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  scoreCarrier,
  selectCarrier,
  unwrapPhase,
} from './breathSignal';
import type { DemodulatedFrame } from './breathSonarTypes';

function frame(
  carrierMagnitude: number,
  sidebandMagnitude: number,
  phaseRad = 0,
  clipped = false,
): DemodulatedFrame {
  return {
    timeMs: 0,
    i: carrierMagnitude * Math.cos(phaseRad),
    q: carrierMagnitude * Math.sin(phaseRad),
    sidebandMagnitude,
    broadbandRms: carrierMagnitude,
    clipped,
  };
}

describe('carrier scoring', () => {
  it('selects the strongest stable carrier above 12 dB SNR', () => {
    const selected = selectCarrier([
      {
        frequencyHz: 18_000,
        frames: [frame(0.1, 0.04), frame(0.1, 0.04, 0.01)],
      },
      {
        frequencyHz: 19_000,
        frames: [frame(0.2, 0.02), frame(0.2, 0.02, 0.01)],
      },
    ]);

    expect(selected?.frequencyHz).toBe(19_000);
    expect(selected?.snrDb).toBeGreaterThanOrEqual(12);
  });

  it('rejects a clipped carrier even when it is loud', () => {
    expect(scoreCarrier([
      frame(0.5, 0.01, 0, true),
      frame(0.5, 0.01, 0, true),
    ]).valid).toBe(false);
  });
});

describe('unwrapPhase', () => {
  it('keeps phase continuous across the positive pi boundary', () => {
    expect(unwrapPhase(3.1, -3.1)).toBeCloseTo(3.183, 2);
  });

  it('keeps phase continuous across the negative pi boundary', () => {
    expect(unwrapPhase(-3.1, 3.1)).toBeCloseTo(-3.183, 2);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/infrastructure/device/breathSignal.test.ts
```

Expected: FAIL because `breathSignal` and `breathSonarTypes` do not exist.

- [ ] **Step 3: Add the shared contracts**

Create `src/infrastructure/device/breathSonarTypes.ts`:

```ts
export type BreathSonarStatus =
  | 'idle'
  | 'requesting-microphone'
  | 'checking-device'
  | 'calibrating-still'
  | 'calibrating-inhale'
  | 'calibrating-exhale'
  | 'inhale'
  | 'exhale'
  | 'movement'
  | 'poor-signal'
  | 'unsupported'
  | 'error';

export type SignalQuality = 'unknown' | 'good' | 'fair' | 'poor';

export interface DemodulatedFrame {
  timeMs: number;
  i: number;
  q: number;
  sidebandMagnitude: number;
  broadbandRms: number;
  clipped: boolean;
}

export interface WaveformPoint {
  timeMs: number;
  value: number;
}

export interface BreathSonarDiagnostics {
  frequencyHz: number | null;
  sampleRateHz: number | null;
  snrDb: number | null;
  phaseAmplitude: number | null;
  qualityScore: number | null;
  movement: boolean;
}

export interface BreathSonarSnapshot {
  status: BreathSonarStatus;
  quality: SignalQuality;
  waveform: WaveformPoint[];
  diagnostics: BreathSonarDiagnostics;
  error: BreathSonarError | null;
}

export type BreathSonarErrorCode =
  | 'insecure-context'
  | 'media-unsupported'
  | 'audio-context-unsupported'
  | 'audio-worklet-unsupported'
  | 'permission-denied'
  | 'microphone-missing'
  | 'audio-start-failed'
  | 'device-lost'
  | 'carrier-unsupported'
  | 'calibration-failed';

export class BreathSonarError extends Error {
  readonly code: BreathSonarErrorCode;

  constructor(code: BreathSonarErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BreathSonarError';
    this.code = code;
  }
}

export interface BreathSonarEngine {
  getSnapshot(): BreathSonarSnapshot;
  subscribe(listener: (snapshot: BreathSonarSnapshot) => void): () => void;
  start(): Promise<void>;
  recalibrate(): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 4: Implement deterministic carrier scoring**

Create `src/infrastructure/device/breathSignal.ts` with these exports:

```ts
import type { DemodulatedFrame } from './breathSonarTypes';

const MIN_SNR_DB = 12;
const MAX_PHASE_JITTER_RAD = 0.35;
const MAX_CLIPPED_RATIO = 0.02;
const EPSILON = 1e-9;

export interface CarrierScore {
  snrDb: number;
  phaseJitterRad: number;
  clippedRatio: number;
  valid: boolean;
}

export interface CarrierProbe {
  frequencyHz: number;
  frames: DemodulatedFrame[];
}

export interface SelectedCarrier extends CarrierScore {
  frequencyHz: number;
}

export function unwrapPhase(previousUnwrapped: number, wrapped: number): number {
  const previousWrapped = Math.atan2(
    Math.sin(previousUnwrapped),
    Math.cos(previousUnwrapped),
  );
  let delta = wrapped - previousWrapped;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return previousUnwrapped + delta;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

export function scoreCarrier(frames: DemodulatedFrame[]): CarrierScore {
  const magnitudes = frames.map((item) => Math.hypot(item.i, item.q));
  const noise = frames.map((item) => item.sidebandMagnitude);
  const phases = frames.map((item) => Math.atan2(item.q, item.i));
  const phaseSteps = phases.slice(1).map((phase, index) => {
    const unwrapped = unwrapPhase(phases[index], phase);
    return unwrapped - phases[index];
  });
  const phaseMean = mean(phaseSteps);
  const phaseJitterRad = Math.sqrt(mean(
    phaseSteps.map((step) => (step - phaseMean) ** 2),
  ));
  const clippedRatio = frames.filter((item) => item.clipped).length
    / Math.max(frames.length, 1);
  const snrDb = 20 * Math.log10(
    Math.max(mean(magnitudes), EPSILON)
    / Math.max(mean(noise), EPSILON),
  );

  return {
    snrDb,
    phaseJitterRad,
    clippedRatio,
    valid: frames.length > 1
      && snrDb >= MIN_SNR_DB
      && phaseJitterRad <= MAX_PHASE_JITTER_RAD
      && clippedRatio <= MAX_CLIPPED_RATIO,
  };
}

export function selectCarrier(probes: CarrierProbe[]): SelectedCarrier | null {
  return probes
    .map((probe) => ({
      frequencyHz: probe.frequencyHz,
      ...scoreCarrier(probe.frames),
    }))
    .filter((score) => score.valid)
    .sort((left, right) => right.snrDb - left.snrDb)[0] ?? null;
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- src/infrastructure/device/breathSignal.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint without committing**

Review and optionally stage:

```powershell
git add src/infrastructure/device/breathSonarTypes.ts src/infrastructure/device/breathSignal.ts src/infrastructure/device/breathSignal.test.ts
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 2: Build the calibrated breathing signal processor

**Files:**
- Modify: `src/infrastructure/device/breathSignal.ts`
- Modify: `src/infrastructure/device/breathSignal.test.ts`

- [ ] **Step 1: Add failing synthetic calibration and classification tests**

Append tests that generate 20 Hz frames from a known phase:

```ts
import { BreathSignalProcessor } from './breathSignal';

function phaseFrame(
  timeMs: number,
  phaseRad: number,
  broadbandRms = 0.05,
): DemodulatedFrame {
  return {
    timeMs,
    i: Math.cos(phaseRad) * 0.2,
    q: Math.sin(phaseRad) * 0.2,
    sidebandMagnitude: 0.01,
    broadbandRms,
    clipped: false,
  };
}

function feedRamp(
  processor: BreathSignalProcessor,
  fromMs: number,
  fromPhase: number,
  toPhase: number,
): void {
  for (let index = 0; index < 80; index += 1) {
    const ratio = index / 79;
    processor.ingest(phaseFrame(
      fromMs + index * 50,
      fromPhase + (toPhase - fromPhase) * ratio,
    ));
  }
}

it('calibrates opposite inhale and exhale directions', () => {
  const processor = new BreathSignalProcessor(20);
  processor.setCarrierSnrDb(24);

  processor.beginCalibrationStage('still');
  feedRamp(processor, 0, 0, 0.01);
  processor.beginCalibrationStage('inhale');
  feedRamp(processor, 4_000, 0.01, 0.6);
  processor.beginCalibrationStage('exhale');
  feedRamp(processor, 8_000, 0.6, 0.02);

  expect(processor.completeCalibration()).toBe(true);
});

it('reports inhale then exhale for a slow calibrated cycle', () => {
  const processor = calibratedProcessor();
  let output = processor.ingest(phaseFrame(12_000, 0.1));
  for (let index = 1; index <= 30; index += 1) {
    output = processor.ingest(phaseFrame(
      12_000 + index * 50,
      0.1 + index * 0.02,
    ));
  }
  expect(output.phase).toBe('inhale');

  for (let index = 1; index <= 30; index += 1) {
    output = processor.ingest(phaseFrame(
      14_000 + index * 50,
      0.7 - index * 0.02,
    ));
  }
  expect(output.phase).toBe('exhale');
});

it('suppresses breath labels during a gross phase jump', () => {
  const processor = calibratedProcessor();
  processor.ingest(phaseFrame(12_000, 0.1));
  const output = processor.ingest(phaseFrame(12_050, 2.8, 0.8));
  expect(output.movement).toBe(true);
  expect(output.phase).toBeNull();
});

it('keeps only the latest 20 seconds of waveform points', () => {
  const processor = calibratedProcessor();
  for (let index = 0; index < 500; index += 1) {
    processor.ingest(phaseFrame(index * 50, Math.sin(index / 20)));
  }
  const output = processor.ingest(phaseFrame(25_000, 0));
  expect(output.waveform.at(-1)!.timeMs - output.waveform[0].timeMs)
    .toBeLessThanOrEqual(20_000);
});
```

Add a local `calibratedProcessor()` helper that performs the same still,
inhale, and exhale sequence as the first test.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/infrastructure/device/breathSignal.test.ts
```

Expected: FAIL because `BreathSignalProcessor` does not exist.

- [ ] **Step 3: Implement the processor state and filters**

Add these public types and class to `breathSignal.ts`:

```ts
import type {
  DemodulatedFrame,
  SignalQuality,
  WaveformPoint,
} from './breathSonarTypes';

export type CalibrationStage = 'still' | 'inhale' | 'exhale';

export interface SignalOutput {
  phase: 'inhale' | 'exhale' | null;
  quality: SignalQuality;
  qualityScore: number;
  phaseAmplitude: number;
  movement: boolean;
  waveform: WaveformPoint[];
}

interface CalibrationStats {
  still: number[];
  inhale: number[];
  exhale: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function segmentDelta(values: number[]): number {
  const window = Math.max(1, Math.floor(values.length / 4));
  return mean(values.slice(-window)) - mean(values.slice(0, window));
}

export class BreathSignalProcessor {
  private readonly sampleRateHz: number;
  private readonly waveform: WaveformPoint[] = [];
  private readonly amplitudeWindow: number[] = [];
  private readonly calibration: CalibrationStats = {
    still: [],
    inhale: [],
    exhale: [],
  };
  private stage: CalibrationStage | null = null;
  private carrierSnrDb = 0;
  private previousWrapped: number | null = null;
  private previousUnwrapped = 0;
  private previousFiltered = 0;
  private lowPass = 0;
  private highPass = 0;
  private previousInput = 0;
  private polarity = 1;
  private calibrated = false;
  private currentPhase: 'inhale' | 'exhale' | null = null;
  private candidatePhase: 'inhale' | 'exhale' | null = null;
  private candidateSinceMs = 0;
  private movementUntilMs = 0;
  private baselineNoise = 0.01;
  private baselineRms = 0.01;

  constructor(sampleRateHz: number) {
    this.sampleRateHz = sampleRateHz;
  }

  setCarrierSnrDb(value: number): void {
    this.carrierSnrDb = value;
  }

  beginCalibrationStage(stage: CalibrationStage): void {
    this.stage = stage;
    this.calibration[stage] = [];
  }

  completeCalibration(): boolean {
    const stillNoise = standardDeviation(this.calibration.still);
    const inhaleDelta = segmentDelta(this.calibration.inhale);
    const exhaleDelta = segmentDelta(this.calibration.exhale);
    const minimumMotion = Math.max(stillNoise * 3, 0.03);
    const valid = Math.abs(inhaleDelta) >= minimumMotion
      && Math.abs(exhaleDelta) >= minimumMotion
      && Math.sign(inhaleDelta) === -Math.sign(exhaleDelta);
    if (!valid) return false;

    this.polarity = inhaleDelta >= 0 ? 1 : -1;
    this.baselineNoise = Math.max(stillNoise, 0.005);
    this.calibrated = true;
    this.stage = null;
    this.currentPhase = null;
    return true;
  }

  ingest(frame: DemodulatedFrame): SignalOutput {
    const wrapped = Math.atan2(frame.q, frame.i);
    const unwrapped = this.previousWrapped === null
      ? wrapped
      : unwrapPhase(this.previousUnwrapped, wrapped);
    const dt = 1 / this.sampleRateHz;
    const lowPassAlpha = dt / ((1 / (Math.PI * 2 * 0.7)) + dt);
    const highPassAlpha = (1 / (Math.PI * 2 * 0.08))
      / ((1 / (Math.PI * 2 * 0.08)) + dt);
    this.highPass = highPassAlpha
      * (this.highPass + unwrapped - this.previousInput);
    this.lowPass += lowPassAlpha * (this.highPass - this.lowPass);
    const filtered = this.lowPass * this.polarity;
    const phaseStep = unwrapped - this.previousUnwrapped;

    this.previousWrapped = wrapped;
    this.previousUnwrapped = unwrapped;
    this.previousInput = unwrapped;

    if (this.stage) {
      this.calibration[this.stage].push(this.lowPass);
      if (this.stage === 'still') {
        this.baselineRms = Math.max(
          this.baselineRms * 0.95 + frame.broadbandRms * 0.05,
          EPSILON,
        );
      }
    }

    const movement = frame.clipped
      || Math.abs(phaseStep) > 1.5
      || frame.broadbandRms > this.baselineRms * 6;
    if (movement) this.movementUntilMs = frame.timeMs + 1_000;
    const movementActive = frame.timeMs < this.movementUntilMs;

    this.amplitudeWindow.push(Math.abs(filtered));
    if (this.amplitudeWindow.length > this.sampleRateHz * 5) {
      this.amplitudeWindow.shift();
    }
    const phaseAmplitude = Math.max(
      Math.sqrt(mean(this.amplitudeWindow.map((value) => value ** 2))),
      this.baselineNoise,
    );
    const normalized = clamp(filtered / (phaseAmplitude * 2), -1, 1);
    this.waveform.push({ timeMs: frame.timeMs, value: normalized });
    while (
      this.waveform.length > 1
      && frame.timeMs - this.waveform[0].timeMs > 20_000
    ) {
      this.waveform.shift();
    }

    const derivative = (filtered - this.previousFiltered) / dt;
    this.previousFiltered = filtered;
    const snrScore = clamp((this.carrierSnrDb - 12) / 18, 0, 1);
    const amplitudeScore = clamp(
      (phaseAmplitude - this.baselineNoise)
      / Math.max(this.baselineNoise * 4, EPSILON),
      0,
      1,
    );
    const continuityScore = clamp(1 - Math.abs(phaseStep) / 1.5, 0, 1);
    const qualityScore = movementActive
      ? 0
      : snrScore * 0.4 + amplitudeScore * 0.3 + continuityScore * 0.3;
    const quality: SignalQuality = qualityScore >= 0.7
      ? 'good'
      : qualityScore >= 0.45
        ? 'fair'
        : 'poor';

    if (this.calibrated && !movementActive && quality !== 'poor') {
      const next = derivative > 0.04
        ? 'inhale'
        : derivative < -0.04
          ? 'exhale'
          : null;
      if (next && next !== this.currentPhase) {
        if (this.candidatePhase !== next) {
          this.candidatePhase = next;
          this.candidateSinceMs = frame.timeMs;
        } else if (frame.timeMs - this.candidateSinceMs >= 500) {
          this.currentPhase = next;
          this.candidatePhase = null;
        }
      }
    }

    return {
      phase: movementActive || quality === 'poor' ? null : this.currentPhase,
      quality,
      qualityScore,
      phaseAmplitude,
      movement: movementActive,
      waveform: [...this.waveform],
    };
  }
}
```

While implementing, keep helper imports consolidated and avoid duplicate
`mean` or `EPSILON` declarations.

- [ ] **Step 4: Run processor tests and adjust only empirically failing constants**

Run:

```powershell
npm test -- src/infrastructure/device/breathSignal.test.ts
```

Expected: PASS. If a synthetic test exposes filter startup latency, feed a
short stationary warm-up in the test rather than bypassing the production
filter.

- [ ] **Step 5: Run lint on the focused files**

Run:

```powershell
npx oxlint src/infrastructure/device/breathSignal.ts src/infrastructure/device/breathSignal.test.ts
```

Expected: no errors.

- [ ] **Step 6: Checkpoint without committing**

```powershell
git add src/infrastructure/device/breathSignal.ts src/infrastructure/device/breathSignal.test.ts
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 3: Add the AudioWorklet and browser audio session

**Files:**
- Create: `src/infrastructure/device/breathSonarWorklet.js`
- Create: `src/infrastructure/device/breathSonarSession.ts`
- Test: `src/infrastructure/device/breathSonarSession.test.ts`

- [ ] **Step 1: Write failing session capability and cleanup tests**

Create `breathSonarSession.test.ts` around a narrow injected environment:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserSonarSession,
  type BreathSonarBrowserEnvironment,
} from './breathSonarSession';

function environment(overrides: Partial<BreathSonarBrowserEnvironment> = {}) {
  const track = { stop: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const oscillator = {
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const worklet = {
    port: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      start: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const silentGain = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const context = {
    sampleRate: 48_000,
    currentTime: 0,
    state: 'running',
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn()
      .mockReturnValueOnce(gain)
      .mockReturnValueOnce(silentGain),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const env: BreathSonarBrowserEnvironment = {
    isSecureContext: true,
    getUserMedia: vi.fn(async () => ({
      getTracks: () => [track],
    })),
    createAudioContext: () => context,
    createAudioWorkletNode: () => worklet,
    workletUrl: '/breath-sonar-worklet.js',
    ...overrides,
  };
  return { env, context, track, oscillator, gain, source, worklet };
}

describe('createBrowserSonarSession', () => {
  it('requests unprocessed mono microphone audio', async () => {
    const { env } = environment();
    await createBrowserSonarSession(env);
    expect(env.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  });

  it('rejects an insecure context before requesting permission', async () => {
    const { env } = environment({ isSecureContext: false });
    await expect(createBrowserSonarSession(env))
      .rejects.toMatchObject({ code: 'insecure-context' });
    expect(env.getUserMedia).not.toHaveBeenCalled();
  });

  it('stops every audio resource exactly once', async () => {
    const { env, context, track, oscillator, source, worklet } = environment();
    const session = await createBrowserSonarSession(env);
    await session.stop();
    await session.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(worklet.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm test -- src/infrastructure/device/breathSonarSession.test.ts
```

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement the worklet**

Create `breathSonarWorklet.js` as a module with no imports:

```js
const TARGET_RATE_HZ = 20;
const SIDEBAND_OFFSET_HZ = 350;
const TWO_PI = Math.PI * 2;

class BreathSonarProcessor extends AudioWorkletProcessor {
  frequencyHz = 19_000;
  carrierPhase = 0;
  lowPhase = 0;
  highPhase = 0;
  count = 0;
  carrierI = 0;
  carrierQ = 0;
  lowI = 0;
  lowQ = 0;
  highI = 0;
  highQ = 0;
  sumSquares = 0;
  clipped = false;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'set-frequency') return;
      this.frequencyHz = event.data.frequencyHz;
      this.reset();
    };
  }

  reset() {
    this.carrierPhase = 0;
    this.lowPhase = 0;
    this.highPhase = 0;
    this.count = 0;
    this.carrierI = 0;
    this.carrierQ = 0;
    this.lowI = 0;
    this.lowQ = 0;
    this.highI = 0;
    this.highQ = 0;
    this.sumSquares = 0;
    this.clipped = false;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    const carrierStep = TWO_PI * this.frequencyHz / sampleRate;
    const lowStep = TWO_PI
      * (this.frequencyHz - SIDEBAND_OFFSET_HZ) / sampleRate;
    const highStep = TWO_PI
      * (this.frequencyHz + SIDEBAND_OFFSET_HZ) / sampleRate;
    const bucketSize = Math.round(sampleRate / TARGET_RATE_HZ);

    for (const sample of input) {
      this.carrierI += sample * Math.cos(this.carrierPhase);
      this.carrierQ += sample * -Math.sin(this.carrierPhase);
      this.lowI += sample * Math.cos(this.lowPhase);
      this.lowQ += sample * -Math.sin(this.lowPhase);
      this.highI += sample * Math.cos(this.highPhase);
      this.highQ += sample * -Math.sin(this.highPhase);
      this.sumSquares += sample * sample;
      this.clipped ||= Math.abs(sample) >= 0.98;
      this.count += 1;

      this.carrierPhase = (this.carrierPhase + carrierStep) % TWO_PI;
      this.lowPhase = (this.lowPhase + lowStep) % TWO_PI;
      this.highPhase = (this.highPhase + highStep) % TWO_PI;

      if (this.count < bucketSize) continue;
      const scale = 2 / this.count;
      const lowMagnitude = Math.hypot(this.lowI, this.lowQ) * scale;
      const highMagnitude = Math.hypot(this.highI, this.highQ) * scale;
      this.port.postMessage({
        type: 'frame',
        frame: {
          timeMs: currentTime * 1_000,
          i: this.carrierI * scale,
          q: this.carrierQ * scale,
          sidebandMagnitude: (lowMagnitude + highMagnitude) / 2,
          broadbandRms: Math.sqrt(this.sumSquares / this.count),
          clipped: this.clipped,
        },
      });
      this.count = 0;
      this.carrierI = 0;
      this.carrierQ = 0;
      this.lowI = 0;
      this.lowQ = 0;
      this.highI = 0;
      this.highQ = 0;
      this.sumSquares = 0;
      this.clipped = false;
    }
    return true;
  }
}

registerProcessor('breath-sonar-processor', BreathSonarProcessor);
```

- [ ] **Step 4: Implement the browser session**

Create `breathSonarSession.ts` with a narrow testable environment and no React
dependency. The returned session must expose `sampleRateHz`, `setFrequency`,
`subscribe`, and idempotent `stop`.

```ts
import {
  BreathSonarError,
  type DemodulatedFrame,
} from './breathSonarTypes';

export interface BreathSonarSession {
  readonly sampleRateHz: number;
  setFrequency(frequencyHz: number): void;
  subscribe(listener: (frame: DemodulatedFrame) => void): () => void;
  stop(): Promise<void>;
}

interface PortLike {
  addEventListener(type: 'message', listener: EventListener): void;
  removeEventListener(type: 'message', listener: EventListener): void;
  postMessage(message: unknown): void;
  start(): void;
}

interface NodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

interface WorkletNodeLike extends NodeLike {
  port: PortLike;
}

interface ContextLike {
  sampleRate: number;
  currentTime: number;
  state: string;
  destination: unknown;
  audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): NodeLike;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface BreathSonarBrowserEnvironment {
  isSecureContext: boolean;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): ContextLike;
  createAudioWorkletNode(context: ContextLike): WorkletNodeLike;
  workletUrl: string;
}

function mapMediaError(error: unknown): BreathSonarError {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new BreathSonarError(
      'permission-denied',
      'Microphone permission was denied.',
      { cause: error },
    );
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
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

export function browserSonarEnvironment(): BreathSonarBrowserEnvironment {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    throw new BreathSonarError(
      'audio-context-unsupported',
      'Web Audio is not supported in this browser.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new BreathSonarError(
      'media-unsupported',
      'Microphone capture is not supported in this browser.',
    );
  }
  const workletUrl = new URL('./breathSonarWorklet.js', import.meta.url).href;
  return {
    isSecureContext: window.isSecureContext,
    getUserMedia: (constraints) =>
      navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContextConstructor(),
    createAudioWorkletNode: (context) =>
      new AudioWorkletNode(
        context as AudioContext,
        'breath-sonar-processor',
        { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] },
      ),
    workletUrl,
  };
}
```

Add the complete session factory:

```ts
export async function createBrowserSonarSession(
  env: BreathSonarBrowserEnvironment = browserSonarEnvironment(),
): Promise<BreathSonarSession> {
  if (!env.isSecureContext) {
    throw new BreathSonarError(
      'insecure-context',
      'Breath sonar requires HTTPS or localhost.',
    );
  }

  let stream: MediaStream | null = null;
  let context: ContextLike | null = null;
  let source: NodeLike | null = null;
  let oscillator: OscillatorNode | null = null;
  let outputGain: GainNode | null = null;
  let worklet: WorkletNodeLike | null = null;
  let silentGain: GainNode | null = null;
  let started = false;
  let stopped = false;
  const listeners = new Set<(frame: DemodulatedFrame) => void>();
  const onMessage: EventListener = (event) => {
    const data = (event as MessageEvent<{
      type?: string;
      frame?: DemodulatedFrame;
    }>).data;
    if (data.type !== 'frame' || !data.frame) return;
    for (const listener of listeners) listener(data.frame);
  };

  const cleanup = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (worklet) worklet.port.removeEventListener('message', onMessage);
    if (context && outputGain) {
      outputGain.gain.setValueAtTime(
        outputGain.gain.value,
        context.currentTime,
      );
      outputGain.gain.linearRampToValueAtTime(
        0,
        context.currentTime + 0.05,
      );
    }
    if (oscillator && started) oscillator.stop();
    oscillator?.disconnect();
    outputGain?.disconnect();
    source?.disconnect();
    worklet?.disconnect();
    silentGain?.disconnect();
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (context) await context.close();
    listeners.clear();
  };

  try {
    stream = await env.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    context = env.createAudioContext();
    if (!context.audioWorklet?.addModule) {
      throw new BreathSonarError(
        'audio-worklet-unsupported',
        'Audio worklets are not supported in this browser.',
      );
    }
    if (context.state === 'suspended') await context.resume();
    await context.audioWorklet.addModule(env.workletUrl);

    source = context.createMediaStreamSource(stream);
    oscillator = context.createOscillator();
    outputGain = context.createGain();
    worklet = env.createAudioWorkletNode(context);
    silentGain = context.createGain();
    outputGain.gain.value = 0;
    silentGain.gain.value = 0;

    source.connect(worklet);
    worklet.connect(silentGain);
    silentGain.connect(context.destination);
    oscillator.connect(outputGain);
    outputGain.connect(context.destination);
    worklet.port.addEventListener('message', onMessage);
    worklet.port.start();
    oscillator.start();
    started = true;

    return {
      sampleRateHz: context.sampleRate,
      setFrequency(frequencyHz: number) {
        if (stopped || !context || !oscillator || !outputGain || !worklet) {
          throw new BreathSonarError(
            'device-lost',
            'The breath sonar audio session is no longer active.',
          );
        }
        oscillator.frequency.setValueAtTime(
          frequencyHz,
          context.currentTime,
        );
        worklet.port.postMessage({ type: 'set-frequency', frequencyHz });
        outputGain.gain.setValueAtTime(
          outputGain.gain.value,
          context.currentTime,
        );
        outputGain.gain.linearRampToValueAtTime(
          0.02,
          context.currentTime + 0.05,
        );
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      stop: cleanup,
    };
  } catch (error) {
    await cleanup();
    if (error instanceof BreathSonarError) throw error;
    throw mapMediaError(error);
  }
}
```

- [ ] **Step 5: Run the focused session tests**

```powershell
npm test -- src/infrastructure/device/breathSonarSession.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build to verify the worklet asset is emitted**

```powershell
npm run build
```

Expected: TypeScript and Vite build succeed, and `dist/assets` contains a
hashed breath-sonar worklet JavaScript asset.

- [ ] **Step 7: Checkpoint without committing**

```powershell
git add src/infrastructure/device/breathSonarWorklet.js src/infrastructure/device/breathSonarSession.ts src/infrastructure/device/breathSonarSession.test.ts
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 4: Orchestrate probing, calibration, and live snapshots

**Files:**
- Create: `src/infrastructure/device/breathSonarEngine.ts`
- Test: `src/infrastructure/device/breathSonarEngine.test.ts`

- [ ] **Step 1: Write failing engine orchestration tests**

Use a fake session that emits deterministic frames and an injected delay that
emits the appropriate frames before resolving:

```ts
import { describe, expect, it } from 'vitest';
import { createBreathSonarEngine } from './breathSonarEngine';
import type {
  BreathSonarSession,
} from './breathSonarSession';
import type { DemodulatedFrame } from './breathSonarTypes';

class FakeSession implements BreathSonarSession {
  readonly sampleRateHz = 48_000;
  readonly frequencies: number[] = [];
  stopped = 0;
  private listener: ((frame: DemodulatedFrame) => void) | null = null;

  setFrequency(frequencyHz: number): void {
    this.frequencies.push(frequencyHz);
  }

  subscribe(listener: (frame: DemodulatedFrame) => void): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  emit(frame: DemodulatedFrame): void {
    this.listener?.(frame);
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }
}

it('probes allowed carriers and selects the strongest valid result', async () => {
  const session = new FakeSession();
  const delay = async () => {
    const frequency = session.frequencies.at(-1)!;
    for (let index = 0; index < 10; index += 1) {
      const strong = frequency === 19_000;
      session.emit(probeFrame(index, strong ? 0.2 : 0.05, 0.01));
    }
  };
  const engine = createBreathSonarEngine({
    createSession: async () => session,
    delay,
    calibrationDurationsMs: { still: 0, inhale: 0, exhale: 0 },
  });

  await engine.start();

  expect(session.frequencies).toEqual([
    18_000, 18_500, 19_000, 19_500, 20_000, 19_000,
  ]);
  expect(engine.getSnapshot().diagnostics.frequencyHz).toBe(19_000);
});

it('reports unsupported and stops when no carrier passes', async () => {
  const session = new FakeSession();
  const engine = createBreathSonarEngine({
    createSession: async () => session,
    delay: async () => {
      for (let index = 0; index < 10; index += 1) {
        session.emit(probeFrame(index, 0.02, 0.02));
      }
    },
  });

  await engine.start();

  expect(engine.getSnapshot().status).toBe('unsupported');
  expect(session.stopped).toBe(1);
});

it('stop invalidates an in-flight start and remains idempotent', async () => {
  const session = new FakeSession();
  let releaseDelay: (() => void) | undefined;
  const engine = createBreathSonarEngine({
    createSession: async () => session,
    delay: () => new Promise<void>((resolve) => { releaseDelay = resolve; }),
  });

  const starting = engine.start();
  await engine.stop();
  releaseDelay?.();
  await starting;
  await engine.stop();

  expect(session.stopped).toBe(1);
  expect(engine.getSnapshot().status).toBe('idle');
});
```

Add these concrete orchestration cases:

```ts
it('notifies subscribers as startup advances', async () => {
  const session = new FakeSession();
  const statuses: string[] = [];
  const delay = successfulStartupDelay(session);
  const engine = createBreathSonarEngine({
    createSession: async () => session,
    delay,
  });
  engine.subscribe((snapshot) => statuses.push(snapshot.status));

  await engine.start();

  expect(statuses).toEqual(expect.arrayContaining([
    'requesting-microphone',
    'checking-device',
    'calibrating-still',
    'calibrating-inhale',
    'calibrating-exhale',
  ]));
});

it('enters live inhale after successful calibration', async () => {
  const session = new FakeSession();
  const engine = createBreathSonarEngine({
    createSession: async () => session,
    delay: successfulStartupDelay(session),
  });
  await engine.start();

  for (let index = 0; index < 40; index += 1) {
    session.emit(livePhaseFrame(
      20_000 + index * 50,
      0.1 + index * 0.02,
    ));
  }

  expect(engine.getSnapshot().status).toBe('inhale');
});

it('keeps the selected session available after failed calibration', async () => {
  const session = new FakeSession();
  const engine = createBreathSonarEngine({
    createSession: async () => session,
    delay: startupDelayWithFlatCalibration(session),
  });
  await engine.start();

  expect(engine.getSnapshot().status).toBe('poor-signal');
  expect(session.stopped).toBe(0);

  await engine.recalibrate();
  expect(session.stopped).toBe(0);
});

it('publishes a typed browser failure as an error snapshot', async () => {
  const engine = createBreathSonarEngine({
    createSession: async () => {
      throw new BreathSonarError(
        'permission-denied',
        'Microphone permission was denied.',
      );
    },
  });

  await engine.start();

  expect(engine.getSnapshot()).toMatchObject({
    status: 'error',
    error: { code: 'permission-denied' },
  });
});
```

Use these helpers in the test file:

```ts
function livePhaseFrame(
  timeMs: number,
  phaseRad: number,
  carrierMagnitude = 0.2,
  sidebandMagnitude = 0.01,
): DemodulatedFrame {
  return {
    timeMs,
    i: carrierMagnitude * Math.cos(phaseRad),
    q: carrierMagnitude * Math.sin(phaseRad),
    sidebandMagnitude,
    broadbandRms: 0.05,
    clipped: false,
  };
}

function probeFrame(
  index: number,
  carrierMagnitude: number,
  sidebandMagnitude: number,
): DemodulatedFrame {
  return livePhaseFrame(index * 50, index * 0.001, carrierMagnitude, sidebandMagnitude);
}

function successfulStartupDelay(session: FakeSession) {
  let waitIndex = 0;
  let timeMs = 0;
  return async () => {
    if (waitIndex < 5) {
      const frequency = session.frequencies.at(-1);
      const carrierMagnitude = frequency === 19_000 ? 0.2 : 0.05;
      for (let index = 0; index < 10; index += 1) {
        session.emit(livePhaseFrame(
          timeMs,
          index * 0.001,
          carrierMagnitude,
          0.01,
        ));
        timeMs += 50;
      }
    } else if (waitIndex === 5) {
      for (let index = 0; index < 30; index += 1) {
        session.emit(livePhaseFrame(timeMs, index * 0.0001));
        timeMs += 50;
      }
    } else if (waitIndex === 6) {
      for (let index = 0; index < 80; index += 1) {
        session.emit(livePhaseFrame(timeMs, 0.6 * index / 79));
        timeMs += 50;
      }
    } else if (waitIndex === 7) {
      for (let index = 0; index < 80; index += 1) {
        session.emit(livePhaseFrame(timeMs, 0.6 - 0.58 * index / 79));
        timeMs += 50;
      }
    }
    waitIndex += 1;
  };
}

function startupDelayWithFlatCalibration(session: FakeSession) {
  let waitIndex = 0;
  let timeMs = 0;
  return async () => {
    if (waitIndex < 5) {
      const frequency = session.frequencies.at(-1);
      const carrierMagnitude = frequency === 19_000 ? 0.2 : 0.05;
      for (let index = 0; index < 10; index += 1) {
        session.emit(livePhaseFrame(
          timeMs,
          index * 0.001,
          carrierMagnitude,
          0.01,
        ));
        timeMs += 50;
      }
    } else {
      for (let index = 0; index < 80; index += 1) {
        session.emit(livePhaseFrame(timeMs, 0.01));
        timeMs += 50;
      }
    }
    waitIndex += 1;
  };
}
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm test -- src/infrastructure/device/breathSonarEngine.test.ts
```

Expected: FAIL because the engine does not exist.

- [ ] **Step 3: Implement the engine with injected timing**

Create `breathSonarEngine.ts`:

```ts
import { BreathSignalProcessor, selectCarrier } from './breathSignal';
import {
  browserSonarEnvironment,
  createBrowserSonarSession,
  type BreathSonarSession,
} from './breathSonarSession';
import {
  BreathSonarError,
  type BreathSonarEngine,
  type BreathSonarSnapshot,
  type DemodulatedFrame,
} from './breathSonarTypes';

const CARRIER_CANDIDATES_HZ = [
  18_000,
  18_500,
  19_000,
  19_500,
  20_000,
];
const PROBE_DURATION_MS = 400;

interface EngineOptions {
  createSession?: () => Promise<BreathSonarSession>;
  delay?: (durationMs: number) => Promise<void>;
  calibrationDurationsMs?: {
    still: number;
    inhale: number;
    exhale: number;
  };
}

const EMPTY_SNAPSHOT: BreathSonarSnapshot = {
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
```

Implement `createBreathSonarEngine(options = {})` with:

- one current session;
- one frame unsubscribe callback;
- a `Set` of snapshot listeners;
- a monotonically increasing run token;
- one mutable frame collector used during carrier probing;
- one `BreathSignalProcessor` after carrier selection;
- `publish(partial)` that replaces the snapshot immutably and notifies
  listeners;
- `start()` that first calls internal cleanup, increments the run token, creates
  the session, filters candidates to `frequency < sampleRate * 0.45`, probes
  each candidate, selects one, and starts calibration;
- `runCalibration(token)` that publishes still/inhale/exhale statuses, tells
  the processor which segment to collect, waits 1.5/4/4 seconds by default, and
  publishes `poor-signal` on calibration failure;
- live frame handling that maps processor output to `movement`, `poor-signal`,
  `inhale`, or `exhale` and updates waveform/diagnostics;
- `recalibrate()` that requires an existing selected session and reruns only
  calibration;
- `stop()` that invalidates the token, unsubscribes, stops the session once,
  resets state to a fresh idle snapshot, and never throws on a repeated call.

When `selectCarrier` returns null, throw:

```ts
new BreathSonarError(
  'carrier-unsupported',
  'This device or placement could not produce a stable ultrasonic carrier.',
)
```

Treat `carrier-unsupported` as `unsupported`; preserve all other typed errors
as `error` snapshots with their exact message. Do not convert unknown errors
into an unsupported result.

- [ ] **Step 4: Run engine and signal tests**

```powershell
npm test -- src/infrastructure/device/breathSignal.test.ts src/infrastructure/device/breathSonarEngine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript build**

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 6: Checkpoint without committing**

```powershell
git add src/infrastructure/device/breathSonarEngine.ts src/infrastructure/device/breathSonarEngine.test.ts
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 5: Add the lifecycle hook and SVG waveform

**Files:**
- Create: `src/ui/hooks/useBreathSonar.ts`
- Test: `src/ui/hooks/useBreathSonar.test.tsx`
- Create: `src/ui/design-system/BreathWaveform.tsx`
- Test: `src/ui/design-system/BreathWaveform.test.tsx`

- [ ] **Step 1: Write failing hook cleanup tests**

```tsx
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useBreathSonar } from './useBreathSonar';
import type {
  BreathSonarEngine,
  BreathSonarSnapshot,
} from '../../infrastructure/device/breathSonarTypes';

function fakeEngine(): BreathSonarEngine {
  const snapshot: BreathSonarSnapshot = {
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
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    start: vi.fn(async () => undefined),
    recalibrate: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

it('stops the engine on unmount', () => {
  const engine = fakeEngine();
  const { unmount } = renderHook(() => useBreathSonar(() => engine));
  unmount();
  expect(engine.stop).toHaveBeenCalledOnce();
});

it('stops the engine when the document becomes hidden', () => {
  const engine = fakeEngine();
  renderHook(() => useBreathSonar(() => engine));
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: true,
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(engine.stop).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Write failing waveform tests**

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BreathWaveform } from './BreathWaveform';

it('renders a centerline and path for motion samples', () => {
  render(
    <BreathWaveform
      points={[
        { timeMs: 0, value: 0 },
        { timeMs: 1_000, value: 1 },
        { timeMs: 2_000, value: -1 },
      ]}
    />,
  );
  expect(screen.getByRole('img', { name: /live breathing motion waveform/i }))
    .toBeInTheDocument();
  expect(screen.getByTestId('breath-centerline')).toBeInTheDocument();
  expect(screen.getByTestId('breath-wave-path')).toHaveAttribute(
    'd',
    expect.stringContaining('M'),
  );
});
```

- [ ] **Step 3: Run both tests and verify RED**

```powershell
npm test -- src/ui/hooks/useBreathSonar.test.tsx src/ui/design-system/BreathWaveform.test.tsx
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement `useBreathSonar`**

```ts
import { useEffect, useState } from 'react';
import { createBreathSonarEngine } from '../../infrastructure/device/breathSonarEngine';
import type {
  BreathSonarEngine,
  BreathSonarSnapshot,
} from '../../infrastructure/device/breathSonarTypes';

export function useBreathSonar(
  createEngine: () => BreathSonarEngine = createBreathSonarEngine,
) {
  const [engine] = useState(createEngine);
  const [snapshot, setSnapshot] = useState<BreathSonarSnapshot>(
    engine.getSnapshot,
  );

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnapshot);
    const onVisibilityChange = () => {
      if (document.hidden) void engine.stop();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
      void engine.stop();
    };
  }, [engine]);

  return {
    snapshot,
    start: () => engine.start(),
    stop: () => engine.stop(),
    recalibrate: () => engine.recalibrate(),
  };
}
```

If `useState(engine.getSnapshot)` loses the method receiver in implementation,
use `useState(() => engine.getSnapshot())`.

- [ ] **Step 5: Implement `BreathWaveform`**

Render a fixed `320 x 180` SVG with a 16 px pad. Map the newest 20-second
window to x, clamp values to `[-1, 1]`, map positive values upward, and render:

```tsx
import type { WaveformPoint } from '../../infrastructure/device/breathSonarTypes';

const WIDTH = 320;
const HEIGHT = 180;
const PAD = 16;

export function BreathWaveform({ points }: { points: WaveformPoint[] }) {
  const lastTime = points.at(-1)?.timeMs ?? 20_000;
  const firstTime = Math.max(0, lastTime - 20_000);
  const x = (timeMs: number) =>
    PAD + ((timeMs - firstTime) / 20_000) * (WIDTH - PAD * 2);
  const y = (value: number) =>
    HEIGHT / 2 - Math.max(-1, Math.min(1, value))
      * (HEIGHT / 2 - PAD);
  const path = points
    .filter((point) => point.timeMs >= firstTime)
    .map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${x(point.timeMs)} ${y(point.value)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Live breathing motion waveform"
      className="w-full"
    >
      <line
        data-testid="breath-centerline"
        x1={PAD}
        x2={WIDTH - PAD}
        y1={HEIGHT / 2}
        y2={HEIGHT / 2}
        stroke="var(--border)"
        strokeDasharray="4 4"
      />
      <text x={PAD} y={14} fill="var(--text-dim)" fontSize="10">
        Inhale
      </text>
      <text x={PAD} y={HEIGHT - 5} fill="var(--text-dim)" fontSize="10">
        Exhale
      </text>
      <path
        data-testid="breath-wave-path"
        d={path}
        fill="none"
        stroke="var(--cyan)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
```

- [ ] **Step 6: Run hook and waveform tests**

```powershell
npm test -- src/ui/hooks/useBreathSonar.test.tsx src/ui/design-system/BreathWaveform.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Checkpoint without committing**

```powershell
git add src/ui/hooks/useBreathSonar.ts src/ui/hooks/useBreathSonar.test.tsx src/ui/design-system/BreathWaveform.tsx src/ui/design-system/BreathWaveform.test.tsx
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 6: Build the Breath Debug screen

**Files:**
- Create: `src/ui/screens/BreathDebugScreen.tsx`
- Test: `src/ui/screens/BreathDebugScreen.test.tsx`

- [ ] **Step 1: Write failing screen tests through a controllable fake engine**

The test fake stores its listener and exposes `publish(snapshot)`. Cover:

```tsx
it('starts idle with setup guidance and a Start sonar button', () => {
  renderScreen(fake);
  expect(screen.getByRole('heading', { name: /breath sonar/i }))
    .toBeInTheDocument();
  expect(screen.getByText(/15-30 cm/i)).toBeInTheDocument();
  expect(screen.getByText(/not headphones or earbuds/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /start sonar/i }))
    .toBeEnabled();
});

it('renders live inhale state, quality, chart, and diagnostics', () => {
  renderScreen(fake);
  act(() => fake.publish({
    ...liveSnapshot,
    status: 'inhale',
    quality: 'good',
    waveform: [
      { timeMs: 0, value: 0 },
      { timeMs: 1_000, value: 0.8 },
    ],
    diagnostics: {
      frequencyHz: 19_000,
      sampleRateHz: 48_000,
      snrDb: 24.2,
      phaseAmplitude: 0.42,
      qualityScore: 0.82,
      movement: false,
    },
  }));
  expect(screen.getByText('Inhale')).toBeInTheDocument();
  expect(screen.getByText('Good signal')).toBeInTheDocument();
  expect(screen.getByText(/19.0 kHz/i)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /live breathing motion waveform/i }))
    .toBeInTheDocument();
});

it('does not show a breath label for poor signal', () => {
  renderScreen(fake);
  act(() => fake.publish({
    ...liveSnapshot,
    status: 'poor-signal',
    quality: 'poor',
  }));
  expect(screen.getByText('Poor signal')).toBeInTheDocument();
  expect(screen.queryByText('Inhale')).not.toBeInTheDocument();
  expect(screen.queryByText('Exhale')).not.toBeInTheDocument();
});

it('shows unsupported hardware honestly', () => {
  renderScreen(fake);
  act(() => fake.publish({
    ...idleSnapshot,
    status: 'unsupported',
    error: new BreathSonarError(
      'carrier-unsupported',
      'This device or placement could not produce a stable ultrasonic carrier.',
    ),
  }));
  expect(screen.getByRole('alert')).toHaveTextContent(/could not produce/i);
  expect(screen.getByRole('button', { name: /start sonar/i }))
    .toBeEnabled();
});
```

Also verify Start, Stop, and Recalibrate call the matching engine methods.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm test -- src/ui/screens/BreathDebugScreen.test.tsx
```

Expected: FAIL because the screen does not exist.

- [ ] **Step 3: Implement status copy and quality presentation**

Create `BreathDebugScreen.tsx` with:

```tsx
import type { BreathSonarEngine } from '../../infrastructure/device/breathSonarTypes';
import { createBreathSonarEngine } from '../../infrastructure/device/breathSonarEngine';
import { useBreathSonar } from '../hooks/useBreathSonar';
import { BreathWaveform } from '../design-system/BreathWaveform';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';

const STATUS_COPY = {
  idle: 'Idle',
  'requesting-microphone': 'Requesting microphone',
  'checking-device': 'Checking device',
  'calibrating-still': 'Calibrating - stay still',
  'calibrating-inhale': 'Calibrating - inhale',
  'calibrating-exhale': 'Calibrating - exhale',
  inhale: 'Inhale',
  exhale: 'Exhale',
  movement: 'Movement detected - hold still',
  'poor-signal': 'Poor signal',
  unsupported: 'Unsupported on this device or placement',
  error: 'Error',
} as const;

const ACTIVE_STATUSES = new Set([
  'requesting-microphone',
  'checking-device',
  'calibrating-still',
  'calibrating-inhale',
  'calibrating-exhale',
  'inhale',
  'exhale',
  'movement',
  'poor-signal',
]);

export function BreathDebugScreen({
  createEngine = createBreathSonarEngine,
}: {
  createEngine?: () => BreathSonarEngine;
}) {
  const { snapshot, start, stop, recalibrate } = useBreathSonar(createEngine);
  const active = ACTIVE_STATUSES.has(snapshot.status);
  const canRecalibrate = active
    && snapshot.diagnostics.frequencyHz !== null
    && !snapshot.status.startsWith('calibrating-');
  const qualityLabel = snapshot.quality === 'unknown'
    ? 'Signal not measured'
    : `${snapshot.quality[0].toUpperCase()}${snapshot.quality.slice(1)} signal`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-[color:var(--warn)]">
          Experimental
        </div>
        <h2 className="text-2xl font-bold">Breath sonar</h2>
        <p className="mt-1 text-sm text-[color:var(--text-dim)]">
          Local active-sonar debug view. Not a medical device.
        </p>
      </div>

      <Card>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--text-dim)]">
          <li>Use a quiet room and keep still.</li>
          <li>Place the phone 15-30 cm from your face or upper chest.</li>
          <li>Point its speaker and microphone toward your body.</li>
          <li>Use the phone speaker, not headphones or earbuds.</li>
          <li>Stop if the high-frequency tone is audible or uncomfortable.</li>
        </ul>
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
              Current phase
            </div>
            <div className="mt-1 text-3xl font-bold">
              {STATUS_COPY[snapshot.status]}
            </div>
          </div>
          <div className="rounded-full border border-[color:var(--border)] px-3 py-1 text-xs">
            {qualityLabel}
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-[color:var(--ocean-900)] p-2">
          <BreathWaveform points={snapshot.waveform} />
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
          Diagnostics
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <dt className="text-[color:var(--text-dim)]">Carrier</dt>
          <dd>{snapshot.diagnostics.frequencyHz === null
            ? '-'
            : `${(snapshot.diagnostics.frequencyHz / 1_000).toFixed(1)} kHz`}</dd>
          <dt className="text-[color:var(--text-dim)]">Sample rate</dt>
          <dd>{snapshot.diagnostics.sampleRateHz === null
            ? '-'
            : `${(snapshot.diagnostics.sampleRateHz / 1_000).toFixed(1)} kHz`}</dd>
          <dt className="text-[color:var(--text-dim)]">Carrier SNR</dt>
          <dd>{snapshot.diagnostics.snrDb === null
            ? '-'
            : `${snapshot.diagnostics.snrDb.toFixed(1)} dB`}</dd>
          <dt className="text-[color:var(--text-dim)]">Phase amplitude</dt>
          <dd>{snapshot.diagnostics.phaseAmplitude?.toFixed(3) ?? '-'}</dd>
          <dt className="text-[color:var(--text-dim)]">Quality score</dt>
          <dd>{snapshot.diagnostics.qualityScore === null
            ? '-'
            : snapshot.diagnostics.qualityScore.toFixed(2)}</dd>
          <dt className="text-[color:var(--text-dim)]">Movement</dt>
          <dd>{snapshot.diagnostics.movement ? 'Detected' : 'No'}</dd>
        </dl>
      </Card>

      {snapshot.error && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {snapshot.error.message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {!active && (
          <Button className="col-span-2" onClick={() => void start()}>
            Start sonar
          </Button>
        )}
        {active && (
          <Button variant="danger" onClick={() => void stop()}>
            Stop
          </Button>
        )}
        {active && (
          <Button
            variant="ghost"
            disabled={!canRecalibrate}
            onClick={() => void recalibrate()}
          >
            Recalibrate
          </Button>
        )}
      </div>
    </div>
  );
}
```

Keep the status label as the only large phase text so poor signal never leaves
a stale Inhale/Exhale label on screen.

- [ ] **Step 4: Run the screen test**

```powershell
npm test -- src/ui/screens/BreathDebugScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Checkpoint without committing**

```powershell
git add src/ui/screens/BreathDebugScreen.tsx src/ui/screens/BreathDebugScreen.test.tsx
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 7: Wire Settings and routing

**Files:**
- Modify: `src/ui/app/routes.tsx`
- Modify: `src/ui/app/routes.test.tsx`
- Modify: `src/ui/screens/SettingsScreen.tsx`
- Modify: `src/ui/screens/SettingsScreen.test.tsx`

- [ ] **Step 1: Add failing route and Settings navigation tests**

In `routes.test.tsx`:

```tsx
it('renders the hidden Breath sonar experiment at /breath-debug', async () => {
  renderAt('/breath-debug');
  expect(await screen.findByRole('heading', { name: /breath sonar/i }))
    .toBeInTheDocument();
});
```

In `SettingsScreen.test.tsx`:

```tsx
it('links to the hidden Breath sonar experiment', async () => {
  render(
    <ServicesProvider>
      <AppProviders>
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>
      </AppProviders>
    </ServicesProvider>,
  );

  expect(await screen.findByRole('button', { name: /breath sonar/i }))
    .toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
npm test -- src/ui/app/routes.test.tsx src/ui/screens/SettingsScreen.test.tsx
```

Expected: route test fails because `/breath-debug` is not registered; Settings
test fails because the experiment control is absent.

- [ ] **Step 3: Register the hidden route**

In `routes.tsx`:

```tsx
import { BreathDebugScreen } from '../screens/BreathDebugScreen';
```

Add alongside the other `AppShell` routes:

```tsx
<Route
  path="/breath-debug"
  element={<AppShell><BreathDebugScreen /></AppShell>}
/>
```

Do not modify `TabBar.tsx`.

- [ ] **Step 4: Add the Settings Experiments card**

In `SettingsScreen.tsx`, after the Data card:

```tsx
<Card>
  <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--text-mute)]">
    Experiments
  </div>
  <p className="mb-3 text-sm text-[color:var(--text-dim)]">
    Test on-device browser sensors before they become training features.
  </p>
  <Button
    variant="ghost"
    className="w-full"
    onClick={() => navigate('/breath-debug')}
  >
    Breath sonar
  </Button>
</Card>
```

- [ ] **Step 5: Run route and Settings tests**

```powershell
npm test -- src/ui/app/routes.test.tsx src/ui/screens/SettingsScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Checkpoint without committing**

```powershell
git add src/ui/app/routes.tsx src/ui/app/routes.test.tsx src/ui/screens/SettingsScreen.tsx src/ui/screens/SettingsScreen.test.tsx
git diff --cached --check
```

Do not commit without explicit user approval.

---

### Task 8: Validate the complete experiment

**Files:**
- Review all files listed in the file map.

- [ ] **Step 1: Run all sonar-focused tests together**

```powershell
npm test -- src/infrastructure/device/breathSignal.test.ts src/infrastructure/device/breathSonarSession.test.ts src/infrastructure/device/breathSonarEngine.test.ts src/ui/hooks/useBreathSonar.test.tsx src/ui/design-system/BreathWaveform.test.tsx src/ui/screens/BreathDebugScreen.test.tsx src/ui/app/routes.test.tsx src/ui/screens/SettingsScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run lint**

```powershell
npm run lint
```

Expected: PASS with no new errors.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: PASS and emit the worklet asset.

- [ ] **Step 4: Run the full test suite**

```powershell
npm test
```

Expected: all tests pass. The existing Onboarding `act(...)` warning may still
appear; do not change unrelated onboarding tests as part of this feature.

- [ ] **Step 5: Inspect the final diff**

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: only the sonar spec/plan and feature files from this plan are
modified or untracked.

- [ ] **Step 6: Perform HTTPS device validation**

Build and serve the app through an HTTPS-capable local or preview environment,
then follow section 11.4 of the design spec on one iPhone Safari device and one
Android Chrome device. Record:

- model and browser version;
- selected carrier;
- measured SNR;
- calibration success/failure;
- correct cycle count out of five;
- movement suppression result;
- confirmation that route exit clears the browser microphone indicator.

If either platform cannot load the worklet or pass the probe, preserve the
explicit unsupported state and capture diagnostics before changing thresholds.

- [ ] **Step 7: Final checkpoint without committing**

```powershell
git add docs/superpowers/specs/2026-07-16-breath-sonar-debug-design.md docs/superpowers/plans/2026-07-16-breath-sonar-debug.md src
git diff --cached --check
git status --short
```

Do not commit or push without explicit user approval.
