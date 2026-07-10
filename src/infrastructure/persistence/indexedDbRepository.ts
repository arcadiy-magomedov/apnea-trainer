import { openDB, type IDBPDatabase } from 'idb';
import type { StateRepository } from '../../domain/ports/stateRepository';
import type { AppState } from '../../domain/models/types';
import { emptyAppState } from '../../domain/models/appState';
import { migrateAppState } from '../../domain/models/migrateAppState';

const DB_NAME = 'apnea-trainer';
const STORE = 'app';
const KEY = 'state';

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    },
  });
}

export function createIndexedDbRepository(): StateRepository {
  return {
    async getState(): Promise<AppState> {
      const database = await db();
      try {
        const stored = await database.get(STORE, KEY);
        if (stored === undefined) {
          return emptyAppState();
        }
        return migrateAppState(stored);
      } finally {
        database.close();
      }
    },
    async setState(state: AppState): Promise<void> {
      const database = await db();
      try {
        await database.put(STORE, state, KEY);
      } finally {
        database.close();
      }
    },
  };
}
