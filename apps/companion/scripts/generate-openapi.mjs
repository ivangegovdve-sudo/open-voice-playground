import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { loadOpenApiDocument } from './openapi-loader.mjs';
import { generateProtocol } from './protocol-generator.mjs';

const root = resolve(import.meta.dirname, '..');
const outputPath = resolve(root, 'src/generated/protocol.ts');

const document = await loadOpenApiDocument();
const output = generateProtocol(document);
if (process.argv.includes('--write')) {
  await mkdir(resolve(root, 'src/generated'), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
} else if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(outputPath, 'utf8');
  } catch {
    // The mismatch below is intentionally stable for CI.
  }
  if (current !== output) {
    throw new Error('Generated OpenAPI TypeScript is stale; run npm run openapi:generate.');
  }
} else {
  process.stdout.write(output);
}
