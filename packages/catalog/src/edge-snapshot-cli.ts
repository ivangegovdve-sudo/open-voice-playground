import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  computeEdgeSnapshotReview,
  normalizeEdgeSnapshot,
  renderEdgeSnapshotModule,
} from './edge-snapshot-import.js';
import { EDGE_VOICE_SNAPSHOT } from './launch-data.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const input = argument('--input');
  if (input === undefined) {
    throw new Error(
      'Usage: npm run review:edge-snapshot -- --input <maintainer-export.json> [--write --approve-hash sha256:…]',
    );
  }
  const raw = JSON.parse(await readFile(resolve(input), 'utf8')) as unknown;
  const candidate = normalizeEdgeSnapshot(raw);
  const review = computeEdgeSnapshotReview(EDGE_VOICE_SNAPSHOT, candidate);
  process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);

  if (!process.argv.includes('--write')) {
    if (review.added.length > 0 || review.removed.length > 0 || review.changed.length > 0) {
      process.exitCode = 2;
    }
    return;
  }
  const approvedHash = argument('--approve-hash');
  if (approvedHash !== review.hash) {
    throw new Error(
      `Refusing to write: --approve-hash must exactly match the reviewed candidate hash ${review.hash}.`,
    );
  }
  await writeFile(
    new URL('./launch-data.ts', import.meta.url),
    renderEdgeSnapshotModule(candidate),
  );
  process.stdout.write(
    'Wrote the approved static snapshot. Run catalog generation, inspect the full diff, and keep Edge synthesis gated.\n',
  );
}

await main();
