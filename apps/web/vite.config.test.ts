import { createHash } from 'node:crypto';
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
  "const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__",
  "const CATALOG_URL = 'development'; // __VITE_CATALOG_URL__",
  "const CATALOG_DIGEST = 'development'; // __VITE_CATALOG_DIGEST__",
  'const CATALOG_BYTES = 0; // __VITE_CATALOG_BYTES__',
  'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__',
].join('\n');

interface BuildMetadata {
  buildAssets: string[];
  cacheVersion: string;
  catalogBytes: number;
  catalogDigest: string;
  catalogUrl: string;
  indexBytes: Uint8Array;
  serviceWorker: string;
  shellDigest: string;
}

async function createBuildFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-voice-pwa-build-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'public'));
  await Promise.all([
    writeFile(
      join(root, 'index.html'),
      '<!doctype html><html><head><title>Fixture A</title></head><body><script type="module" src="/main.js"></script></body></html>',
    ),
    writeFile(
      join(root, 'main.js'),
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ),
    writeFile(
      join(root, 'launch-catalog.public.json'),
      JSON.stringify({ voices: 'x'.repeat(5000) }),
    ),
    writeFile(join(root, 'public', 'sw.js'), SERVICE_WORKER_TEMPLATE),
    writeFile(join(root, 'public', 'manifest.webmanifest'), '{"name":"Fixture A"}'),
    writeFile(join(root, 'public', 'icon.svg'), '<svg><title>Fixture A</title></svg>'),
  ]);
  return root;
}

async function buildMetadata(root: string): Promise<BuildMetadata> {
  await build({
    root,
    configFile: join(APP_ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    build: {
      assetsInlineLimit: 0,
      emptyOutDir: true,
      outDir: 'dist',
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name].js',
          entryFileNames: 'assets/[name].js',
        },
      },
    },
  });
  const [serviceWorker, indexBytes] = await Promise.all([
    readFile(join(root, 'dist', 'sw.js'), 'utf8'),
    readFile(join(root, 'dist', 'index.html')),
  ]);
  const cacheVersion = serviceWorker.match(/const CACHE_VERSION = '([^']+)'/)?.[1];
  const shellDigest = serviceWorker.match(/const SHELL_DIGEST = '([^']+)'/)?.[1];
  const catalogUrl = serviceWorker.match(/const CATALOG_URL = '([^']+)'/)?.[1];
  const catalogDigest = serviceWorker.match(/const CATALOG_DIGEST = '([^']+)'/)?.[1];
  const catalogBytes = Number(serviceWorker.match(/const CATALOG_BYTES = (\d+)/)?.[1]);
  const buildAssetsSource = serviceWorker.match(/const BUILD_ASSETS = (\[[^;]*\]);/)?.[1];
  if (cacheVersion === undefined) {
    throw new Error('The built service worker has no cache version.');
  }
  if (shellDigest === undefined) {
    throw new Error('The built service worker has no shell digest.');
  }
  if (
    catalogUrl === undefined ||
    catalogDigest === undefined ||
    !Number.isSafeInteger(catalogBytes)
  ) {
    throw new Error('The built service worker has no exact catalog identity.');
  }
  if (buildAssetsSource === undefined) {
    throw new Error('The built service worker has no shell asset list.');
  }
  return {
    buildAssets: JSON.parse(buildAssetsSource) as string[],
    cacheVersion,
    catalogBytes,
    catalogDigest,
    catalogUrl,
    indexBytes,
    serviceWorker,
    shellDigest,
  };
}

async function buildCacheVersion(root: string): Promise<string> {
  return (await buildMetadata(root)).cacheVersion;
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

  await writeFile(
    join(root, 'main.js'),
    "document.body.dataset.changed = new URL('./launch-catalog.public.json', import.meta.url).href;",
  );
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

test('injects the SHA-256 digest of the exact emitted index bytes', async () => {
  const root = await createBuildFixture();
  const { indexBytes, shellDigest } = await buildMetadata(root);

  expect(shellDigest).toBe(createHash('sha256').update(indexBytes).digest('hex'));
});

test('emitted shell byte changes alter both the digest and cache version', async () => {
  const root = await createBuildFixture();
  const initial = await buildMetadata(root);

  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture B</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );
  const changed = await buildMetadata(root);

  expect(changed.shellDigest).not.toBe(initial.shellDigest);
  expect(changed.cacheVersion).not.toBe(initial.cacheVersion);
});

test('requires unique injection placeholders and resolves every placeholder in output', async () => {
  const root = await createBuildFixture();
  const { serviceWorker } = await buildMetadata(root);

  for (const placeholder of [
    '__VITE_BUILD_ASSETS__',
    '__VITE_CACHE_VERSION__',
    '__VITE_SHELL_DIGEST__',
    '__VITE_CATALOG_URL__',
    '__VITE_CATALOG_DIGEST__',
    '__VITE_CATALOG_BYTES__',
  ]) {
    expect(SERVICE_WORKER_TEMPLATE.match(new RegExp(placeholder, 'g'))).toHaveLength(1);
    expect(serviceWorker).not.toContain(placeholder);
  }
  expect(serviceWorker).not.toContain("'development'");
});

test('injects exactly one content-addressed catalog identity and excludes it from the shell', async () => {
  const root = await createBuildFixture();
  const metadata = await buildMetadata(root);
  const catalogPath = join(root, 'dist', metadata.catalogUrl.replace(/^\//, ''));
  const catalog = await readFile(catalogPath);

  expect(metadata.catalogUrl).toMatch(/^\/assets\/launch-catalog\.public-[A-Za-z0-9_-]{6,}\.json$/);
  expect(metadata.catalogDigest).toBe(
    `sha256:${createHash('sha256').update(catalog).digest('hex')}`,
  );
  expect(metadata.catalogBytes).toBe(catalog.byteLength);
  expect(metadata.serviceWorker).not.toMatch(
    new RegExp(`BUILD_ASSETS[^\\n]+${metadata.catalogUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  const emittedCatalogs = (
    await readFile(join(root, 'dist', 'assets', metadata.catalogUrl.split('/').at(-1)!))
  ).byteLength;
  expect(emittedCatalogs).toBe(metadata.catalogBytes);
});

test('shell injection excludes Worker entries, dynamic inference chunks, and runtime assets', async () => {
  const root = await createBuildFixture();
  await Promise.all([
    writeFile(join(root, 'runtime.worker.js'), "self.postMessage('worker loaded');"),
    writeFile(join(root, 'inference.js'), "document.body.dataset.inference = 'loaded';"),
    writeFile(join(root, 'runtime.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    writeFile(join(root, 'model.bin'), new Uint8Array([1, 2, 3, 4])),
    writeFile(
      join(root, 'main.js'),
      [
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
        "document.body.dataset.wasm = new URL('./runtime.wasm', import.meta.url).href;",
        "document.body.dataset.model = new URL('./model.bin', import.meta.url).href;",
        "new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });",
        "void import('./inference.js');",
      ].join('\n'),
    ),
  ]);

  const { buildAssets } = await buildMetadata(root);

  expect(buildAssets.some((asset) => /\/assets\/[^/]+\.js$/.test(asset))).toBe(true);
  for (const forbidden of [
    /worker.*\.js$/i,
    /inference.*\.js$/i,
    /\.wasm$/i,
    /\.bin$/i,
    /launch-catalog.*\.json$/i,
  ]) {
    expect(buildAssets).not.toEqual(expect.arrayContaining([expect.stringMatching(forbidden)]));
  }
});

test('rejects builds with zero emitted launch catalogs', async () => {
  const root = await createBuildFixture();
  await writeFile(join(root, 'main.js'), "document.body.dataset.ready = 'true';");

  await expect(buildMetadata(root)).rejects.toThrow(/exactly one.*launch catalog/i);
});

test('rejects builds with multiple emitted launch catalogs', async () => {
  const root = await createBuildFixture();
  await mkdir(join(root, 'alternate'));
  await writeFile(
    join(root, 'alternate', 'launch-catalog.public.json'),
    JSON.stringify({ voices: 'y'.repeat(5000) }),
  );
  await writeFile(
    join(root, 'main.js'),
    [
      "new URL('./launch-catalog.public.json', import.meta.url).href;",
      "new URL('./alternate/launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).rejects.toThrow(/exactly one.*launch catalog/i);
});

test('rejects a duplicate catalog-digest injection placeholder', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'public', 'sw.js'),
    `${SERVICE_WORKER_TEMPLATE}\nconst CATALOG_DIGEST = 'development'; // __VITE_CATALOG_DIGEST__`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(
    /service-worker injection marker __VITE_CATALOG_DIGEST__ must appear exactly once/i,
  );
});

test('rejects a duplicate shell-digest injection placeholder', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'public', 'sw.js'),
    `${SERVICE_WORKER_TEMPLATE}\nconst SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(
    /service-worker injection marker __VITE_SHELL_DIGEST__ must appear exactly once/i,
  );
});

test('does not rewrite the emitted index with a public identity marker', async () => {
  const root = await createBuildFixture();
  await buildMetadata(root);
  const indexHtml = await readFile(join(root, 'dist', 'index.html'), 'utf8');

  expect(indexHtml).not.toContain('open-voice-shell');
});

test('hashes noncanonical head markup as ordinary shell bytes', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head data-note=">"><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  const { indexBytes, shellDigest } = await buildMetadata(root);

  expect(shellDigest).toBe(createHash('sha256').update(indexBytes).digest('hex'));
});

test('does not reserve former marker text in the source index', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><meta name="open-voice-shell" content="reserved"><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  const { indexBytes, shellDigest } = await buildMetadata(root);

  expect(new TextDecoder().decode(indexBytes)).toContain('open-voice-shell');
  expect(shellDigest).toBe(createHash('sha256').update(indexBytes).digest('hex'));
});
