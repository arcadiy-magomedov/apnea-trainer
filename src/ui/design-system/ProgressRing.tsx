export function dashOffset(progress: number, radius: number): number {
  const c = 2 * Math.PI * radius;
  return c * (1 - Math.min(1, Math.max(0, progress)));
}

export function ProgressRing({
  progress, label, sublabel, color,
}: { progress: number; label: string; sublabel?: string; color: string }) {
  const r = 98;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-56 w-56">
      <svg width="224" height="224" viewBox="0 0 224 224" className="-rotate-90">
        <circle cx="112" cy="112" r={r} fill="none" stroke="var(--border)" strokeWidth="12" />
        <circle
          cx="112" cy="112" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={dashOffset(progress, r)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-bold tabular-nums">{label}</div>
        {sublabel && <div className="text-xs uppercase tracking-widest text-[color:var(--text-dim)]">{sublabel}</div>}
      </div>
    </div>
  );
}
