import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterEach, expect, test } from 'vitest';

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const temporaryRoots: string[] = [];
const SERVICE_WORKER_TEMPLATE = [
  "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__",
  "const SHELL_IDENTITY = 'development'; // __VITE_SHELL_IDENTITY__",
  'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__',
].join('\n');

async function createBuildFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-voice-pwa-build-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'public'));
  await Promise.all([
    writeFile(
      join(root, 'index.html'),
      '<!doctype html><html><head><title>Fixture A</title></head><body><script type="module" src="/main.js"></script></body></html>',
    ),
    writeFile(join(root, 'main.js'), "document.body.dataset.ready = 'true';"),
    writeFile(join(root, 'public', 'sw.js'), SERVICE_WORKER_TEMPLATE),
    writeFile(join(root, 'public', 'manifest.webmanifest'), '{"name":"Fixture A"}'),
    writeFile(join(root, 'public', 'icon.svg'), '<svg><title>Fixture A</title></svg>'),
  ]);
  return root;
}

async function buildCacheVersion(root: string): Promise<string> {
  await build({
    root,
    configFile: join(APP_ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      outDir: 'dist',
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name][extname]',
          chunkFileNames: 'assets/[name].js',
          entryFileNames: 'assets/[name].js',
        },
      },
    },
  });
  const serviceWorker = await readFile(join(root, 'dist', 'sw.js'), 'utf8');
  const match = serviceWorker.match(/const CACHE_VERSION = '([^']+)'/);
  if (match?.[1] === undefined) {
    throw new Error('The built service worker has no cache version.');
  }
  return match[1];
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

test.each([
  [
    'index.html',
    'index.html',
    '<!doctype html><html><head><title>Fixture B</title></head><body><script type="module" src="/main.js"></script></body></html>',
  ],
  ['manifest.webmanifest', 'public/manifest.webmanifest', '{"name":"Fixture B"}'],
  ['icon.svg', 'public/icon.svg', '<svg><title>Fixture B</title></svg>'],
])('cache version changes when emitted %s contents change', async (_label, relativePath, body) => {
  const root = await createBuildFixture();
  const initialVersion = await buildCacheVersion(root);

  await writeFile(join(root, relativePath), body);
  const changedVersion = await buildCacheVersion(root);

  expect(changedVersion).not.toBe(initialVersion);
});

test('cache version changes when emitted JavaScript bytes change under a stable filename', async () => {
  const root = await createBuildFixture();
  const initialVersion = await buildCacheVersion(root);

  await writeFile(join(root, 'main.js'), "document.body.dataset.ready = 'changed';");
  const changedVersion = await buildCacheVersion(root);

  expect(changedVersion).not.toBe(initialVersion);
});

test('cache version changes when the service-worker template changes', async () => {
  const root = await createBuildFixture();
  const initialVersion = await buildCacheVersion(root);

  await writeFile(
    join(root, 'public', 'sw.js'),
    `${SERVICE_WORKER_TEMPLATE}\nself.addEventListener('message', () => {});`,
  );
  const changedVersion = await buildCacheVersion(root);

  expect(changedVersion).not.toBe(initialVersion);
});
