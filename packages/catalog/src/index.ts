import { readFile } from 'node:fs/promises';

import {
  EngineManifestSchema,
  LicenseRecordSchema,
  RUNTIME_MODES,
  SampleManifestSchema,
  SourceRecordSchema,
  VoicePresetSchema,
  type RuntimeMode,
} from '@open-voice/contracts';
import { z } from 'zod';

export const CatalogManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogId: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase catalog slug'),
    generatedAt: z.string().datetime({ offset: true }),
    engines: z.array(EngineManifestSchema).min(1),
    voices: z.array(VoicePresetSchema).min(1),
    samples: z.array(SampleManifestSchema),
    licenses: z.array(LicenseRecordSchema).min(1),
    sources: z.array(SourceRecordSchema).min(1),
  })
  .strict();

export type CatalogManifest = z.infer<typeof CatalogManifestSchema>;

export type CatalogCounts = {
  totalVoices: number;
  runnableVoices: number;
  listenOnlyVoices: number;
  samples: number;
  byRuntime: Record<RuntimeMode, number>;
};

export type ValidatedCatalog = {
  manifest: CatalogManifest;
  counts: CatalogCounts;
};

export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogValidationError';
  }
}

function compareIds(left: { id: string }, right: { id: string }): number {
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

export function sortCatalogManifest(manifest: CatalogManifest): CatalogManifest {
  return {
    ...manifest,
    engines: [...manifest.engines].sort(compareIds),
    voices: [...manifest.voices].sort(compareIds),
    samples: [...manifest.samples].sort(compareIds),
    licenses: [...manifest.licenses].sort(compareIds),
    sources: [...manifest.sources].sort(compareIds),
  };
}

export function countCatalog(manifest: CatalogManifest): CatalogCounts {
  const byRuntime: Record<RuntimeMode, number> = {
    browser: 0,
    online: 0,
    companion: 0,
    'sample-only': 0,
  };
  let runnableVoices = 0;
  let listenOnlyVoices = 0;

  for (const voice of manifest.voices) {
    for (const mode of voice.runtimeModes) {
      byRuntime[mode] += 1;
    }
    if (voice.runtimeModes.includes('sample-only')) {
      listenOnlyVoices += 1;
    } else {
      runnableVoices += 1;
    }
  }

  return {
    totalVoices: manifest.voices.length,
    runnableVoices,
    listenOnlyVoices,
    samples: manifest.samples.length,
    byRuntime,
  };
}

function assertUniqueIds(
  records: ReadonlyArray<{ id: string }>,
  recordName: 'engine' | 'voice' | 'sample' | 'license' | 'source',
): void {
  const seenIds = new Set<string>();
  for (const record of records) {
    if (seenIds.has(record.id)) {
      throw new CatalogValidationError(`Duplicate ${recordName} ID: ${record.id}`);
    }
    seenIds.add(record.id);
  }
}

function requireReferences(
  owner: string,
  referenceType: 'license' | 'source',
  referenceIds: readonly string[],
  availableIds: ReadonlySet<string>,
): void {
  for (const referenceId of referenceIds) {
    if (!availableIds.has(referenceId)) {
      throw new CatalogValidationError(
        `${owner} references missing ${referenceType}: ${referenceId}`,
      );
    }
  }
}

function requireLicenseScope(
  owner: string,
  referenceIds: readonly string[],
  licensesById: ReadonlyMap<string, CatalogManifest['licenses'][number]>,
  requiredScope: CatalogManifest['licenses'][number]['scope'],
): void {
  const hasRequiredScope = referenceIds.some(
    (referenceId) => licensesById.get(referenceId)?.scope === requiredScope,
  );
  if (!hasRequiredScope) {
    throw new CatalogValidationError(`${owner} requires ${requiredScope} license evidence`);
  }
}

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
    .join('; ');
}

export function validateCatalogForRelease(input: unknown): ValidatedCatalog {
  const parsed = CatalogManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new CatalogValidationError(
      `Catalog schema validation failed: ${formatSchemaIssues(parsed.error)}`,
    );
  }

  const manifest = parsed.data;
  assertUniqueIds(manifest.engines, 'engine');
  assertUniqueIds(manifest.voices, 'voice');
  assertUniqueIds(manifest.samples, 'sample');
  assertUniqueIds(manifest.licenses, 'license');
  assertUniqueIds(manifest.sources, 'source');

  const enginesById = new Map(manifest.engines.map((engine) => [engine.id, engine]));
  const voicesById = new Map(manifest.voices.map((voice) => [voice.id, voice]));
  const licensesById = new Map(manifest.licenses.map((license) => [license.id, license]));
  const licenseIds = new Set(manifest.licenses.map((license) => license.id));
  const sourceIds = new Set(manifest.sources.map((source) => source.id));

  for (const license of manifest.licenses) {
    if (license.reviewStatus === 'needs-review') {
      throw new CatalogValidationError(`License evidence needs review: ${license.id}`);
    }
  }

  for (const engine of manifest.engines) {
    requireReferences(`Engine ${engine.id}`, 'license', engine.licenseIds, licenseIds);
    requireReferences(`Engine ${engine.id}`, 'source', engine.sourceIds, sourceIds);
    requireLicenseScope(`Engine ${engine.id}`, engine.licenseIds, licensesById, 'code');
    if (engine.classification === 'open-weight-local') {
      requireLicenseScope(`Engine ${engine.id}`, engine.licenseIds, licensesById, 'weights');
    }
  }

  for (const voice of manifest.voices) {
    const engine = enginesById.get(voice.engineId);
    if (engine === undefined) {
      throw new CatalogValidationError(
        `Voice ${voice.id} references missing engine: ${voice.engineId}`,
      );
    }
    for (const mode of voice.runtimeModes) {
      if (!engine.runtimeModes.includes(mode)) {
        throw new CatalogValidationError(
          `Voice ${voice.id} uses runtime mode absent from engine ${engine.id}: ${mode}`,
        );
      }
    }
    requireReferences(`Voice ${voice.id}`, 'license', voice.licenseIds, licenseIds);
    requireReferences(`Voice ${voice.id}`, 'source', voice.sourceIds, sourceIds);
    requireLicenseScope(`Voice ${voice.id}`, voice.licenseIds, licensesById, 'voice');
  }

  for (const sample of manifest.samples) {
    if (!enginesById.has(sample.engineId)) {
      throw new CatalogValidationError(
        `Sample ${sample.id} references missing engine: ${sample.engineId}`,
      );
    }
    if (sample.voiceId !== undefined && !voicesById.has(sample.voiceId)) {
      throw new CatalogValidationError(
        `Sample ${sample.id} references missing voice: ${sample.voiceId}`,
      );
    }
    requireReferences(`Sample ${sample.id}`, 'license', [sample.licenseId], licenseIds);
    requireReferences(`Sample ${sample.id}`, 'source', [sample.sourceId], sourceIds);
    requireLicenseScope(`Sample ${sample.id}`, [sample.licenseId], licensesById, 'sample');
  }

  const voicesWithSamples = new Set(
    manifest.samples.flatMap((sample) => (sample.voiceId === undefined ? [] : [sample.voiceId])),
  );
  for (const voice of manifest.voices) {
    if (voice.runtimeModes.includes('sample-only') && !voicesWithSamples.has(voice.id)) {
      throw new CatalogValidationError(`Listen-only voice has no official sample: ${voice.id}`);
    }
  }

  const counts = countCatalog(manifest);
  if (counts.runnableVoices === 0) {
    throw new CatalogValidationError('Release catalog must contain at least one runnable voice');
  }

  return {
    manifest: sortCatalogManifest(manifest),
    counts,
  };
}

export async function loadCatalog(path: string): Promise<ValidatedCatalog> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CatalogValidationError(`Unable to read catalog ${path}: ${reason}`);
  }

  return validateCatalogForRelease(decoded);
}

export { RUNTIME_MODES };
