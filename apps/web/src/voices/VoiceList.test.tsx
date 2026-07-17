import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { createDefaultServices } from '../app-services';
import { seedCatalog } from '../catalog/catalog';
import { buildExplorerEntries, type PocketCoverageExplorerEntry } from '../catalog/explorer';
import type { CatalogVoice } from '../catalog/filters';
import { mapLaunchCatalog } from '../catalog/launch-catalog';
import { AppStateProvider } from '../state/AppState';
import { createLocalDataStore } from '../state/local-store';
import { VoiceList } from './VoiceList';

afterEach(() => vi.restoreAllMocks());

function launchCoverageFixture() {
  const catalog = mapLaunchCatalog(launchJson);
  const coverage = buildExplorerEntries(catalog).filter(
    (entry): entry is PocketCoverageExplorerEntry =>
      entry.entryKind === 'catalog-only-pocket-variant',
  );
  const candidate = coverage.find(
    ({ label, selectorId }) => label === 'alba' && selectorId === 'german_24l',
  )!;
  const noncommercial = coverage.find(
    ({ listingPolicy }) => listingPolicy === 'link-only-noncommercial',
  )!;
  const provenancePending = coverage.find(
    ({ listingPolicy }) => listingPolicy === 'link-only-provenance-pending',
  )!;
  return { candidate, catalog, noncommercial, provenancePending };
}

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

  it('renders all Pocket coverage policies as evidence-only external-demo rows', () => {
    const { candidate, catalog, noncommercial, provenancePending } = launchCoverageFixture();
    const entries = [candidate, noncommercial, provenancePending];
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog,
      store: createLocalDataStore({ indexedDB: null }),
    };

    render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={entries} />
        </AppStateProvider>
      </MemoryRouter>,
    );

    const policyCopy = new Map<PocketCoverageExplorerEntry['listingPolicy'], string>([
      [
        'catalog-only-runtime-candidate',
        'Catalog candidate · embedding assets and companion runtime are not release-pinned.',
      ],
      ['link-only-noncommercial', 'Link only · source terms are noncommercial.'],
      ['link-only-provenance-pending', 'Link only · per-clip provenance is unresolved.'],
    ]);
    for (const entry of entries) {
      const article = screen.getByRole('article', {
        name: `Catalog-only Pocket variant ${entry.label} · ${entry.language} · ${entry.selectorId}`,
      });
      expect(within(article).getByText('Catalog only · no generation')).toBeInTheDocument();
      expect(
        within(article).getByText('Country: Unspecified (not source-published)'),
      ).toBeVisible();
      expect(within(article).getByText('Gender: Unspecified (not source-published)')).toBeVisible();
      expect(within(article).getByText(policyCopy.get(entry.listingPolicy)!)).toBeVisible();
      expect(
        within(article).getByText(
          'No stable official generated Pocket TTS output clip was found. Conditioning/source audio is not a model sample.',
        ),
      ).toBeVisible();
      expect(
        within(article).getByText(
          'Official live demo · internet required. The destination performs live generation and is not called, proxied, or cached by this app.',
        ),
      ).toBeVisible();
      for (const licenseId of entry.licenseIds) {
        expect(
          within(article).getByRole('link', { name: `Voice license ${licenseId}` }),
        ).toHaveAttribute('href', `/about/sources#${licenseId}`);
      }
      for (const sourceId of entry.sourceIds) {
        expect(
          within(article).getByRole('link', { name: `Voice source ${sourceId}` }),
        ).toHaveAttribute('href', `/about/sources#${sourceId}`);
      }
      for (const sourceId of entry.officialDemo.sourceIds) {
        expect(
          within(article).getByRole('link', { name: `Official demo source ${sourceId}` }),
        ).toHaveAttribute('href', `/about/sources#${sourceId}`);
      }
      expect(within(article).queryByRole('button')).not.toBeInTheDocument();
      expect(
        within(article).queryByRole('link', {
          name: /use voice|inspect preset|add to compare|play/i,
        }),
      ).not.toBeInTheDocument();
      expect(article.querySelector('audio, input[type="file"]')).toBeNull();
    }

    const officialDemo = within(
      screen.getByRole('article', {
        name: 'Catalog-only Pocket variant alba · German · german_24l',
      }),
    ).getByRole('link', {
      name: 'Open official Pocket TTS live demo for alba · german_24l',
    });
    expect(officialDemo).toHaveAttribute('href', 'https://kyutai.org/tts');
    expect(officialDemo).toHaveAttribute('target', '_blank');
    expect(officialDemo).toHaveAttribute('rel', 'noreferrer');
    const outputBoundaryId = `pocket-output-boundary-${candidate.id.replaceAll(
      /[^a-zA-Z0-9_-]/g,
      '-',
    )}`;
    expect(officialDemo).toHaveAttribute('aria-describedby', outputBoundaryId);
    expect(document.getElementById(outputBoundaryId)).toHaveTextContent(
      'Official live demo · internet required. The destination performs live generation and is not called, proxied, or cached by this app.',
    );
  });

  it('does not consult runtime state or cause effects while rendering Pocket coverage', () => {
    const { candidate, catalog } = launchCoverageFixture();
    const defaults = createDefaultServices();
    const previewPlay = vi.spyOn(defaults.preview, 'play');
    const runtimeGet = vi.fn(() => null);
    const runtimeSummaryRead = vi.fn();
    const createObjectUrl = vi.fn(() => 'blob:forbidden');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = createLocalDataStore({ indexedDB: null });
    const favoriteSpy = vi.spyOn(store, 'toggleFavorite');
    const services = {
      ...defaults,
      catalog,
      createObjectUrl,
      runtime: { get: runtimeGet },
      store,
    };
    Object.defineProperty(services, 'runtimeSummary', {
      configurable: true,
      get: () => {
        runtimeSummaryRead();
        return defaults.runtimeSummary;
      },
    });

    render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={[candidate]} />
        </AppStateProvider>
      </MemoryRouter>,
    );

    expect(runtimeSummaryRead).not.toHaveBeenCalled();
    expect(runtimeGet).not.toHaveBeenCalled();
    expect(previewPlay).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(favoriteSpy).not.toHaveBeenCalled();
  });

  it('uses a catalog-only estimate for virtualized Pocket coverage rows', () => {
    const { candidate, catalog } = launchCoverageFixture();
    const entries = Array.from({ length: 35 }, (_, index) => ({
      ...candidate,
      id: `pocket:test-${index}.alba`,
      name: `Alba catalog ${index}`,
    }));
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog,
      store: createLocalDataStore({ indexedDB: null }),
    };

    const { container } = render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={entries} />
        </AppStateProvider>
      </MemoryRouter>,
    );

    expect(container.querySelector('li')).toHaveStyle({ minHeight: '440px' });
  });

  it('virtualizes all 312 Pocket variants with exact positions, unique keys, and focusable links', async () => {
    const catalog = mapLaunchCatalog(launchJson);
    const entries = buildExplorerEntries(catalog).filter(
      (entry): entry is PocketCoverageExplorerEntry =>
        entry.entryKind === 'catalog-only-pocket-variant',
    );
    const finalEntry = entries.at(-1)!;
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog,
      store: createLocalDataStore({ indexedDB: null }),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { container } = render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={entries} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    const viewport = container.querySelector<HTMLElement>('.voice-list-viewport')!;
    fireEvent.scroll(viewport, { target: { scrollTop: 1_000_000 } });

    const finalArticle = await screen.findByRole('article', {
      name: `Catalog-only Pocket variant ${finalEntry.label} · ${finalEntry.language} · ${finalEntry.selectorId}`,
    });
    const finalItem = finalArticle.closest('li');
    expect(finalItem).toHaveAttribute('aria-posinset', '312');
    expect(finalItem).toHaveAttribute('aria-setsize', '312');
    const finalLink = within(finalArticle).getByRole('link', {
      name: `Open official Pocket TTS live demo for ${finalEntry.label} · ${finalEntry.selectorId}`,
    });
    finalLink.focus();
    expect(finalLink).toHaveFocus();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringMatching(/unique.*key/i),
      expect.anything(),
    );
  });

  it('resets 312 to 26 to 312 results and preserves a logical list focus target', async () => {
    const catalog = mapLaunchCatalog(launchJson);
    const entries = buildExplorerEntries(catalog).filter(
      (entry): entry is PocketCoverageExplorerEntry =>
        entry.entryKind === 'catalog-only-pocket-variant',
    );
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog,
      store: createLocalDataStore({ indexedDB: null }),
    };
    const view = render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={entries} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    const viewport = view.container.querySelector<HTMLElement>('.voice-list-viewport')!;
    fireEvent.scroll(viewport, { target: { scrollTop: 1_000_000 } });
    const finalEntry = entries.at(-1)!;
    const finalLink = await screen.findByRole('link', {
      name: `Open official Pocket TTS live demo for ${finalEntry.label} · ${finalEntry.selectorId}`,
    });
    finalLink.focus();
    expect(finalLink).toHaveFocus();

    view.rerender(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={entries.slice(0, 26)} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('article')).toHaveLength(26);
    expect(screen.getAllByRole('article')[0]!.closest('li')).not.toHaveAttribute('aria-posinset');

    view.rerender(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <VoiceList voices={entries} />
        </AppStateProvider>
      </MemoryRouter>,
    );
    const resetViewport = view.container.querySelector<HTMLElement>('.voice-list-viewport')!;
    await waitFor(() => expect(resetViewport).toHaveFocus());
    expect(resetViewport).toHaveProperty('scrollTop', 0);
    const firstItem = (await screen.findAllByRole('article'))[0]!.closest('li');
    expect(firstItem).toHaveAttribute('aria-posinset', '1');
    expect(firstItem).toHaveAttribute('aria-setsize', '312');
  });

  it('does not steal focus from a filter after the focused virtual row is removed', async () => {
    const catalog = mapLaunchCatalog(launchJson);
    const entries = buildExplorerEntries(catalog).filter(
      (entry): entry is PocketCoverageExplorerEntry =>
        entry.entryKind === 'catalog-only-pocket-variant',
    );
    const germanEntries = entries.filter(({ language }) => language === 'German');
    const defaults = createDefaultServices();
    const services = {
      ...defaults,
      catalog,
      store: createLocalDataStore({ indexedDB: null }),
    };

    function FilterHarness() {
      const [germanOnly, setGermanOnly] = useState(false);
      return (
        <MemoryRouter>
          <label>
            <input
              aria-label="German only"
              checked={germanOnly}
              onChange={(event) => setGermanOnly(event.currentTarget.checked)}
              type="checkbox"
            />
            German only
          </label>
          <AppStateProvider services={services}>
            <VoiceList voices={germanOnly ? germanEntries : entries} />
          </AppStateProvider>
        </MemoryRouter>
      );
    }

    const { container } = render(<FilterHarness />);
    const firstEntry = entries[0]!;
    const firstLink = screen.getByRole('link', {
      name: `Open official Pocket TTS live demo for ${firstEntry.label} · ${firstEntry.selectorId}`,
    });
    firstLink.focus();
    expect(firstLink).toHaveFocus();

    const viewport = container.querySelector<HTMLElement>('.voice-list-viewport')!;
    fireEvent.scroll(viewport, { target: { scrollTop: 1_000_000 } });
    await waitFor(() => expect(firstLink).not.toBeInTheDocument());
    expect(document.body).toHaveFocus();

    const filter = screen.getByRole('checkbox', { name: 'German only' });
    filter.focus();
    fireEvent.click(filter);

    expect(filter).toBeChecked();
    expect(filter).toHaveFocus();
    expect(container.querySelector('li')).toHaveAttribute('aria-setsize', '52');
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
