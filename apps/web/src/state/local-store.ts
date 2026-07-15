export const DB_VERSION = 1;

const DEFAULT_DATABASE_NAME = 'open-voice-playground';
const STATE_STORE = 'state';
const SNAPSHOT_KEY = 'snapshot';
const RECENT_LIMIT = 12;
const HISTORY_LIMIT = 50;

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

export type LocalDataStore = {
  getSnapshot(): Promise<LocalSnapshot>;
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
      const request = database.transaction(STATE_STORE).objectStore(STATE_STORE).get(SNAPSHOT_KEY);
      request.onsuccess = () => {
        const value = request.result as LocalSnapshot | undefined;
        resolve(value?.schemaVersion === DB_VERSION ? value : emptySnapshot('indexeddb'));
      };
      request.onerror = () => reject(request.error ?? new Error('Local state could not be read'));
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

export function createLocalDataStore(options: StoreOptions = {}): LocalDataStore {
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const databaseName = options.dbName ?? DEFAULT_DATABASE_NAME;
  let memorySnapshot = emptySnapshot('memory');
  let useMemory = factory === null || factory === undefined;
  let mutationQueue = Promise.resolve();

  async function read(): Promise<LocalSnapshot> {
    if (useMemory || factory === null || factory === undefined) {
      return cloneSnapshot(memorySnapshot);
    }
    try {
      const snapshot = await readIndexedDb(factory, databaseName);
      memorySnapshot = { ...snapshot, storage: 'indexeddb' };
      return cloneSnapshot(memorySnapshot);
    } catch {
      useMemory = true;
      memorySnapshot.storage = 'memory';
      return cloneSnapshot(memorySnapshot);
    }
  }

  async function persist(snapshot: LocalSnapshot): Promise<void> {
    memorySnapshot = cloneSnapshot(snapshot);
    if (useMemory || factory === null || factory === undefined) {
      memorySnapshot.storage = 'memory';
      return;
    }
    try {
      const persisted = { ...snapshot, storage: 'indexeddb' as const };
      await writeIndexedDb(factory, databaseName, persisted);
      memorySnapshot = persisted;
    } catch {
      useMemory = true;
      memorySnapshot.storage = 'memory';
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
