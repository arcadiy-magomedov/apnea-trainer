import { Card } from './Card';

export function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-[color:var(--text-mute)]">{label}</div>
      <div className="mt-1 text-4xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </Card>
  );
}
