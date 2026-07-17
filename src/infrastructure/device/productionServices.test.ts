import { afterEach, expect, it, vi } from 'vitest';
import { productionServices } from './productionServices';
import { noopAnalytics } from '../analytics/noopAnalytics';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('builds a full services bundle', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const s = productionServices();
  expect(typeof s.clock.now).toBe('function');
  expect(typeof s.wakeLock.acquire).toBe('function');
  expect(typeof s.cues.speak).toBe('function');
  expect(typeof s.notifications.isSupported).toBe('function');
  expect(typeof s.repository.getState).toBe('function');
  expect(typeof s.analytics.track).toBe('function');
  expect(typeof s.analyticsConsent.read).toBe('function');
});

it('uses no-op analytics for an invalid GA4 measurement id', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'not-a-ga4-id');
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'privacy@apneatrainer.test');

  expect(productionServices().analytics).toBe(noopAnalytics);
});

it('uses no-op analytics when the privacy contact is missing', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', '');

  expect(productionServices().analytics).toBe(noopAnalytics);
});

it.each([
  'privacy @apneatrainer.test',
  'privacy@apneatrainer.test?subject=delete',
  'privacy@apneatrainer.test#fragment',
  'privacy@apneatrainer.test/path',
  'privacy@@apneatrainer.test',
  'privacy@apneatrainer..test',
  'privacy@-apneatrainer.test',
  'privacy@apneatrainer-.test',
])('uses no-op analytics for malformed privacy contact %s', (privacyContact) => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', privacyContact);

  expect(productionServices().analytics).toBe(noopAnalytics);
});

it('builds analytics when both public values are valid', () => {
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv(
    'VITE_PRIVACY_CONTACT_EMAIL',
    '  privacy.team+requests@sub-domain.apneatrainer.test  ',
  );

  expect(productionServices().analytics).not.toBe(noopAnalytics);
});

it('fails closed when local storage is inaccessible without claiming consent was saved', () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', '');
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', '');
  const storageError = new DOMException('Storage is blocked.', 'SecurityError');
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw storageError;
  });

  const services = productionServices();

  expect(services.analytics).toBe(noopAnalytics);
  expect(services.analyticsConsent.read()).toBeNull();
  expect(() => services.analyticsConsent.write('granted')).toThrow(storageError);
});

it('logs a one-time diagnostic without echoing invalid values', async () => {
  await vi.resetModules();
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-INVALID-123!');
  vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'invalid-address');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const { productionServices: freshProductionServices } = await import('./productionServices');

  freshProductionServices();
  freshProductionServices();

  expect(info).toHaveBeenCalledTimes(1);
  expect(info.mock.calls[0]?.[0]).toContain('no-op analytics');
  expect(JSON.stringify(info.mock.calls)).not.toContain('G-INVALID-123!');
  expect(JSON.stringify(info.mock.calls)).not.toContain('invalid-address');
});