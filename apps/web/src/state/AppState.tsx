import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { createDefaultServices, type AppServices } from '../app-services';
import {
  DB_VERSION,
  type HistoryEntry,
  type LocalSnapshot,
  type ModelCacheStatus,
} from './local-store';

type LocalStateContextValue = {
  snapshot: LocalSnapshot;
  loaded: boolean;
  toggleFavorite(voiceId: string): Promise<void>;
  recordRecent(voiceId: string): Promise<void>;
  recordHistory(entry: HistoryEntry): Promise<void>;
  setModelCache(engineId: string, status: ModelCacheStatus): Promise<void>;
};

const ServicesContext = createContext<AppServices | null>(null);
const LocalStateContext = createContext<LocalStateContextValue | null>(null);

const INITIAL_SNAPSHOT: LocalSnapshot = {
  schemaVersion: DB_VERSION,
  storage: 'memory',
  favorites: [],
  recent: [],
  history: [],
  modelCache: {},
};

export function AppStateProvider({
  children,
  services: suppliedServices,
}: {
  children: ReactNode;
  services?: AppServices | undefined;
}) {
  const [services] = useState(() => suppliedServices ?? createDefaultServices());
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(INITIAL_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const next = await services.store.getSnapshot();
    setSnapshot(next);
    setLoaded(true);
  }, [services]);

  useEffect(() => {
    let active = true;
    void services.store.getSnapshot().then((next) => {
      if (active) {
        setSnapshot(next);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [services]);

  const localState = useMemo<LocalStateContextValue>(
    () => ({
      snapshot,
      loaded,
      async toggleFavorite(voiceId) {
        await services.store.toggleFavorite(voiceId);
        await refresh();
      },
      async recordRecent(voiceId) {
        await services.store.recordRecent(voiceId);
        await refresh();
      },
      async recordHistory(entry) {
        await services.store.recordHistory(entry);
        await refresh();
      },
      async setModelCache(engineId, status) {
        await services.store.setModelCache(engineId, status);
        await refresh();
      },
    }),
    [loaded, refresh, services, snapshot],
  );

  return (
    <ServicesContext.Provider value={services}>
      <LocalStateContext.Provider value={localState}>{children}</LocalStateContext.Provider>
    </ServicesContext.Provider>
  );
}

export function useAppServices(): AppServices {
  const value = useContext(ServicesContext);
  if (value === null) {
    throw new Error('useAppServices must be used inside AppStateProvider');
  }
  return value;
}

export function useLocalState(): LocalStateContextValue {
  const value = useContext(LocalStateContext);
  if (value === null) {
    throw new Error('useLocalState must be used inside AppStateProvider');
  }
  return value;
}
