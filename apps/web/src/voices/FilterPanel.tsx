import { RUNTIME_LABELS, type SeedCatalog } from '../catalog/catalog';
import type { FilterState } from '../catalog/filters';

export type ArrayFilterKey = Exclude<keyof FilterState, 'q' | 'sort'>;

type FilterPanelProps = {
  catalog: SeedCatalog;
  filters: FilterState;
  idPrefix: string;
  onClear(): void;
  onSort(sort: FilterState['sort']): void;
  onToggle(key: ArrayFilterKey, value: string): void;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function CheckboxGroup({
  filterKey,
  idPrefix,
  label,
  options,
  selected,
  onToggle,
}: {
  filterKey: ArrayFilterKey;
  idPrefix: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  selected: readonly string[];
  onToggle(key: ArrayFilterKey, value: string): void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <fieldset className="filter-group">
      <legend>{label}</legend>
      {options.map((option) => {
        const id = `${idPrefix}-${filterKey}-${option.value.replaceAll(/[^a-zA-Z0-9]/g, '-')}`;
        return (
          <label className="check-row" htmlFor={id} key={option.value}>
            <input
              checked={selected.includes(option.value)}
              id={id}
              onChange={() => onToggle(filterKey, option.value)}
              type="checkbox"
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function FilterPanel({
  catalog,
  filters,
  idPrefix,
  onClear,
  onSort,
  onToggle,
}: FilterPanelProps) {
  const voices = catalog.voices;
  const runtimeOptions = (Object.keys(RUNTIME_LABELS) as Array<keyof typeof RUNTIME_LABELS>).map(
    (mode) => ({ value: mode, label: RUNTIME_LABELS[mode] }),
  );
  const engineOptions = catalog.engines.map((engine) => ({ value: engine.id, label: engine.name }));
  const languageOptions = unique(voices.map((voice) => voice.language)).map((value) => ({
    value,
    label: value,
  }));
  const localeOptions = unique(voices.map((voice) => voice.locale)).map((value) => ({
    value,
    label: value,
  }));
  const regionOptions = unique(voices.map((voice) => voice.region)).map((value) => ({
    value,
    label: value,
  }));
  const genderOptions = unique(voices.map((voice) => voice.gender)).map((value) => ({
    value,
    label: titleCase(value),
  }));
  const styleOptions = unique(voices.flatMap((voice) => voice.styles)).map((value) => ({
    value,
    label: titleCase(value),
  }));
  const licenseOptions = unique(voices.flatMap((voice) => voice.licenseIds)).map((value) => ({
    value,
    label: value,
  }));

  return (
    <form className="filter-panel" onSubmit={(event) => event.preventDefault()}>
      <div className="filter-panel__heading">
        <strong>Filter the atlas</strong>
        <button className="text-button" onClick={onClear} type="button">
          Clear all
        </button>
      </div>
      <label className="select-field" htmlFor={`${idPrefix}-sort`}>
        <span>Sort</span>
        <select
          id={`${idPrefix}-sort`}
          onChange={(event) => onSort(event.currentTarget.value as FilterState['sort'])}
          value={filters.sort}
        >
          <option value="name">Name</option>
          <option value="engine">Engine</option>
          <option value="language">Language</option>
        </select>
      </label>
      <CheckboxGroup
        filterKey="mode"
        idPrefix={idPrefix}
        label="Availability"
        onToggle={onToggle}
        options={runtimeOptions}
        selected={filters.mode}
      />
      <CheckboxGroup
        filterKey="engine"
        idPrefix={idPrefix}
        label="Engine"
        onToggle={onToggle}
        options={engineOptions}
        selected={filters.engine}
      />
      <CheckboxGroup
        filterKey="lang"
        idPrefix={idPrefix}
        label="Language"
        onToggle={onToggle}
        options={languageOptions}
        selected={filters.lang}
      />
      <CheckboxGroup
        filterKey="locale"
        idPrefix={idPrefix}
        label="Locale"
        onToggle={onToggle}
        options={localeOptions}
        selected={filters.locale}
      />
      <CheckboxGroup
        filterKey="region"
        idPrefix={idPrefix}
        label="Country / region"
        onToggle={onToggle}
        options={regionOptions}
        selected={filters.region}
      />
      <CheckboxGroup
        filterKey="gender"
        idPrefix={idPrefix}
        label="Source-published gender"
        onToggle={onToggle}
        options={genderOptions}
        selected={filters.gender}
      />
      <CheckboxGroup
        filterKey="style"
        idPrefix={idPrefix}
        label="Style"
        onToggle={onToggle}
        options={styleOptions}
        selected={filters.style}
      />
      <CheckboxGroup
        filterKey="license"
        idPrefix={idPrefix}
        label="License"
        onToggle={onToggle}
        options={licenseOptions}
        selected={filters.license}
      />
    </form>
  );
}
