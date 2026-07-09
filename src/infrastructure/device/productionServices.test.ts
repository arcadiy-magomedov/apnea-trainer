import { it, expect } from 'vitest';
import { productionServices } from './productionServices';

it('builds a full services bundle', () => {
  const s = productionServices();
  expect(typeof s.clock.now).toBe('function');
  expect(typeof s.wakeLock.acquire).toBe('function');
  expect(typeof s.cues.speak).toBe('function');
  expect(typeof s.notifications.isSupported).toBe('function');
  expect(typeof s.ics.build).toBe('function');
  expect(typeof s.repository.getState).toBe('function');
});