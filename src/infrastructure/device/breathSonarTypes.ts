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
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface BreathSonarSnapshot {
  status: BreathSonarStatus;
  quality: SignalQuality;
  waveform: WaveformPoint[];
  diagnostics: BreathSonarDiagnostics;
  error: BreathSonarError | null;
}

export interface BreathSonarEngine {
  getSnapshot(): BreathSonarSnapshot;
  subscribe(listener: (snapshot: BreathSonarSnapshot) => void): () => void;
  start(): Promise<void>;
  recalibrate(): Promise<void>;
  stop(): Promise<void>;
}
