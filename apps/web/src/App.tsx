import { BrowserRouter, Route, Routes } from 'react-router-dom';

import type { AppServices } from './app-services';
import { AppShell } from './components/AppShell';
import { CompanionPage } from './pages/CompanionPage';
import { ComparePage } from './pages/ComparePage';
import { EnginePage } from './pages/EnginePage';
import { HomePage } from './pages/HomePage';
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

export function App() {
  return (
    <BrowserRouter>
      <AppView />
    </BrowserRouter>
  );
}
