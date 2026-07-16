import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computePocketInventoryReview,
  normalizePocketHubInfo,
  renderPocketMultilingualData,
  type PocketMultilingualInventory,
} from '../src/pocket-multilingual-import.js';
import {
  resolvePocketMultilingualInputPath,
  runPocketMultilingualCli,
  type PocketMultilingualCliDependencies,
} from '../src/pocket-multilingual-cli.js';

const repositoryId = 'kyutai/pocket-tts-without-voice-cloning';
const revision = 'e041936c75475d350b405bc870bcf7c22da4e9e6';
const selectors = [
  ['english', 'en'],
  ['english_2026-01', 'en'],
  ['english_2026-04', 'en'],
  ['french_24l', 'fr'],
  ['german', 'de'],
  ['german_24l', 'de'],
  ['italian', 'it'],
  ['italian_24l', 'it'],
  ['portuguese', 'pt'],
  ['portuguese_24l', 'pt'],
  ['spanish', 'es'],
  ['spanish_24l', 'es'],
] as const;
const labels = [
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

const embeddingPaths = selectors.flatMap(([selectorId]) =>
  labels.map((label) => `languages/${selectorId}/embeddings/${label}.safetensors`),
);

function hubInfo(paths: readonly string[] = embeddingPaths): {
  id: string;
  siblings: Array<{ rfilename: string }>;
} {
  return {
    id: repositoryId,
    siblings: [
      { rfilename: '.gitattributes' },
      { rfilename: 'README.md' },
      { rfilename: 'embeddings/alba.safetensors' },
      { rfilename: 'model.safetensors' },
      { rfilename: 'tokenizer.json' },
      ...paths.map((rfilename) => ({ rfilename })),
    ],
  };
}

function expectClosedFailure(input: unknown, requestedRevision: string, invariant: RegExp): void {
  let message = '';
  try {
    normalizePocketHubInfo(input, requestedRevision);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toMatch(invariant);
  expect(message).not.toContain('untrusted-marker');
}

function cliHarness(inventory: PocketMultilingualInventory): {
  dependencies: PocketMultilingualCliDependencies;
  resolutions: string[];
  reads: string[];
  writes: Array<{ destination: URL; contents: string }>;
  output: string[];
} {
  const resolutions: string[] = [];
  const reads: string[] = [];
  const writes: Array<{ destination: URL; contents: string }> = [];
  const output: string[] = [];
  return {
    dependencies: {
      currentInventory: inventory,
      resolveInputPath: (inputPath) => {
        resolutions.push(inputPath);
        return inputPath;
      },
      readTextFile: async (inputPath) => {
        reads.push(inputPath);
        return `\uFEFF${JSON.stringify(hubInfo())}`;
      },
      writeDataModule: async (destination, contents) => {
        writes.push({ destination, contents });
      },
      writeStdout: (text) => {
        output.push(text);
      },
    },
    resolutions,
    reads,
    writes,
    output,
  };
}

describe('reviewed Pocket multilingual Hub inventory import', () => {
  it('extracts exactly 312 immutable language-scoped embeddings', () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);

    expect(inventory.repositoryId).toBe(repositoryId);
    expect(inventory.revision).toBe(revision);
    expect(inventory.selectors).toEqual(
      selectors.map(([id, languageTag]) => ({ id, languageTag })),
    );
    expect(inventory.labels).toEqual(labels);
    expect(inventory.variants).toHaveLength(312);
    expect(inventory.variants.filter((variant) => variant.languageTag === 'en')).toHaveLength(78);
    expect(inventory.variants.filter((variant) => variant.languageTag === 'fr')).toHaveLength(26);
    expect(inventory.variants.filter((variant) => variant.languageTag === 'de')).toHaveLength(52);
    expect(inventory.variants.filter((variant) => variant.languageTag === 'it')).toHaveLength(52);
    expect(inventory.variants.filter((variant) => variant.languageTag === 'pt')).toHaveLength(52);
    expect(inventory.variants.filter((variant) => variant.languageTag === 'es')).toHaveLength(52);
    expect(
      inventory.variants.every(
        (variant) => variant.countryCode === null && variant.gender === 'unspecified',
      ),
    ).toBe(true);
    expect(inventory.variants[0]).toEqual({
      selectorId: 'english',
      label: 'alba',
      languageTag: 'en',
      upstreamPath: 'languages/english/embeddings/alba.safetensors',
      countryCode: null,
      gender: 'unspecified',
    });
    expect(inventory.variants.at(-1)?.upstreamPath).toBe(
      'languages/spanish_24l/embeddings/vera.safetensors',
    );
  });

  it('sorts source permutations identically and hashes a domain-separated canonical payload', () => {
    const ascending = normalizePocketHubInfo(hubInfo(), revision);
    const descending = normalizePocketHubInfo(hubInfo([...embeddingPaths].reverse()), revision);
    const expectedHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          domain: 'open-voice/pocket-multilingual-inventory/v1',
          repositoryId,
          revision,
          variants: ascending.variants,
        }),
        'utf8',
      )
      .digest('hex')}`;

    expect(descending).toEqual(ascending);
    expect(ascending.inventorySha256).toBe(expectedHash);
    expect(ascending.inventorySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    {
      name: 'a wrong repository ID',
      input: { ...hubInfo(), id: 'untrusted-marker' },
      requestedRevision: revision,
      invariant: /repository invariant/i,
    },
    {
      name: 'a floating revision',
      input: hubInfo(),
      requestedRevision: 'main',
      invariant: /revision invariant/i,
    },
    {
      name: 'one missing path',
      input: hubInfo(embeddingPaths.slice(1)),
      requestedRevision: revision,
      invariant: /Cartesian closure invariant/i,
    },
    {
      name: 'a duplicate path',
      input: hubInfo([...embeddingPaths, embeddingPaths[0]!]),
      requestedRevision: revision,
      invariant: /uniqueness invariant/i,
    },
    {
      name: 'an unknown label',
      input: hubInfo([
        ...embeddingPaths.slice(1),
        'languages/english/embeddings/untrusted-marker.safetensors',
      ]),
      requestedRevision: revision,
      invariant: /label closure invariant/i,
    },
    {
      name: 'an unknown selector',
      input: hubInfo([
        ...embeddingPaths.slice(1),
        'languages/untrusted-marker/embeddings/alba.safetensors',
      ]),
      requestedRevision: revision,
      invariant: /selector closure invariant/i,
    },
    {
      name: 'a traversal path',
      input: hubInfo([...embeddingPaths, '../untrusted-marker.safetensors']),
      requestedRevision: revision,
      invariant: /path safety invariant/i,
    },
    {
      name: 'a backslash path',
      input: hubInfo([...embeddingPaths, 'languages\\untrusted-marker']),
      requestedRevision: revision,
      invariant: /path safety invariant/i,
    },
    {
      name: 'a non-safetensors embedding record',
      input: hubInfo([
        ...embeddingPaths.slice(1),
        'languages/english/embeddings/untrusted-marker.json',
      ]),
      requestedRevision: revision,
      invariant: /embedding file invariant/i,
    },
  ])('rejects $name with a closed invariant error', ({ input, requestedRevision, invariant }) => {
    expectClosedFailure(input, requestedRevision, invariant);
  });

  it('rejects malformed Hub envelopes and sibling records without coercion', () => {
    expectClosedFailure([], revision, /Hub info invariant/i);
    expectClosedFailure(
      { id: repositoryId, siblings: 'untrusted-marker' },
      revision,
      /siblings invariant/i,
    );
    expectClosedFailure(
      { id: repositoryId, siblings: [{ rfilename: 42 }] },
      revision,
      /sibling record invariant/i,
    );
  });

  it('computes review counts and deterministic path-level differences', () => {
    const candidate = normalizePocketHubInfo(hubInfo(), revision);
    const current = structuredClone(candidate) as PocketMultilingualInventory;
    const missing = current.variants.shift()!;
    current.variants[0] = { ...current.variants[0]!, languageTag: 'fr' };
    current.variants.push({
      selectorId: 'english',
      label: 'legacy',
      languageTag: 'en',
      upstreamPath: 'languages/english/embeddings/legacy.safetensors',
      countryCode: null,
      gender: 'unspecified',
    });

    expect(computePocketInventoryReview(candidate, candidate)).toEqual({
      inventorySha256: candidate.inventorySha256,
      selectorCount: 12,
      labelCount: 26,
      variantCount: 312,
      added: [],
      removed: [],
      changed: [],
    });
    expect(computePocketInventoryReview(current, candidate)).toMatchObject({
      inventorySha256: candidate.inventorySha256,
      selectorCount: 12,
      labelCount: 26,
      variantCount: 312,
      added: [missing.upstreamPath],
      removed: ['languages/english/embeddings/legacy.safetensors'],
      changed: ['languages/english/embeddings/anna.safetensors'],
    });
  });

  it('renders only the four reviewed constants byte-identically', () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const rendered = renderPocketMultilingualData(inventory);

    expect(renderPocketMultilingualData(inventory)).toBe(rendered);
    expect(rendered.match(/export const /g)).toHaveLength(4);
    expect(rendered).toContain('POCKET_MULTILINGUAL_REVISION');
    expect(rendered).toContain('POCKET_MULTILINGUAL_INVENTORY_SHA256');
    expect(rendered).toContain('POCKET_MULTILINGUAL_SELECTORS');
    expect(rendered).toContain('POCKET_MULTILINGUAL_LABELS');
    expect(rendered).not.toMatch(/variants|repositoryId|safetensors/);
    expect(rendered.endsWith('\n')).toBe(true);
  });

  it('keeps the checked-in generated module byte-identical to the reviewed inventory', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const dataUrl = new URL('../src/pocket-multilingual-data.ts', import.meta.url);

    expect(await readFile(dataUrl, 'utf8')).toBe(renderPocketMultilingualData(inventory));
  });

  it('reviews a BOM-prefixed local JSON capture without writing', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const harness = cliHarness(inventory);

    await runPocketMultilingualCli(
      ['--input', 'review/pinned-siblings.json', '--revision', revision],
      harness.dependencies,
    );

    expect(harness.reads).toEqual(['review/pinned-siblings.json']);
    expect(harness.writes).toEqual([]);
    expect(JSON.parse(harness.output.join(''))).toEqual({
      inventorySha256: inventory.inventorySha256,
      selectorCount: 12,
      labelCount: 26,
      variantCount: 312,
      languageCounts: { en: 78, fr: 26, de: 52, it: 52, pt: 52, es: 52 },
      added: [],
      removed: [],
      changed: [],
    });
  });

  it('refuses a write until the exact candidate hash is approved', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);

    for (const approval of [undefined, 'sha256:untrusted-marker']) {
      const harness = cliHarness(inventory);
      const args = ['--input', 'pinned.json', '--revision', revision, '--write'];
      if (approval !== undefined) {
        args.push('--approve-hash', approval);
      }
      await expect(runPocketMultilingualCli(args, harness.dependencies)).rejects.toThrow(
        /approval hash invariant/i,
      );
      expect(harness.writes).toEqual([]);
    }
  });

  it('writes only the generated data module after exact hash approval', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const harness = cliHarness(inventory);

    await runPocketMultilingualCli(
      [
        '--input',
        'pinned.json',
        '--revision',
        revision,
        '--write',
        '--approve-hash',
        inventory.inventorySha256,
      ],
      harness.dependencies,
    );

    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]!.destination.href).toBe(
      new URL('../src/pocket-multilingual-data.ts', import.meta.url).href,
    );
    expect(harness.writes[0]!.contents).toBe(renderPocketMultilingualData(inventory));
    expect(harness.output.join('')).toContain(inventory.inventorySha256);
  });

  it('accepts only a local input flag surface and closed JSON', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const remoteHarness = cliHarness(inventory);
    await expect(
      runPocketMultilingualCli(
        ['--input', 'https://example.invalid/untrusted-marker.json', '--revision', revision],
        remoteHarness.dependencies,
      ),
    ).rejects.toThrow(/local input invariant/i);
    expect(remoteHarness.reads).toEqual([]);

    const unknownHarness = cliHarness(inventory);
    await expect(
      runPocketMultilingualCli(
        ['--input', 'pinned.json', '--revision', revision, '--output', 'untrusted-marker'],
        unknownHarness.dependencies,
      ),
    ).rejects.toThrow(/argument invariant/i);
    expect(unknownHarness.reads).toEqual([]);

    const doubleBomHarness = cliHarness(inventory);
    doubleBomHarness.dependencies.readTextFile = async () =>
      `\uFEFF\uFEFF${JSON.stringify(hubInfo())}`;
    await expect(
      runPocketMultilingualCli(
        ['--input', 'pinned.json', '--revision', revision],
        doubleBomHarness.dependencies,
      ),
    ).rejects.toThrow(/input JSON invariant/i);
  });

  it.each([
    ['forward-slash UNC', '//untrusted-marker/share/pinned.json'],
    ['backslash UNC', '\\\\untrusted-marker\\share\\pinned.json'],
    ['forward-slash extended namespace', '//?/C:/review/untrusted-marker.json'],
    ['backslash extended namespace', '\\\\?\\C:\\review\\untrusted-marker.json'],
    ['forward-slash device namespace', '//./pipe/untrusted-marker.json'],
    ['backslash device namespace', '\\\\.\\pipe\\untrusted-marker.json'],
    ['drive-relative path', 'C:review\\untrusted-marker.json'],
  ])('rejects a %s before resolving or reading', async (_name, inputPath) => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const harness = cliHarness(inventory);
    let message = '';

    try {
      await runPocketMultilingualCli(
        ['--input', inputPath, '--revision', revision],
        harness.dependencies,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/local input invariant/i);
    expect(message).not.toContain('untrusted-marker');
    expect(harness.resolutions).toEqual([]);
    expect(harness.reads).toEqual([]);
  });

  it('rejects a relative input under a forward-slash UNC npm cwd before reading', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const harness = cliHarness(inventory);
    harness.dependencies.resolveInputPath = (inputPath) =>
      resolvePocketMultilingualInputPath(
        inputPath,
        '//untrusted-marker/share/repository',
        'C:\\repository\\packages\\catalog',
      );
    let message = '';

    try {
      await runPocketMultilingualCli(
        ['--input', 'review/pinned.json', '--revision', revision],
        harness.dependencies,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/local input invariant/i);
    expect(message).not.toContain('untrusted-marker');
    expect(harness.reads).toEqual([]);
  });

  it.each([
    ['drive-absolute backslashes', 'C:\\review\\pinned.json'],
    ['drive-absolute forward slashes', 'C:/review/pinned.json'],
    ['dot-relative forward slashes', '.superpowers/sdd/pinned.json'],
    ['relative backslashes', 'review\\pinned.json'],
    ['root-relative forward slashes', '/review/pinned.json'],
  ])('accepts a normal local %s', async (_name, inputPath) => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const harness = cliHarness(inventory);
    const invocationRoot = 'C:\\repository';
    const workspaceDirectory = 'C:\\repository\\packages\\catalog';
    const expected = resolvePocketMultilingualInputPath(
      inputPath,
      invocationRoot,
      workspaceDirectory,
    );
    harness.dependencies.resolveInputPath = (value) =>
      resolvePocketMultilingualInputPath(value, invocationRoot, workspaceDirectory);

    await runPocketMultilingualCli(
      ['--input', inputPath, '--revision', revision],
      harness.dependencies,
    );

    expect(harness.reads).toEqual([expected]);
  });

  it('resolves root-script inputs from npm original cwd instead of the workspace cwd', () => {
    const invocationRoot = resolve('review-root');
    const workspaceDirectory = resolve(invocationRoot, 'packages/catalog');

    expect(
      resolvePocketMultilingualInputPath(
        '.superpowers/sdd/pinned.json',
        invocationRoot,
        workspaceDirectory,
      ),
    ).toBe(resolve(invocationRoot, '.superpowers/sdd/pinned.json'));
    expect(
      resolvePocketMultilingualInputPath(
        '.superpowers/sdd/pinned.json',
        undefined,
        workspaceDirectory,
      ),
    ).toBe(resolve(workspaceDirectory, '.superpowers/sdd/pinned.json'));
  });

  it('closes local read failures without echoing the supplied path or filesystem error', async () => {
    const inventory = normalizePocketHubInfo(hubInfo(), revision);
    const harness = cliHarness(inventory);
    harness.dependencies.readTextFile = async () => {
      throw new Error('untrusted-marker filesystem detail');
    };

    let message = '';
    try {
      await runPocketMultilingualCli(
        ['--input', 'untrusted-marker.json', '--revision', revision],
        harness.dependencies,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/local input read invariant/i);
    expect(message).not.toContain('untrusted-marker');
  });
});
