import type {
  BrowserRuntimeArtifact,
  BrowserRuntimeBackend,
  BrowserRuntimeSelection,
} from '@open-voice/contracts';

type RuntimeArtifactUrlModule = { default: string };
type RuntimeArtifactUrlImporter = () => Promise<RuntimeArtifactUrlModule>;
type RuntimeArtifactUrlImporters = Readonly<
  Record<BrowserRuntimeBackend, RuntimeArtifactUrlImporter>
>;

export type ResolvedBrowserRuntimeArtifact = BrowserRuntimeArtifact & { url: string };
export type SupertonicRuntimeArtifactResolver = (
  selection: BrowserRuntimeSelection,
  artifact: BrowserRuntimeArtifact,
) => Promise<ResolvedBrowserRuntimeArtifact>;

const expectedArtifacts: Readonly<Record<BrowserRuntimeBackend, BrowserRuntimeArtifact>> = {
  webgpu: {
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
  },
  wasm: {
    id: 'onnxruntime-web-wasm-runtime',
    backend: 'wasm',
    packageName: 'onnxruntime-web',
    packageVersion: '1.27.0',
    tarballUrl: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz',
    tarballIntegrity:
      'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==',
    tarballSha1: 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4',
    packagePath: 'dist/ort-wasm-simd-threaded.wasm',
    sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    bytes: 13_479_978,
    mediaType: 'application/wasm',
    cacheKey:
      'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded/d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    sourceIds: ['onnxruntime-web-source'],
    licenseIds: ['onnxruntime-web-runtime-license'],
  },
};

const expectedSelections: Readonly<Record<BrowserRuntimeBackend, BrowserRuntimeSelection>> = {
  webgpu: {
    id: 'supertonic-webgpu',
    engineId: 'supertonic',
    backend: 'webgpu',
    assetSetId: 'supertonic-browser-assets',
    runtimeArtifactId: 'onnxruntime-web-webgpu-jsep-wasm',
    selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
  },
  wasm: {
    id: 'supertonic-wasm',
    engineId: 'supertonic',
    backend: 'wasm',
    assetSetId: 'supertonic-browser-assets',
    runtimeArtifactId: 'onnxruntime-web-wasm-runtime',
    selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
  },
};

const defaultImporters: RuntimeArtifactUrlImporters = {
  webgpu: () => import('onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'),
  wasm: () => import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
};

function sameIdentity(left: unknown, right: unknown): boolean {
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) return false;
  return leftKeys.every((key) => {
    const leftValue = leftRecord[key];
    const rightValue = rightRecord[key];
    return Array.isArray(leftValue) && Array.isArray(rightValue)
      ? JSON.stringify(leftValue) === JSON.stringify(rightValue)
      : leftValue === rightValue;
  });
}

export function createSupertonicRuntimeArtifactResolver(
  importers: RuntimeArtifactUrlImporters,
  currentUrl: () => string,
): SupertonicRuntimeArtifactResolver {
  return async (selection, artifact) => {
    const expectedSelection = expectedSelections[selection.backend];
    const expectedArtifact = expectedArtifacts[selection.backend];
    if (
      expectedSelection === undefined ||
      expectedArtifact === undefined ||
      !sameIdentity(selection, expectedSelection) ||
      !sameIdentity(artifact, expectedArtifact)
    ) {
      throw new Error('Supertonic runtime artifact identity does not match the frozen selection.');
    }

    const baseUrl = new URL(currentUrl());
    const imported = await importers[selection.backend]();
    if (typeof imported.default !== 'string' || imported.default.length === 0) {
      throw new Error('Supertonic runtime artifact URL module is malformed.');
    }
    const emittedUrl = new URL(imported.default, baseUrl);
    if (
      emittedUrl.origin !== baseUrl.origin ||
      emittedUrl.username.length !== 0 ||
      emittedUrl.password.length !== 0
    ) {
      throw new Error(
        'Supertonic runtime artifact URL must remain on the application same origin.',
      );
    }
    return {
      ...artifact,
      sourceIds: [...artifact.sourceIds],
      licenseIds: [...artifact.licenseIds],
      url: emittedUrl.href,
    };
  };
}

export const resolveSupertonicRuntimeArtifact = createSupertonicRuntimeArtifactResolver(
  defaultImporters,
  () => globalThis.location.href,
);
