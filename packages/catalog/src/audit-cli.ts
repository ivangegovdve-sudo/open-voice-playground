import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildSourceRecordCatalogFromAudit } from './audit.js';

async function main(): Promise<void> {
  const [inputPathArgument, outputPathArgument] = process.argv.slice(2);
  if (inputPathArgument === undefined || outputPathArgument === undefined) {
    throw new Error(
      'Usage: npm run audit:import --workspace @open-voice/catalog -- <public-audit.json> <source-records.json>',
    );
  }

  const inputPath = resolve(inputPathArgument);
  const outputPath = resolve(outputPathArgument);
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const catalog = buildSourceRecordCatalogFromAudit(input);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${catalog.sources.length} public source records to ${outputPath}\n`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
