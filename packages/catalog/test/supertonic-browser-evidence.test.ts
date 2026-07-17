import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildLaunchCatalog, stableStringifyLaunchCatalog } from '../src/launch.js';
import {
  buildDisabledSupertonicBrowserEvidence,
  generateSupertonicBrowserEvidence,
  parseSupertonicBrowserEvidenceCliMode,
  stableStringifySupertonicBrowserEvidence,
  validateSupertonicBrowserEvidence,
} from '../src/supertonic-browser-evidence.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(packageRoot, 'data', 'supertonic-browser-evidence.public.json');
const integrityPath = join(packageRoot, 'data', 'supertonic-browser-evidence.integrity.json');
const temporaryDirectories: string[] = [];

async function temporaryEvidencePaths(): Promise<{
  directory: string;
  outputPath: string;
  integrityPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'open-voice-supertonic-evidence-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    outputPath: join(directory, 'evidence.json'),
    integrityPath: join(directory, 'integrity.json'),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('deterministic Supertonic browser evidence ledger', () => {
  it('requires one exact, unambiguous CLI mode', () => {
    expect(parseSupertonicBrowserEvidenceCliMode(['--write'])).toBe('write');
    expect(parseSupertonicBrowserEvidenceCliMode(['--check'])).toBe('check');

    for (const arguments_ of [
      [],
      ['--unknown'],
      ['--check', '--write'],
      ['--write', '--check'],
      ['--check', 'extra'],
    ]) {
      expect(() => parseSupertonicBrowserEvidenceCliMode(arguments_), arguments_.join(' ')).toThrow(
        /exactly one|--write|--check/i,
      );
    }
  });

  it('builds exactly four disabled, not-run tuples bound to the current frozen catalog', () => {
    const ledger = buildDisabledSupertonicBrowserEvidence();
    const catalogBytes = stableStringifyLaunchCatalog(buildLaunchCatalog());

    expect(ledger.operationalStatus).toBe('disabled');
    expect(ledger.catalogSha256).toBe(
      `sha256:${createHash('sha256').update(catalogBytes, 'utf8').digest('hex')}`,
    );
    expect(ledger.assetSetId).toBe('supertonic-browser-assets');
    expect(ledger.manifestDigest).toBe(
      'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
    );
    expect(ledger.tuples.map(({ tupleId }) => tupleId)).toEqual([
      'chrome-webgpu',
      'chrome-wasm',
      'edge-webgpu',
      'edge-wasm',
    ]);
    expect(ledger.tuples.every(({ qualification }) => qualification.status === 'not-run')).toBe(
      true,
    );
    expect(stableStringifySupertonicBrowserEvidence(ledger)).toBe(
      `${JSON.stringify(ledger, null, 2)}\n`,
    );
  });

  it('matches the checked-in canonical bytes and exact integrity sidecar', async () => {
    const expected = stableStringifySupertonicBrowserEvidence(
      buildDisabledSupertonicBrowserEvidence(),
    );
    const [actual, integrityBytes] = await Promise.all([
      readFile(ledgerPath, 'utf8'),
      readFile(integrityPath, 'utf8'),
    ]);

    expect(actual).toBe(expected);
    expect(JSON.parse(integrityBytes)).toEqual({
      sha256: `sha256:${createHash('sha256').update(expected, 'utf8').digest('hex')}`,
      bytes: Buffer.byteLength(expected, 'utf8'),
    });
    await expect(generateSupertonicBrowserEvidence('check')).resolves.toBeUndefined();
  });

  it('rejects semantic ledger, launch-catalog, and frozen-selection drift', () => {
    const canonical = buildDisabledSupertonicBrowserEvidence();
    const wrongCatalogDigest = structuredClone(canonical);
    wrongCatalogDigest.catalogSha256 = `sha256:${'0'.repeat(64)}`;
    expect(() => validateSupertonicBrowserEvidence(wrongCatalogDigest)).toThrow(/catalog/i);

    const wrongTuple = structuredClone(canonical);
    Object.assign(wrongTuple.tuples[0], {
      selectionId: 'supertonic-wasm',
      selectionDigest: wrongTuple.tuples[1].selectionDigest,
    });
    expect(() => validateSupertonicBrowserEvidence(wrongTuple)).toThrow(/schema|canonical/i);

    const changedCatalog = structuredClone(buildLaunchCatalog());
    changedCatalog.runtimeSelections.find(({ id }) => id === 'supertonic-webgpu')!.selectionDigest =
      `sha256:${'0'.repeat(64)}`;
    expect(() => validateSupertonicBrowserEvidence(canonical, changedCatalog)).toThrow(
      /catalog|runtime selection/i,
    );
  });

  it('fails check mode on missing, malformed, noncanonical, or sidecar-drifted files', async () => {
    const paths = await temporaryEvidencePaths();
    await expect(generateSupertonicBrowserEvidence('check', paths)).rejects.toThrow();

    await writeFile(paths.outputPath, '{', 'utf8');
    await writeFile(paths.integrityPath, '{}\n', 'utf8');
    await expect(generateSupertonicBrowserEvidence('check', paths)).rejects.toThrow(/parse|json/i);

    const ledger = buildDisabledSupertonicBrowserEvidence();
    const canonical = stableStringifySupertonicBrowserEvidence(ledger);
    await writeFile(paths.outputPath, JSON.stringify(ledger), 'utf8');
    await writeFile(
      paths.integrityPath,
      `${JSON.stringify({
        sha256: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
        bytes: Buffer.byteLength(canonical, 'utf8'),
      })}\n`,
      'utf8',
    );
    await expect(generateSupertonicBrowserEvidence('check', paths)).rejects.toThrow(
      /canonical|drift/i,
    );

    await generateSupertonicBrowserEvidence('write', paths);
    await writeFile(
      paths.integrityPath,
      `${JSON.stringify({ sha256: `sha256:${'f'.repeat(64)}`, bytes: 1, extra: true }, null, 2)}\n`,
      'utf8',
    );
    await expect(generateSupertonicBrowserEvidence('check', paths)).rejects.toThrow(
      /integrity|drift|schema/i,
    );
  });

  it('writes only canonical validated bytes and contains no transient secrets or machine paths', async () => {
    const paths = await temporaryEvidencePaths();
    await generateSupertonicBrowserEvidence('write', paths);
    const [ledgerBytes, integrityBytes] = await Promise.all([
      readFile(paths.outputPath, 'utf8'),
      readFile(paths.integrityPath, 'utf8'),
    ]);

    expect(ledgerBytes).toBe(
      stableStringifySupertonicBrowserEvidence(buildDisabledSupertonicBrowserEvidence()),
    );
    expect(integrityBytes.endsWith('\n')).toBe(true);
    for (const forbidden of [
      'X-Amz-',
      'finalUrl',
      'credential',
      'secret',
      '.har',
      'F:\\',
      'C:\\',
      '/home/',
    ]) {
      expect(ledgerBytes, forbidden).not.toContain(forbidden);
    }

    const launchBytes = stableStringifyLaunchCatalog(buildLaunchCatalog());
    const evidenceSha256 = createHash('sha256').update(ledgerBytes, 'utf8').digest('hex');
    expect(launchBytes).not.toContain('supertonic-browser-evidence');
    expect(launchBytes).not.toContain(evidenceSha256);
  });
});
