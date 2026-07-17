/* oxlint-disable react/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AnalyticsConsent,
} from '../../application/analytics/analyticsService';
import { useServices } from '../app/services';

type AnalyticsChoice = Exclude<AnalyticsConsent, 'unknown'>;

export interface AnalyticsConsentContextValue {
  available: boolean;
  active: boolean;
  consent: AnalyticsConsent;
  ready: boolean;
  error: string | null;
  choose(next: AnalyticsChoice): Promise<void>;
  getAnonymousId(): Promise<string | null>;
}

interface ConsentState {
  active: boolean;
  consent: AnalyticsConsent;
  ready: boolean;
  error: string | null;
}

const LOAD_ERROR =
  'Could not load the analytics preference. Analytics remains disabled.';
const SAVE_ERROR =
  'Could not save the analytics preference. Please try again.';
const APPLY_ERROR =
  'Could not apply the analytics preference. Analytics remains disabled.';
const UNAVAILABLE_ERROR = 'Analytics is unavailable in this build.';
const RESET_ERROR =
  'Analytics preference was saved, but analytics could not be fully disabled. Please try again.';
const SAVE_AND_RESET_ERROR =
  'Could not save the analytics preference or fully disable analytics. Please try again.';

const AnalyticsConsentContext =
  createContext<AnalyticsConsentContextValue | null>(null);

export function AnalyticsConsentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { analytics, analyticsConsent } = useServices();
  const [initial] = useState<Pick<ConsentState, 'consent' | 'error'>>(() => {
    try {
      return {
        consent: analyticsConsent.read()?.status ?? 'unknown',
        error: null,
      };
    } catch {
      return {
        consent: 'unknown',
        error: LOAD_ERROR,
      };
    }
  });
  const [state, setState] = useState<ConsentState>({
    active: false,
    consent: initial.consent,
    ready: false,
    error: initial.error,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function applyInitialConsent() {
      if (!analytics.available) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            active: false,
            ready: true,
          }));
        }
        return;
      }

      let active = false;
      let applyFailed = false;
      try {
        if (initial.consent === 'denied') {
          await analytics.reset();
        } else {
          await analytics.setConsent(initial.consent);
        }
        active = initial.consent === 'granted';
      } catch {
        applyFailed = true;
        if (initial.consent === 'granted') {
          try {
            await analytics.reset();
          } catch {
            // Preserve the apply error after best-effort deactivation.
          }
        }
      } finally {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            active,
            ready: true,
            error: applyFailed ? APPLY_ERROR : current.error,
          }));
        }
      }
    }

    void applyInitialConsent();
    return () => {
      cancelled = true;
    };
  }, [analytics, initial.consent]);

  const choose = useCallback(async (next: AnalyticsChoice): Promise<void> => {
    setState((current) => ({ ...current, error: null }));

    if (next === 'granted' && !analytics.available) {
      setState((current) => ({
        ...current,
        active: false,
        error: UNAVAILABLE_ERROR,
      }));
      return;
    }

    setState((current) => ({
      ...current,
      active: false,
      ready: false,
    }));

    if (next === 'denied') {
      let persisted = true;
      let resetFailed = false;

      try {
        analyticsConsent.write(next);
      } catch {
        persisted = false;
      }

      if (persisted && mountedRef.current) {
        setState((current) => ({ ...current, consent: next }));
      }

      try {
        await analytics.reset();
      } catch {
        resetFailed = true;
      }

      if (mountedRef.current) {
        if (persisted) {
          setState({
            active: false,
            consent: next,
            ready: true,
            error: resetFailed ? RESET_ERROR : null,
          });
        } else {
          setState((current) => ({
            ...current,
            ready: true,
            error: resetFailed ? SAVE_AND_RESET_ERROR : SAVE_ERROR,
          }));
        }
      }
      return;
    }

    try {
      analyticsConsent.write(next);
    } catch {
      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          ready: true,
          error: SAVE_ERROR,
        }));
      }
      return;
    }

    if (mountedRef.current) {
      setState((current) => ({ ...current, consent: next }));
    }

    try {
      await analytics.setConsent(next);

      if (mountedRef.current) {
        setState({
          active: true,
          consent: next,
          ready: true,
          error: null,
        });
      }
    } catch {
      try {
        await analytics.reset();
      } catch {
        // Preserve the apply error after best-effort deactivation.
      }
      if (mountedRef.current) {
        setState({
          active: false,
          consent: next,
          ready: true,
          error: APPLY_ERROR,
        });
      }
    }
  }, [analytics, analyticsConsent]);

  const getAnonymousId = useCallback(
    () => state.active ? analytics.getAnonymousId() : Promise.resolve(null),
    [analytics, state.active],
  );

  const value = useMemo<AnalyticsConsentContextValue>(() => ({
    available: analytics.available,
    active: state.active,
    consent: state.consent,
    ready: state.ready,
    error: state.error,
    choose,
    getAnonymousId,
  }), [
    analytics.available,
    choose,
    getAnonymousId,
    state.active,
    state.consent,
    state.error,
    state.ready,
  ]);

  return (
    <AnalyticsConsentContext.Provider value={value}>
      {children}
    </AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent(): AnalyticsConsentContextValue {
  const context = useContext(AnalyticsConsentContext);
  if (!context) {
    throw new Error(
      'useAnalyticsConsent must be used within AnalyticsConsentProvider',
    );
  }
  return context;
}
