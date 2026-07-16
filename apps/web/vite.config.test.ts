import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
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

async function installFixtureInferencePackages(root: string): Promise<void> {
  const onnxRoot = join(root, 'node_modules', 'onnxruntime-web');
  const transformersRoot = join(root, 'node_modules', '@huggingface', 'transformers');
  const sherpaRoot = join(root, 'node_modules', 'sherpa-onnx-web');
  const externWasmRoot = join(root, 'node_modules', 'onnxruntime-web-use-extern-wasm');
  await Promise.all([
    mkdir(onnxRoot, { recursive: true }),
    mkdir(transformersRoot, { recursive: true }),
    mkdir(sherpaRoot, { recursive: true }),
    mkdir(externWasmRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(onnxRoot, 'package.json'),
      JSON.stringify({
        name: 'onnxruntime-web',
        type: 'module',
        exports: {
          './ort': './ort.mjs',
          './webgpu': './webgpu.mjs',
          './wasm': './wasm.mjs',
          './ort-wasm-simd-threaded.jsep.wasm': './ort-wasm-simd-threaded.jsep.wasm',
          './ort-wasm-simd-threaded.wasm': './ort-wasm-simd-threaded.wasm',
        },
      }),
    ),
    writeFile(
      join(onnxRoot, 'ort.mjs'),
      "globalThis.__fixtureRuntime = 'ort'; export const runtime = 'ort';",
    ),
    writeFile(
      join(onnxRoot, 'webgpu.mjs'),
      "globalThis.__fixtureRuntime = 'webgpu'; export const runtime = 'webgpu';",
    ),
    writeFile(
      join(onnxRoot, 'wasm.mjs'),
      "globalThis.__fixtureRuntime = 'wasm'; export const runtime = 'wasm';",
    ),
    writeFile(
      join(onnxRoot, 'ort-wasm-simd-threaded.jsep.wasm'),
      new Uint8Array([0, 97, 115, 109]),
    ),
    writeFile(join(onnxRoot, 'ort-wasm-simd-threaded.wasm'), new Uint8Array([0, 97, 115, 109])),
    writeFile(
      join(transformersRoot, 'package.json'),
      JSON.stringify({
        name: '@huggingface/transformers',
        type: 'module',
        exports: './index.mjs',
      }),
    ),
    writeFile(
      join(transformersRoot, 'index.mjs'),
      "globalThis.__fixtureRuntime = 'transformers'; export const runtime = 'transformers';",
    ),
    writeFile(
      join(sherpaRoot, 'package.json'),
      JSON.stringify({ name: 'sherpa-onnx-web', type: 'module', exports: './index.mjs' }),
    ),
    writeFile(
      join(sherpaRoot, 'index.mjs'),
      "globalThis.__fixtureRuntime = 'sherpa'; export const runtime = 'sherpa';",
    ),
    writeFile(
      join(externWasmRoot, 'package.json'),
      JSON.stringify({
        name: 'onnxruntime-web-use-extern-wasm',
        type: 'module',
        exports: './index.mjs',
      }),
    ),
    writeFile(
      join(externWasmRoot, 'index.mjs'),
      "globalThis.__fixtureRuntime = 'extern-wasm'; export const runtime = 'extern-wasm';",
    ),
  ]);
}

function deterministicBase64Payload(bytes: number): string {
  const payload = new Uint8Array(bytes);
  let state = 0x12345678;
  for (let index = 0; index < payload.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    payload[index] = state >>> 24;
  }
  return Buffer.from(payload).toString('base64');
}

async function buildMetadata(
  root: string,
  manualChunks?: (id: string) => string | undefined,
  modulePreload = true,
): Promise<BuildMetadata> {
  await build({
    root,
    configFile: join(APP_ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    build: {
      assetsInlineLimit: 0,
      emptyOutDir: true,
      modulePreload,
      outDir: 'dist',
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name].js',
          entryFileNames: 'assets/[name].js',
          ...(manualChunks === undefined ? {} : { manualChunks }),
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
    writeFile(
      join(root, 'worker-factory.js'),
      "export const createWorker = () => new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });",
    ),
    writeFile(join(root, 'inference.js'), "document.body.dataset.inference = 'loaded';"),
    writeFile(join(root, 'runtime.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    writeFile(join(root, 'model.bin'), new Uint8Array([1, 2, 3, 4])),
    writeFile(
      join(root, 'main.js'),
      [
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
        "document.body.dataset.wasm = new URL('./runtime.wasm', import.meta.url).href;",
        "document.body.dataset.model = new URL('./model.bin', import.meta.url).href;",
        "globalThis.__fixtureWorkerFactory = async () => (await import('./worker-factory.js')).createWorker();",
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

test('rejects guarded inference code that enters the initial production module graph', async () => {
  const root = await createBuildFixture();
  await mkdir(join(root, 'runtime', 'inference'), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, 'runtime', 'inference', 'engine.js'),
      "globalThis.__fixtureRuntime = 'inference'; export const inference = 'must stay lazy';",
    ),
    writeFile(
      join(root, 'main.js'),
      [
        "import { inference } from './runtime/inference/engine.js';",
        'document.body.dataset.inference = inference;',
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
  ]);

  await expect(buildMetadata(root)).rejects.toThrow(
    /initial production module graph contains guarded runtime implementation code/i,
  );
});

test('rejects a guarded static module even when Rollup inlines its only used value', async () => {
  const root = await createBuildFixture();
  await mkdir(join(root, 'runtime', 'inference'), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, 'runtime', 'inference', 'constants.js'),
      "export const runtimeLabel = 'must-stay-lazy';",
    ),
    writeFile(
      join(root, 'main.js'),
      [
        "import { runtimeLabel } from './runtime/inference/constants.js';",
        'document.body.dataset.runtime = runtimeLabel;',
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
  ]);

  await expect(buildMetadata(root)).rejects.toThrow(
    /initial production module graph contains guarded runtime implementation code/i,
  );
});

test.each([
  ['onnxruntime-web/ort', "import 'onnxruntime-web/ort';", null],
  ['onnxruntime-web/webgpu', "import 'onnxruntime-web/webgpu';", null],
  ['onnxruntime-web/wasm', "import 'onnxruntime-web/wasm';", null],
  [
    'onnxruntime-web threaded JSEP binary URL',
    "import runtimeUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'; globalThis.__runtimeUrl = runtimeUrl;",
    null,
  ],
  [
    'onnxruntime-web threaded binary URL',
    "import runtimeUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'; globalThis.__runtimeUrl = runtimeUrl;",
    null,
  ],
  ['@huggingface/transformers', "import '@huggingface/transformers';", null],
  ['sherpa-onnx-web', "import 'sherpa-onnx-web';", null],
  ['onnxruntime-web-use-extern-wasm .mjs', "import 'onnxruntime-web-use-extern-wasm';", null],
  ['a .worker. module', "import './background/eager.worker.mjs';", 'background/eager.worker.mjs'],
  ['runtime/workers', "import './runtime/workers/eager.mjs';", 'runtime/workers/eager.mjs'],
  [
    'runtime/supertonic',
    "import './runtime/supertonic/eager.mjs';",
    'runtime/supertonic/eager.mjs',
  ],
  ['runtime/inference', "import './runtime/inference/eager.mjs';", 'runtime/inference/eager.mjs'],
] as const)(
  'rejects statically reachable guarded runtime implementation: %s',
  async (_label, staticImport, localModule) => {
    const root = await createBuildFixture();
    await installFixtureInferencePackages(root);
    if (localModule !== null) {
      await mkdir(dirname(join(root, localModule)), { recursive: true });
      await writeFile(
        join(root, localModule),
        "globalThis.__fixtureRuntime = 'forbidden'; export const eagerRuntime = 'forbidden';",
      );
    }
    await writeFile(
      join(root, 'main.js'),
      [
        staticImport,
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    );

    await expect(buildMetadata(root)).rejects.toThrow(
      /initial production module graph contains guarded runtime implementation code/i,
    );
  },
);

test('permits arbitrary engine filenames outside guarded namespaces', async () => {
  const root = await createBuildFixture();
  await writeFile(join(root, 'engine.js'), "export const ordinaryEngine = 'shell-state';");
  await writeFile(
    join(root, 'main.js'),
    [
      "import { ordinaryEngine } from './engine.js';",
      'document.body.dataset.engine = ordinaryEngine;',
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits guarded runtime packages and Worker factories only through dynamic imports', async () => {
  const root = await createBuildFixture();
  await installFixtureInferencePackages(root);
  await mkdir(join(root, 'runtime', 'supertonic'), { recursive: true });
  await writeFile(
    join(root, 'runtime', 'supertonic', 'lazy.worker.mjs'),
    "self.postMessage('lazy runtime');",
  );
  await writeFile(
    join(root, 'runtime', 'supertonic', 'create-worker.mjs'),
    "export const createWorker = () => new Worker(new URL('./lazy.worker.mjs', import.meta.url), { type: 'module' });",
  );
  await writeFile(
    join(root, 'main.js'),
    [
      "void import('onnxruntime-web/webgpu');",
      "globalThis.__lazyRuntimeFactory = async () => (await import('./runtime/supertonic/create-worker.mjs')).createWorker();",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  const { buildAssets } = await buildMetadata(root);
  expect(buildAssets).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/create-worker|lazy\.worker|webgpu/i)]),
  );
});

test('keeps both lazy ONNX Runtime URL artifacts outside the initial shell and service worker', async () => {
  const root = await createBuildFixture();
  await installFixtureInferencePackages(root);
  await writeFile(
    join(root, 'node_modules', 'onnxruntime-web', 'ort-wasm-simd-threaded.wasm'),
    new Uint8Array([0, 97, 115, 109, 1]),
  );
  await mkdir(join(root, 'runtime', 'supertonic'), { recursive: true });
  const productionResolverSource = await readFile(
    join(APP_ROOT, 'src', 'runtime', 'supertonic', 'runtime-artifacts.ts'),
    'utf8',
  );
  await writeFile(
    join(root, 'runtime', 'supertonic', 'runtime-artifacts.ts'),
    productionResolverSource,
  );
  await writeFile(
    join(root, 'main.js'),
    [
      "globalThis.__loadRuntimeArtifacts = () => import('./runtime/supertonic/runtime-artifacts.ts');",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  const metadata = await buildMetadata(root);
  const emitted = (await readdir(join(root, 'dist'), { recursive: true })).map((path) =>
    path.replaceAll('\\', '/'),
  );

  expect(emitted.filter((path) => path.endsWith('.wasm'))).toHaveLength(2);
  expect(emitted).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/runtime-artifacts.*\.js$/),
      expect.stringMatching(/ort-wasm-simd-threaded\.jsep.*\.wasm$/),
      expect.stringMatching(/ort-wasm-simd-threaded.*\.wasm$/),
    ]),
  );
  expect(metadata.buildAssets).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/runtime-artifacts|onnxruntime|\.wasm$/i)]),
  );
  expect(metadata.serviceWorker).not.toMatch(/onnxruntime|\.wasm/i);
});

test.each([
  ['data URL', 'data:text/javascript,globalThis.__remoteScript=true'],
  ['remote HTTPS URL', 'https://example.com/runtime.js'],
  ['sentinel-origin absolute HTTPS URL', 'https://open-voice.invalid/assets/index.js'],
  ['sentinel-origin protocol-relative URL', '//open-voice.invalid/assets/index.js'],
  ['blob URL', 'blob:https://open-voice.invalid/01234567-89ab-cdef-0123-456789abcdef'],
  ['javascript URL', 'javascript:globalThis.__remoteScript=true'],
] as const)('rejects a %s script source', async (_label, source) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head><body><script src="${source}"></script><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/script source|same-origin|build-owned/i);
});

test.each([
  ['an absolute href', '<base href="https://open-voice.invalid/">'],
  ['a relative href', '<base href="/nested/">'],
  ['only a target', '<base target="_blank">'],
] as const)('rejects a base element with %s', async (_label, baseElement) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head>${baseElement}<title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/base element/i);
});

test.each([
  ['remote modulepreload', '<link rel="modulepreload" href="https://example.com/runtime.js">'],
  [
    'remote fetch preload',
    '<link rel="preload" as="fetch" href="https://huggingface.co/model.onnx">',
  ],
  ['local prefetch', '<link rel="prefetch" href="/later.js">'],
  ['remote preconnect', '<link rel="preconnect" href="https://example.com">'],
  ['remote DNS prefetch', '<link rel="dns-prefetch" href="//example.com">'],
  ['remote prerender', '<link rel="prerender" href="https://example.com/next">'],
  ['protocol-relative preload', '<link rel="preload" href="//example.com/runtime.js">'],
  ['data preload', '<link rel="preload" href="data:text/javascript,void 0">'],
  [
    'blob prefetch',
    '<link rel="prefetch" href="blob:https://open-voice.invalid/01234567-89ab-cdef-0123-456789abcdef">',
  ],
  [
    'javascript modulepreload',
    '<link rel="modulepreload" href="javascript:globalThis.__hint=true">',
  ],
  [
    'case-varied resource-hint token among multiple rel tokens',
    '<link rel="stylesheet MoDuLePrElOaD" href="/style.css">',
  ],
] as const)('rejects a production link with %s', async (_label, link) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head>${link}<title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/resource hint|link relation/i);
});

test('rejects a local modulepreload that exposes a public raw Worker factory', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'public', 'factory.js'),
    "export const createWorker = () => new Worker('./runtime.worker.js');",
  );
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><link rel="modulepreload" href="/factory.js"><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/resource hint|link relation/i);
});

test('rejects an unreviewed request-bearing production link relation', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><link rel="apple-touch-icon-precomposed" href="https://example.com/icon.png"><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/reviewed link relation|unreviewed.*link/i);
});

test.each([
  ['remote stylesheet', 'stylesheet', 'https://example.com/style.css'],
  ['protocol-relative stylesheet', 'stylesheet', '//example.com/style.css'],
  ['data stylesheet', 'stylesheet', 'data:text/css,body{}'],
  [
    'blob stylesheet',
    'stylesheet',
    'blob:https://open-voice.invalid/01234567-89ab-cdef-0123-456789abcdef',
  ],
  ['javascript stylesheet', 'stylesheet', 'javascript:globalThis.__style=true'],
  ['absolute same-origin stylesheet', 'stylesheet', 'https://open-voice.invalid/style.css'],
  ['credentialed stylesheet', 'stylesheet', 'https://user:pass@open-voice.invalid/style.css'],
  ['query-bearing icon', 'icon', '/icon.svg?v=1'],
  ['fragment-bearing manifest', 'manifest', '/manifest.webmanifest#install'],
  ['unreviewed public icon', 'icon', '/other.svg'],
  ['unreviewed public manifest', 'manifest', '/other.webmanifest'],
] as const)('rejects a production link with a %s target', async (_label, relation, target) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><link rel="${relation}" href="${target}"><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/local|same-origin|reviewed|query|hash/i);
});

test('rejects a local stylesheet that is not an exact build-owned emitted CSS asset', async () => {
  const root = await createBuildFixture();
  await writeFile(join(root, 'public', 'unowned.css'), 'body { color: red; }');
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/unowned.css"><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/stylesheet|build-owned|emitted CSS/i);
});

test.each(['js', 'mjs'] as const)(
  'rejects a raw .%s asset that enters the initial shell through emitted CSS',
  async (extension) => {
    const root = await createBuildFixture();
    await Promise.all([
      writeFile(join(root, `shell-code.${extension}`), "new Worker('./runtime.worker.js');"),
      writeFile(
        join(root, 'shell.css'),
        `.fixture { background-image: url('./shell-code.${extension}'); }`,
      ),
      writeFile(
        join(root, 'main.js'),
        [
          "import './shell.css';",
          "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
        ].join('\n'),
      ),
    ]);

    await expect(buildMetadata(root)).rejects.toThrow(/JavaScript.*Rollup chunk|raw.*asset/i);
  },
);

test('permits the reviewed icon, manifest, emitted stylesheet, and ordinary anchor hrefs', async () => {
  const root = await createBuildFixture();
  await Promise.all([
    writeFile(join(root, 'shell.css'), '.fixture { color: CanvasText; }'),
    writeFile(
      join(root, 'main.js'),
      [
        "import './shell.css';",
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
    writeFile(
      join(root, 'index.html'),
      '<!doctype html><html><head><link rel="icon" href="/icon.svg"><link rel="manifest" href="/manifest.webmanifest"><link rel="canonical"><title>Fixture</title></head><body><a href="https://example.com/voices?language=en#demo">Ordinary link</a><script type="module" src="/main.js"></script></body></html>',
    ),
  ]);

  const { buildAssets } = await buildMetadata(root);
  expect(buildAssets).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/assets\/index\.js$/),
      expect.stringMatching(/\/assets\/index-[A-Za-z0-9_-]+\.css$/),
    ]),
  );
  expect(buildAssets).not.toEqual(expect.arrayContaining(['/icon.svg', '/manifest.webmanifest']));
});

test.each([
  ['remote image src', '<img src="https://example.com/voice.png" alt="">'],
  ['remote iframe src', '<iframe src="https://example.com/runtime.html" title="Runtime"></iframe>'],
  [
    'remote image srcset',
    '<img srcset="https://example.com/voice-1x.png 1x, https://example.com/voice-2x.png 2x" alt="">',
  ],
  ['local non-script src', '<img src="/voice.png" alt="">'],
  ['remote video poster', '<video poster="https://example.com/poster.png"></video>'],
  ['remote object data', '<object data="https://example.com/runtime.bin"></object>'],
  ['legacy background attribute', '<body background="https://example.com/background.png">'],
  ['meta refresh', '<meta http-equiv="refresh" content="0; url=https://example.com/runtime.html">'],
  [
    'remote SVG image href',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/voice.png"></image></svg>',
  ],
  [
    'request-bearing inline style',
    '<div style="background-image: url(https://example.com/voice.png)"></div>',
  ],
  ['request-bearing style element', '<style>@import url(https://example.com/runtime.css);</style>'],
] as const)('rejects an automatic request from production HTML: %s', async (_label, markup) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head><body>${markup}<script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/automatic request|request-capable CSS/i);
});

test('rejects an automatic request from an HTML application-cache manifest', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html manifest="https://example.com/application.appcache"><head><title>Fixture</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/automatic request/i);
});

test.each([
  ['remote model URL', '.fixture { background-image: url(https://huggingface.co/model.onnx); }'],
  ['remote import', '@import url(https://example.com/runtime.css);'],
  [
    'case-varied URL function',
    '.fixture { background-image: UrL(https://example.com/voice.png); }',
  ],
  ['comment-separated import', '@IMPORT/**/url(https://example.com/runtime.css);'],
  [
    'escaped URL function',
    String.raw`.fixture { background-image: u\72l(https://example.com/voice.png); }`,
  ],
] as const)('rejects an initial emitted CSS request through %s', async (_label, css) => {
  const root = await createBuildFixture();
  await Promise.all([
    writeFile(join(root, 'shell.css'), css),
    writeFile(
      join(root, 'main.js'),
      [
        "import './shell.css';",
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
  ]);

  await expect(buildMetadata(root)).rejects.toThrow(/request-capable CSS|initial.*CSS/i);
});

test('permits request-looking CSS text that is inert inside strings and comments', async () => {
  const root = await createBuildFixture();
  await Promise.all([
    writeFile(
      join(root, 'shell.css'),
      '.fixture::before { content: "url(https://example.com/inert.png)"; } /* URL(https://example.com/inert.png) */',
    ),
    writeFile(
      join(root, 'main.js'),
      [
        "import './shell.css';",
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
  ]);

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('rejects a same-origin script that is not a build-owned emitted entry', async () => {
  const root = await createBuildFixture();
  await writeFile(join(root, 'public', 'unowned.js'), 'globalThis.__unownedScript = true;');
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture</title></head><body><script src="/unowned.js"></script><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/script source|build-owned|emitted entry/i);
});

test.each([
  ['remote SVG href', 'href', 'https://example.com/runtime.js'],
  ['data SVG href', 'href', 'data:text/javascript,globalThis.__svgScript=true'],
  ['non-owned SVG href', 'href', '/unowned.js'],
  ['remote SVG xlink:href', 'xlink:href', 'https://example.com/runtime.js'],
  ['data SVG xlink:href', 'xlink:href', 'data:text/javascript,globalThis.__svgScript=true'],
  ['non-owned SVG xlink:href', 'xlink:href', '/unowned.js'],
] as const)('rejects a %s executable source', async (_label, attribute, source) => {
  const root = await createBuildFixture();
  await writeFile(join(root, 'public', 'unowned.js'), 'globalThis.__unownedSvgScript = true;');
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head><body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><script ${attribute}="${source}"></script></svg><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/script source|build-owned|emitted entry/i);
});

test.each([
  ['body onload', '<body onload="globalThis.__inlineHandler=true">'],
  ['button onclick', '<body><button onclick="globalThis.__inlineHandler=true">Run</button>'],
  [
    'template SVG onload',
    '<body><template><svg onload="globalThis.__inlineHandler=true"></svg></template>',
  ],
] as const)('rejects a nonempty inline event handler on %s', async (_label, openingBody) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head>${openingBody}<script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/inline event handler/i);
});

test.each([
  ['an empty source document', ''],
  ['executable markup', '&lt;script&gt;globalThis.__srcdoc=true;&lt;/script&gt;'],
  ['arbitrary markup', '&lt;p&gt;reviewed-looking data&lt;/p&gt;'],
] as const)('rejects iframe srcdoc containing %s', async (_label, sourceDocument) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head><body><iframe srcdoc="${sourceDocument}"></iframe><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/srcdoc/i);
});

test.each([
  [
    'direct construction',
    "new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });",
  ],
  [
    'arrow IIFE construction',
    "(() => new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }))();",
  ],
  [
    'scheduled inline callback construction',
    "queueMicrotask(() => new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }));",
  ],
  [
    'invoked factory construction',
    "const startRuntime = () => new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }); startRuntime();",
  ],
  [
    'factory passed through an invoked wrapper',
    "const invoke = (factory) => factory(); invoke(() => new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }));",
  ],
  [
    'scheduled named factory construction',
    "const startRuntime = () => new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }); setTimeout(startRuntime, 0);",
  ],
  [
    'aliased Worker constructor construction',
    "const RuntimeWorker = globalThis.Worker; new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });",
  ],
  [
    'computed Worker member construction',
    "const RuntimeWorker = globalThis['Worker']; new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });",
  ],
  [
    'destructured Worker constructor construction',
    "const { Worker: RuntimeWorker } = globalThis; new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });",
  ],
  [
    'Function.prototype.call IIFE construction',
    "(function () { new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }); }).call(null);",
  ],
  [
    'object getter construction',
    "({ get worker() { return new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }); } }).worker;",
  ],
  ['computed ordinary object key', "globalThis.__displayMetadata = { [Worker]: 'not metadata' };"],
  ...(['globalThis', 'window', 'self'] as const).map(
    (globalName) =>
      [
        `Reflect.get ${globalName} construction`,
        `const RuntimeWorker = Reflect.get(${globalName}, 'Worker'); new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
      ] as const,
  ),
  ...(['globalThis', 'window', 'self'] as const).flatMap((globalName) => [
    [
      `Reflect.get ${globalName} dynamic-key construction`,
      `const runtimeKey = location.hash.slice(1) || 'Worker'; const RuntimeWorker = Reflect.get(${globalName}, runtimeKey); new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
    ] as const,
    [
      `Reflect['get'] ${globalName} construction`,
      `const RuntimeWorker = Reflect['get'](${globalName}, 'Worker'); new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
    ] as const,
    [
      `Reflect['get'] ${globalName} dynamic-key construction`,
      `const runtimeKey = location.hash.slice(1) || 'Worker'; const RuntimeWorker = Reflect['get'](${globalName}, runtimeKey); new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
    ] as const,
  ]),
  ...(['globalThis', 'window', 'self'] as const).map(
    (globalName) =>
      [
        `computed ObjectPattern ${globalName} construction`,
        `const runtimeKey = location.hash.slice(1) || 'Worker'; const { [runtimeKey]: RuntimeWorker } = ${globalName}; new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
      ] as const,
  ),
  ...(['globalThis', 'window', 'self'] as const).map(
    (globalName) =>
      [
        `computed exact-Worker ObjectPattern ${globalName} construction`,
        `const { ['Worker']: RuntimeWorker } = ${globalName}; new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
      ] as const,
  ),
  ...(['globalThis', 'window', 'self'] as const).map(
    (globalName) =>
      [
        `dynamic computed ${globalName} construction`,
        `const workerKey = location.hash.slice(1) || 'Worker'; const RuntimeWorker = ${globalName}[workerKey]; new RuntimeWorker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });`,
      ] as const,
  ),
] as const)(
  'rejects Worker %s anywhere in the initial static shell',
  async (_label, workerCode) => {
    const root = await createBuildFixture();
    await writeFile(join(root, 'runtime.worker.js'), "self.postMessage('worker loaded');");
    await writeFile(
      join(root, 'main.js'),
      [
        workerCode,
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    );

    await expect(buildMetadata(root)).rejects.toThrow(/static shell.*Worker|Worker.*static shell/i);
  },
);

test('permits non-reference Worker display text in a static shell chunk', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      "document.body.dataset.label = 'Worker';",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits a non-reference Worker metadata key in an ordinary object', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      "globalThis.__displayMetadata = { Worker: 'not a constructor' };",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits benign Reflect.get metadata access on a non-global target', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      "const metadata = { Worker: 'display only' };",
      "document.body.dataset.label = Reflect.get(metadata, 'Worker');",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits computed destructuring from an ordinary non-global object', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      "const metadata = { label: 'display only' };",
      "const metadataKey = location.hash.slice(1) || 'label';",
      'const { [metadataKey]: displayValue } = metadata;',
      'document.body.dataset.label = displayValue;',
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits an exact Worker display key destructured from an ordinary object', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      `const { Worker: displayValue } = JSON.parse('{"Worker":"display only"}');`,
      'document.body.dataset.label = displayValue;',
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test.each([
  ['direct construction', "new SharedWorker('/runtime.js');"],
  [
    'aliased global constructor',
    "const RuntimeWorker = globalThis.SharedWorker; new RuntimeWorker('/runtime.js');",
  ],
  [
    'computed global constructor',
    "const RuntimeWorker = window['SharedWorker']; new RuntimeWorker('/runtime.js');",
  ],
  [
    'destructured global constructor',
    "const { SharedWorker: RuntimeWorker } = self; new RuntimeWorker('/runtime.js');",
  ],
  [
    'reflected global constructor',
    "const RuntimeWorker = Reflect.get(globalThis, 'SharedWorker'); new RuntimeWorker('/runtime.js');",
  ],
  [
    'scheduled factory construction',
    "const startRuntime = () => new SharedWorker('/runtime.js'); setTimeout(startRuntime, 0);",
  ],
  [
    'object getter construction',
    "({ get runtime() { return new SharedWorker('/runtime.js'); } }).runtime;",
  ],
] as const)(
  'rejects SharedWorker %s anywhere in the initial static shell',
  async (_label, sharedWorkerCode) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'main.js'),
      [
        sharedWorkerCode,
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    );

    await expect(buildMetadata(root)).rejects.toThrow(
      /static shell.*SharedWorker|SharedWorker.*static shell/i,
    );
  },
);

test.each([
  ['direct eval', `eval("new Worker('/runtime.js')")`],
  ['indirect eval', `(0, eval)("new Worker('/runtime.js')")`],
  ['global eval', `globalThis.eval("new Worker('/runtime.js')")`],
  ['computed global eval', `window['eval']("new Worker('/runtime.js')")`],
  ['Function call', `Function("return new Worker('/runtime.js')")()`],
  ['Function constructor', `new Function("return new Worker('/runtime.js')")()`],
  [
    'Function.prototype.toString constructor chain',
    `Function.prototype.toString.constructor("return new Worker('/runtime.js')")()`,
  ],
  [
    'Function.prototype.bind constructor chain',
    `Function.prototype.bind.constructor("return new SharedWorker('/runtime.js')")()`,
  ],
  [
    'computed Function.prototype constructor chain',
    `Function.prototype['toString']['constructor']("return (0, eval)('1')")()`,
  ],
  ['global Function reference', `globalThis.__runtimeFunction = self.Function`],
  [
    'reflected Function reference',
    `globalThis.__runtimeFunction = Reflect.get(globalThis, 'Function')`,
  ],
] as const)(
  'rejects the %s executable-string seam in the initial static shell',
  async (_label, executableStringCode) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'main.js'),
      [
        executableStringCode,
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    );

    await expect(buildMetadata(root)).rejects.toThrow(
      /static shell.*(?:eval|Function)|executable-string/i,
    );
  },
);

test('permits inert SharedWorker, eval, and Function metadata keys in an ordinary object', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      "globalThis.__displayMetadata = { SharedWorker: 'display', eval: 'display', Function: 'display' };",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test.each([
  ['direct toString call', `Function.prototype.toString()`],
  ['direct bind call', `Function.prototype.bind()`],
  ['toString.call invocation', `Function.prototype.toString.call(() => undefined)`],
  ['toString.apply invocation', `Function.prototype.toString.apply(() => undefined, [])`],
  ['bind.call invocation', `Function.prototype.bind.call(() => undefined)`],
  ['bind.apply invocation', `Function.prototype.bind.apply(() => undefined, [])`],
] as const)('permits a reviewed Function.prototype utility through %s', async (_label, code) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'main.js'),
    [
      code,
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('rejects a Worker factory invoked across initial static chunks', async () => {
  const root = await createBuildFixture();
  await Promise.all([
    writeFile(
      join(root, 'main.js'),
      [
        "import { start } from './factory.js';",
        'start();',
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
    writeFile(
      join(root, 'factory.js'),
      "export function start() { new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }); }",
    ),
    writeFile(join(root, 'runtime.worker.js'), "self.postMessage('worker loaded');"),
  ]);

  await expect(
    buildMetadata(root, (id) => (/[\\/]factory\.js$/.test(id) ? 'factory' : undefined), false),
  ).rejects.toThrow(/static shell.*Worker|Worker.*static shell/i);
});

test('rejects an imported but uninvoked Worker factory across initial static chunks', async () => {
  const root = await createBuildFixture();
  await Promise.all([
    writeFile(
      join(root, 'main.js'),
      [
        "import { start } from './factory.js';",
        'globalThis.__lazyRuntimeFactory = start;',
        "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
      ].join('\n'),
    ),
    writeFile(
      join(root, 'factory.js'),
      "export function start() { return new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' }); }",
    ),
    writeFile(join(root, 'runtime.worker.js'), "self.postMessage('worker loaded');"),
  ]);

  await expect(
    buildMetadata(root, (id) => (/[\\/]factory\.js$/.test(id) ? 'factory' : undefined), false),
  ).rejects.toThrow(/static shell.*Worker|Worker.*static shell/i);
});

test.each(['classic', 'module'] as const)(
  'rejects a 395+ KiB gzip %s inline executable script',
  async (scriptKind) => {
    const root = await createBuildFixture();
    const inlineCode = `globalThis.__inlinePayload = '${deterministicBase64Payload(410 * 1024)}';`;
    expect(gzipSync(Buffer.from(inlineCode), { level: 9 }).byteLength).toBeGreaterThan(395 * 1024);
    const type = scriptKind === 'module' ? ' type="module"' : '';
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html><head><title>Fixture</title></head><body><script${type}>${inlineCode}</script><script type="module" src="/main.js"></script></body></html>`,
    );

    await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
  },
);

test.each([
  ['type', `data-note=" type='application/json'"`],
  ['src', `data-note=" src='/not-a-real-script.js'"`],
] as const)(
  'rejects inline JavaScript despite a quoted-attribute %s spoof',
  async (_name, spoof) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html><head><title>Fixture</title></head><body><script ${spoof}>globalThis.__inlineBypass = true;</script><script type="module" src="/main.js"></script></body></html>`,
    );

    await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
  },
);

test.each([
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/livescript',
] as const)('rejects Chromium-executed legacy inline script type %s', async (type) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head><body><script type="${type}">globalThis.__legacyInlineBypass = true;</script><script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
});

test.each([
  ['hexadecimal slash', 'text&#x2f;javascript'],
  ['decimal slash', 'text&#47;javascript'],
  ['named slash', 'text&sol;javascript'],
  ['hexadecimal module letter', 'mod&#x75;le'],
] as const)(
  'rejects a Chromium-executed inline script type with a %s character reference',
  async (_label, type) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html><head><title>Fixture</title></head><body><script type="${type}">globalThis.__encodedInlineBypass = true;</script><script type="module" src="/main.js"></script></body></html>`,
    );

    await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
  },
);

test.each([
  ['a bogus end-tag attribute', '</script x>'],
  ['a self-closing flag', '</script/>'],
] as const)(
  'rejects an inline script using browser-valid closing syntax with %s',
  async (_label, closingTag) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html><head><title>Fixture</title></head><body><script type="module" src="/main.js"></script><script>globalThis.__closingTagBypass = true;${closingTag}</body></html>`,
    );

    await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
  },
);

test.each([
  ['another data type', 'application/ld+json'],
  ['an encoded reviewed type', 'application&#x2f;json'],
  ['an unknown type', 'application/x-open-voice-data'],
] as const)(
  'rejects nonempty inline script data with %s under the fail-closed policy',
  async (_label, type) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html><head><script type="${type}">{"fixture":true}</script></head><body><script type="module" src="/main.js"></script></body></html>`,
    );

    await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
  },
);

test.each([
  [
    'a comment decoy',
    '<!-- <script src="/decoy.js"> --><script>globalThis.__commentDecoyBypass = true;</script>',
  ],
  [
    'a quoted attribute decoy on another element',
    '<div data-note="<script src=\'/decoy.js\'>"><script>globalThis.__attributeDecoyBypass = true;</script></div>',
  ],
] as const)('rejects a real inline script after %s', async (_label, markup) => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    `<!doctype html><html><head><title>Fixture</title></head><body>${markup}<script type="module" src="/main.js"></script></body></html>`,
  );

  await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
});

test('rejects inline JavaScript after a quote in an unquoted attribute value', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture</title></head><body><script data=x">globalThis.__unquotedQuoteBypass = true; src=fake</script><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
});

test.each([
  ['src', 'data=x\u00a0src=/decoy.js', 'globalThis.__nbspSrcBypass = true;'],
  ['type', 'data=x\u00a0type=application/json', 'globalThis.__nbspTypeBypass = true;'],
] as const)(
  'rejects inline JavaScript when NBSP makes scanner-only %s text part of another attribute value',
  async (_label, attributes, body) => {
    const root = await createBuildFixture();
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html><head><title>Fixture</title></head><body><script ${attributes}>${body}</script><script type="module" src="/main.js"></script></body></html>`,
    );

    await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
  },
);

test('rejects inline JavaScript inside parsed template content', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture</title><template><script>globalThis.__templateInline = true;</script></template></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).rejects.toThrow(/inline executable script/i);
});

test('permits script-shaped comment and attribute text when every real script is external', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture</title></head><body><!-- <script>comment text</script> --><div data-note="<script>attribute text</script>"></div><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits an empty inline script node', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture</title><template><script></script></template></head><body><script></script><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits an ordinary external module when another attribute contains greater-than', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><title>Fixture</title></head><body><script data-note=">" type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('permits non-executable inline JSON data', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><script data-note=">" type="application/json">{"fixture":true}</script></head><body><script type="module" src="/main.js"></script></body></html>',
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
});

test('rejects an initial production JavaScript graph at or above 250 KiB gzip', async () => {
  const root = await createBuildFixture();
  const payload = deterministicBase64Payload(384 * 1024);
  await writeFile(
    join(root, 'main.js'),
    [
      `globalThis.__initialPayload = '${payload}';`,
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).rejects.toThrow(/250.*gzip|gzip.*250/i);
});

test('the actual production entry graph stays small and excludes emitted inference workers', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'open-voice-production-boundary-'));
  temporaryRoots.push(outDir);
  await build({
    root: APP_ROOT,
    configFile: join(APP_ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    resolve: {
      alias: {
        '@open-voice/contracts': resolve(APP_ROOT, '../../packages/contracts/src/index.ts'),
      },
    },
    build: {
      emptyOutDir: true,
      manifest: true,
      outDir,
      sourcemap: true,
    },
  });

  const manifest = JSON.parse(
    await readFile(join(outDir, '.vite', 'manifest.json'), 'utf8'),
  ) as Record<
    string,
    {
      file: string;
      imports?: string[];
      isDynamicEntry?: boolean;
      isEntry?: boolean;
      src?: string;
    }
  >;
  const entryKey = Object.entries(manifest).find(([, record]) => record.isEntry === true)?.[0];
  expect(entryKey).toBeDefined();
  const pending = [entryKey!];
  const initialKeys = new Set<string>();
  while (pending.length > 0) {
    const key = pending.shift()!;
    if (initialKeys.has(key)) continue;
    initialKeys.add(key);
    pending.push(...(manifest[key]?.imports ?? []));
  }
  const initialJavaScriptFiles = [...initialKeys]
    .map((key) => manifest[key]!.file)
    .filter((file) => /\.(?:js|mjs)$/.test(file));
  const initialGzipBytes = (
    await Promise.all(
      initialJavaScriptFiles.map(
        async (file) => gzipSync(await readFile(join(outDir, file)), { level: 9 }).byteLength,
      ),
    )
  ).reduce((total, bytes) => total + bytes, 0);
  expect(initialGzipBytes).toBeLessThan(250 * 1024);

  const factoryEntries = Object.entries(manifest).filter(([key, record]) =>
    /runtime[\\/]workers[\\/]factories[\\/](?:kokoro|kitten|supertonic|piper)\.ts$/.test(
      record.src ?? key,
    ),
  );
  expect(factoryEntries).toHaveLength(4);
  expect(factoryEntries.every(([, record]) => record.isDynamicEntry === true)).toBe(true);
  expect(new Set(factoryEntries.map(([, record]) => record.file)).size).toBe(4);
  for (const [key] of factoryEntries) expect(initialKeys).not.toContain(key);

  for (const file of initialJavaScriptFiles) {
    const sourceMap = JSON.parse(await readFile(join(outDir, `${file}.map`), 'utf8')) as {
      sources: string[];
    };
    expect(sourceMap.sources).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/runtime[\\/]workers|inference/i)]),
    );
  }

  const emitted = (await readdir(outDir, { recursive: true })).map((file) =>
    file.replaceAll('\\', '/'),
  );
  const workerFiles = emitted.filter((file) => /worker.*\.js$/i.test(file));
  expect(workerFiles.length).toBeGreaterThan(0);
  const serviceWorker = await readFile(join(outDir, 'sw.js'), 'utf8');
  const buildAssets = JSON.parse(
    serviceWorker.match(/const BUILD_ASSETS = (\[[^;]*\]);/)?.[1] ?? 'null',
  ) as string[] | null;
  expect(buildAssets).not.toBeNull();
  expect(buildAssets).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/worker|inference|\.wasm$|\.onnx$|\.bin$|\.safetensors$|\.npz$/i),
    ]),
  );
  for (const workerFile of workerFiles) {
    expect(buildAssets).not.toContain(`/${workerFile}`);
  }
  for (const [, factory] of factoryEntries) {
    expect(buildAssets).not.toContain(`/${factory.file}`);
    expect(initialJavaScriptFiles).not.toContain(factory.file);
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
