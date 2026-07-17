import { useState, type CSSProperties } from 'react';
import { createBreathSonarEngine } from '../../infrastructure/device/breathSonarEngine';
import type {
  BreathSonarEngine,
  SignalQuality,
  BreathSonarStatus,
} from '../../infrastructure/device/breathSonarTypes';
import { useBreathSonar } from '../hooks/useBreathSonar';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { BreathWaveform } from '../design-system/BreathWaveform';

type BreathDebugScreenProps = {
  createEngine?: () => BreathSonarEngine;
};

const STATUS_COPY: Record<BreathSonarStatus, string> = {
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
};

const QUALITY_COPY: Record<SignalQuality, string> = {
  unknown: 'Signal not measured',
  good: 'Good signal',
  fair: 'Fair signal',
  poor: 'Poor signal',
};

const QUALITY_STYLE: Record<SignalQuality, { className: string; style?: CSSProperties }> = {
  unknown: {
    className: 'border-[color:var(--border)] bg-ocean-700 text-[color:var(--text-dim)]',
  },
  good: {
    className: 'border-success text-success',
    style: { backgroundColor: 'rgba(52, 211, 153, 0.12)' },
  },
  fair: {
    className: 'border-warn text-warn',
    style: { backgroundColor: 'rgba(251, 191, 36, 0.12)' },
  },
  poor: {
    className: 'border-danger text-danger',
    style: { backgroundColor: 'rgba(248, 113, 113, 0.12)' },
  },
};

function formatKHz(value: number | null): string {
  return value === null ? '-' : `${(value / 1000).toFixed(1)} kHz`;
}

function formatFixed(value: number | null, digits: number, suffix = ''): string {
  return value === null ? '-' : `${value.toFixed(digits)}${suffix}`;
}

function formatMovement(movement: boolean): string {
  return movement ? 'Detected' : 'No';
}

function isActiveStatus(status: BreathSonarStatus): boolean {
  return (
    status === 'requesting-microphone'
    || status === 'checking-device'
    || status === 'calibrating-still'
    || status === 'calibrating-inhale'
    || status === 'calibrating-exhale'
    || status === 'inhale'
    || status === 'exhale'
    || status === 'movement'
    || status === 'poor-signal'
  );
}

function QualityBadge({ quality }: { quality: SignalQuality }) {
  const { className, style } = QUALITY_STYLE[quality];

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${className}`}
      style={style}
    >
      {QUALITY_COPY[quality]}
    </span>
  );
}

export function BreathDebugScreen({
  createEngine = createBreathSonarEngine,
}: BreathDebugScreenProps = {}) {
  const { snapshot, start, stop, recalibrate } = useBreathSonar(createEngine);
  const [isStopping, setIsStopping] = useState(false);

  const error = snapshot.error;
  const statusCopy = STATUS_COPY[snapshot.status];
  const showActiveControls = isActiveStatus(snapshot.status);
  const canRecalibrate = showActiveControls
    && snapshot.diagnostics.frequencyHz !== null
    && !snapshot.status.startsWith('calibrating-');
  const showError = Boolean(error)
    && !snapshot.status.startsWith('calibrating-');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-mute)]">
          Experimental
        </div>
        <h2 className="mt-1 text-2xl font-bold">Breath sonar</h2>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Processing stays local on your device. Breath sonar is not a medical device.
        </p>
      </div>

      <Card>
        <section aria-labelledby="breath-sonar-setup-heading" className="space-y-3">
          <div
            id="breath-sonar-setup-heading"
            className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-mute)]"
          >
            Setup
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm text-[color:var(--text-dim)]">
            <li>Use a quiet room and keep still.</li>
            <li>Hold the phone 15-30 cm from your face or upper chest.</li>
            <li>Point the phone speaker and microphone toward your body.</li>
            <li>Use the phone speaker, not headphones or earbuds.</li>
            <li>The carrier may be audible to children or nearby animals.</li>
            <li>Stop if you hear a high-frequency tone or feel uncomfortable.</li>
          </ul>
        </section>
      </Card>

      <Card>
        <section className="space-y-4" aria-labelledby="breath-sonar-current-heading">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div
                id="breath-sonar-current-heading"
                className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-mute)]"
              >
                Current status
              </div>
              <p
                role="status"
                aria-live="polite"
                className="text-2xl font-semibold"
              >
                {statusCopy}
              </p>
            </div>
            <QualityBadge quality={snapshot.quality} />
          </div>

          {showError && error && (
            <p role="alert" className="text-sm text-[color:var(--danger)]">
              {error.message}
            </p>
          )}

          <div className="rounded-3xl border border-[color:var(--border)] bg-ocean-700 p-4">
            <BreathWaveform waveform={snapshot.waveform} />
          </div>

          <section aria-labelledby="breath-sonar-diagnostics-heading" className="space-y-3">
            <div
              id="breath-sonar-diagnostics-heading"
              className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-mute)]"
            >
              Diagnostics
            </div>
            <dl
              data-testid="diagnostics-grid"
              className="grid grid-cols-2 gap-3 text-sm"
            >
              <div>
                <dt className="text-[color:var(--text-mute)]">Carrier</dt>
                <dd>{formatKHz(snapshot.diagnostics.frequencyHz)}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--text-mute)]">Sample rate</dt>
                <dd>{formatKHz(snapshot.diagnostics.sampleRateHz)}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--text-mute)]">Carrier SNR</dt>
                <dd>{formatFixed(snapshot.diagnostics.snrDb, 1, ' dB')}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--text-mute)]">Phase amplitude</dt>
                <dd>{formatFixed(snapshot.diagnostics.phaseAmplitude, 3)}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--text-mute)]">Quality score</dt>
                <dd>{formatFixed(snapshot.diagnostics.qualityScore, 2)}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--text-mute)]">Movement</dt>
                <dd>{formatMovement(snapshot.diagnostics.movement)}</dd>
              </div>
            </dl>
          </section>

          <div>
            {!showActiveControls ? (
              <Button
                className="w-full"
                onClick={() => {
                  void start();
                }}
              >
                Start sonar
              </Button>
            ) : (
              <div className="flex gap-3">
                <Button
                  variant="danger"
                  className="flex-1"
                  disabled={isStopping}
                  onClick={() => {
                    if (isStopping) {
                      return;
                    }

                    setIsStopping(true);
                    void stop().finally(() => {
                      setIsStopping(false);
                    });
                  }}
                >
                  Stop
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={!canRecalibrate || isStopping}
                  onClick={() => {
                    if (isStopping || !canRecalibrate) {
                      return;
                    }

                    void recalibrate();
                  }}
                >
                  Recalibrate
                </Button>
              </div>
            )}
          </div>
        </section>
      </Card>
    </div>
  );
}
