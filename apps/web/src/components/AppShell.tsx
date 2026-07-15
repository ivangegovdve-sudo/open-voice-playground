import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { MiniPlayer } from '../audio/MiniPlayer';
import { CloseIcon, MenuIcon, WaveformMark } from './Icons';
import { useModalDrawer } from './useModalDrawer';

type ThemeMode = 'system' | 'light' | 'dark';

const NAV_ITEMS = [
  { to: '/voices', label: 'Voices' },
  { to: '/play', label: 'Play' },
  { to: '/compare', label: 'Compare' },
  { to: '/engines/fixture-browser', label: 'Engines' },
  { to: '/companion', label: 'Companion' },
  { to: '/about/sources', label: 'Sources' },
] as const;

function initialTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem('open-voice-theme');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function PrimaryLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <NavLink
          className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
          key={item.to}
          onClick={onNavigate}
          to={item.to}
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const location = useLocation();
  const navigationDrawer = useModalDrawer(navigationOpen, setNavigationOpen);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('open-voice-theme', theme);
    } catch {
      // Theme persistence is optional when browser storage is restricted.
    }
  }, [theme]);

  useEffect(() => {
    setNavigationOpen(false);
  }, [location.pathname]);

  const cycleTheme = () => {
    setTheme((current) =>
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system',
    );
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Link aria-label="Open Voice Playground home" className="wordmark" to="/">
          <WaveformMark className="wordmark__mark" />
          <span>
            Open Voice
            <small>Playground</small>
          </span>
        </Link>
        <nav aria-label="Primary" className="desktop-nav">
          <PrimaryLinks />
        </nav>
        <div className="header-actions">
          <button className="theme-button" onClick={cycleTheme} type="button">
            Theme: {theme[0]?.toUpperCase()}
            {theme.slice(1)}
          </button>
          <button
            aria-expanded={navigationOpen}
            aria-label="Open navigation"
            className="icon-button mobile-menu-button"
            onClick={() => setNavigationOpen(true)}
            ref={navigationDrawer.triggerRef}
            type="button"
          >
            <MenuIcon />
          </button>
        </div>
      </header>

      {navigationOpen ? (
        <div
          aria-label="Navigation"
          aria-modal="true"
          className="drawer drawer--navigation"
          ref={navigationDrawer.dialogRef}
          role="dialog"
        >
          <div className="drawer__header">
            <strong>Navigate</strong>
            <button
              aria-label="Close navigation"
              className="icon-button"
              onClick={() => setNavigationOpen(false)}
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
          <nav aria-label="Mobile primary" className="mobile-nav">
            <PrimaryLinks onNavigate={() => setNavigationOpen(false)} />
          </nav>
        </div>
      ) : null}

      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <p>Preset voices only · Local history · No account</p>
        <p>
          Fixture catalog for interface validation.{' '}
          <Link to="/about/sources">Read the source notes.</Link>
        </p>
      </footer>
      <MiniPlayer />
    </div>
  );
}
