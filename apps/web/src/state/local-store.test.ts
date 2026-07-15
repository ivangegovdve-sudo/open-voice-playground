import { afterEach, describe, expect, it } from 'vitest';

import { DB_VERSION, createLocalDataStore, migrateLocalSnapshot } from './local-store';

const databases: string[] = [];

function databaseName(): string {
  const name = `open-voice-test-${databases.length}`;
  databases.push(name);
  return name;
}

function openTestDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) {
        request.result.createObjectStore('state');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawState(name: string, key: string, value: unknown): Promise<void> {
  const database = await openTestDatabase(name);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readRawState(name: string, key: string): Promise<unknown> {
  const database = await openTestDatabase(name);
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('state').objectStore('state').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
        }),
    ),
  );
});

describe('local data store', () => {
  it('validates v1 snapshots and deterministically migrates known v0 data', () => {
    const v0 = {
      schemaVersion: 0,
      favorites: ['fixture-browser:voice-a'],
      recent: ['fixture-online:voice-a'],
    };
    expect(migrateLocalSnapshot(v0, 'indexeddb')).toEqual({
      schemaVersion: DB_VERSION,
      storage: 'indexeddb',
      favorites: ['fixture-browser:voice-a'],
      recent: ['fixture-online:voice-a'],
      history: [],
      modelCache: {},
    });

    const v1 = {
      schemaVersion: DB_VERSION,
      storage: 'memory',
      favorites: ['fixture-browser:voice-b'],
      recent: [],
      history: [
        {
          id: 'known-history',
          voiceId: 'fixture-browser:voice-b',
          text: 'Known v1 data.',
          createdAt: '2026-07-16T09:00:00.000Z',
          outcome: 'complete',
        },
      ],
      modelCache: { 'fixture-browser': 'cached' },
    };
    expect(migrateLocalSnapshot(v1, 'indexeddb')).toEqual({ ...v1, storage: 'indexeddb' });
  });

  it('quarantines a malformed snapshot and replaces it with clean validated state', async () => {
    const dbName = databaseName();
    const malformed = {
      schemaVersion: DB_VERSION,
      storage: 'indexeddb',
      favorites: ['fixture-browser:voice-a', 42],
      recent: [],
      history: [],
      modelCache: {},
    };
    await writeRawState(dbName, 'snapshot', malformed);

    const snapshot = await createLocalDataStore({ dbName }).getSnapshot();

    expect(snapshot).toEqual({
      schemaVersion: DB_VERSION,
      storage: 'indexeddb',
      favorites: [],
      recent: [],
      history: [],
      modelCache: {},
    });
    await expect(readRawState(dbName, 'snapshot:quarantine')).resolves.toEqual({
      reason: 'invalid-local-snapshot',
      value: malformed,
    });
    await expect(readRawState(dbName, 'snapshot')).resolves.toEqual(snapshot);
  });

  it('persists versioned favorites and deduplicated recent presets', async () => {
    const dbName = databaseName();
    const first = createLocalDataStore({ dbName });

    await first.toggleFavorite('fixture-browser:voice-a');
    await first.recordRecent('fixture-browser:voice-a');
    await first.recordRecent('fixture-browser:voice-b');
    await first.recordRecent('fixture-browser:voice-a');

    const reopened = createLocalDataStore({ dbName });
    await expect(reopened.getSnapshot()).resolves.toMatchObject({
      schemaVersion: DB_VERSION,
      favorites: ['fixture-browser:voice-a'],
      recent: ['fixture-browser:voice-a', 'fixture-browser:voice-b'],
    });
  });

  it('stores generation history and model cache status locally', async () => {
    const store = createLocalDataStore({ dbName: databaseName() });

    await store.recordHistory({
      id: 'history-1',
      voiceId: 'fixture-browser:voice-a',
      text: 'A local test.',
      createdAt: '2026-07-15T10:00:00.000Z',
      outcome: 'unavailable',
    });
    await store.setModelCache('fixture-browser', 'cached');

    const snapshot = await store.getSnapshot();
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.modelCache['fixture-browser']).toBe('cached');
  });

  it('falls back safely when IndexedDB is unavailable', async () => {
    const store = createLocalDataStore({ indexedDB: null });

    await expect(store.toggleFavorite('fixture-online:voice-a')).resolves.toBeUndefined();
    await expect(store.getSnapshot()).resolves.toMatchObject({
      storage: 'memory',
      favorites: ['fixture-online:voice-a'],
    });
  });
});
