import { useEffect, useState } from 'react';

export function makeAppUpdate(updateSW: (reload?: boolean) => Promise<void>) {
  let needRefresh = false;
  const listeners = new Set<() => void>();
  return {
    getNeedRefresh: () => needRefresh,
    setNeedRefresh: (v: boolean) => { needRefresh = v; listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
    async apply(sessionActive: boolean) {
      if (sessionActive) return;
      await updateSW(true);
    },
  };
}

export function useAppUpdate(sessionActive: boolean) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(reload?: boolean) => Promise<void>>();

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (disposed) return;
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() { setNeedRefresh(true); },
      });
      setUpdate(() => updateSW);
      const id = setInterval(() => { void updateSW(); }, 60 * 60 * 1000);
      const onFocus = () => { void updateSW(); };
      window.addEventListener('focus', onFocus);
      cleanup = () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
    });
    return () => { disposed = true; cleanup(); };
  }, []);

  return {
    needRefresh,
    async apply() {
      if (sessionActive || !update) return;
      await update(true);
    },
    dismiss: () => setNeedRefresh(false),
  };
}