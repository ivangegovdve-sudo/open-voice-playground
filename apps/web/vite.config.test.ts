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

test('permits guarded runtime packages and Workers only through genuinely lazy graphs', async () => {
  const root = await createBuildFixture();
  await installFixtureInferencePackages(root);
  await mkdir(join(root, 'runtime', 'supertonic'), { recursive: true });
  await writeFile(
    join(root, 'runtime', 'supertonic', 'lazy.worker.mjs'),
    "self.postMessage('lazy runtime');",
  );
  await writeFile(
    join(root, 'main.js'),
    [
      "void import('onnxruntime-web/webgpu');",
      "new Worker(new URL('./runtime/supertonic/lazy.worker.mjs', import.meta.url), { type: 'module' });",
      "document.body.dataset.catalog = new URL('./launch-catalog.public.json', import.meta.url).href;",
    ].join('\n'),
  );

  await expect(buildMetadata(root)).resolves.toBeDefined();
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

test('permits non-executable inline JSON data', async () => {
  const root = await createBuildFixture();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><script type="application/json">{"fixture":true}</script></head><body><script type="module" src="/main.js"></script></body></html>',
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
