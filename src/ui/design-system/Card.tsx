import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-[color:var(--border)] bg-surface p-4 ${className}`}>
      {children}
    </div>
  );
}
