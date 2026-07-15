import { afterEach, describe, expect, it } from 'vitest';

import { DB_VERSION, createLocalDataStore } from './local-store';

const databases: string[] = [];

function databaseName(): string {
  const name = `open-voice-test-${databases.length}`;
  databases.push(name);
  return name;
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
