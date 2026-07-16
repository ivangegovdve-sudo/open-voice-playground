import type {
  AssetDeliveryEvidence,
  AssetSetManifest,
  FeatureFlag,
  GalleryManifest,
  GeneratedMediaProvenance,
  GenerationCandidate,
  LaunchEngineManifest,
  LaunchVoicePreset,
  LicenseRecord,
  OfficialSample,
  PinnedReleaseAssetEvidence,
  SourceRecord,
} from '@open-voice/contracts';

import catalogIntegrity from '../../../../packages/catalog/data/launch-catalog.integrity.json';

import { deriveLanguageName, deriveRegionFromLocale, type SeedCatalog } from './catalog';
import type { CatalogVoice, RuntimeMode } from './filters';

type LaunchCatalogData = {
  schemaVersion: 2;
  catalogId: 'open-voice-launch';
  generatedAt: string;
  engines: LaunchEngineManifest[];
  voices: LaunchVoicePreset[];
  samples: OfficialSample[];
  licenses: LicenseRecord[];
  sources: SourceRecord[];
  assetSets: AssetSetManifest[];
  assetDeliveryEvidence: AssetDeliveryEvidence[];
  releaseAssetEvidence: PinnedReleaseAssetEvidence[];
  featureFlags: FeatureFlag[];
  galleries: GalleryManifest[];
  generationCandidates: GenerationCandidate[];
  generatedMedia: GeneratedMediaProvenance[];
};

const ARRAY_FIELDS = [
  'engines',
  'voices',
  'samples',
  'licenses',
  'sources',
  'assetSets',
  'assetDeliveryEvidence',
  'releaseAssetEvidence',
  'featureFlags',
  'galleries',
  'generationCandidates',
  'generatedMedia',
] as const;

const TOP_LEVEL_FIELDS = [...ARRAY_FIELDS, 'catalogId', 'generatedAt', 'schemaVersion'].sort();
const EXPECTED_ENGINE_COUNTS: Readonly<Record<string, number>> = {
  edge: 322,
  kitten: 8,
  kokoro: 54,
  piper: 12,
  pocket: 20,
  supertonic: 10,
};
const LAUNCH_CATALOG_CACHE_PREFIX = 'open-voice-launch-catalog-';
const STRICT_JSON_CONTENT_TYPE =
  /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLaunchCatalog(value: unknown): LaunchCatalogData {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(TOP_LEVEL_FIELDS) ||
    value.schemaVersion !== 2 ||
    value.catalogId !== 'open-voice-launch' ||
    typeof value.generatedAt !== 'string' ||
    ARRAY_FIELDS.some((field) => !Array.isArray(value[field]))
  ) {
    throw new Error('Invalid launch catalog payload: required public fields are missing.');
  }
  const candidate = value as unknown as LaunchCatalogData;
  if (candidate.voices.length !== 426) {
    throw new Error(
      `Invalid launch catalog payload: expected 426 presets, got ${candidate.voices.length}.`,
    );
  }
  if (new Set(candidate.voices.map(({ id }) => id)).size !== candidate.voices.length) {
    throw new Error('Invalid launch catalog payload: duplicate preset IDs.');
  }
  if (candidate.engines.length !== 6 || candidate.galleries.length !== 12) {
    throw new Error('Invalid launch catalog payload: launch engine or gallery count drift.');
  }
  const engineIds = new Set<string>();
  for (const engine of candidate.engines) {
    if (
      !isRecord(engine) ||
      typeof engine.id !== 'string' ||
      typeof engine.displayName !== 'string' ||
      !Array.isArray(engine.runtimeModes) ||
      !Array.isArray(engine.languageTags) ||
      !Array.isArray(engine.licenseIds) ||
      !Array.isArray(engine.sourceIds) ||
      !isRecord(engine.releaseGate)
    ) {
      throw new Error('Invalid launch catalog payload: malformed engine record.');
    }
    engineIds.add(engine.id);
  }
  if (engineIds.size !== candidate.engines.length) {
    throw new Error('Invalid launch catalog payload: duplicate engine IDs.');
  }
  const actualEngineCounts: Record<string, number> = {};
  for (const voice of candidate.voices) {
    if (
      !isRecord(voice) ||
      typeof voice.id !== 'string' ||
      typeof voice.engineId !== 'string' ||
      typeof voice.displayName !== 'string' ||
      typeof voice.locale !== 'string' ||
      !Array.isArray(voice.languageTags) ||
      !Array.isArray(voice.runtimeModes) ||
      !Array.isArray(voice.styleTags) ||
      !Array.isArray(voice.licenseIds) ||
      !Array.isArray(voice.sourceIds) ||
      !isRecord(voice.releaseGate) ||
      (voice.releaseGate.status !== 'enabled' && voice.releaseGate.status !== 'unavailable') ||
      !engineIds.has(voice.engineId)
    ) {
      throw new Error('Invalid launch catalog payload: malformed voice record.');
    }
    actualEngineCounts[voice.engineId] = (actualEngineCounts[voice.engineId] ?? 0) + 1;
  }
  if (
    Object.entries(EXPECTED_ENGINE_COUNTS).some(
      ([engineId, expected]) => actualEngineCounts[engineId] !== expected,
    ) ||
    Object.keys(actualEngineCounts).some((engineId) => !(engineId in EXPECTED_ENGINE_COUNTS))
  ) {
    throw new Error('Invalid launch catalog payload: per-engine preset count drift.');
  }
  return candidate;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function mapLaunchCatalog(value: unknown): SeedCatalog {
  const launch = parseLaunchCatalog(value);
  const enginesById = new Map(launch.engines.map((engine) => [engine.id, engine]));
  const voices: CatalogVoice[] = launch.voices.map((voice) => {
    const engine = enginesById.get(voice.engineId);
    if (engine === undefined) {
      throw new Error(`Invalid launch catalog payload: ${voice.id} references a missing engine.`);
    }
    const languages = unique(voice.languageTags.map(deriveLanguageName));
    const regions = unique(voice.languageTags.map(deriveRegionFromLocale));
    return {
      id: voice.id,
      name: voice.displayName,
      engineId: voice.engineId,
      engineName: engine.displayName,
      locale: voice.locale,
      languageTags: [...voice.languageTags],
      languages,
      language: deriveLanguageName(voice.locale),
      region: deriveRegionFromLocale(voice.locale),
      regions,
      gender: voice.gender,
      styles: [...voice.styleTags],
      licenseIds: [...voice.licenseIds],
      sourceIds: [...voice.sourceIds],
      runtimeModes: [...voice.runtimeModes] as RuntimeMode[],
      sample: null,
      backend: voice.backend,
      releaseGate: { ...voice.releaseGate },
      assetSetId: voice.assetSetId,
      declaredDownloadBytes: voice.declaredDownloadBytes,
      consentRequired: voice.consentRequired,
    };
  });

  return {
    kind: 'launch',
    catalogId: launch.catalogId,
    voices,
    engines: launch.engines.map((engine) => ({
      id: engine.id,
      name: engine.displayName,
      classification: engine.classification,
      runtimeModes: [...engine.runtimeModes] as RuntimeMode[],
      languageTags: [...engine.languageTags],
      licenseIds: [...engine.licenseIds],
      sourceIds: [...engine.sourceIds],
      backend: engine.backend,
      releaseGate: { ...engine.releaseGate },
      assetSetIds: [...engine.assetSetIds],
    })),
    licenses: new Map(
      launch.licenses.map((record) => [
        record.id,
        {
          id: record.id,
          name: record.name,
          scope: record.scope,
          url: record.evidenceUrl,
          attribution: record.attribution,
          redistribution: record.permitsRedistribution,
          commercialUse: record.permitsCommercialUse,
          terms: record.exactUpstreamTerms ?? null,
          reviewStatus: record.reviewStatus,
          ...(record.spdxId === undefined ? {} : { spdxId: record.spdxId }),
        },
      ]),
    ),
    sources: new Map(
      launch.sources.map((record) => [
        record.id,
        {
          id: record.id,
          url: record.canonicalUrl,
          sourceClass: record.sourceClass,
          lastVerifiedAt: record.lastVerifiedAt,
          health: record.health,
          revision: record.upstreamRevision,
          ...(record.contentHash === undefined ? {} : { contentHash: record.contentHash }),
        },
      ]),
    ),
    generatedAt: launch.generatedAt,
    assetSets: launch.assetSets.map((assetSet) => structuredClone(assetSet)),
    assetDeliveryEvidence: launch.assetDeliveryEvidence.map((record) => structuredClone(record)),
    releaseAssetEvidence: launch.releaseAssetEvidence.map((record) => structuredClone(record)),
    featureFlags: launch.featureFlags.map((record) => structuredClone(record)),
    galleries: launch.galleries.map((record) => structuredClone(record)),
    officialSamples: launch.samples.map((record) => structuredClone(record)),
    generationCandidates: launch.generationCandidates.map((record) => structuredClone(record)),
    generatedMedia: launch.generatedMedia.map((record) => structuredClone(record)),
  };
}

export const launchCatalogUrl = new URL(
  '../../../../packages/catalog/data/launch-catalog.public.json',
  import.meta.url,
).href;

function isContentAddressedLaunchCatalog(url: string): boolean {
  try {
    const pathname = new URL(url, 'https://open-voice.invalid').pathname;
    return /^\/assets\/launch-catalog\.public-[A-Za-z0-9_-]{6,}\.json$/.test(pathname);
  } catch {
    return false;
  }
}

async function cancelResponseBody(response: Response, reason?: unknown): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Cancellation is best effort; the original validation failure is authoritative.
  }
}

async function readExactCatalogBytes(response: Response): Promise<Uint8Array> {
  const expectedBytes = catalogIntegrity.bytes;
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes) {
      await cancelResponseBody(response, 'Unexpected launch catalog Content-Length.');
      throw new Error(
        `Launch catalog requires exactly ${expectedBytes} bytes; Content-Length was ${declaredLength}.`,
      );
    }
  }

  if (response.body === null) {
    throw new Error('Launch catalog response has no readable body.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : null;
      if (bytes === null) {
        throw new Error('Launch catalog stream produced a non-byte chunk.');
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > expectedBytes) {
        await reader.cancel('Launch catalog exceeded its exact byte limit.');
        throw new Error(
          `Launch catalog requires exactly ${expectedBytes} bytes; the stream overflowed.`,
        );
      }
      chunks.push(bytes);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the read or validation error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== expectedBytes) {
    throw new Error(
      `Launch catalog requires exactly ${expectedBytes} bytes; received ${totalBytes}.`,
    );
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function parseCatalogResponse(response: Response, url: string): Promise<SeedCatalog> {
  if (!response.ok) {
    throw new Error(`Launch catalog request failed with HTTP ${response.status}.`);
  }
  const baseUrl = globalThis.location?.href ?? 'https://open-voice.invalid/';
  if (
    response.redirected ||
    (response.url !== '' && new URL(response.url, baseUrl).href !== new URL(url, baseUrl).href)
  ) {
    throw new Error('Launch catalog response URL did not match the exact requested asset URL.');
  }
  if (!STRICT_JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Launch catalog response must use an application/json content type.');
  }
  try {
    const bytes = await readExactCatalogBytes(response);
    const digestInput = Uint8Array.from(bytes).buffer;
    const actualDigest = `sha256:${[
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput)),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
    if (actualDigest !== catalogIntegrity.sha256) {
      throw new Error(
        `Exact catalog integrity mismatch: expected ${catalogIntegrity.sha256}, received ${actualDigest}.`,
      );
    }
    return mapLaunchCatalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch (error) {
    throw new Error(
      `Launch catalog at ${url} failed exact-byte integrity, schema, or count validation.`,
      {
        cause: error,
      },
    );
  }
}

async function versionedCatalogCaches(url: string): Promise<Cache[]> {
  if (!isContentAddressedLaunchCatalog(url) || typeof globalThis.caches === 'undefined') {
    return [];
  }
  try {
    const names = (await globalThis.caches.keys())
      .filter((name) => name.startsWith(LAUNCH_CATALOG_CACHE_PREFIX))
      .sort((left, right) => right.localeCompare(left, 'en'));
    return await Promise.all(names.map((name) => globalThis.caches.open(name)));
  } catch {
    return [];
  }
}

async function loadLaunchCatalogFromUrl(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<SeedCatalog> {
  const caches = await versionedCatalogCaches(url);
  let networkError: unknown;
  try {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'omit' });
    return await parseCatalogResponse(response, url);
  } catch (error) {
    networkError = error;
  }

  for (const cache of caches) {
    try {
      const cached = await cache.match(url);
      if (cached !== undefined) {
        return await parseCatalogResponse(cached, url);
      }
    } catch {
      await cache.delete(url).catch(() => false);
    }
  }
  throw networkError;
}

/** Production entry point: the bundler owns the one immutable catalog URL. */
export async function loadLaunchCatalog(
  fetcher: typeof fetch = globalThis.fetch,
  ...forbiddenCustomUrl: never[]
): Promise<SeedCatalog> {
  if (forbiddenCustomUrl.length !== 0) {
    throw new Error('Production launch catalog loading is fixed to the built immutable URL.');
  }
  return loadLaunchCatalogFromUrl(launchCatalogUrl, fetcher);
}

/** Explicit fixture seam that cannot be reached through the production boot API. */
export function createTestOnlyLaunchCatalogLoader(
  url: string,
): (fetcher?: typeof fetch) => Promise<SeedCatalog> {
  return (fetcher = globalThis.fetch) => loadLaunchCatalogFromUrl(url, fetcher);
}
