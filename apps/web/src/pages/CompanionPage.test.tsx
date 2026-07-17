import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { createDefaultServices } from '../app-services';
import { mapLaunchCatalog } from '../catalog/launch-catalog';
import { AppStateProvider } from '../state/AppState';
import { createLocalDataStore } from '../state/local-store';
import { CompanionPage } from './CompanionPage';

describe('CompanionPage Pocket coverage boundary', () => {
  it('keeps the 20 runtime presets separate from all 312 catalog-only variants', () => {
    const defaults = createDefaultServices();
    const catalog = mapLaunchCatalog(launchJson);
    const services = {
      ...defaults,
      catalog,
      store: createLocalDataStore({ indexedDB: null }),
    };

    render(
      <MemoryRouter>
        <AppStateProvider services={services}>
          <CompanionPage />
        </AppStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('20 presets')).toBeVisible();
    expect(screen.getAllByRole('listitem', { name: /Pocket preset/i })).toHaveLength(20);
    const coverage = screen.getByRole('region', { name: 'Pocket multilingual coverage' });
    expect(coverage).toHaveTextContent('426 runtime-declared presets');
    expect(coverage).toHaveTextContent('20 legacy Pocket pack presets');
    expect(coverage).toHaveTextContent('312 catalog-only variants');
    expect(coverage).toHaveTextContent(
      '240 source-license candidates with unpinned assets/runtime',
    );
    expect(coverage).toHaveTextContent('Output/personality-rights review still required');
    expect(coverage).toHaveTextContent('24 noncommercial link-only');
    expect(coverage).toHaveTextContent('48 provenance-pending link-only');
    expect(coverage).toHaveTextContent('Zero Pocket output clips');
    expect(
      within(coverage).getByRole('link', { name: /Browse all 312 variants/i }),
    ).toHaveAttribute('href', '/voices?mode=catalog-only&engine=pocket');
  });
});
