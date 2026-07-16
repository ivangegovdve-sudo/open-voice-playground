import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultServices } from '../app-services';
import { seedCatalog } from '../catalog/catalog';
import type { CatalogVoice } from '../catalog/filters';
import { AppStateProvider } from '../state/AppState';
import { createLocalDataStore } from '../state/local-store';
import { VoiceList } from './VoiceList';

afterEach(() => vi.restoreAllMocks());

describe('variable-height virtual voice list', () => {
  it('links runnable voice-level source and license evidence accessibly', () => {
    const voice = seedCatalog.voices.find(
      (candidate) => candidate.id === 'fixture-browser:voice-a',
    )!;
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog: { ...defaults.catalog, voices: [voice] },
      store: createLocalDataStore({ indexedDB: null }),
    };

    render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={[voice]} />
        </AppStateProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: 'Voice license fixture-voice-license' }),
    ).toHaveAttribute('href', '/about/sources#fixture-voice-license');
    expect(
      screen.getByRole('link', { name: 'Voice source fixture-browser-source' }),
    ).toHaveAttribute('href', '/about/sources#fixture-browser-source');
    expect(screen.getByLabelText('Evidence for Fixture Voice A')).toHaveTextContent(
      'License: fixture-voice-license · Source: fixture-browser-source',
    );
  });

  it('never widens launch operability from an engine or voice-level claim', () => {
    const fixtureVoice = seedCatalog.voices.find(
      (candidate) => candidate.id === 'fixture-browser:voice-a',
    )!;
    const enabledButUnverified: CatalogVoice = {
      ...fixtureVoice,
      id: 'launch:enabled-unverified',
      name: 'Enabled but unverified',
      releaseGate: { status: 'enabled', reason: null, detail: 'Catalog evidence is cleared.' },
    };
    const unavailableButListed: CatalogVoice = {
      ...fixtureVoice,
      id: 'launch:unavailable-listed',
      name: 'Unavailable but listed',
      releaseGate: {
        status: 'unavailable',
        reason: 'asset-unavailable',
        detail: 'A required immutable asset is unavailable.',
      },
    };
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog: {
        ...defaults.catalog,
        kind: 'launch' as const,
        voices: [enabledButUnverified, unavailableButListed],
      },
      runtimeSummary: {
        evidenceClearedVoiceCount: 1,
        operationalVoiceCount: 1,
        operationalEngineIds: [fixtureVoice.engineId],
        operationalVoiceIds: [unavailableButListed.id],
      },
      store: createLocalDataStore({ indexedDB: null }),
    };

    render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={services.catalog.voices} />
        </AppStateProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /use voice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /add to compare/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /inspect preset/i })).toHaveLength(2);
    expect(screen.getByText('Runtime verification pending')).toBeInTheDocument();
    expect(screen.getByText('Catalog unavailable')).toBeInTheDocument();
  });

  it('measures mixed rows and exposes the final item with its full-list position', async () => {
    const plainVoice = seedCatalog.voices.find((voice) => voice.sample === null)!;
    const sample = seedCatalog.voices.find((voice) => voice.sample !== null)!.sample;
    const voices: CatalogVoice[] = Array.from({ length: 35 }, (_, index) => ({
      ...plainVoice,
      id: `virtual:${index}`,
      name: `Virtual voice ${index}`,
      sample: index % 7 === 0 ? sample : null,
    }));
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog: { ...defaults.catalog, voices },
      store: createLocalDataStore({ indexedDB: null }),
    };
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getRect(this: HTMLElement) {
        const height = this.textContent?.includes('synthetic catalog fixture sample') ? 460 : 220;
        return {
          bottom: height,
          height,
          left: 0,
          right: 800,
          top: 0,
          width: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    const { container } = render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={voices} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    const viewport = container.querySelector<HTMLElement>('.voice-list-viewport');
    expect(viewport).not.toBeNull();

    fireEvent.scroll(viewport!, { target: { scrollTop: 20_000 } });

    const finalHeading = await screen.findByRole('heading', { name: 'Virtual voice 34' });
    const finalItem = finalHeading.closest('li');
    expect(finalItem).toHaveAttribute('aria-posinset', '35');
    expect(finalItem).toHaveAttribute('aria-setsize', '35');
    rectSpy.mockRestore();
  });

  it('realigns DOM scroll and virtual state after a 35 to 5 to 35 result transition', async () => {
    const plainVoice = seedCatalog.voices.find((voice) => voice.sample === null)!;
    const voices: CatalogVoice[] = Array.from({ length: 35 }, (_, index) => ({
      ...plainVoice,
      id: `transition:${index}`,
      name: `Transition voice ${index}`,
      sample: null,
    }));
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog: { ...defaults.catalog, voices },
      store: createLocalDataStore({ indexedDB: null }),
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 220,
      height: 220,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const view = render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={voices} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    const initialViewport = view.container.querySelector<HTMLElement>('.voice-list-viewport');
    expect(initialViewport).not.toBeNull();
    fireEvent.scroll(initialViewport!, { target: { scrollTop: 20_000 } });
    expect(await screen.findByRole('heading', { name: 'Transition voice 34' })).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={voices.slice(0, 5)} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Transition voice 0' })).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={voices} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    const resetViewport = view.container.querySelector<HTMLElement>('.voice-list-viewport');
    expect(resetViewport).not.toBeNull();
    expect(resetViewport).toHaveProperty('scrollTop', 0);
    const firstHeading = await screen.findByRole('heading', { name: 'Transition voice 0' });
    expect(firstHeading.closest('li')).toHaveAttribute('aria-posinset', '1');
    expect(screen.queryByRole('heading', { name: 'Transition voice 34' })).not.toBeInTheDocument();
  });
});
