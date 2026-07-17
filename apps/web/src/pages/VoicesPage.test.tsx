import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { AppView } from '../App';
import { createDefaultServices } from '../app-services';
import { mapLaunchCatalog } from '../catalog/launch-catalog';

function renderVoices(route = '/voices') {
  const catalog = mapLaunchCatalog(launchJson);
  const services = { ...createDefaultServices(), catalog };
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppView services={services} />
    </MemoryRouter>,
  );
  return services;
}

describe('launch voice explorer page', () => {
  it('reports runtime presets and catalog-only Pocket coverage separately', () => {
    const services = renderVoices();

    expect(
      screen.getByText('426 runtime-declared presets + 312 catalog-only Pocket variants'),
    ).toBeInTheDocument();
    expect(screen.getByText('738 catalog entries')).toBeInTheDocument();
    expect(services.catalog.voices).toHaveLength(426);
    expect(services.catalog.voices.some(({ id }) => id === 'pocket:german.alba')).toBe(false);
  });

  it('exposes the combined launch count exactly once to accessibility APIs', () => {
    renderVoices();

    const combinedCount = screen.getAllByText(
      '426 runtime-declared presets + 312 catalog-only Pocket variants',
    );
    expect(combinedCount).toHaveLength(1);
    expect(combinedCount[0]?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('applies the existing mode query parameter to catalog-only entries', () => {
    renderVoices('/voices?mode=catalog-only&locale=de');

    expect(document.querySelector('#desktop-mode-catalog-only')).toBeChecked();
    expect(document.querySelector('#desktop-locale-de')).toBeChecked();
    expect(screen.getByText('52 catalog entries')).toBeInTheDocument();
    expect(screen.queryByText(/runnable voices/i)).not.toBeInTheDocument();
  });

  it('keeps a filtered catalog-only result out of internal runtime actions', () => {
    renderVoices('/voices?mode=catalog-only&locale=de&q=german_24l%20alba');

    expect(screen.getByText('1 catalog entry')).toBeInTheDocument();
    const article = screen.getByRole('article', {
      name: 'Catalog-only Pocket variant alba · German · german_24l',
    });
    expect(
      within(article).getByRole('link', {
        name: 'Open official Pocket TTS live demo for alba · german_24l',
      }),
    ).toHaveAttribute('href', 'https://kyutai.org/tts');
    expect(within(article).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(article).queryByRole('link', {
        name: /inspect preset|use voice|add to compare|play/i,
      }),
    ).not.toBeInTheDocument();
  });
});
