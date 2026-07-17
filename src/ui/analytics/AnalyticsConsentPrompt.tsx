import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { useAnalyticsConsent } from './AnalyticsConsentProvider';

const SUPPRESSED_ROUTES = new Set(['/runner', '/baseline', '/privacy']);
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface BackgroundState {
  element: HTMLElement;
  ariaHidden: string | null;
  inert: boolean;
}

export function AnalyticsConsentPrompt() {
  const location = useLocation();
  const {
    available,
    consent,
    ready,
    error,
    choose,
  } = useAnalyticsConsent();
  const [saving, setSaving] = useState(false);
  const [attemptedChoice, setAttemptedChoice] = useState<
    'granted' | 'denied' | null
  >(null);
  const mountedRef = useRef(true);
  const overlayRef = useRef<HTMLDivElement>(null);
  const normalizedPathname =
    (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
  const suppressed = SUPPRESSED_ROUTES.has(normalizedPathname);
  const promptRequired = ready && consent === 'unknown';
  const promptDecisionNeedsAttention =
    attemptedChoice !== null && (saving || error !== null);
  const open =
    available
    && !suppressed
    && (promptRequired || promptDecisionNeedsAttention);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      attemptedChoice !== null
      && !saving
      && ready
      && error === null
      && consent === attemptedChoice
    ) {
      setAttemptedChoice(null);
    }
  }, [attemptedChoice, consent, error, ready, saving]);

  useLayoutEffect(() => {
    if (!open) return;

    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) return;

    const priorFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const backgroundStates = new Map<HTMLElement, BackgroundState>();

    const hideBackground = (element: HTMLElement) => {
      if (element === overlay || backgroundStates.has(element)) return;
      backgroundStates.set(element, {
        element,
        ariaHidden: element.getAttribute('aria-hidden'),
        inert: element.hasAttribute('inert'),
      });
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    };

    for (const child of parent.children) {
      if (child instanceof HTMLElement) hideBackground(child);
    }

    const observer = new MutationObserver(() => {
      for (const child of parent.children) {
        if (child instanceof HTMLElement) hideBackground(child);
      }
    });
    observer.observe(parent, { childList: true });

    const dialog = overlay.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!focusable.includes(active as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey
        && (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      for (const state of backgroundStates.values()) {
        if (state.ariaHidden === null) {
          state.element.removeAttribute('aria-hidden');
        } else {
          state.element.setAttribute('aria-hidden', state.ariaHidden);
        }
        if (!state.inert) state.element.removeAttribute('inert');
      }
      priorFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  async function decide(next: 'granted' | 'denied') {
    setAttemptedChoice(next);
    setSaving(true);
    try {
      await choose(next);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] flex items-end bg-black/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-consent-title"
        tabIndex={-1}
        className="mx-auto w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5"
      >
        <h2 id="analytics-consent-title" className="text-lg font-semibold">
          Anonymous usage analytics
        </h2>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          If you choose to share, anonymous app usage leaves this device to
          improve the app and estimate whether future ads could be supported
          on non-training screens. Exact training measurements, exact goal
          values, contractions, and reminder times are never collected.
        </p>
        <p className="mt-2 text-sm text-[color:var(--text-dim)]">
          Google Analytics 4 uses pseudonymous client and vendor session
          identifiers for measurement. The app does not send app-defined
          account, training, baseline, goal, or session identifiers.
        </p>
        <Link
          className="mt-2 inline-block text-sm text-[color:var(--cyan)]"
          to="/privacy"
        >
          Read the privacy details
        </Link>
        {error && (
          <p role="alert" className="mt-3 text-sm text-[color:var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-4 grid gap-2">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void decide('granted')}
          >
            Share anonymous usage analytics
          </Button>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void decide('denied')}
          >
            Do not share
          </Button>
        </div>
      </div>
    </div>
  );
}
