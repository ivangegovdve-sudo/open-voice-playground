import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  POCKET_MULTILINGUAL_INVENTORY_SHA256,
  POCKET_MULTILINGUAL_LABELS,
  POCKET_MULTILINGUAL_REVISION,
  POCKET_MULTILINGUAL_SELECTORS,
} from './pocket-multilingual-data.js';
import {
  computePocketInventoryReview,
  normalizePocketHubInfo,
  renderPocketMultilingualData,
  type PocketMultilingualInventory,
} from './pocket-multilingual-import.js';

const DATA_MODULE_URL = new URL('./pocket-multilingual-data.ts', import.meta.url);

export type PocketMultilingualCliDependencies = {
  currentInventory: PocketMultilingualInventory;
  resolveInputPath(inputPath: string): string;
  readTextFile(inputPath: string): Promise<string>;
  writeDataModule(destination: URL, contents: string): Promise<void>;
  writeStdout(text: string): void;
};

type ParsedArguments = {
  input: string;
  revision: string;
  write: boolean;
  approveHash: string | undefined;
};

function assertLocalFilesystemPath(path: string): void {
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) ||
    /^[\\/]{2}/.test(path) ||
    /^[A-Za-z]:(?![\\/])/.test(path)
  ) {
    throw new Error('Pocket CLI local input invariant failed.');
  }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--write') {
      if (write) {
        throw new Error('Pocket CLI argument invariant failed.');
      }
      write = true;
      continue;
    }
    if (token !== '--input' && token !== '--revision' && token !== '--approve-hash') {
      throw new Error('Pocket CLI argument invariant failed.');
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--') || values.has(token)) {
      throw new Error('Pocket CLI argument invariant failed.');
    }
    values.set(token, value);
    index += 1;
  }

  const input = values.get('--input');
  const revision = values.get('--revision');
  const approveHash = values.get('--approve-hash');
  if (input === undefined || revision === undefined || (!write && approveHash !== undefined)) {
    throw new Error('Pocket CLI argument invariant failed.');
  }
  assertLocalFilesystemPath(input);
  if (!input.toLowerCase().endsWith('.json')) {
    throw new Error('Pocket CLI local input invariant failed.');
  }
  return { input, revision, write, approveHash };
}

function inventoryFromGeneratedData(): PocketMultilingualInventory {
  const inventory = normalizePocketHubInfo(
    {
      id: 'kyutai/pocket-tts-without-voice-cloning',
      siblings: POCKET_MULTILINGUAL_SELECTORS.flatMap(({ id }) =>
        POCKET_MULTILINGUAL_LABELS.map((label) => ({
          rfilename: `languages/${id}/embeddings/${label}.safetensors`,
        })),
      ),
    },
    POCKET_MULTILINGUAL_REVISION,
  );
  if (
    inventory.inventorySha256 !== POCKET_MULTILINGUAL_INVENTORY_SHA256 ||
    JSON.stringify(inventory.selectors) !== JSON.stringify(POCKET_MULTILINGUAL_SELECTORS) ||
    JSON.stringify(inventory.labels) !== JSON.stringify(POCKET_MULTILINGUAL_LABELS)
  ) {
    throw new Error('Pocket generated inventory invariant failed.');
  }
  return inventory;
}

export function resolvePocketMultilingualInputPath(
  inputPath: string,
  initialWorkingDirectory: string | undefined,
  currentWorkingDirectory: string,
): string {
  assertLocalFilesystemPath(inputPath);
  const base = initialWorkingDirectory ?? currentWorkingDirectory;
  assertLocalFilesystemPath(base);
  const resolved = resolve(base, inputPath);
  assertLocalFilesystemPath(resolved);
  return resolved;
}

function defaultDependencies(): PocketMultilingualCliDependencies {
  return {
    currentInventory: inventoryFromGeneratedData(),
    resolveInputPath: (inputPath) =>
      resolvePocketMultilingualInputPath(inputPath, process.env.INIT_CWD, process.cwd()),
    readTextFile: async (inputPath) => readFile(inputPath, 'utf8'),
    writeDataModule: async (destination, contents) => writeFile(destination, contents, 'utf8'),
    writeStdout: (text) => {
      process.stdout.write(text);
    },
  };
}

function parseLocalJson(raw: string): unknown {
  const withoutBom = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  try {
    return JSON.parse(withoutBom) as unknown;
  } catch {
    throw new Error('Pocket input JSON invariant failed.');
  }
}

function countLanguages(inventory: PocketMultilingualInventory): Record<string, number> {
  return Object.fromEntries(
    ['en', 'fr', 'de', 'it', 'pt', 'es'].map((languageTag) => [
      languageTag,
      inventory.variants.filter((variant) => variant.languageTag === languageTag).length,
    ]),
  );
}

export async function runPocketMultilingualCli(
  argv: readonly string[],
  dependencies: PocketMultilingualCliDependencies = defaultDependencies(),
): Promise<void> {
  const options = parseArguments(argv);
  let inputPath: string;
  try {
    inputPath = dependencies.resolveInputPath(options.input);
    assertLocalFilesystemPath(inputPath);
  } catch {
    throw new Error('Pocket CLI local input invariant failed.');
  }
  let raw: string;
  try {
    raw = await dependencies.readTextFile(inputPath);
  } catch {
    throw new Error('Pocket local input read invariant failed.');
  }
  const candidate = normalizePocketHubInfo(parseLocalJson(raw), options.revision);
  const review = computePocketInventoryReview(dependencies.currentInventory, candidate);
  dependencies.writeStdout(
    `${JSON.stringify(
      {
        ...review,
        languageCounts: countLanguages(candidate),
      },
      null,
      2,
    )}\n`,
  );

  if (!options.write) {
    return;
  }
  if (options.approveHash !== candidate.inventorySha256) {
    throw new Error('Pocket approval hash invariant failed.');
  }
  await dependencies.writeDataModule(DATA_MODULE_URL, renderPocketMultilingualData(candidate));
  dependencies.writeStdout(`Wrote approved Pocket inventory ${candidate.inventorySha256}.\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPocketMultilingualCli(process.argv.slice(2));
}
