import { useEffect, useRef, useState } from 'react';

export async function pollForUpdate(registration: ServiceWorkerRegistration | undefined): Promise<void> {
  await registration?.update();
}

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
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (disposed) return;
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() { setNeedRefresh(true); },
        onRegisteredSW(_swUrl, registration) { registrationRef.current = registration; },
      });
      setUpdate(() => updateSW);
      const checkForUpdate = () => { void pollForUpdate(registrationRef.current); };
      const id = setInterval(checkForUpdate, 60 * 60 * 1000);
      const onFocus = () => { checkForUpdate(); };
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
