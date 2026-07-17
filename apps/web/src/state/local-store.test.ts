import { afterEach, describe, expect, it } from 'vitest';

import { DB_VERSION, createLocalDataStore, migrateLocalSnapshot } from './local-store';

const exactConsent = {
  schemaVersion: 1 as const,
  selectionId: 'supertonic-browser-wasm-v1',
  selectionDigest: `sha256:${'a'.repeat(64)}`,
  acceptedLicenseIds: ['supertone-weights-license'],
  acceptedTermsHashes: ['sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f'],
  acceptedAt: '2026-07-17T06:00:00.000Z',
};

const databases: string[] = [];

function databaseName(): string {
  const name = `open-voice-test-${databases.length}`;
  databases.push(name);
  return name;
}

function failOneOpen(factory: IDBFactory, failedCall: number): IDBFactory {
  let calls = 0;
  return {
    open(name: string, version?: number) {
      calls += 1;
      if (calls !== failedCall) {
        return version === undefined ? factory.open(name) : factory.open(name, version);
      }
      const request = {
        error: new DOMException('Fixture consent-only IndexedDB failure', 'UnknownError'),
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => request.onerror?.(new Event('error')));
      return request;
    },
  } as IDBFactory;
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

  it('persists and revokes the exact Supertonic receipt without changing the snapshot', async () => {
    const dbName = databaseName();
    const first = createLocalDataStore({ dbName });
    await first.toggleFavorite('supertonic:F1');
    const callerOwned = structuredClone(exactConsent);

    await first.setSupertonicConsent(callerOwned);
    callerOwned.selectionId = 'mutated-after-write';
    callerOwned.acceptedLicenseIds.push('mutated-after-write');

    await expect(createLocalDataStore({ dbName }).getSupertonicConsent()).resolves.toEqual(
      exactConsent,
    );
    const callerRead = await first.getSupertonicConsent();
    callerRead!.selectionId = 'mutated-after-read';
    callerRead!.acceptedTermsHashes.push(`sha256:${'f'.repeat(64)}`);
    await expect(first.getSupertonicConsent()).resolves.toEqual(exactConsent);
    await expect(readRawState(dbName, 'consent:supertonic')).resolves.toEqual(exactConsent);
    await expect(first.getSnapshot()).resolves.toMatchObject({ favorites: ['supertonic:F1'] });

    await first.setSupertonicConsent(null);

    await expect(createLocalDataStore({ dbName }).getSupertonicConsent()).resolves.toBeNull();
    await expect(readRawState(dbName, 'consent:supertonic')).resolves.toBeUndefined();
    await expect(first.getSnapshot()).resolves.toMatchObject({ favorites: ['supertonic:F1'] });
  });

  it('keeps the IndexedDB fallback receipt only in the current store session', async () => {
    const session = createLocalDataStore({ indexedDB: null });

    await session.setSupertonicConsent(exactConsent);

    await expect(session.getSupertonicConsent()).resolves.toEqual(exactConsent);
    await expect(
      createLocalDataStore({ indexedDB: null }).getSupertonicConsent(),
    ).resolves.toBeNull();
  });

  it('isolates consent I/O fallback so snapshot state remains IndexedDB-persistent', async () => {
    const dbName = databaseName();
    const store = createLocalDataStore({
      dbName,
      indexedDB: failOneOpen(indexedDB, 3),
    });
    await store.toggleFavorite('supertonic:F1');

    await store.setSupertonicConsent(exactConsent);
    await store.recordRecent('supertonic:F2');

    await expect(store.getSupertonicConsent()).resolves.toEqual(exactConsent);
    await expect(store.getSnapshot()).resolves.toMatchObject({
      storage: 'indexeddb',
      favorites: ['supertonic:F1'],
      recent: ['supertonic:F2'],
    });
    const reopened = createLocalDataStore({ dbName });
    await expect(reopened.getSnapshot()).resolves.toMatchObject({
      storage: 'indexeddb',
      favorites: ['supertonic:F1'],
      recent: ['supertonic:F2'],
    });
    await expect(reopened.getSupertonicConsent()).resolves.toBeNull();
  });

  it('isolates a consent read-open failure from later IndexedDB snapshot mutations', async () => {
    const dbName = databaseName();
    const seeded = createLocalDataStore({ dbName });
    await seeded.toggleFavorite('supertonic:F1');
    await seeded.setSupertonicConsent(exactConsent);
    const failedConsentReader = createLocalDataStore({
      dbName,
      indexedDB: failOneOpen(indexedDB, 1),
    });

    await expect(failedConsentReader.getSupertonicConsent()).resolves.toBeNull();
    await failedConsentReader.recordRecent('supertonic:F2');

    await expect(failedConsentReader.getSnapshot()).resolves.toMatchObject({
      storage: 'indexeddb',
      favorites: ['supertonic:F1'],
      recent: ['supertonic:F2'],
    });
    const reopened = createLocalDataStore({ dbName });
    await expect(reopened.getSnapshot()).resolves.toMatchObject({
      storage: 'indexeddb',
      favorites: ['supertonic:F1'],
      recent: ['supertonic:F2'],
    });
    await expect(reopened.getSupertonicConsent()).resolves.toEqual(exactConsent);
    await expect(failedConsentReader.getSupertonicConsent()).resolves.toBeNull();
  });

  it.each([
    ['future schema', { ...exactConsent, schemaVersion: 2 }],
    ['extra field', { ...exactConsent, script: 'must never persist' }],
    ['text field', { ...exactConsent, text: 'must never persist' }],
    ['audio field', { ...exactConsent, audio: new Blob(['RIFF']) }],
    ['empty selection', { ...exactConsent, selectionId: '' }],
    ['whitespace selection', { ...exactConsent, selectionId: '   ' }],
    ['invalid digest', { ...exactConsent, selectionDigest: `sha256:${'A'.repeat(64)}` }],
    ['invalid timestamp', { ...exactConsent, acceptedAt: '2026-07-17T06:00:00Z' }],
    ['empty licenses', { ...exactConsent, acceptedLicenseIds: [] }],
    ['whitespace license', { ...exactConsent, acceptedLicenseIds: ['   '] }],
    [
      'duplicate licenses',
      {
        ...exactConsent,
        acceptedLicenseIds: ['supertone-weights-license', 'supertone-weights-license'],
      },
    ],
    ['empty terms', { ...exactConsent, acceptedTermsHashes: [] }],
    [
      'uppercase terms hash',
      { ...exactConsent, acceptedTermsHashes: [`sha256:${'A'.repeat(64)}`] },
    ],
    ['short terms hash', { ...exactConsent, acceptedTermsHashes: [`sha256:${'a'.repeat(63)}`] }],
    [
      'duplicate terms',
      {
        ...exactConsent,
        acceptedTermsHashes: [
          exactConsent.acceptedTermsHashes[0],
          exactConsent.acceptedTermsHashes[0],
        ],
      },
    ],
  ])('quarantines only malformed Supertonic consent: %s', async (_label, malformed) => {
    const dbName = databaseName();
    const store = createLocalDataStore({ dbName });
    await store.toggleFavorite('supertonic:F1');
    await store.recordRecent('supertonic:F2');
    await store.recordHistory({
      id: 'consent-isolation',
      voiceId: 'supertonic:F3',
      text: 'This snapshot data must survive consent quarantine.',
      createdAt: '2026-07-17T06:02:00.000Z',
      outcome: 'complete',
    });
    await store.setModelCache('supertonic', 'cached');
    const existingSnapshotQuarantine = { reason: 'existing-snapshot-quarantine' };
    await writeRawState(dbName, 'snapshot:quarantine', existingSnapshotQuarantine);
    await writeRawState(dbName, 'consent:supertonic', malformed);

    await expect(store.getSupertonicConsent()).resolves.toBeNull();

    await expect(readRawState(dbName, 'consent:supertonic')).resolves.toBeUndefined();
    await expect(readRawState(dbName, 'consent:supertonic:quarantine')).resolves.toEqual({
      reason: 'invalid-supertonic-consent',
    });
    await expect(readRawState(dbName, 'snapshot:quarantine')).resolves.toEqual(
      existingSnapshotQuarantine,
    );
    await expect(store.getSnapshot()).resolves.toMatchObject({
      favorites: ['supertonic:F1'],
      recent: ['supertonic:F2'],
      history: [{ id: 'consent-isolation', text: expect.any(String) }],
      modelCache: { supertonic: 'cached' },
    });
  });

  it('serializes concurrent consent writes so the last requested state wins', async () => {
    const dbName = databaseName();
    const store = createLocalDataStore({ dbName });
    const replacement = {
      ...exactConsent,
      selectionId: 'supertonic-browser-webgpu-v1',
      selectionDigest: `sha256:${'b'.repeat(64)}`,
      acceptedAt: '2026-07-17T06:01:00.000Z',
    };

    const accepted = store.setSupertonicConsent(exactConsent);
    const revoked = store.setSupertonicConsent(null);
    const replaced = store.setSupertonicConsent(replacement);
    await Promise.all([replaced, revoked, accepted]);

    await expect(store.getSupertonicConsent()).resolves.toEqual(replacement);
    await expect(createLocalDataStore({ dbName }).getSupertonicConsent()).resolves.toEqual(
      replacement,
    );
  });
});
