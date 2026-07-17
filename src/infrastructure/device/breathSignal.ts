import type {
  DemodulatedFrame,
  SignalQuality,
  WaveformPoint,
} from './breathSonarTypes';

const TWO_PI = Math.PI * 2;
const EPSILON = 1e-9;
const MIN_SNR_DB = 12;
const MIN_LIVE_SNR_DB = 6;
const MIN_LIVE_CARRIER_RATIO = 0.2;
const MIN_AMPLITUDE_SCORE = 0.1;
const MAX_PHASE_STEP_JITTER_RAD = 0.35;
const MAX_CLIPPED_RATIO = 0.02;
const HIGH_PASS_CUTOFF_HZ = 0.08;
const LOW_PASS_CUTOFF_HZ = 0.7;
const MOVEMENT_HOLD_MS = 1_000;
const SIGNAL_LOSS_HOLD_MS = 1_000;
const PHASE_DERIVATIVE_THRESHOLD = 0.04;
const PHASE_HYSTERESIS_MS = 500;
const MIN_CALIBRATION_SAMPLES = 4;
const MIN_STILL_BROADBAND_SAMPLES = 5;

export type CalibrationStage = 'still' | 'inhale' | 'exhale';

export interface SignalOutput {
  phase: 'inhale' | 'exhale' | null;
  quality: SignalQuality;
  qualityScore: number;
  phaseAmplitude: number;
  carrierSnrDb: number;
  movement: boolean;
  waveform: WaveformPoint[];
}

interface CalibrationStats {
  still: number[];
  inhale: number[];
  exhale: number[];
}

export interface CarrierProbe {
  frequencyHz: number;
  frames: DemodulatedFrame[];
}

export interface CarrierScore {
  snrDb: number;
  phaseJitterRad: number;
  clippedRatio: number;
  valid: boolean;
}

export interface SelectedCarrier {
  frequencyHz: number;
  snrDb: number;
  phaseJitterRad: number;
  clippedRatio: number;
  valid: boolean;
}

function hasInvalidFrame(frame: DemodulatedFrame): boolean {
  return !Number.isFinite(frame.i)
    || !Number.isFinite(frame.q)
    || !Number.isFinite(frame.sidebandMagnitude)
    || !Number.isFinite(frame.broadbandRms)
    || frame.sidebandMagnitude < 0
    || frame.broadbandRms < 0;
}

function wrapToPi(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }

  let wrapped = angle % TWO_PI;
  if (wrapped < -Math.PI) {
    wrapped += TWO_PI;
  } else if (wrapped > Math.PI) {
    wrapped -= TWO_PI;
  }

  return wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function segmentDelta(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const window = Math.max(1, Math.floor(values.length / 4));
  return mean(values.slice(-window)) - mean(values.slice(0, window));
}

function hasInvalidProcessorFrame(frame: DemodulatedFrame): boolean {
  return !Number.isFinite(frame.timeMs)
    || hasInvalidFrame(frame);
}

export function unwrapPhase(previousUnwrapped: number, wrapped: number): number {
  if (!Number.isFinite(previousUnwrapped)) {
    return Number.isFinite(wrapped) ? wrapped : 0;
  }

  const previousPrincipal = wrapToPi(previousUnwrapped);
  const delta = wrapToPi(wrapped - previousPrincipal);
  return previousUnwrapped + delta;
}

export function scoreCarrier(frames: readonly DemodulatedFrame[]): CarrierScore {
  if (frames.length <= 1) {
    return {
      snrDb: 0,
      phaseJitterRad: 0,
      clippedRatio: 1,
      valid: false,
    };
  }

  const clippedRatio = frames.reduce((count, frame) => count + (frame.clipped ? 1 : 0), 0) / frames.length;
  if (frames.some(hasInvalidFrame)) {
    return {
      snrDb: 0,
      phaseJitterRad: 0,
      clippedRatio,
      valid: false,
    };
  }

  let carrierMagnitudeSum = 0;
  let adjacentBandNoiseSum = 0;
  const unwrappedPhases: number[] = [];

  for (const frame of frames) {
    const carrierMagnitude = Math.hypot(frame.i, frame.q);
    const adjacentBandNoise = frame.sidebandMagnitude;

    carrierMagnitudeSum += carrierMagnitude;
    adjacentBandNoiseSum += adjacentBandNoise;

    const phase = Math.atan2(frame.q, frame.i);
    if (unwrappedPhases.length === 0) {
      unwrappedPhases.push(phase);
    } else {
      unwrappedPhases.push(unwrapPhase(unwrappedPhases[unwrappedPhases.length - 1], phase));
    }
  }

  const carrierMagnitude = carrierMagnitudeSum / frames.length;
  const adjacentBandNoise = adjacentBandNoiseSum / frames.length;
  const snrDb = 20 * Math.log10(
    Math.max(carrierMagnitude, EPSILON) / Math.max(adjacentBandNoise, EPSILON),
  );

  const phaseSteps: number[] = [];
  for (let index = 1; index < unwrappedPhases.length; index += 1) {
    phaseSteps.push(unwrappedPhases[index] - unwrappedPhases[index - 1]);
  }

  const phaseStepMean = phaseSteps.length === 0
    ? 0
    : phaseSteps.reduce((sum, value) => sum + value, 0) / phaseSteps.length;

  const phaseStepVariance = phaseSteps.length === 0
    ? 0
    : phaseSteps.reduce((sum, value) => sum + (value - phaseStepMean) ** 2, 0) / phaseSteps.length;

  const phaseJitterRad = Math.sqrt(Math.max(phaseStepVariance, 0));
  const valid = snrDb >= MIN_SNR_DB
    && phaseJitterRad <= MAX_PHASE_STEP_JITTER_RAD
    && clippedRatio <= MAX_CLIPPED_RATIO;

  return {
    snrDb,
    phaseJitterRad,
    clippedRatio,
    valid,
  };
}

export function selectCarrier(probes: readonly CarrierProbe[]): SelectedCarrier | null {
  let selected: SelectedCarrier | null = null;

  for (const probe of probes) {
    const score = scoreCarrier(probe.frames);
    if (!score.valid) {
      continue;
    }

    if (
      selected === null
      || score.snrDb > selected.snrDb
    ) {
      selected = {
        frequencyHz: probe.frequencyHz,
        snrDb: score.snrDb,
        phaseJitterRad: score.phaseJitterRad,
        clippedRatio: score.clippedRatio,
        valid: score.valid,
      };
    }
  }

  return selected;
}

export class BreathSignalProcessor {
  private readonly sampleRateHz: number;
  private readonly sampleIntervalMs: number;
  private readonly liveWindowFrameCount: number;
  private readonly signalLossFrameCount: number;
  private readonly lowPassAlpha: number;
  private readonly highPassAlpha: number;
  private readonly waveform: WaveformPoint[] = [];
  private readonly amplitudeWindow: number[] = [];
  private readonly carrierMagnitudeWindow: number[] = [];
  private readonly sidebandMagnitudeWindow: number[] = [];
  private readonly calibration: CalibrationStats = {
    still: [],
    inhale: [],
    exhale: [],
  };
  private readonly calibrationStageStarted: Record<CalibrationStage, boolean> = {
    still: false,
    inhale: false,
    exhale: false,
  };
  private stage: CalibrationStage | null = null;
  private carrierSnrDb = 0;
  private previousUnwrapped: number | null = null;
  private previousInput = 0;
  private previousFiltered = 0;
  private lowPass = 0;
  private highPass = 0;
  private polarity = 1;
  private calibrated = false;
  private currentPhase: 'inhale' | 'exhale' | null = null;
  private candidatePhase: 'inhale' | 'exhale' | null = null;
  private candidateSinceMs = 0;
  private currentPhaseSinceMs = 0;
  private movementUntilMs = Number.NEGATIVE_INFINITY;
  private baselineNoise = 0.01;
  private baselineRms = 0.01;
  private readonly stillBroadbandSamples: number[] = [];
  private calibrationMovementDetected = false;
  private baselineCarrierMagnitude = 0;
  private stillCarrierMagnitudeSum = 0;
  private stillCarrierMagnitudeCount = 0;
  private liveCarrierSnrDb = 0;
  private unusableFrameCount = 0;
  private sustainedSignalLoss = false;
  private lastTimeMs: number | null = null;

  constructor(sampleRateHz: number) {
    this.sampleRateHz = Number.isFinite(sampleRateHz) && sampleRateHz > 0
      ? sampleRateHz
      : 20;
    this.sampleIntervalMs = 1_000 / this.sampleRateHz;
    this.liveWindowFrameCount = Math.max(
      1,
      Math.ceil(this.sampleRateHz),
    );
    this.signalLossFrameCount = Math.max(
      1,
      Math.ceil(
        SIGNAL_LOSS_HOLD_MS / this.sampleIntervalMs,
      ),
    );
    const dt = 1 / this.sampleRateHz;
    const lowPassTimeConstant = 1 / (TWO_PI * LOW_PASS_CUTOFF_HZ);
    const highPassTimeConstant = 1 / (TWO_PI * HIGH_PASS_CUTOFF_HZ);
    this.lowPassAlpha = dt / (lowPassTimeConstant + dt);
    this.highPassAlpha = highPassTimeConstant / (highPassTimeConstant + dt);
  }

  setCarrierSnrDb(value: number): void {
    this.carrierSnrDb = Number.isFinite(value) ? value : 0;
  }

  markSignalLost(): void {
    this.clearLiveSignalWindows();
    this.unusableFrameCount = 0;
    this.sustainedSignalLoss = true;
    this.rebasePhaseTracking();
  }

  beginCalibrationStage(stage: CalibrationStage): void {
    if (stage === 'still') {
      this.resetCalibrationState();
    } else {
      this.calibration[stage] = [];
      this.clearLivePhase();
    }

    this.stage = stage;
    this.calibrationStageStarted[stage] = true;
  }

  completeCalibration(): boolean {
    const stillNoise = standardDeviation(this.calibration.still);
    const inhaleDelta = segmentDelta(this.calibration.inhale);
    const exhaleDelta = segmentDelta(this.calibration.exhale);
    const minimumMotion = Math.max(stillNoise * 3, 0.03);
    const stillCarrierMagnitude = this.stillCarrierMagnitudeCount === 0
      ? 0
      : this.stillCarrierMagnitudeSum
        / this.stillCarrierMagnitudeCount;
    const stagesValid = (
      Object.values(this.calibrationStageStarted).every(Boolean)
      && Object.values(this.calibration).every(
        (samples) => samples.length >= MIN_CALIBRATION_SAMPLES,
      )
    );
    const valid = stagesValid
      && !this.calibrationMovementDetected
      && Math.abs(inhaleDelta) >= minimumMotion
      && Math.abs(exhaleDelta) >= minimumMotion
      && Math.sign(inhaleDelta) === -Math.sign(exhaleDelta);
    const carrierBaselineValid = Number.isFinite(stillCarrierMagnitude)
      && stillCarrierMagnitude > 0;

    this.stage = null;
    this.clearLivePhase();
    this.calibrated = valid && carrierBaselineValid;

    if (!this.calibrated) {
      return false;
    }

    this.polarity = inhaleDelta > 0 ? 1 : -1;
    this.baselineNoise = Math.max(stillNoise, 0.005);
    this.baselineCarrierMagnitude = stillCarrierMagnitude;
    this.waveform.length = 0;
    this.amplitudeWindow.length = 0;
    this.clearCarrierMeasurements();
    this.unusableFrameCount = 0;
    this.sustainedSignalLoss = false;
    this.previousFiltered = this.lowPass * this.polarity;
    return true;
  }

  ingest(frame: DemodulatedFrame): SignalOutput {
    const timeMs = this.safeTimeMs(frame.timeMs);
    if (hasInvalidProcessorFrame(frame)) {
      this.movementUntilMs = Math.max(
        this.movementUntilMs,
        timeMs + MOVEMENT_HOLD_MS,
      );
      if (this.stage !== null) {
        this.calibrationMovementDetected = true;
      }
      this.rebasePhaseTracking();
      return this.outputForMovement();
    }

    const carrierMagnitude = this.updateCarrierMeasurements(frame);
    const wrapped = Math.atan2(frame.q, frame.i);
    const hadPreviousPhase = this.previousUnwrapped !== null;
    const unwrapped = hadPreviousPhase
      ? unwrapPhase(this.previousUnwrapped!, wrapped)
      : wrapped;
    const phaseStep = hadPreviousPhase
      ? unwrapped - this.previousUnwrapped!
      : 0;
    const broadbandMovement = (
      this.stillBroadbandSamples.length >= MIN_STILL_BROADBAND_SAMPLES
      && frame.broadbandRms > this.baselineRms * 6
    );
    const movementDetected = frame.clipped
      || Math.abs(phaseStep) > 1.5
      || broadbandMovement;

    if (movementDetected) {
      this.movementUntilMs = Math.max(
        this.movementUntilMs,
        timeMs + MOVEMENT_HOLD_MS,
      );
      if (this.stage !== null) {
        this.calibrationMovementDetected = true;
      }
      this.rebaseFilter(unwrapped);
    } else {
      this.updateFilter(unwrapped, hadPreviousPhase);
    }

    this.previousUnwrapped = unwrapped;
    this.previousInput = unwrapped;

    const filtered = this.lowPass * this.polarity;
    const movementActive = timeMs < this.movementUntilMs;
    if (this.stage !== null && !movementActive) {
      this.calibration[this.stage].push(this.lowPass);
      if (this.stage === 'still') {
        this.stillBroadbandSamples.push(frame.broadbandRms);
        this.stillCarrierMagnitudeSum += carrierMagnitude;
        this.stillCarrierMagnitudeCount += 1;
        this.baselineRms = Math.max(
          median(this.stillBroadbandSamples),
          EPSILON,
        );
      }
    }

    this.updateAmplitudeAndWaveform(timeMs, filtered);

    const derivative = (filtered - this.previousFiltered)
      * this.sampleRateHz;
    this.previousFiltered = filtered;

    const phaseAmplitude = this.currentPhaseAmplitude();
    const amplitudeScore = this.amplitudeScore(phaseAmplitude);
    const carrierSnrDb = this.currentCarrierSnrDb();
    const carrierUsable = this.carrierIsUsable();
    const breathingUsable = !this.calibrated
      || (
        carrierUsable
        && amplitudeScore >= MIN_AMPLITUDE_SCORE
      );
    const signalUnavailable = this.calibrated && !breathingUsable;
    this.updateSignalLoss(signalUnavailable, carrierUsable);
    const qualityScore = movementActive
      || signalUnavailable
      ? 0
      : this.qualityScore(
          carrierSnrDb,
          amplitudeScore,
          phaseStep,
        );
    const quality = this.qualityFromScore(qualityScore);

    this.updatePhaseClassifier(
      derivative,
      timeMs,
      movementActive || signalUnavailable || quality === 'poor',
    );

    return {
      phase: this.calibrated
        && !movementActive
        && !signalUnavailable
        && quality !== 'poor'
        ? this.currentPhase
        : null,
      quality,
      qualityScore,
      phaseAmplitude,
      carrierSnrDb,
      movement: movementActive,
      waveform: [...this.waveform],
    };
  }

  private resetCalibrationState(): void {
    this.calibration.still = [];
    this.calibration.inhale = [];
    this.calibration.exhale = [];
    this.calibrationStageStarted.still = false;
    this.calibrationStageStarted.inhale = false;
    this.calibrationStageStarted.exhale = false;
    this.waveform.length = 0;
    this.amplitudeWindow.length = 0;
    this.clearCarrierMeasurements();
    this.previousUnwrapped = null;
    this.previousInput = 0;
    this.previousFiltered = 0;
    this.lowPass = 0;
    this.highPass = 0;
    this.polarity = 1;
    this.calibrated = false;
    this.currentPhase = null;
    this.candidatePhase = null;
    this.candidateSinceMs = 0;
    this.currentPhaseSinceMs = 0;
    this.movementUntilMs = Number.NEGATIVE_INFINITY;
    this.baselineNoise = 0.01;
    this.baselineRms = 0.01;
    this.stillBroadbandSamples.length = 0;
    this.calibrationMovementDetected = false;
    this.baselineCarrierMagnitude = 0;
    this.stillCarrierMagnitudeSum = 0;
    this.stillCarrierMagnitudeCount = 0;
    this.unusableFrameCount = 0;
    this.sustainedSignalLoss = false;
    this.lastTimeMs = null;
  }

  private safeTimeMs(timeMs: number): number {
    const minimumNextTime = this.lastTimeMs === null
      ? 0
      : this.lastTimeMs + this.sampleIntervalMs;
    const safeTime = Number.isFinite(timeMs)
      ? Math.max(timeMs, minimumNextTime)
      : minimumNextTime;
    this.lastTimeMs = safeTime;
    return safeTime;
  }

  private updateFilter(unwrapped: number, hadPreviousPhase: boolean): void {
    if (!hadPreviousPhase) {
      this.previousInput = unwrapped;
      this.highPass = 0;
      this.lowPass = 0;
      return;
    }

    this.highPass = this.highPassAlpha
      * (this.highPass + unwrapped - this.previousInput);
    this.lowPass += this.lowPassAlpha * (this.highPass - this.lowPass);
  }

  private rebaseFilter(unwrapped: number): void {
    this.previousInput = unwrapped;
    this.highPass = 0;
    this.lowPass = 0;
    this.previousFiltered = 0;
    this.clearLivePhase();
  }

  private rebasePhaseTracking(): void {
    this.previousUnwrapped = null;
    this.previousInput = 0;
    this.highPass = 0;
    this.lowPass = 0;
    this.previousFiltered = 0;
    this.clearLivePhase();
  }

  private clearLivePhase(): void {
    this.currentPhase = null;
    this.candidatePhase = null;
    this.candidateSinceMs = 0;
    this.currentPhaseSinceMs = 0;
  }

  private clearCarrierMeasurements(): void {
    this.carrierMagnitudeWindow.length = 0;
    this.sidebandMagnitudeWindow.length = 0;
    this.liveCarrierSnrDb = 0;
  }

  private clearLiveSignalWindows(): void {
    this.clearCarrierMeasurements();
    this.amplitudeWindow.length = 0;
  }

  private updateCarrierMeasurements(frame: DemodulatedFrame): number {
    const carrierMagnitude = Math.hypot(frame.i, frame.q);
    this.carrierMagnitudeWindow.push(carrierMagnitude);
    this.sidebandMagnitudeWindow.push(frame.sidebandMagnitude);
    while (
      this.carrierMagnitudeWindow.length > this.liveWindowFrameCount
    ) {
      this.carrierMagnitudeWindow.shift();
      this.sidebandMagnitudeWindow.shift();
    }

    const meanCarrierMagnitude = mean(this.carrierMagnitudeWindow);
    const meanSidebandMagnitude = mean(this.sidebandMagnitudeWindow);
    const snrDb = 20 * Math.log10(
      Math.max(meanCarrierMagnitude, EPSILON)
        / Math.max(meanSidebandMagnitude, EPSILON),
    );
    this.liveCarrierSnrDb = Number.isFinite(snrDb) ? snrDb : 0;
    return carrierMagnitude;
  }

  private currentCarrierMagnitude(): number {
    const value = mean(this.carrierMagnitudeWindow);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  private currentCarrierSnrDb(): number {
    const value = this.carrierMagnitudeWindow.length > 0
      ? this.liveCarrierSnrDb
      : this.calibrated
        ? 0
        : this.carrierSnrDb;
    return Number.isFinite(value) ? value : 0;
  }

  private carrierIsUsable(): boolean {
    const minimumCarrierMagnitude = this.baselineCarrierMagnitude
      * MIN_LIVE_CARRIER_RATIO;
    return Number.isFinite(this.baselineCarrierMagnitude)
      && this.baselineCarrierMagnitude > 0
      && this.currentCarrierMagnitude() >= minimumCarrierMagnitude
      && this.currentCarrierSnrDb() >= MIN_LIVE_SNR_DB;
  }

  private updateSignalLoss(
    signalUnavailable: boolean,
    carrierUsable: boolean,
  ): void {
    if (!signalUnavailable) {
      this.unusableFrameCount = 0;
      this.sustainedSignalLoss = false;
      return;
    }

    if (this.sustainedSignalLoss) {
      if (carrierUsable) {
        this.unusableFrameCount = 0;
        this.sustainedSignalLoss = false;
        return;
      }

      this.clearLiveSignalWindows();
      this.rebasePhaseTracking();
      return;
    }

    this.unusableFrameCount += 1;
    if (this.unusableFrameCount >= this.signalLossFrameCount) {
      this.sustainedSignalLoss = true;
      this.clearLiveSignalWindows();
      this.rebasePhaseTracking();
    }
  }

  private updateAmplitudeAndWaveform(
    timeMs: number,
    filtered: number,
  ): void {
    const finiteFiltered = Number.isFinite(filtered) ? filtered : 0;
    this.amplitudeWindow.push(finiteFiltered);
    while (this.amplitudeWindow.length > this.sampleRateHz * 5) {
      this.amplitudeWindow.shift();
    }

    const phaseAmplitude = this.currentPhaseAmplitude();
    const normalized = clamp(
      finiteFiltered / Math.max(phaseAmplitude * 2, EPSILON),
      -1,
      1,
    );
    this.waveform.push({ timeMs, value: normalized });
    while (
      this.waveform.length > 1
      && timeMs - this.waveform[0].timeMs > 20_000
    ) {
      this.waveform.shift();
    }
  }

  private currentPhaseAmplitude(): number {
    const rms = Math.sqrt(mean(
      this.amplitudeWindow.map((value) => value ** 2),
    ));
    return Math.max(
      Number.isFinite(rms) ? rms : 0,
      this.baselineNoise,
    );
  }

  private amplitudeScore(phaseAmplitude: number): number {
    return clamp(
      (phaseAmplitude - this.baselineNoise)
        / Math.max(this.baselineNoise * 4, EPSILON),
      0,
      1,
    );
  }

  private qualityScore(
    carrierSnrDb: number,
    amplitudeScore: number,
    phaseStep: number,
  ): number {
    const snrScore = clamp((carrierSnrDb - MIN_SNR_DB) / 18, 0, 1);
    const continuityScore = clamp(
      1 - Math.abs(phaseStep) / 1.5,
      0,
      1,
    );
    return clamp(
      snrScore * 0.4
        + amplitudeScore * 0.3
        + continuityScore * 0.3,
      0,
      1,
    );
  }

  private qualityFromScore(qualityScore: number): SignalQuality {
    if (qualityScore >= 0.7) {
      return 'good';
    }
    if (qualityScore >= 0.45) {
      return 'fair';
    }
    return 'poor';
  }

  private updatePhaseClassifier(
    derivative: number,
    timeMs: number,
    suppressed: boolean,
  ): void {
    if (!this.calibrated || this.stage !== null || suppressed) {
      this.candidatePhase = null;
      return;
    }

    const nextPhase = derivative > PHASE_DERIVATIVE_THRESHOLD
      ? 'inhale'
      : derivative < -PHASE_DERIVATIVE_THRESHOLD
        ? 'exhale'
        : null;

    if (nextPhase === null || nextPhase === this.currentPhase) {
      this.candidatePhase = null;
      return;
    }

    if (this.candidatePhase !== nextPhase) {
      this.candidatePhase = nextPhase;
      this.candidateSinceMs = timeMs;
      return;
    }

    const candidateReady = timeMs - this.candidateSinceMs
      >= PHASE_HYSTERESIS_MS;
    const currentPhaseDwelled = this.currentPhase === null
      || timeMs - this.currentPhaseSinceMs >= PHASE_HYSTERESIS_MS;
    if (candidateReady && currentPhaseDwelled) {
      this.currentPhase = nextPhase;
      this.currentPhaseSinceMs = timeMs;
      this.candidatePhase = null;
    }
  }

  private outputForMovement(): SignalOutput {
    return {
      phase: null,
      quality: 'poor',
      qualityScore: 0,
      phaseAmplitude: this.currentPhaseAmplitude(),
      carrierSnrDb: this.currentCarrierSnrDb(),
      movement: true,
      waveform: [...this.waveform],
    };
  }
}
