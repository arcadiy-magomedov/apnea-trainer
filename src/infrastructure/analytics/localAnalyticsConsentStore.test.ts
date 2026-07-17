import { describe, expect, it } from 'vitest';
import { exportJson } from '../persistence/jsonBackup';
import { emptyAppState } from '../../domain/models/appState';
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  createLocalAnalyticsConsentStore,
} from './localAnalyticsConsentStore';

type StorageOverrides = Partial<Pick<
  Storage,
  'getItem' | 'removeItem' | 'setItem'
>>;

function createStorage(
  initial: Record<string, string> = {},
  overrides: StorageOverrides = {},
): Storage {
  const map = new Map(Object.entries(initial));

  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem: overrides.getItem ?? ((key: string) => {
      return map.has(key) ? map.get(key)! : null;
    }),
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem: overrides.removeItem ?? ((key: string) => {
      map.delete(key);
    }),
    setItem: overrides.setItem ?? ((key: string, value: string) => {
      map.set(key, value);
    }),
  };
}

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error('Expected action to throw.');
}

describe('local analytics consent store', () => {
  it('reads null when consent is missing', () => {
    const store = createLocalAnalyticsConsentStore(createStorage(), () => 123);

    expect(store.read()).toBeNull();
  });

  it('writes consent as json and returns the stored decision', () => {
    const storage = createStorage();
    const store = createLocalAnalyticsConsentStore(storage, () => 123);

    expect(store.write('granted')).toEqual({ status: 'granted', decidedAt: 123 });
    expect(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe(
      JSON.stringify({ status: 'granted', decidedAt: 123 }),
    );
  });

  it('reads stored consent decisions', () => {
    const storage = createStorage({
      [ANALYTICS_CONSENT_STORAGE_KEY]: JSON.stringify({
        status: 'denied',
        decidedAt: 456,
      }),
    });
    const store = createLocalAnalyticsConsentStore(storage, () => 0);

    expect(store.read()).toEqual({ status: 'denied', decidedAt: 456 });
  });

  it.each([
    JSON.stringify({ status: 'maybe', decidedAt: 456 }),
    '{ "status": "granted", "decidedAt": 1e400 }',
    JSON.stringify({ status: 'granted' }),
    'null',
  ])('removes invalid stored decisions %#', (raw) => {
    const storage = createStorage({
      [ANALYTICS_CONSENT_STORAGE_KEY]: raw,
    });
    const store = createLocalAnalyticsConsentStore(storage, () => 0);

    expect(store.read()).toBeNull();
    expect(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('removes malformed json and returns null', () => {
    const storage = createStorage({
      [ANALYTICS_CONSENT_STORAGE_KEY]: '{',
    });
    const store = createLocalAnalyticsConsentStore(storage, () => 0);

    expect(store.read()).toBeNull();
    expect(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('propagates the original getItem error while reading', () => {
    const storageError = new Error('getItem failed');
    const storage = createStorage({}, {
      getItem() {
        throw storageError;
      },
    });
    const store = createLocalAnalyticsConsentStore(storage, () => 0);

    expect(thrownBy(() => store.read())).toBe(storageError);
  });

  it('propagates the original setItem error while writing', () => {
    const storageError = new Error('setItem failed');
    const storage = createStorage({}, {
      setItem() {
        throw storageError;
      },
    });
    const store = createLocalAnalyticsConsentStore(storage, () => 123);

    expect(thrownBy(() => store.write('granted'))).toBe(storageError);
  });

  it.each([
    ['malformed', '{'],
    ['invalid', JSON.stringify({ status: 'maybe', decidedAt: 456 })],
  ])('propagates the original removeItem error while cleaning %s data', (_, raw) => {
    const storageError = new Error('removeItem failed');
    const storage = createStorage({
      [ANALYTICS_CONSENT_STORAGE_KEY]: raw,
    }, {
      removeItem() {
        throw storageError;
      },
    });
    const store = createLocalAnalyticsConsentStore(storage, () => 0);

    expect(thrownBy(() => store.read())).toBe(storageError);
  });

  it('leaves analytics consent out of the app state backup json', () => {
    expect(exportJson(emptyAppState())).not.toContain(ANALYTICS_CONSENT_STORAGE_KEY);
  });
});
