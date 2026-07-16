import type { WaveformPoint } from '../../infrastructure/device/breathSonarTypes';

const WIDTH = 320;
const HEIGHT = 180;
const PAD = 16;
const WINDOW_MS = 20_000;
const DRAWABLE_WIDTH = WIDTH - PAD * 2;
const CENTER_Y = HEIGHT / 2;
const DRAWABLE_HALF_HEIGHT = CENTER_Y - PAD;

function isFinitePoint(point: WaveformPoint): boolean {
  return Number.isFinite(point.timeMs) && Number.isFinite(point.value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

export function BreathWaveform({
  waveform,
}: {
  waveform: readonly WaveformPoint[];
}) {
  const finitePoints = waveform.filter(isFinitePoint).slice().sort((left, right) => left.timeMs - right.timeMs);
  const latestTime = finitePoints.at(-1)?.timeMs ?? 0;
  const cutoffTime = latestTime - WINDOW_MS;
  const visiblePoints = finitePoints.filter((point) => point.timeMs >= cutoffTime);

  const path = visiblePoints
    .map((point, index) => {
      const normalized = clamp(point.value, -1, 1);
      const x = PAD + ((point.timeMs - cutoffTime) / WINDOW_MS) * DRAWABLE_WIDTH;
      const y = CENTER_Y - normalized * DRAWABLE_HALF_HEIGHT;
      return `${index === 0 ? 'M' : 'L'} ${formatNumber(x)} ${formatNumber(y)}`;
    })
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
        y1={CENTER_Y}
        y2={CENTER_Y}
        stroke="var(--text-mute)"
        strokeDasharray="6 4"
      />
      <text x={PAD} y={20} fill="var(--text-dim)" fontSize="10">
        Inhale
      </text>
      <text x={PAD} y={HEIGHT - 10} fill="var(--text-dim)" fontSize="10">
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
