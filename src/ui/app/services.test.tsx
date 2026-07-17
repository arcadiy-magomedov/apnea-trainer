import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ServicesProvider,
  useServices,
  type Services,
} from './services';

function Probe() {
  const { analytics, clock } = useServices();
  return (
    <span>
      now:{clock.now() > 0 ? 'ok' : 'bad'} analytics:
      {typeof analytics.track === 'function' ? 'ok' : 'bad'}
    </span>
  );
}

function ServicesProbe({ capture }: { capture: (services: Services) => void }) {
  capture(useServices());
  return null;
}

describe('ServicesProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides a working clock by default', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    render(<ServicesProvider><Probe /></ServicesProvider>);
    expect(screen.getByText(/now:ok analytics:ok/i)).toBeInTheDocument();
  });

  it('keeps default services and the context value stable across rerenders', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const observed: Services[] = [];
    const capture = (services: Services) => observed.push(services);
    const { rerender } = render(
      <ServicesProvider>
        <ServicesProbe capture={capture} />
      </ServicesProvider>,
    );

    const first = observed.at(-1)!;
    rerender(
      <ServicesProvider>
        <ServicesProbe capture={capture} />
      </ServicesProvider>,
    );

    expect(observed.at(-1)).toBe(first);
  });

  it('updates changed overrides without rebuilding unchanged defaults', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const firstClock = { now: () => 1 };
    const secondClock = { now: () => 2 };
    const observed: Services[] = [];
    const capture = (services: Services) => observed.push(services);
    const { rerender } = render(
      <ServicesProvider value={{ clock: firstClock }}>
        <ServicesProbe capture={capture} />
      </ServicesProvider>,
    );

    const first = observed.at(-1)!;
    rerender(
      <ServicesProvider value={{ clock: firstClock }}>
        <ServicesProbe capture={capture} />
      </ServicesProvider>,
    );
    expect(observed.at(-1)).toBe(first);

    rerender(
      <ServicesProvider value={{ clock: secondClock }}>
        <ServicesProbe capture={capture} />
      </ServicesProvider>,
    );
    const changed = observed.at(-1)!;

    expect(changed).not.toBe(first);
    expect(changed.clock).toBe(secondClock);
    expect(changed.repository).toBe(first.repository);
    expect(changed.analyticsConsent).toBe(first.analyticsConsent);
  });

  it('uses a consent-store override when local storage is inaccessible', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is blocked.', 'SecurityError');
    });
    const analyticsConsent = {
      read: () => null,
      write: (status: 'granted' | 'denied') => ({
        status,
        decidedAt: 123,
      }),
    } satisfies Services['analyticsConsent'];
    let observed: Services | undefined;

    render(
      <ServicesProvider value={{ analyticsConsent }}>
        <ServicesProbe capture={(services) => {
          observed = services;
        }} />
      </ServicesProvider>,
    );

    expect(observed?.analyticsConsent).toBe(analyticsConsent);
  });
});
