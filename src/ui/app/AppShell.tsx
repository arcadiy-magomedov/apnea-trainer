import type { ReactNode } from 'react';
import { TabBar } from '../design-system/TabBar';

export function AppShell({
  children,
  bottomAction,
}: {
  children: ReactNode;
  bottomAction?: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-5 py-4">{children}</main>
      {bottomAction && (
        <div
          role="region"
          aria-label="Primary action"
          className="shrink-0 bg-[color:var(--ocean-900)] px-5 pb-3 pt-2"
        >
          {bottomAction}
        </div>
      )}
      <TabBar />
    </div>
  );
}
