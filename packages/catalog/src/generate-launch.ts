import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildLaunchCatalog,
  stableStringifyLaunchCatalog,
  validateLaunchCatalogForRelease,
} from './launch.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(packageRoot, 'data', 'launch-catalog.public.json');
const integrityPath = resolve(packageRoot, 'data', 'launch-catalog.integrity.json');

function integrityRecord(catalogBytes: string): string {
  const sha256 = `sha256:${createHash('sha256').update(catalogBytes, 'utf8').digest('hex')}`;
  const bytes = Buffer.byteLength(catalogBytes, 'utf8');
  return `${JSON.stringify({ sha256, bytes }, null, 2)}\n`;
}

export async function generateLaunchCatalog(mode: 'write' | 'check'): Promise<void> {
  const catalog = buildLaunchCatalog();
  validateLaunchCatalogForRelease(catalog);
  const expected = stableStringifyLaunchCatalog(catalog);
  const expectedIntegrity = integrityRecord(expected);
  if (mode === 'write') {
    await Promise.all([
      writeFile(outputPath, expected, 'utf8'),
      writeFile(integrityPath, expectedIntegrity, 'utf8'),
    ]);
    return;
  }
  const [actual, actualIntegrity] = await Promise.all([
    readFile(outputPath, 'utf8'),
    readFile(integrityPath, 'utf8'),
  ]);
  if (actual !== expected || actualIntegrity !== expectedIntegrity) {
    throw new Error(
      'Launch catalog or integrity drift detected. Run `npm run catalog:generate` and review the deterministic diff.',
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  await generateLaunchCatalog(mode);
  process.stdout.write(
    mode === 'write'
      ? `Wrote ${outputPath} and ${integrityPath}\n`
      : `Launch catalog and integrity are deterministic: ${outputPath}\n`,
  );
}
