import { createHash } from 'node:crypto';

import type {
  AssetSetManifest,
  BrowserRuntimeArtifact,
  BrowserRuntimeSelection,
} from '@open-voice/contracts';

const SELECTION_DIGEST_DOMAIN = 'open-voice/browser-runtime-selection/v1';
const ONNXRUNTIME_WEB_TARBALL_URL =
  'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz';
const ONNXRUNTIME_WEB_TARBALL_INTEGRITY =
  'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==';
const ONNXRUNTIME_WEB_TARBALL_SHA1 = 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4';

export const BROWSER_RUNTIME_ARTIFACTS: readonly BrowserRuntimeArtifact[] = [
  {
    id: 'onnxruntime-web-wasm-runtime',
    backend: 'wasm',
    packageName: 'onnxruntime-web',
    packageVersion: '1.27.0',
    tarballUrl: ONNXRUNTIME_WEB_TARBALL_URL,
    tarballIntegrity: ONNXRUNTIME_WEB_TARBALL_INTEGRITY,
    tarballSha1: ONNXRUNTIME_WEB_TARBALL_SHA1,
    packagePath: 'dist/ort-wasm-simd-threaded.wasm',
    sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    bytes: 13_479_978,
    mediaType: 'application/wasm',
    cacheKey:
      'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded/d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    sourceIds: ['onnxruntime-web-source'],
    licenseIds: ['onnxruntime-web-runtime-license'],
  },
  {
    id: 'onnxruntime-web-webgpu-jsep-wasm',
    backend: 'webgpu',
    packageName: 'onnxruntime-web',
    packageVersion: '1.27.0',
    tarballUrl: ONNXRUNTIME_WEB_TARBALL_URL,
    tarballIntegrity: ONNXRUNTIME_WEB_TARBALL_INTEGRITY,
    tarballSha1: ONNXRUNTIME_WEB_TARBALL_SHA1,
    packagePath: 'dist/ort-wasm-simd-threaded.jsep.wasm',
    sha256: 'sha256:78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    bytes: 26_827_543,
    mediaType: 'application/wasm',
    cacheKey:
      'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded.jsep/78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    sourceIds: ['onnxruntime-web-source'],
    licenseIds: ['onnxruntime-web-runtime-license'],
  },
];

export type BrowserRuntimeSelectionIdentity = Omit<BrowserRuntimeSelection, 'selectionDigest'>;
export type BrowserRuntimeAssetSetAnchor = Pick<AssetSetManifest, 'id' | 'manifestDigest'>;

/**
 * Hashes an unambiguous fixed projection. Every scalar is one UTF-8 field;
 * ordered reference arrays are canonical JSON fields. NUL separates fields,
 * and the final field has no trailing separator.
 */
export function computeBrowserRuntimeSelectionDigest(
  selection: BrowserRuntimeSelectionIdentity,
  assetSet: BrowserRuntimeAssetSetAnchor,
  artifact: BrowserRuntimeArtifact,
): `sha256:${string}` {
  const fields = [
    SELECTION_DIGEST_DOMAIN,
    selection.id,
    selection.engineId,
    selection.backend,
    selection.assetSetId,
    selection.runtimeArtifactId,
    assetSet.id,
    assetSet.manifestDigest,
    artifact.id,
    artifact.backend,
    artifact.packageName,
    artifact.packageVersion,
    artifact.tarballUrl,
    artifact.tarballIntegrity,
    artifact.tarballSha1,
    artifact.packagePath,
    artifact.sha256,
    String(artifact.bytes),
    artifact.mediaType,
    artifact.cacheKey,
    JSON.stringify(artifact.sourceIds),
    JSON.stringify(artifact.licenseIds),
  ];
  return `sha256:${createHash('sha256').update(fields.join('\0'), 'utf8').digest('hex')}`;
}

export function buildBrowserRuntimeSelections(
  assetSet: BrowserRuntimeAssetSetAnchor,
): BrowserRuntimeSelection[] {
  return BROWSER_RUNTIME_ARTIFACTS.map((artifact) => {
    const identity: BrowserRuntimeSelectionIdentity = {
      id: artifact.backend === 'webgpu' ? 'supertonic-webgpu' : 'supertonic-wasm',
      engineId: 'supertonic',
      backend: artifact.backend,
      assetSetId: assetSet.id,
      runtimeArtifactId: artifact.id,
    };
    return {
      ...identity,
      selectionDigest: computeBrowserRuntimeSelectionDigest(identity, assetSet, artifact),
    };
  });
}
