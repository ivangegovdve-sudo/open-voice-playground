import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { BrowserRuntimeArtifact, BrowserRuntimeSelection } from '@open-voice/contracts';

import {
  createSupertonicRuntimeArtifactResolver,
  resolveSupertonicRuntimeArtifact,
} from './runtime-artifacts';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..', '..', '..', '..', '..');

const webgpuArtifact: BrowserRuntimeArtifact = {
  id: 'onnxruntime-web-webgpu-jsep-wasm',
  backend: 'webgpu',
  packageName: 'onnxruntime-web',
  packageVersion: '1.27.0',
  tarballUrl: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz',
  tarballIntegrity:
    'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==',
  tarballSha1: 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4',
  packagePath: 'dist/ort-wasm-simd-threaded.jsep.wasm',
  sha256: 'sha256:78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
  bytes: 26_827_543,
  mediaType: 'application/wasm',
  cacheKey:
    'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded.jsep/78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
  sourceIds: ['onnxruntime-web-source'],
  licenseIds: ['onnxruntime-web-runtime-license'],
};

const wasmArtifact: BrowserRuntimeArtifact = {
  ...webgpuArtifact,
  id: 'onnxruntime-web-wasm-runtime',
  backend: 'wasm',
  packagePath: 'dist/ort-wasm-simd-threaded.wasm',
  sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
  bytes: 13_479_978,
  cacheKey:
    'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded/d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
};

const webgpuSelection: BrowserRuntimeSelection = {
  id: 'supertonic-webgpu',
  engineId: 'supertonic',
  backend: 'webgpu',
  assetSetId: 'supertonic-browser-assets',
  runtimeArtifactId: webgpuArtifact.id,
  selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
};

type IdentityMutation = {
  selection?: Record<string, unknown>;
  artifact?: Record<string, unknown>;
};

const IDENTITY_MUTATIONS: ReadonlyArray<readonly [string, IdentityMutation]> = [
  ['selection ID', { selection: { id: 'supertonic-wasm' } }],
  ['engine ID', { selection: { engineId: 'kokoro' } }],
  ['selection backend', { selection: { backend: 'wasm' } }],
  ['asset-set ID', { selection: { assetSetId: 'kitten-browser-assets' } }],
  ['artifact reference', { selection: { runtimeArtifactId: wasmArtifact.id } }],
  ['selection digest', { selection: { selectionDigest: `sha256:${'0'.repeat(64)}` } }],
  ['artifact ID', { artifact: { id: wasmArtifact.id } }],
  ['artifact backend', { artifact: { backend: 'wasm' } }],
  ['artifact path', { artifact: { packagePath: wasmArtifact.packagePath } }],
  ['artifact package', { artifact: { packageVersion: '1.27.1' } }],
  ['artifact digest', { artifact: { sha256: wasmArtifact.sha256 } }],
  ['artifact byte count', { artifact: { bytes: webgpuArtifact.bytes + 1 } }],
];

describe('Supertonic runtime artifact closure', () => {
  it('pins the exact root lock resolution and installed ONNX Runtime Web binaries', async () => {
    const [
      webPackageText,
      lockText,
      installedPackageText,
      canonicalCatalogText,
      installedPackageFiles,
      webgpuBytes,
      wasmBytes,
    ] = await Promise.all([
      readFile(join(repositoryRoot, 'apps', 'web', 'package.json'), 'utf8'),
      readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'),
      readFile(join(repositoryRoot, 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8'),
      readFile(
        join(repositoryRoot, 'packages', 'catalog', 'data', 'launch-catalog.public.json'),
        'utf8',
      ),
      readdir(join(repositoryRoot, 'node_modules', 'onnxruntime-web')),
      readFile(
        join(
          repositoryRoot,
          'node_modules',
          'onnxruntime-web',
          'dist',
          'ort-wasm-simd-threaded.jsep.wasm',
        ),
      ),
      readFile(
        join(
          repositoryRoot,
          'node_modules',
          'onnxruntime-web',
          'dist',
          'ort-wasm-simd-threaded.wasm',
        ),
      ),
    ]);
    const webPackage = JSON.parse(webPackageText) as { dependencies: Record<string, string> };
    const lock = JSON.parse(lockText) as {
      packages: Record<
        string,
        {
          version?: string;
          resolved?: string;
          integrity?: string;
          dependencies?: Record<string, string>;
        }
      >;
    };
    const installedPackage = JSON.parse(installedPackageText) as { name: string; version: string };
    const canonicalCatalog = JSON.parse(canonicalCatalogText) as {
      runtimeArtifacts: BrowserRuntimeArtifact[];
      runtimeSelections: BrowserRuntimeSelection[];
    };
    const locked = lock.packages['node_modules/onnxruntime-web'];
    const canonicalWebgpu = canonicalCatalog.runtimeArtifacts.find(
      ({ id }) => id === webgpuArtifact.id,
    );
    const canonicalWasm = canonicalCatalog.runtimeArtifacts.find(
      ({ id }) => id === wasmArtifact.id,
    );
    const canonicalWebgpuSelection = canonicalCatalog.runtimeSelections.find(
      ({ id }) => id === webgpuSelection.id,
    );

    expect(webPackage.dependencies['onnxruntime-web']).toBe('1.27.0');
    expect(lock.packages['apps/web']?.dependencies?.['onnxruntime-web']).toBe('1.27.0');
    expect(locked).toMatchObject({
      version: '1.27.0',
      resolved: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz',
      integrity:
        'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==',
    });
    expect(installedPackage).toMatchObject({ name: 'onnxruntime-web', version: '1.27.0' });
    expect(installedPackageFiles.some((file) => /^licen[sc]e(?:\.|$)/i.test(file))).toBe(false);
    expect(canonicalWebgpu).toEqual(webgpuArtifact);
    expect(canonicalWasm).toEqual(wasmArtifact);
    expect(canonicalWebgpuSelection).toEqual(webgpuSelection);
    expect(webgpuBytes.byteLength).toBe(canonicalWebgpu?.bytes);
    expect(`sha256:${createHash('sha256').update(webgpuBytes).digest('hex')}`).toBe(
      canonicalWebgpu?.sha256,
    );
    expect(wasmBytes.byteLength).toBe(canonicalWasm?.bytes);
    expect(`sha256:${createHash('sha256').update(wasmBytes).digest('hex')}`).toBe(
      canonicalWasm?.sha256,
    );
  });

  it('loads only the selected backend and returns an absolute same-origin identity', async () => {
    const webgpu = vi.fn(async () => ({ default: '/assets/ort-webgpu.wasm' }));
    const wasm = vi.fn(async () => ({ default: '/assets/ort-wasm.wasm' }));
    const resolveArtifact = createSupertonicRuntimeArtifactResolver(
      { webgpu, wasm },
      () => 'https://atlas.example/play',
    );

    await expect(resolveArtifact(webgpuSelection, webgpuArtifact)).resolves.toEqual({
      ...webgpuArtifact,
      url: 'https://atlas.example/assets/ort-webgpu.wasm',
    });
    expect(webgpu).toHaveBeenCalledOnce();
    expect(wasm).not.toHaveBeenCalled();
  });

  it('compares closed field values without trusting object insertion order', async () => {
    const resolveArtifact = createSupertonicRuntimeArtifactResolver(
      {
        webgpu: vi.fn(async () => ({ default: '/assets/ort-webgpu.wasm' })),
        wasm: vi.fn(async () => ({ default: '/assets/ort-wasm.wasm' })),
      },
      () => 'https://atlas.example/play',
    );
    const reorderedSelection = Object.fromEntries(
      Object.entries(webgpuSelection).reverse(),
    ) as BrowserRuntimeSelection;
    const reorderedArtifact = Object.fromEntries(
      Object.entries(webgpuArtifact).reverse(),
    ) as BrowserRuntimeArtifact;

    await expect(resolveArtifact(reorderedSelection, reorderedArtifact)).resolves.toMatchObject({
      id: webgpuArtifact.id,
      url: 'https://atlas.example/assets/ort-webgpu.wasm',
    });
  });

  it.each(IDENTITY_MUTATIONS)(
    'rejects a mismatched %s before importing runtime bytes',
    async (_label, mutation) => {
      const webgpu = vi.fn(async () => ({ default: '/assets/ort-webgpu.wasm' }));
      const resolveArtifact = createSupertonicRuntimeArtifactResolver(
        { webgpu, wasm: vi.fn(async () => ({ default: '/assets/ort-wasm.wasm' })) },
        () => 'https://atlas.example/play',
      );

      await expect(
        resolveArtifact(
          { ...webgpuSelection, ...(mutation.selection ?? {}) } as BrowserRuntimeSelection,
          { ...webgpuArtifact, ...(mutation.artifact ?? {}) } as BrowserRuntimeArtifact,
        ),
      ).rejects.toThrow(/runtime artifact identity/i);
      expect(webgpu).not.toHaveBeenCalled();
    },
  );

  it('rejects an emitted runtime URL whose final origin differs', async () => {
    const resolveArtifact = createSupertonicRuntimeArtifactResolver(
      {
        webgpu: vi.fn(async () => ({ default: 'https://cdn.example/runtime.wasm' })),
        wasm: vi.fn(async () => ({ default: '/assets/ort-wasm.wasm' })),
      },
      () => 'https://atlas.example/play',
    );

    await expect(resolveArtifact(webgpuSelection, webgpuArtifact)).rejects.toThrow(/same origin/i);
  });

  it('keeps both package-exported URL imports literal and lazy', async () => {
    const source = await readFile(join(currentDirectory, 'runtime-artifacts.ts'), 'utf8');

    expect(
      source.match(/import\('onnxruntime-web\/ort-wasm-simd-threaded\.jsep\.wasm\?url'\)/g),
    ).toHaveLength(1);
    expect(
      source.match(/import\('onnxruntime-web\/ort-wasm-simd-threaded\.wasm\?url'\)/g),
    ).toHaveLength(1);
    expect(source).not.toMatch(/from ['"]onnxruntime-web\//);
  });

  it('exposes the production resolver without importing a runtime during module evaluation', () => {
    expect(resolveSupertonicRuntimeArtifact).toBeTypeOf('function');
  });
});
