import process from 'node:process';

import { CatalogValidationError, loadCatalog } from './index.js';

const manifestPath = process.argv[2];

if (manifestPath === undefined) {
  console.error('Usage: catalog:validate <manifest.json>');
  process.exitCode = 1;
} else {
  try {
    const validated = await loadCatalog(manifestPath);
    console.log(
      `Validated ${validated.manifest.catalogId}: ${validated.counts.runnableVoices} runnable fixture voices, ${validated.counts.listenOnlyVoices} listen-only fixture voices`,
    );
  } catch (error) {
    const message =
      error instanceof CatalogValidationError || error instanceof Error
        ? error.message
        : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
