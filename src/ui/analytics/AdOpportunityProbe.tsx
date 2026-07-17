import { useEffect, useRef } from 'react';
import type {
  AnalyticsPlacement,
  AnalyticsSurface,
} from '../../application/analytics/events';
import { useServices } from '../app/services';

export function AdOpportunityProbe({
  placement,
  surface,
}: {
  placement: AnalyticsPlacement;
  surface: AnalyticsSurface;
}) {
  const { analytics } = useServices();
  const target = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    const element = target.current;
    if (
      !element
      || sent.current
      || typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    let active = true;
    const clearPending = () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
    };
    const observer = new IntersectionObserver((entries) => {
      if (!active || sent.current) return;

      const entry = entries.find((candidate) => candidate.target === element);
      if (!entry) return;

      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) {
        clearPending();
        return;
      }

      if (timer.current !== null) return;

      let timerId: number;
      timerId = window.setTimeout(() => {
        if (!active || sent.current || timer.current !== timerId) return;

        timer.current = null;
        sent.current = true;
        analytics.track({
          name: 'ad_opportunity_viewable',
          placement,
          surface,
        });
        observer.disconnect();
      }, 1_000);
      timer.current = timerId;
    }, { threshold: [0.5] });

    observer.observe(element);

    return () => {
      active = false;
      clearPending();
      observer.disconnect();
    };
  }, [analytics, placement, surface]);

  return (
    <div className="relative h-0 w-full" aria-hidden="true">
      <span
        ref={target}
        aria-hidden="true"
        data-ad-opportunity={placement}
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
      />
    </div>
  );
}
