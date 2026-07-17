import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPERTONIC_ASSET_SET_ID,
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
} from '@open-voice/contracts';
import {
  SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES,
  SUPERTONIC_BROWSER_EVIDENCE_LEDGER_KIND,
  SupertonicBrowserEvidenceLedgerSchema,
  type SupertonicBrowserEvidenceLedger,
} from '@open-voice/contracts/supertonic-browser-evidence';
import { z } from 'zod';

import {
  buildLaunchCatalog,
  stableStringifyLaunchCatalog,
  validateLaunchCatalogForRelease,
  type LaunchCatalogManifest,
} from './launch.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPaths = {
  outputPath: resolve(packageRoot, 'data', 'supertonic-browser-evidence.public.json'),
  integrityPath: resolve(packageRoot, 'data', 'supertonic-browser-evidence.integrity.json'),
} as const;

const IntegrityRecordSchema = z
  .object({
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().safe(),
  })
  .strict();

export type SupertonicBrowserEvidencePaths = {
  outputPath: string;
  integrityPath: string;
};

export class SupertonicBrowserEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupertonicBrowserEvidenceValidationError';
  }
}

function sha256(bytes: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

function schemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'ledger'}: ${issue.message}`)
    .join('; ');
}

function requireInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SupertonicBrowserEvidenceValidationError(message);
}

function validateFrozenCatalogClosure(catalog: LaunchCatalogManifest): void {
  const assetSets = catalog.assetSets.filter(({ id }) => id === SUPERTONIC_ASSET_SET_ID);
  requireInvariant(
    assetSets.length === 1 && assetSets[0]!.manifestDigest === SUPERTONIC_MANIFEST_DIGEST,
    'Supertonic browser evidence requires the exact frozen asset-set manifest',
  );

  for (const backend of ['webgpu', 'wasm'] as const) {
    const identity = SUPERTONIC_RUNTIME_IDENTITIES[backend];
    const selections = catalog.runtimeSelections.filter(({ id }) => id === identity.selectionId);
    requireInvariant(
      selections.length === 1 &&
        selections[0]!.engineId === 'supertonic' &&
        selections[0]!.backend === backend &&
        selections[0]!.assetSetId === SUPERTONIC_ASSET_SET_ID &&
        selections[0]!.selectionDigest === identity.selectionDigest,
      `Supertonic browser evidence requires the exact ${backend} runtime selection`,
    );
  }
}

export function buildDisabledSupertonicBrowserEvidence(
  inputCatalog: LaunchCatalogManifest = buildLaunchCatalog(),
): SupertonicBrowserEvidenceLedger {
  validateLaunchCatalogForRelease(inputCatalog);
  validateFrozenCatalogClosure(inputCatalog);
  const catalogSha256 = sha256(stableStringifyLaunchCatalog(inputCatalog));
  const parsed = SupertonicBrowserEvidenceLedgerSchema.safeParse({
    schemaVersion: 1,
    kind: SUPERTONIC_BROWSER_EVIDENCE_LEDGER_KIND,
    engineId: 'supertonic',
    operationalStatus: 'disabled',
    catalogSha256,
    assetSetId: SUPERTONIC_ASSET_SET_ID,
    manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
    tuples: SUPERTONIC_BROWSER_EVIDENCE_INITIAL_TUPLES,
  });
  if (!parsed.success) {
    throw new SupertonicBrowserEvidenceValidationError(
      `Canonical Supertonic browser evidence schema failed: ${schemaIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function stableStringifySupertonicBrowserEvidence(
  ledger: SupertonicBrowserEvidenceLedger,
): string {
  const parsed = SupertonicBrowserEvidenceLedgerSchema.parse(ledger);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function validateSupertonicBrowserEvidence(
  input: unknown,
  inputCatalog: LaunchCatalogManifest = buildLaunchCatalog(),
): SupertonicBrowserEvidenceLedger {
  const parsed = SupertonicBrowserEvidenceLedgerSchema.safeParse(input);
  if (!parsed.success) {
    throw new SupertonicBrowserEvidenceValidationError(
      `Supertonic browser evidence schema failed: ${schemaIssues(parsed.error)}`,
    );
  }

  const expected = buildDisabledSupertonicBrowserEvidence(inputCatalog);
  if (
    stableStringifySupertonicBrowserEvidence(parsed.data) !==
    stableStringifySupertonicBrowserEvidence(expected)
  ) {
    throw new SupertonicBrowserEvidenceValidationError(
      'Supertonic browser evidence differs from the canonical disabled catalog binding',
    );
  }
  return parsed.data;
}

function integrityRecord(ledgerBytes: string): string {
  return `${JSON.stringify(
    {
      sha256: sha256(ledgerBytes),
      bytes: Buffer.byteLength(ledgerBytes, 'utf8'),
    },
    null,
    2,
  )}\n`;
}

function parseJson(bytes: string, label: string): unknown {
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new SupertonicBrowserEvidenceValidationError(`Unable to parse ${label} JSON`);
  }
}

export async function generateSupertonicBrowserEvidence(
  mode: 'write' | 'check',
  paths: SupertonicBrowserEvidencePaths = defaultPaths,
): Promise<void> {
  const ledger = buildDisabledSupertonicBrowserEvidence();
  validateSupertonicBrowserEvidence(ledger);
  const expected = stableStringifySupertonicBrowserEvidence(ledger);
  const expectedIntegrity = integrityRecord(expected);

  if (mode === 'write') {
    await Promise.all([
      writeFile(paths.outputPath, expected, 'utf8'),
      writeFile(paths.integrityPath, expectedIntegrity, 'utf8'),
    ]);
    return;
  }

  const [actual, actualIntegrity] = await Promise.all([
    readFile(paths.outputPath, 'utf8'),
    readFile(paths.integrityPath, 'utf8'),
  ]);
  validateSupertonicBrowserEvidence(parseJson(actual, 'evidence ledger'));
  const parsedIntegrity = IntegrityRecordSchema.safeParse(
    parseJson(actualIntegrity, 'evidence integrity'),
  );
  if (!parsedIntegrity.success) {
    throw new SupertonicBrowserEvidenceValidationError(
      `Supertonic browser evidence integrity schema failed: ${schemaIssues(parsedIntegrity.error)}`,
    );
  }
  if (actual !== expected || actualIntegrity !== expectedIntegrity) {
    throw new SupertonicBrowserEvidenceValidationError(
      'Supertonic browser evidence or integrity drifted from canonical bytes',
    );
  }
}

export function parseSupertonicBrowserEvidenceCliMode(
  arguments_: readonly string[],
): 'write' | 'check' {
  if (arguments_.length !== 1 || (arguments_[0] !== '--write' && arguments_[0] !== '--check')) {
    throw new SupertonicBrowserEvidenceValidationError(
      'Expected exactly one Supertonic browser evidence mode: --write or --check',
    );
  }
  return arguments_[0] === '--write' ? 'write' : 'check';
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = parseSupertonicBrowserEvidenceCliMode(process.argv.slice(2));
  await generateSupertonicBrowserEvidence(mode);
  process.stdout.write(
    mode === 'write'
      ? `Wrote ${defaultPaths.outputPath} and ${defaultPaths.integrityPath}\n`
      : `Supertonic browser evidence and integrity are deterministic: ${defaultPaths.outputPath}\n`,
  );
}
