import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { EMPTY_FILTERS } from '../catalog/filters';
import { buildExplorerEntries } from '../catalog/explorer';
import { mapLaunchCatalog } from '../catalog/launch-catalog';
import { FilterPanel } from './FilterPanel';

describe('voice explorer filter panel', () => {
  it('labels catalog-only availability without implying generation', () => {
    const entries = buildExplorerEntries(mapLaunchCatalog(launchJson))
      .filter(({ entryKind }) => entryKind === 'catalog-only-pocket-variant')
      .slice(0, 1);
    const onToggle = vi.fn();

    render(
      <FilterPanel
        entries={entries}
        filters={EMPTY_FILTERS}
        idPrefix="test"
        onClear={vi.fn()}
        onSort={vi.fn()}
        onToggle={onToggle}
      />,
    );

    const catalogOnly = screen.getByRole('checkbox', {
      name: 'Catalog only · no generation',
    });
    fireEvent.click(catalogOnly);
    expect(onToggle).toHaveBeenCalledWith('mode', 'catalog-only');
  });

  it('marks unavailable country and gender metadata as not source-published', () => {
    const entries = buildExplorerEntries(mapLaunchCatalog(launchJson))
      .filter(({ entryKind }) => entryKind === 'catalog-only-pocket-variant')
      .slice(0, 1);

    render(
      <FilterPanel
        entries={entries}
        filters={EMPTY_FILTERS}
        idPrefix="test"
        onClear={vi.fn()}
        onSort={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole('group', { name: 'Country / region' })).getByRole('checkbox', {
        name: 'Unspecified (not source-published)',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Source-published gender' })).getByRole('checkbox', {
        name: 'Unspecified (not source-published)',
      }),
    ).toBeInTheDocument();
  });
});
