import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ASSETS_MARKER = 'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__';
const CACHE_VERSION_MARKER = "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__";
const SHELL_ASSET_PATTERN = /\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;

function injectServiceWorkerShellAssets(): Plugin {
  return {
    name: 'inject-service-worker-shell-assets',
    apply: 'build',
    async writeBundle(outputOptions, bundle) {
      if (outputOptions.dir === undefined) {
        throw new Error('The web build must write to a directory for PWA asset injection.');
      }

      const buildAssets = Object.values(bundle)
        .map((output) => `/${output.fileName}`)
        .filter((path) => SHELL_ASSET_PATTERN.test(path))
        .sort();

      if (!buildAssets.some((path) => path.endsWith('.js'))) {
        throw new Error('The PWA shell build did not emit a JavaScript entry.');
      }

      const serviceWorkerPath = resolve(outputOptions.dir, 'sw.js');
      const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
      if (
        !serviceWorker.includes(BUILD_ASSETS_MARKER) ||
        !serviceWorker.includes(CACHE_VERSION_MARKER)
      ) {
        throw new Error('The service-worker precache injection markers are missing.');
      }

      const cacheVersion = createHash('sha256')
        .update(serviceWorker)
        .update('\0')
        .update(buildAssets.join('\n'))
        .digest('hex')
        .slice(0, 12);
      const injectedServiceWorker = serviceWorker
        .replace(
          BUILD_ASSETS_MARKER,
          `const BUILD_ASSETS = ${JSON.stringify(buildAssets)}; // __VITE_BUILD_ASSETS__`,
        )
        .replace(
          CACHE_VERSION_MARKER,
          `const CACHE_VERSION = '${cacheVersion}'; // __VITE_CACHE_VERSION__`,
        );

      await writeFile(serviceWorkerPath, injectedServiceWorker, 'utf8');
    },
  };
}

export default defineConfig({
  plugins: [react(), injectServiceWorkerShellAssets()],
});
