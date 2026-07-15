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
});
