export type RuntimeMode = 'browser' | 'online' | 'companion' | 'sample-only';

export type CatalogSample = {
  id: string;
  audioUrl: string;
  officialPageUrl: string;
  transcript: string;
  sourceId: string;
  licenseId: string;
};

export type CatalogVoice = {
  id: string;
  name: string;
  engineId: string;
  engineName: string;
  locale: string;
  language: string;
  region: string;
  gender: string;
  styles: string[];
  licenseIds: string[];
  sourceIds: string[];
  runtimeModes: RuntimeMode[];
  sample: CatalogSample | null;
};

export type VoiceSort = 'name' | 'engine' | 'language';

export type FilterState = {
  q: string;
  mode: string[];
  engine: string[];
  lang: string[];
  locale: string[];
  region: string[];
  gender: string[];
  style: string[];
  license: string[];
  sort: VoiceSort;
};

export const EMPTY_FILTERS: FilterState = {
  q: '',
  mode: [],
  engine: [],
  lang: [],
  locale: [],
  region: [],
  gender: [],
  style: [],
  license: [],
  sort: 'name',
};

const DIACRITICS = /\p{Diacritic}/gu;
const ARRAY_FILTER_KEYS = [
  'mode',
  'engine',
  'lang',
  'locale',
  'region',
  'gender',
  'style',
  'license',
] as const;

function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(DIACRITICS, '').toLocaleLowerCase().trim();
}

function intersects(values: readonly string[], selected: readonly string[]): boolean {
  return selected.length === 0 || selected.some((value) => values.includes(value));
}

function matchesSingle(value: string, selected: readonly string[]): boolean {
  return selected.length === 0 || selected.includes(value);
}

export function filterVoices(
  voices: readonly CatalogVoice[],
  filters: FilterState,
): CatalogVoice[] {
  const query = normalizeSearchText(filters.q);
  const filtered = voices.filter((voice) => {
    const haystack = normalizeSearchText(
      [
        voice.name,
        voice.engineName,
        voice.locale,
        voice.language,
        voice.region,
        voice.gender,
        ...voice.styles,
        ...voice.licenseIds,
      ].join(' '),
    );

    return (
      (query.length === 0 || haystack.includes(query)) &&
      intersects(voice.runtimeModes, filters.mode) &&
      matchesSingle(voice.engineId, filters.engine) &&
      matchesSingle(voice.language, filters.lang) &&
      matchesSingle(voice.locale, filters.locale) &&
      matchesSingle(voice.region, filters.region) &&
      matchesSingle(voice.gender, filters.gender) &&
      intersects(voice.styles, filters.style) &&
      intersects(voice.licenseIds, filters.license)
    );
  });

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'engine') {
      return left.engineName.localeCompare(right.engineName) || left.name.localeCompare(right.name);
    }
    if (filters.sort === 'language') {
      return left.language.localeCompare(right.language) || left.name.localeCompare(right.name);
    }
    return left.name.localeCompare(right.name);
  });
}

export function parseFilterSearch(search: string): FilterState {
  const parameters = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawSort = parameters.get('sort');
  const sort: VoiceSort =
    rawSort === 'engine' || rawSort === 'language' || rawSort === 'name' ? rawSort : 'name';
  const state: FilterState = {
    ...EMPTY_FILTERS,
    q: parameters.get('q') ?? '',
    sort,
  };

  for (const key of ARRAY_FILTER_KEYS) {
    state[key] = parameters.getAll(key).filter((value) => value.length > 0);
  }

  return state;
}

export function serializeFilterSearch(filters: FilterState): string {
  const parameters = new URLSearchParams();
  if (filters.q.length > 0) {
    parameters.set('q', filters.q);
  }
  for (const key of ARRAY_FILTER_KEYS) {
    for (const value of filters[key]) {
      parameters.append(key, value);
    }
  }
  if (filters.sort !== 'name') {
    parameters.set('sort', filters.sort);
  }

  const search = parameters.toString();
  return search.length > 0 ? `?${search}` : '';
}
