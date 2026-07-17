import { useDeferredValue, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';

import {
  EMPTY_FILTERS,
  filterVoices,
  parseFilterSearch,
  serializeFilterSearch,
  type FilterState,
} from '../catalog/filters';
import { buildExplorerEntries } from '../catalog/explorer';
import { CloseIcon, FilterIcon, SearchIcon } from '../components/Icons';
import { useModalDrawer } from '../components/useModalDrawer';
import { useAppServices } from '../state/AppState';
import { FilterPanel, type ArrayFilterKey } from '../voices/FilterPanel';
import { VoiceList } from '../voices/VoiceList';

export function VoicesPage() {
  const { catalog } = useAppServices();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const filterDrawer = useModalDrawer(filterDrawerOpen, setFilterDrawerOpen);
  const filters = useMemo(() => parseFilterSearch(searchParameters.toString()), [searchParameters]);
  const entries = useMemo(() => buildExplorerEntries(catalog), [catalog]);
  const deferredQuery = useDeferredValue(filters.q);
  const result = useMemo(
    () => filterVoices(entries, { ...filters, q: deferredQuery }),
    [deferredQuery, entries, filters],
  );
  const activeCount = Object.entries(filters).reduce(
    (count, [key, value]) =>
      key === 'q' || key === 'sort' ? count : count + (Array.isArray(value) ? value.length : 0),
    filters.q.length > 0 ? 1 : 0,
  );

  const replaceFilters = (next: FilterState) => {
    const serialized = serializeFilterSearch(next);
    setSearchParameters(
      new URLSearchParams(serialized.startsWith('?') ? serialized.slice(1) : serialized),
      {
        replace: true,
      },
    );
  };

  const toggleFilter = (key: ArrayFilterKey, value: string) => {
    const selected = filters[key];
    replaceFilters({
      ...filters,
      [key]: selected.includes(value)
        ? selected.filter((candidate) => candidate !== value)
        : [...selected, value],
    });
  };

  return (
    <div className="page page--voices">
      <header className="page-intro page-intro--split">
        <div>
          <h1>Voice atlas</h1>
          <p>
            Search the{' '}
            {catalog.kind === 'launch' ? 'reviewed launch catalog' : 'validated seed catalog'} by
            language, runtime, source-published metadata, and license. Every mode and limitation
            stays visible.
          </p>
        </div>
        <div className="atlas-coordinate" aria-hidden="true">
          {catalog.kind === 'launch'
            ? '426 runtime-declared presets + 312 catalog-only Pocket variants'
            : '05 PRESETS / FIXTURE V1'}
        </div>
      </header>

      <div className="explorer-toolbar">
        <label className="search-field">
          <span className="sr-only">Search voices</span>
          <SearchIcon />
          <input
            aria-label="Search voices"
            onChange={(event) => replaceFilters({ ...filters, q: event.currentTarget.value })}
            placeholder="Search name, locale, engine, style…"
            type="search"
            value={filters.q}
          />
        </label>
        <button
          className="button button--secondary filter-drawer-button"
          onClick={() => setFilterDrawerOpen(true)}
          ref={filterDrawer.triggerRef}
          type="button"
        >
          <FilterIcon />
          Open filters
          {activeCount > 0 ? <span className="filter-count">{activeCount}</span> : null}
        </button>
        <span className="result-count" aria-live="polite">
          {catalog.kind === 'launch'
            ? `${result.length} ${result.length === 1 ? 'catalog entry' : 'catalog entries'}`
            : `${result.length} ${result.length === 1 ? 'preset' : 'presets'}`}
        </span>
      </div>

      <div className="explorer-layout">
        <aside aria-label="Voice filters" className="filter-sidebar">
          <FilterPanel
            entries={entries}
            filters={filters}
            idPrefix="desktop"
            onClear={() => replaceFilters(EMPTY_FILTERS)}
            onSort={(sort) => replaceFilters({ ...filters, sort })}
            onToggle={toggleFilter}
          />
        </aside>
        <section aria-label="Voice results" className="explorer-results">
          <div className="result-rule" aria-hidden="true">
            <span>NAME / ENGINE</span>
            <span>RUNTIME / SOURCE</span>
          </div>
          <VoiceList voices={result} />
        </section>
      </div>

      {filterDrawerOpen
        ? createPortal(
            <div
              aria-label="Voice filters"
              aria-modal="true"
              className="drawer drawer--filters"
              ref={filterDrawer.dialogRef}
              role="dialog"
            >
              <div className="drawer__header">
                <strong>Voice filters</strong>
                <button
                  aria-label="Close filters"
                  className="icon-button"
                  onClick={() => setFilterDrawerOpen(false)}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>
              <FilterPanel
                entries={entries}
                filters={filters}
                idPrefix="mobile"
                onClear={() => replaceFilters(EMPTY_FILTERS)}
                onSort={(sort) => replaceFilters({ ...filters, sort })}
                onToggle={toggleFilter}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
