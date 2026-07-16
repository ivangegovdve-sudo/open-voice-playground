import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { createLaunchServices, type AppServices } from './app-services';
import { AppShell } from './components/AppShell';
import { CompanionPage } from './pages/CompanionPage';
import { ComparePage } from './pages/ComparePage';
import { EnginePage } from './pages/EnginePage';
import { HomePage } from './pages/HomePage';
import { GalleryPage } from './pages/GalleryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlayPage } from './pages/PlayPage';
import { SourcesPage } from './pages/SourcesPage';
import { VoicesPage } from './pages/VoicesPage';
import { AppStateProvider } from './state/AppState';

export function AppView({ services }: { services?: AppServices }) {
  return (
    <AppStateProvider services={services}>
      <AppShell>
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<GalleryPage />} path="/galleries" />
          <Route element={<VoicesPage />} path="/voices" />
          <Route element={<PlayPage />} path="/play" />
          <Route element={<ComparePage />} path="/compare" />
          <Route element={<EnginePage />} path="/engines/:slug" />
          <Route element={<CompanionPage />} path="/companion" />
          <Route element={<SourcesPage />} path="/about/sources" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </AppShell>
    </AppStateProvider>
  );
}

let productionServicesPromise: Promise<AppServices> | null = null;

function loadProductionServices(): Promise<AppServices> {
  productionServicesPromise ??= createLaunchServices().catch((error: unknown) => {
    productionServicesPromise = null;
    throw error;
  });
  return productionServicesPromise;
}

export function App({
  loadServices = loadProductionServices,
}: {
  loadServices?: () => Promise<AppServices>;
}) {
  const pending = useRef<Promise<AppServices> | null>(null);
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    pending.current ??= loadServices();
    void pending.current.then(
      (loaded) => {
        if (active) setServices(loaded);
      },
      (reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'The launch catalog could not load.');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, loadServices]);

  return (
    <BrowserRouter>
      {services !== null ? (
        <AppView services={services} />
      ) : error === null ? (
        <main className="catalog-boot" role="status">
          <div aria-hidden="true" className="catalog-boot__pulse" />
          <h1>Loading the reviewed voice catalog…</h1>
          <p>The interface shell is ready; the external provenance index is arriving separately.</p>
        </main>
      ) : (
        <main className="catalog-boot" role="alert">
          <h1>Catalog unavailable</h1>
          <p>{error}</p>
          <button
            className="button button--primary"
            onClick={() => {
              pending.current = null;
              setError(null);
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            Retry catalog load
          </button>
        </main>
      )}
    </BrowserRouter>
  );
}
