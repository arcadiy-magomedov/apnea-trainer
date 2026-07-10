import type { MaxPoint } from '../../domain/apnea/assessmentHistory';
import type { ProjectionPoint } from '../../domain/apnea/goalEngine';
import { formatMMSS } from './format';

const WIDTH = 320;
const HEIGHT = 180;
const PAD = 28;

export function ProgressChart({
  actual,
  projected,
  targetSec,
}: {
  actual: MaxPoint[];
  projected: ProjectionPoint[];
  targetSec: number;
}) {
  const all = [
    ...actual.map((point) => ({ at: point.at, sec: point.sec })),
    ...projected,
    { at: projected.at(-1)?.at ?? actual.at(-1)?.at ?? 0, sec: targetSec },
  ];
  const minAt = Math.min(...all.map((point) => point.at));
  const maxAt = Math.max(...all.map((point) => point.at), minAt + 1);
  const minSec = Math.min(...all.map((point) => point.sec));
  const maxSec = Math.max(...all.map((point) => point.sec), minSec + 1);
  const x = (at: number) =>
    PAD + ((at - minAt) / (maxAt - minAt)) * (WIDTH - PAD * 2);
  const y = (sec: number) =>
    HEIGHT - PAD
    - ((sec - minSec) / (maxSec - minSec)) * (HEIGHT - PAD * 2);
  const path = (points: Array<{ at: number; sec: number }>) =>
    points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${x(point.at)} ${y(point.sec)}`,
    ).join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Goal progress chart"
      className="w-full"
    >
      <line
        data-testid="goal-line"
        x1={PAD}
        x2={WIDTH - PAD}
        y1={y(targetSec)}
        y2={y(targetSec)}
        stroke="var(--warn)"
        strokeDasharray="4 4"
      />
      <path
        d={path(actual)}
        fill="none"
        stroke="var(--cyan)"
        strokeWidth="3"
      />
      <path
        data-testid="projected-path"
        d={path(projected)}
        fill="none"
        stroke="var(--teal)"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      {actual.map((point) => (
        <circle
          key={point.id}
          data-testid="actual-point"
          cx={x(point.at)}
          cy={y(point.sec)}
          r="4"
          fill="var(--cyan)"
        />
      ))}
      <text x={PAD} y={16} fill="var(--text-dim)" fontSize="10">
        Goal {formatMMSS(targetSec)}
      </text>
      <text data-testid="axis-label" x="2" y={y(maxSec)} fill="var(--text-dim)" fontSize="9">
        {formatMMSS(maxSec)}
      </text>
      <text data-testid="axis-label" x="2" y={y(minSec)} fill="var(--text-dim)" fontSize="9">
        {formatMMSS(minSec)}
      </text>
      <text data-testid="axis-label" x={PAD} y={HEIGHT - 4} fill="var(--text-dim)" fontSize="9">
        {new Date(minAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })}
      </text>
      <text
        data-testid="axis-label"
        x={WIDTH - PAD}
        y={HEIGHT - 4}
        textAnchor="end"
        fill="var(--text-dim)"
        fontSize="9"
      >
        {new Date(maxAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })}
      </text>
    </svg>
  );
}
