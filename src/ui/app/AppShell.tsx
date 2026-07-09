import type { ReactNode } from 'react';
import { TabBar } from '../design-system/TabBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-5 py-4">{children}</main>
      <TabBar />
    </div>
  );
}
