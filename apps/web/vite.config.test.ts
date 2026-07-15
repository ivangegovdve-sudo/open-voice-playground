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
  'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__',
].join('\n');

interface BuildMetadata {
  cacheVersion: string;
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
    writeFile(join(root, 'main.js'), "document.body.dataset.ready = 'true';"),
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
  const [serviceWorker, indexBytes] = await Promise.all([
    readFile(join(root, 'dist', 'sw.js'), 'utf8'),
    readFile(join(root, 'dist', 'index.html')),
  ]);
  const cacheVersion = serviceWorker.match(/const CACHE_VERSION = '([^']+)'/)?.[1];
  const shellDigest = serviceWorker.match(/const SHELL_DIGEST = '([^']+)'/)?.[1];
  if (cacheVersion === undefined) {
    throw new Error('The built service worker has no cache version.');
  }
  if (shellDigest === undefined) {
    throw new Error('The built service worker has no shell digest.');
  }
  return { cacheVersion, indexBytes, serviceWorker, shellDigest };
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
  ]) {
    expect(SERVICE_WORKER_TEMPLATE.match(new RegExp(placeholder, 'g'))).toHaveLength(1);
    expect(serviceWorker).not.toContain(placeholder);
  }
  expect(serviceWorker).not.toContain("'development'");
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
