export const DB_VERSION = 1;

const DEFAULT_DATABASE_NAME = 'open-voice-playground';
const STATE_STORE = 'state';
const SNAPSHOT_KEY = 'snapshot';
const QUARANTINE_KEY = 'snapshot:quarantine';
const SUPERTONIC_CONSENT_KEY = 'consent:supertonic';
const SUPERTONIC_CONSENT_QUARANTINE_KEY = 'consent:supertonic:quarantine';
const RECENT_LIMIT = 12;
const HISTORY_LIMIT = 50;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type ModelCacheStatus = 'not-cached' | 'checking' | 'cached';
export type HistoryOutcome = 'complete' | 'cancelled' | 'unavailable' | 'error';

export type HistoryEntry = {
  id: string;
  voiceId: string;
  text: string;
  createdAt: string;
  outcome: HistoryOutcome;
};

export type LocalSnapshot = {
  schemaVersion: typeof DB_VERSION;
  storage: 'indexeddb' | 'memory';
  favorites: string[];
  recent: string[];
  history: HistoryEntry[];
  modelCache: Record<string, ModelCacheStatus>;
};

export type PersistedSupertonicConsent = {
  schemaVersion: 1;
  selectionId: string;
  selectionDigest: string;
  acceptedLicenseIds: string[];
  acceptedTermsHashes: string[];
  acceptedAt: string;
};

export type LocalDataStore = {
  getSnapshot(): Promise<LocalSnapshot>;
  getSupertonicConsent(): Promise<PersistedSupertonicConsent | null>;
  setSupertonicConsent(value: PersistedSupertonicConsent | null): Promise<void>;
  toggleFavorite(voiceId: string): Promise<void>;
  recordRecent(voiceId: string): Promise<void>;
  recordHistory(entry: HistoryEntry): Promise<void>;
  setModelCache(engineId: string, status: ModelCacheStatus): Promise<void>;
};

type StoreOptions = {
  indexedDB?: IDBFactory | null;
  dbName?: string;
};

function emptySnapshot(storage: LocalSnapshot['storage']): LocalSnapshot {
  return {
    schemaVersion: DB_VERSION,
    storage,
    favorites: [],
    recent: [],
    history: [],
    modelCache: {},
  };
}

function cloneSnapshot(snapshot: LocalSnapshot): LocalSnapshot {
  return structuredClone(snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.voiceId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.outcome === 'complete' ||
      value.outcome === 'cancelled' ||
      value.outcome === 'unavailable' ||
      value.outcome === 'error')
  );
}

function isHistory(value: unknown): value is HistoryEntry[] {
  return Array.isArray(value) && value.every(isHistoryEntry);
}

function isModelCache(value: unknown): value is Record<string, ModelCacheStatus> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (status) => status === 'not-cached' || status === 'checking' || status === 'cached',
    )
  );
}

function isNonEmptyUniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

function isStrictIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isPersistedSupertonicConsent(value: unknown): value is PersistedSupertonicConsent {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    'acceptedAt',
    'acceptedLicenseIds',
    'acceptedTermsHashes',
    'schemaVersion',
    'selectionDigest',
    'selectionId',
  ];
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    value.schemaVersion === 1 &&
    typeof value.selectionId === 'string' &&
    value.selectionId.trim().length > 0 &&
    typeof value.selectionDigest === 'string' &&
    SHA256_PATTERN.test(value.selectionDigest) &&
    isNonEmptyUniqueStrings(value.acceptedLicenseIds) &&
    isNonEmptyUniqueStrings(value.acceptedTermsHashes) &&
    value.acceptedTermsHashes.every((hash) => SHA256_PATTERN.test(hash)) &&
    isStrictIsoTimestamp(value.acceptedAt)
  );
}

function cloneSupertonicConsent(
  value: PersistedSupertonicConsent | null,
): PersistedSupertonicConsent | null {
  return value === null ? null : structuredClone(value);
}

export function migrateLocalSnapshot(
  value: unknown,
  storage: LocalSnapshot['storage'],
): LocalSnapshot | null {
  try {
    if (!isRecord(value)) {
      return null;
    }

    if (value.schemaVersion === 0) {
      if (!isStringArray(value.favorites) || !isStringArray(value.recent)) {
        return null;
      }
      const history = value.history === undefined ? [] : value.history;
      const modelCache = value.modelCache === undefined ? {} : value.modelCache;
      if (!isHistory(history) || !isModelCache(modelCache)) {
        return null;
      }
      return {
        schemaVersion: DB_VERSION,
        storage,
        favorites: [...value.favorites],
        recent: [...value.recent].slice(0, RECENT_LIMIT),
        history: [...history].slice(0, HISTORY_LIMIT),
        modelCache: { ...modelCache },
      };
    }

    if (
      value.schemaVersion !== DB_VERSION ||
      (value.storage !== 'indexeddb' && value.storage !== 'memory') ||
      !isStringArray(value.favorites) ||
      !isStringArray(value.recent) ||
      !isHistory(value.history) ||
      !isModelCache(value.modelCache)
    ) {
      return null;
    }

    return {
      schemaVersion: DB_VERSION,
      storage,
      favorites: [...value.favorites],
      recent: [...value.recent].slice(0, RECENT_LIMIT),
      history: [...value.history].slice(0, HISTORY_LIMIT),
      modelCache: { ...value.modelCache },
    };
  } catch {
    return null;
  }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE)) {
        request.result.createObjectStore(STATE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked'));
  });
}

async function readIndexedDb(factory: IDBFactory, name: string): Promise<LocalSnapshot> {
  const database = await openDatabase(factory, name);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, 'readwrite');
      const objectStore = transaction.objectStore(STATE_STORE);
      const request = objectStore.get(SNAPSHOT_KEY);
      let snapshot = emptySnapshot('indexeddb');
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (value === undefined) {
          return;
        }
        const migrated = migrateLocalSnapshot(value, 'indexeddb');
        if (migrated === null) {
          objectStore.put({ reason: 'invalid-local-snapshot', value }, QUARANTINE_KEY);
          objectStore.put(snapshot, SNAPSHOT_KEY);
          return;
        }
        snapshot = migrated;
        if (isRecord(value) && value.schemaVersion === 0) {
          objectStore.put(snapshot, SNAPSHOT_KEY);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Local state could not be read'));
      transaction.oncomplete = () => resolve(snapshot);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Local state could not be read'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local state read was aborted'));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedDb(
  factory: IDBFactory,
  name: string,
  snapshot: LocalSnapshot,
): Promise<void> {
  const database = await openDatabase(factory, name);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, 'readwrite');
      transaction.objectStore(STATE_STORE).put(snapshot, SNAPSHOT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Local state could not be saved'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local state save was aborted'));
    });
  } finally {
    database.close();
  }
}

async function readSupertonicConsentIndexedDb(
  factory: IDBFactory,
  name: string,
): Promise<PersistedSupertonicConsent | null> {
  const database = await openDatabase(factory, name);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, 'readwrite');
      const objectStore = transaction.objectStore(STATE_STORE);
      const request = objectStore.get(SUPERTONIC_CONSENT_KEY);
      let consent: PersistedSupertonicConsent | null = null;
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (value === undefined) return;
        if (!isPersistedSupertonicConsent(value)) {
          objectStore.put(
            { reason: 'invalid-supertonic-consent' },
            SUPERTONIC_CONSENT_QUARANTINE_KEY,
          );
          objectStore.delete(SUPERTONIC_CONSENT_KEY);
          return;
        }
        consent = cloneSupertonicConsent(value);
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Supertonic consent could not be read'));
      transaction.oncomplete = () => resolve(consent);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Supertonic consent could not be read'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Supertonic consent read was aborted'));
    });
  } finally {
    database.close();
  }
}

async function writeSupertonicConsentIndexedDb(
  factory: IDBFactory,
  name: string,
  value: PersistedSupertonicConsent | null,
): Promise<void> {
  const database = await openDatabase(factory, name);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, 'readwrite');
      const objectStore = transaction.objectStore(STATE_STORE);
      if (value === null) objectStore.delete(SUPERTONIC_CONSENT_KEY);
      else objectStore.put(value, SUPERTONIC_CONSENT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Supertonic consent could not be saved'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Supertonic consent save was aborted'));
    });
  } finally {
    database.close();
  }
}

export function createLocalDataStore(options: StoreOptions = {}): LocalDataStore {
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const databaseName = options.dbName ?? DEFAULT_DATABASE_NAME;
  let memorySnapshot = emptySnapshot('memory');
  let memorySupertonicConsent: PersistedSupertonicConsent | null = null;
  let useMemorySnapshot = factory === null || factory === undefined;
  let useMemorySupertonicConsent = factory === null || factory === undefined;
  let mutationQueue = Promise.resolve();

  async function read(): Promise<LocalSnapshot> {
    if (useMemorySnapshot || factory === null || factory === undefined) {
      return cloneSnapshot(memorySnapshot);
    }
    try {
      const snapshot = await readIndexedDb(factory, databaseName);
      memorySnapshot = { ...snapshot, storage: 'indexeddb' };
      return cloneSnapshot(memorySnapshot);
    } catch {
      useMemorySnapshot = true;
      memorySnapshot.storage = 'memory';
      return cloneSnapshot(memorySnapshot);
    }
  }

  async function persist(snapshot: LocalSnapshot): Promise<void> {
    memorySnapshot = cloneSnapshot(snapshot);
    if (useMemorySnapshot || factory === null || factory === undefined) {
      memorySnapshot.storage = 'memory';
      return;
    }
    try {
      const persisted = { ...snapshot, storage: 'indexeddb' as const };
      await writeIndexedDb(factory, databaseName, persisted);
      memorySnapshot = persisted;
    } catch {
      useMemorySnapshot = true;
      memorySnapshot.storage = 'memory';
    }
  }

  async function readSupertonicConsent(): Promise<PersistedSupertonicConsent | null> {
    if (useMemorySupertonicConsent || factory === null || factory === undefined) {
      return cloneSupertonicConsent(memorySupertonicConsent);
    }
    try {
      memorySupertonicConsent = await readSupertonicConsentIndexedDb(factory, databaseName);
      return cloneSupertonicConsent(memorySupertonicConsent);
    } catch {
      useMemorySupertonicConsent = true;
      return cloneSupertonicConsent(memorySupertonicConsent);
    }
  }

  async function persistSupertonicConsent(value: PersistedSupertonicConsent | null): Promise<void> {
    memorySupertonicConsent = cloneSupertonicConsent(value);
    if (useMemorySupertonicConsent || factory === null || factory === undefined) return;
    try {
      await writeSupertonicConsentIndexedDb(factory, databaseName, value);
    } catch {
      useMemorySupertonicConsent = true;
    }
  }

  function mutate(update: (snapshot: LocalSnapshot) => void): Promise<void> {
    mutationQueue = mutationQueue.then(async () => {
      const snapshot = await read();
      update(snapshot);
      await persist(snapshot);
    });
    return mutationQueue;
  }

  return {
    async getSnapshot() {
      await mutationQueue;
      return read();
    },
    async getSupertonicConsent() {
      await mutationQueue;
      return readSupertonicConsent();
    },
    setSupertonicConsent(value) {
      if (value !== null && !isPersistedSupertonicConsent(value)) {
        return Promise.reject(new TypeError('Supertonic consent is invalid.'));
      }
      const requested = cloneSupertonicConsent(value);
      mutationQueue = mutationQueue.then(() => persistSupertonicConsent(requested));
      return mutationQueue;
    },
    toggleFavorite(voiceId) {
      return mutate((snapshot) => {
        snapshot.favorites = snapshot.favorites.includes(voiceId)
          ? snapshot.favorites.filter((id) => id !== voiceId)
          : [voiceId, ...snapshot.favorites];
      });
    },
    recordRecent(voiceId) {
      return mutate((snapshot) => {
        snapshot.recent = [voiceId, ...snapshot.recent.filter((id) => id !== voiceId)].slice(
          0,
          RECENT_LIMIT,
        );
      });
    },
    recordHistory(entry) {
      return mutate((snapshot) => {
        snapshot.history = [
          entry,
          ...snapshot.history.filter((item) => item.id !== entry.id),
        ].slice(0, HISTORY_LIMIT);
      });
    },
    setModelCache(engineId, status) {
      return mutate((snapshot) => {
        snapshot.modelCache = { ...snapshot.modelCache, [engineId]: status };
      });
    },
  };
}
