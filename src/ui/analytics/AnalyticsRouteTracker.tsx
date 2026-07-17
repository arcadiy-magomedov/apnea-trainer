import { useEffect, useRef } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import {
  normalizeAnalyticsPath,
  surfaceForPath,
} from '../../application/analytics/events';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { useAnalyticsConsent } from './AnalyticsConsentProvider';

export function AnalyticsRouteTracker() {
  const location = useLocation();
  const { analytics } = useServices();
  const hydrated = useAppStore((state) => state.hydrated);
  const onboarded = useAppStore((state) => state.state.settings.onboarded);
  const { active, available, consent, ready } = useAnalyticsConsent();
  const lastPageKey = useRef<string | null>(null);

  useEffect(() => {
    if (!available || !active) {
      lastPageKey.current = null;
      return;
    }

    if (!ready || !hydrated) return;

    // Redirect sources never render a page; their destinations are tracked.
    if (
      matchPath('/program', location.pathname)
      || (location.pathname === '/' && !onboarded)
    ) {
      return;
    }
    const path = normalizeAnalyticsPath(location.pathname);
    const pageKey = `${location.key}:${path}`;
    if (lastPageKey.current === pageKey) return;

    lastPageKey.current = pageKey;
    analytics.track({
      name: 'page_view',
      path,
      surface: surfaceForPath(path),
    });

    if (path === '/onboarding') {
      analytics.track({ name: 'onboarding_started' });
    }
  }, [
    active,
    analytics,
    available,
    consent,
    hydrated,
    location.key,
    location.pathname,
    onboarded,
    ready,
  ]);

  useEffect(() => {
    if (!ready || !available || !active) return;

    const installed = () => {
      analytics.track({ name: 'pwa_install_accepted' });
    };
    window.addEventListener('appinstalled', installed);

    return () => {
      window.removeEventListener('appinstalled', installed);
    };
  }, [active, analytics, available, consent, ready]);

  return null;
}
