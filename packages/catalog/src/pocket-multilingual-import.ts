import { createHash } from 'node:crypto';

const POCKET_REPOSITORY_ID = 'kyutai/pocket-tts-without-voice-cloning' as const;
const POCKET_REVISION = 'e041936c75475d350b405bc870bcf7c22da4e9e6' as const;
const INVENTORY_DIGEST_DOMAIN = 'open-voice/pocket-multilingual-inventory/v1' as const;

const SELECTORS = [
  { id: 'english', languageTag: 'en' },
  { id: 'english_2026-01', languageTag: 'en' },
  { id: 'english_2026-04', languageTag: 'en' },
  { id: 'french_24l', languageTag: 'fr' },
  { id: 'german', languageTag: 'de' },
  { id: 'german_24l', languageTag: 'de' },
  { id: 'italian', languageTag: 'it' },
  { id: 'italian_24l', languageTag: 'it' },
  { id: 'portuguese', languageTag: 'pt' },
  { id: 'portuguese_24l', languageTag: 'pt' },
  { id: 'spanish', languageTag: 'es' },
  { id: 'spanish_24l', languageTag: 'es' },
] as const;

const LABELS = [
  'alba',
  'anna',
  'azelma',
  'bill_boerst',
  'caro_davy',
  'charles',
  'cosette',
  'eponine',
  'estelle',
  'eve',
  'fantine',
  'george',
  'giovanni',
  'jane',
  'javert',
  'jean',
  'juergen',
  'lola',
  'marius',
  'mary',
  'michael',
  'paul',
  'peter_yearsley',
  'rafael',
  'stuart_bell',
  'vera',
] as const;

export type PocketSelectorRecord = {
  id: string;
  languageTag: 'en' | 'fr' | 'de' | 'it' | 'pt' | 'es';
};

export type PocketInventoryVariant = {
  selectorId: string;
  label: string;
  languageTag: PocketSelectorRecord['languageTag'];
  upstreamPath: string;
  countryCode: null;
  gender: 'unspecified';
};

export type PocketMultilingualInventory = {
  repositoryId: typeof POCKET_REPOSITORY_ID;
  revision: typeof POCKET_REVISION;
  inventorySha256: `sha256:${string}`;
  selectors: PocketSelectorRecord[];
  labels: string[];
  variants: PocketInventoryVariant[];
};

export type PocketInventoryReview = {
  inventorySha256: `sha256:${string}`;
  selectorCount: 12;
  labelCount: 26;
  variantCount: 312;
  added: string[];
  removed: string[];
  changed: string[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSafeRepositoryPath(path: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') || path.includes('\\')) {
    return false;
  }
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function inventoryDigest(
  variants: readonly PocketInventoryVariant[],
): PocketMultilingualInventory['inventorySha256'] {
  const payload = JSON.stringify({
    domain: INVENTORY_DIGEST_DOMAIN,
    repositoryId: POCKET_REPOSITORY_ID,
    revision: POCKET_REVISION,
    variants,
  });
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

function expectedEmbeddingPaths(): Set<string> {
  return new Set(
    SELECTORS.flatMap(({ id }) =>
      LABELS.map((label) => `languages/${id}/embeddings/${label}.safetensors`),
    ),
  );
}

/**
 * Normalizes a maintainer-supplied, revision-pinned local Hub tree capture.
 * It deliberately has no network or filesystem path.
 */
export function normalizePocketHubInfo(
  input: unknown,
  revision: string,
): PocketMultilingualInventory {
  if (!isRecord(input) || !hasOnlyKeys(input, ['id', 'siblings'])) {
    throw new Error('Pocket Hub info invariant failed.');
  }
  if (input.id !== POCKET_REPOSITORY_ID) {
    throw new Error('Pocket repository invariant failed.');
  }
  if (revision !== POCKET_REVISION) {
    throw new Error('Pocket revision invariant failed.');
  }
  if (!Array.isArray(input.siblings)) {
    throw new Error('Pocket siblings invariant failed.');
  }

  const paths: string[] = [];
  for (const value of input.siblings) {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ['rfilename']) ||
      typeof value.rfilename !== 'string' ||
      value.rfilename.length === 0
    ) {
      throw new Error('Pocket sibling record invariant failed.');
    }
    if (!isSafeRepositoryPath(value.rfilename)) {
      throw new Error('Pocket sibling path safety invariant failed.');
    }
    paths.push(value.rfilename);
  }

  if (new Set(paths).size !== paths.length) {
    throw new Error('Pocket embedding path uniqueness invariant failed.');
  }

  const selectorById = new Map<string, PocketSelectorRecord>(
    SELECTORS.map((selector) => [selector.id, { ...selector }]),
  );
  const labelSet = new Set<string>(LABELS);
  const variants: PocketInventoryVariant[] = [];

  for (const path of paths) {
    if (!/^languages\/[^/]+\/embeddings(?:\/|$)/.test(path)) {
      continue;
    }
    const parts = path.split('/');
    if (parts.length !== 4 || !parts[3]!.endsWith('.safetensors')) {
      throw new Error('Pocket embedding file invariant failed.');
    }
    const selectorId = parts[1]!;
    const selector = selectorById.get(selectorId);
    if (selector === undefined) {
      throw new Error('Pocket selector closure invariant failed.');
    }
    const label = parts[3]!.slice(0, -'.safetensors'.length);
    if (!labelSet.has(label)) {
      throw new Error('Pocket label closure invariant failed.');
    }
    variants.push({
      selectorId,
      label,
      languageTag: selector.languageTag,
      upstreamPath: path,
      countryCode: null,
      gender: 'unspecified',
    });
  }

  variants.sort(
    (left, right) =>
      compareText(left.selectorId, right.selectorId) || compareText(left.label, right.label),
  );
  const expectedPaths = expectedEmbeddingPaths();
  if (
    variants.length !== expectedPaths.size ||
    variants.some((variant) => !expectedPaths.has(variant.upstreamPath))
  ) {
    throw new Error('Pocket embedding Cartesian closure invariant failed.');
  }

  return {
    repositoryId: POCKET_REPOSITORY_ID,
    revision: POCKET_REVISION,
    inventorySha256: inventoryDigest(variants),
    selectors: SELECTORS.map((selector) => ({ ...selector })),
    labels: [...LABELS],
    variants,
  };
}

export function computePocketInventoryReview(
  current: PocketMultilingualInventory,
  candidate: PocketMultilingualInventory,
): PocketInventoryReview {
  const currentByPath = new Map(current.variants.map((variant) => [variant.upstreamPath, variant]));
  const candidateByPath = new Map(
    candidate.variants.map((variant) => [variant.upstreamPath, variant]),
  );
  const added = [...candidateByPath.keys()]
    .filter((path) => !currentByPath.has(path))
    .sort(compareText);
  const removed = [...currentByPath.keys()]
    .filter((path) => !candidateByPath.has(path))
    .sort(compareText);
  const changed = [...candidateByPath.entries()]
    .filter(
      ([path, variant]) =>
        currentByPath.has(path) &&
        JSON.stringify(currentByPath.get(path)) !== JSON.stringify(variant),
    )
    .map(([path]) => path)
    .sort(compareText);

  return {
    inventorySha256: candidate.inventorySha256,
    selectorCount: 12,
    labelCount: 26,
    variantCount: 312,
    added,
    removed,
    changed,
  };
}

function quoted(value: string): string {
  return `'${value}'`;
}

export function renderPocketMultilingualData(inventory: PocketMultilingualInventory): string {
  const selectorLines = inventory.selectors
    .map(({ id, languageTag }) => `  { id: ${quoted(id)}, languageTag: ${quoted(languageTag)} },`)
    .join('\n');
  const labelLines = inventory.labels.map((label) => `  ${quoted(label)},`).join('\n');
  return [
    `export const POCKET_MULTILINGUAL_REVISION = ${quoted(inventory.revision)} as const;`,
    'export const POCKET_MULTILINGUAL_INVENTORY_SHA256 =',
    `  ${quoted(inventory.inventorySha256)} as const;`,
    'export const POCKET_MULTILINGUAL_SELECTORS = [',
    selectorLines,
    '] as const;',
    'export const POCKET_MULTILINGUAL_LABELS = [',
    labelLines,
    '] as const;',
    '',
  ].join('\n');
}
