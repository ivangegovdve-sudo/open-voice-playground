import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import * as contracts from '../src/index.js';

const api = contracts as Record<string, unknown>;

function schema(name: string): ZodType {
  expect(api[name], `${name} should be exported`).toBeDefined();
  return api[name] as ZodType;
}

const releaseGate = {
  status: 'enabled',
  reason: null,
  detail: 'Reviewed for the browser launch.',
};

const immutableAsset = {
  id: 'kokoro-model-q8',
  url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model_q8f16.onnx',
  approvedFinalOrigins: ['https://cas-bridge.xethub.hf.co'],
  revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
  sha256: 'sha256:04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0',
  bytes: 86_033_585,
  cacheKey: 'kokoro/model-q8f16/1939ad2a',
  mediaType: 'application/onnx',
  sourceIds: ['kokoro-onnx-source'],
  licenseIds: ['kokoro-weights-license'],
  requiredAcceptance: null,
};

describe('launch release and asset contracts', () => {
  it('requires one or more unique language tags on every preset', () => {
    const voiceSchema = schema('VoicePresetSchema');
    const voice = {
      id: 'supertone:m1',
      engineId: 'supertone',
      upstreamId: 'm1',
      displayName: 'M1',
      locale: 'en',
      languageTags: ['en', 'bg'],
      gender: 'male',
      runtimeModes: ['browser'],
      styleTags: [],
      licenseIds: ['supertone-voice-license'],
      sourceIds: ['supertone-source'],
    };

    expect(voiceSchema.safeParse(voice).success).toBe(true);
    expect(voiceSchema.safeParse({ ...voice, languageTags: [] }).success).toBe(false);
    expect(voiceSchema.safeParse({ ...voice, languageTags: ['en', 'en'] }).success).toBe(false);
    const { languageTags: _languageTags, ...withoutLanguageTags } = voice;
    expect(voiceSchema.safeParse(withoutLanguageTags).success).toBe(false);
  });

  it('requires an honest enabled or unavailable release gate', () => {
    const releaseGateSchema = schema('ReleaseGateSchema');

    expect(releaseGateSchema.safeParse(releaseGate).success).toBe(true);
    expect(
      releaseGateSchema.safeParse({
        status: 'unavailable',
        reason: 'terms-not-cleared',
        detail: 'No consumer-service request path is shipped.',
      }).success,
    ).toBe(true);
    expect(
      releaseGateSchema.safeParse({ ...releaseGate, reason: 'asset-unavailable' }).success,
    ).toBe(false);
    expect(
      releaseGateSchema.safeParse({ status: 'unavailable', reason: null, detail: 'Hidden.' })
        .success,
    ).toBe(false);
  });

  it('accepts only credential-free immutable HTTPS assets with complete evidence', () => {
    const assetSchema = schema('ImmutableAssetSchema');

    expect(assetSchema.safeParse(immutableAsset).success).toBe(true);
    for (const unsafeUrl of [
      'http://huggingface.co/model.onnx',
      'https://token@example.com/model.onnx',
      'https://huggingface.co/model/resolve/main/model.onnx',
      'https://huggingface.co/model/resolve/refs%2Fheads%2Fmain/model.onnx',
    ]) {
      expect(assetSchema.safeParse({ ...immutableAsset, url: unsafeUrl }).success).toBe(false);
    }
    expect(assetSchema.safeParse({ ...immutableAsset, revision: 'main' }).success).toBe(false);
    expect(
      assetSchema.safeParse({ ...immutableAsset, sha256: 'sha256:not-a-digest' }).success,
    ).toBe(false);
    expect(assetSchema.safeParse({ ...immutableAsset, cacheKey: '../model' }).success).toBe(false);
    expect(assetSchema.safeParse({ ...immutableAsset, bytes: 0 }).success).toBe(false);
  });

  it('requires an exact, unique HTTPS final-origin allowlist on every immutable asset', () => {
    const assetSchema = schema('ImmutableAssetSchema');
    const approved = {
      ...immutableAsset,
      approvedFinalOrigins: ['https://huggingface.co', 'https://cas-bridge.xethub.hf.co'],
    };

    expect(assetSchema.safeParse(approved).success).toBe(true);
    const { approvedFinalOrigins: _approvedFinalOrigins, ...withoutOrigins } = immutableAsset;
    expect(assetSchema.safeParse(withoutOrigins).success).toBe(false);
    for (const invalidOrigins of [
      [],
      ['http://huggingface.co'],
      ['https://token@huggingface.co'],
      ['https://huggingface.co/models'],
      ['https://huggingface.co?download=true'],
      ['https://huggingface.co', 'https://huggingface.co'],
    ]) {
      expect(
        assetSchema.safeParse({ ...approved, approvedFinalOrigins: invalidOrigins }).success,
      ).toBe(false);
    }
  });

  it('records pinned release-asset evidence separately from browser-fetchable assets', () => {
    const evidenceSchema = schema('PinnedReleaseAssetEvidenceSchema');
    const evidence = {
      id: 'piper-thorsten-int8-release-asset',
      voiceId: 'piper:de_DE-thorsten-medium',
      provider: 'github-release-asset',
      repository: 'k2-fsa/sherpa-onnx',
      releaseId: 130612623,
      assetId: 324199311,
      assetName: 'vits-piper-de_DE-thorsten-medium-int8.tar.bz2',
      apiUrl: 'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/324199311',
      browserDownloadUrl:
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-de_DE-thorsten-medium-int8.tar.bz2',
      sha256: 'sha256:07e240b7b9c1fc9211d5a69512f8cbe11b3286c2ed79c15c076ac6ed427fdf13',
      bytes: 20_949_833,
      createdAt: '2025-12-04T06:02:19Z',
      updatedAt: '2025-12-04T06:02:20Z',
      corsReadable: false,
      sourceIds: ['piper-sherpa-source'],
      licenseIds: ['piper-voice-license'],
    };

    expect(evidenceSchema.safeParse(evidence).success).toBe(true);
    expect(evidenceSchema.safeParse({ ...evidence, corsReadable: true }).success).toBe(false);
    expect(
      evidenceSchema.safeParse({ ...evidence, apiUrl: evidence.apiUrl.replace('324199311', '1') })
        .success,
    ).toBe(false);
    expect(
      evidenceSchema.safeParse({ ...evidence, browserDownloadUrl: 'https://example.com/model' })
        .success,
    ).toBe(false);
  });

  it('records representative browser delivery checks without overstating all-asset coverage', () => {
    const deliverySchema = schema('AssetDeliveryEvidenceSchema');
    const evidence = {
      id: 'kokoro-browser-delivery-2026-07-16',
      engineId: 'kokoro',
      assetSetIds: ['kokoro-af-heart'],
      checkedAssetIds: ['onnx-model-q8f16-onnx', 'voices-af-heart-bin'],
      scope: 'representative-assets',
      result: 'representative-pass',
      checkedAt: '2026-07-16T00:00:00.000Z',
      browser: 'Chromium automated browser check',
      origin: 'http://127.0.0.1:4173',
      request: {
        method: 'GET',
        rangeHeader: 'bytes=0-0',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
      },
      observations: [
        {
          assetId: 'onnx-model-q8f16-onnx',
          responseType: 'cors',
          status: 206,
          bytesRead: 1,
          contentRange: 'bytes 0-0/86033585',
        },
        {
          assetId: 'voices-af-heart-bin',
          responseType: 'cors',
          status: 206,
          bytesRead: 1,
          contentRange: 'bytes 0-0/522240',
        },
      ],
      detail:
        'Only the named representative assets were checked. Runtime enablement still requires all assets.',
    };

    expect(deliverySchema.safeParse(evidence).success).toBe(true);
    expect(
      deliverySchema.safeParse({
        ...evidence,
        result: 'all-required-pass',
      }).success,
    ).toBe(false);
    expect(
      deliverySchema.safeParse({
        ...evidence,
        scope: 'all-required-assets',
        result: 'all-required-pass',
      }).success,
    ).toBe(true);
  });

  it('binds asset sets to a manifest digest, exact byte total, and acceptance records', () => {
    const assetSetSchema = schema('AssetSetManifestSchema');
    const assetSet = {
      id: 'kokoro-browser-assets',
      engineId: 'kokoro',
      manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
      assets: [immutableAsset],
      totalBytes: immutableAsset.bytes,
      requiredAcceptanceLicenseIds: [],
      releaseGate,
    };

    expect(assetSetSchema.safeParse(assetSet).success).toBe(true);
    expect(assetSetSchema.safeParse({ ...assetSet, totalBytes: 1 }).success).toBe(false);
    expect(
      assetSetSchema.safeParse({ ...assetSet, assets: [immutableAsset, immutableAsset] }).success,
    ).toBe(false);
  });

  it('validates the structure of a deterministic machine-readable browser S0 evidence record', () => {
    const evidenceSchema = schema('BrowserRuntimeS0EvidenceStructureSchema');
    const evidence = {
      schemaVersion: 1,
      kind: 'open-voice-browser-runtime-s0',
      assetSetId: 'test-browser-assets',
      manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
      consent: {
        assetSetId: 'test-browser-assets',
        manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
        acceptedLicenseIds: ['test-license'],
        acceptedTermsHashes: [],
      },
      storage: {
        selectedBytes: 4,
        largestAssetBytes: 4,
        safetyMarginBytes: 8 * 1024 * 1024,
        upperBoundBytes: 8 * 1024 * 1024 + 8,
        persisted: true,
        quotaBytes: 64 * 1024 * 1024,
        usageBytes: 1024,
        retainedBytes: 0,
        candidateBytes: 4,
        largestTemporaryBytes: 4,
        additionalRequiredBytes: 8 * 1024 * 1024 + 8,
        requiredCapacityBytes: 8 * 1024 * 1024 + 8,
      },
      assets: [
        {
          assetId: 'test-model',
          cacheKey: 'test/model/0123456789ab',
          disposition: 'downloaded',
          requestUrl:
            'https://example.com/model/0123456789abcdef0123456789abcdef01234567/model.onnx',
          finalUrl: 'https://assets.example.com/model.onnx',
          finalOrigin: 'https://assets.example.com',
          responseType: 'cors',
          status: 200,
          expectedBytes: 4,
          observedBytes: 4,
          expectedSha256: immutableAsset.sha256,
          observedSha256: immutableAsset.sha256,
        },
      ],
    };

    expect(evidenceSchema.safeParse(evidence).success).toBe(true);
    expect(
      evidenceSchema.safeParse({
        ...evidence,
        consent: { ...evidence.consent, assetSetId: 'other-assets' },
      }).success,
    ).toBe(false);
    expect(
      evidenceSchema.safeParse({
        ...evidence,
        storage: { ...evidence.storage, candidateBytes: 5 },
      }).success,
    ).toBe(false);
    expect(
      evidenceSchema.safeParse({
        ...evidence,
        assets: [
          {
            ...evidence.assets[0],
            finalOrigin: 'https://unapproved.example',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      evidenceSchema.safeParse({
        ...evidence,
        assets: [
          {
            ...evidence.assets[0],
            disposition: 'cache-hit',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('binds browser S0 evidence to every trusted asset-manifest identity and total', () => {
    const structureSchema = schema('BrowserRuntimeS0EvidenceStructureSchema');
    const parseEvidence = api.parseBrowserRuntimeS0Evidence;
    expect(parseEvidence).toBeTypeOf('function');
    const parse = parseEvidence as (value: unknown, trustedAssetSet: unknown) => unknown;
    const revision = '0123456789abcdef0123456789abcdef01234567';
    const firstAsset = {
      ...immutableAsset,
      id: 'test-model',
      url: `https://example.com/model/${revision}/model.onnx`,
      approvedFinalOrigins: ['https://assets.example.com'],
      revision,
      bytes: 4,
      cacheKey: 'test/model/0123456789ab',
      sourceIds: ['test-source'],
      licenseIds: ['test-license'],
    };
    const secondAsset = {
      ...firstAsset,
      id: 'test-voice',
      url: `https://example.com/model/${revision}/voice.bin`,
      approvedFinalOrigins: ['https://cdn.example.com'],
      sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      bytes: 6,
      cacheKey: 'test/voice/0123456789ab',
      mediaType: 'application/octet-stream',
    };
    const assetSet = {
      id: 'test-browser-assets',
      engineId: 'test-engine',
      manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
      assets: [firstAsset, secondAsset],
      totalBytes: 10,
      requiredAcceptanceLicenseIds: ['test-license'],
      releaseGate,
    };
    const margin = 8 * 1024 * 1024;
    const evidence = {
      schemaVersion: 1,
      kind: 'open-voice-browser-runtime-s0',
      assetSetId: assetSet.id,
      manifestDigest: assetSet.manifestDigest,
      consent: {
        assetSetId: assetSet.id,
        manifestDigest: assetSet.manifestDigest,
        acceptedLicenseIds: ['test-license'],
        acceptedTermsHashes: [],
      },
      storage: {
        selectedBytes: 10,
        largestAssetBytes: 6,
        safetyMarginBytes: margin,
        upperBoundBytes: margin + 16,
        persisted: true,
        quotaBytes: 64 * 1024 * 1024,
        usageBytes: 1024,
        retainedBytes: 6,
        candidateBytes: 4,
        largestTemporaryBytes: 4,
        additionalRequiredBytes: margin + 8,
        requiredCapacityBytes: margin + 14,
      },
      assets: [
        {
          assetId: firstAsset.id,
          cacheKey: firstAsset.cacheKey,
          disposition: 'downloaded',
          requestUrl: firstAsset.url,
          finalUrl: 'https://assets.example.com/model.onnx',
          finalOrigin: 'https://assets.example.com',
          responseType: 'cors',
          status: 200,
          expectedBytes: firstAsset.bytes,
          observedBytes: firstAsset.bytes,
          expectedSha256: firstAsset.sha256,
          observedSha256: firstAsset.sha256,
        },
        {
          assetId: secondAsset.id,
          cacheKey: secondAsset.cacheKey,
          disposition: 'cache-hit',
          requestUrl: null,
          finalUrl: null,
          finalOrigin: null,
          responseType: null,
          status: null,
          expectedBytes: secondAsset.bytes,
          observedBytes: secondAsset.bytes,
          expectedSha256: secondAsset.sha256,
          observedSha256: secondAsset.sha256,
        },
      ],
    };

    expect(parse(evidence, assetSet)).toEqual(evidence);

    const unrelatedDigest = `sha256:${'a'.repeat(64)}`;
    const mutations: Array<[string, unknown]> = [
      ['asset order', { ...evidence, assets: [evidence.assets[1], evidence.assets[0]] }],
      [
        'asset ID',
        {
          ...evidence,
          assets: [{ ...evidence.assets[0], assetId: 'other-model' }, evidence.assets[1]],
        },
      ],
      [
        'cache key',
        {
          ...evidence,
          assets: [
            { ...evidence.assets[0], cacheKey: 'other/model/0123456789ab' },
            evidence.assets[1],
          ],
        },
      ],
      [
        'request URL',
        {
          ...evidence,
          assets: [
            { ...evidence.assets[0], requestUrl: 'https://mirror.example.com/model.onnx' },
            evidence.assets[1],
          ],
        },
      ],
      [
        'byte identity',
        {
          ...evidence,
          assets: [
            { ...evidence.assets[0], expectedBytes: 5, observedBytes: 5 },
            evidence.assets[1],
          ],
        },
      ],
      [
        'hash identity',
        {
          ...evidence,
          assets: [
            {
              ...evidence.assets[0],
              expectedSha256: unrelatedDigest,
              observedSha256: unrelatedDigest,
            },
            evidence.assets[1],
          ],
        },
      ],
      [
        'approved final origin',
        {
          ...evidence,
          assets: [
            {
              ...evidence.assets[0],
              finalUrl: 'https://evil.example/model.onnx',
              finalOrigin: 'https://evil.example',
            },
            evidence.assets[1],
          ],
        },
      ],
      [
        'manifest digest string',
        {
          ...evidence,
          manifestDigest: unrelatedDigest,
          consent: { ...evidence.consent, manifestDigest: unrelatedDigest },
        },
      ],
      [
        'disposition storage arithmetic',
        {
          ...evidence,
          storage: {
            ...evidence.storage,
            retainedBytes: 5,
            candidateBytes: 5,
            largestTemporaryBytes: 5,
            additionalRequiredBytes: margin + 10,
            requiredCapacityBytes: margin + 15,
          },
        },
      ],
      [
        'manifest totals',
        {
          ...evidence,
          storage: {
            ...evidence.storage,
            selectedBytes: 11,
            upperBoundBytes: margin + 17,
            retainedBytes: 5,
            candidateBytes: 6,
            largestTemporaryBytes: 6,
            additionalRequiredBytes: margin + 12,
            requiredCapacityBytes: margin + 17,
          },
        },
      ],
    ];
    for (const [label, mutation] of mutations) {
      expect(
        structureSchema.safeParse(mutation).success,
        `${label} is structurally plausible`,
      ).toBe(true);
      expect(() => parse(mutation, assetSet), `${label} must be manifest-bound`).toThrow();
    }
  });

  it('keeps future Azure server-only, hard-disabled, terms-gated, and zero-budget', () => {
    const featureFlagSchema = schema('FeatureFlagSchema');
    const azure = {
      id: 'future-azure-inference',
      enabled: false,
      serverOnlyCredentials: true,
      termsCleared: false,
      monthlyBudgetUsd: 0,
      hardStop: true,
      characterLimit: 0,
      spendLimitUsd: 0,
    };

    expect(featureFlagSchema.safeParse(azure).success).toBe(true);
    expect(featureFlagSchema.safeParse({ ...azure, enabled: true }).success).toBe(false);
    expect(featureFlagSchema.safeParse({ ...azure, monthlyBudgetUsd: 1 }).success).toBe(false);
  });
});

describe('browser runtime artifact contracts', () => {
  const webgpuArtifact = {
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
  } as const;
  const wasmArtifact = {
    ...webgpuArtifact,
    id: 'onnxruntime-web-wasm-runtime',
    backend: 'wasm',
    packagePath: 'dist/ort-wasm-simd-threaded.wasm',
    sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    bytes: 13_479_978,
    cacheKey:
      'runtime/onnxruntime-web/1.27.0/ort-wasm-simd-threaded/d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
  } as const;
  const webgpuSelection = {
    id: 'supertonic-webgpu',
    engineId: 'supertonic',
    backend: 'webgpu',
    assetSetId: 'supertonic-browser-assets',
    runtimeArtifactId: webgpuArtifact.id,
    selectionDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  } as const;

  it('exports a dedicated closed backend and exact runtime artifact schema', () => {
    const backendSchema = schema('BrowserRuntimeBackendSchema');
    const artifactSchema = schema('BrowserRuntimeArtifactSchema');

    expect(backendSchema.safeParse('webgpu').success).toBe(true);
    expect(backendSchema.safeParse('wasm').success).toBe(true);
    expect(backendSchema.safeParse('webgpu-wasm').success).toBe(false);
    expect(artifactSchema.safeParse(webgpuArtifact).success).toBe(true);
    expect(artifactSchema.safeParse(wasmArtifact).success).toBe(true);
    expect(artifactSchema.safeParse({ ...webgpuArtifact, unexpected: true }).success).toBe(false);
  });

  it.each([
    ['floating package version', { packageVersion: '^1.27.0' }],
    ['wrong package', { packageName: 'onnxruntime-node' }],
    ['wrong tarball URL', { tarballUrl: 'https://cdn.example/onnxruntime-web.tgz' }],
    ['wrong tarball integrity', { tarballIntegrity: 'sha512-not-the-locked-tarball' }],
    ['wrong tarball SHA-1', { tarballSha1: `sha1:${'0'.repeat(40)}` }],
    ['unsafe parent path', { packagePath: '../dist/runtime.wasm' }],
    ['absolute path', { packagePath: '/dist/runtime.wasm' }],
    ['backend/path mismatch', { packagePath: wasmArtifact.packagePath }],
    ['wrong media type', { mediaType: 'application/octet-stream' }],
    ['nonpositive bytes', { bytes: 0 }],
    ['duplicate sources', { sourceIds: ['onnxruntime-web-source', 'onnxruntime-web-source'] }],
    [
      'duplicate licenses',
      {
        licenseIds: ['onnxruntime-web-runtime-license', 'onnxruntime-web-runtime-license'],
      },
    ],
  ])('rejects %s', (_label, mutation) => {
    expect(
      schema('BrowserRuntimeArtifactSchema').safeParse({
        ...webgpuArtifact,
        ...mutation,
      }).success,
    ).toBe(false);
  });

  it('requires unique artifact IDs and unique selection IDs', () => {
    const artifactsSchema = schema('BrowserRuntimeArtifactsSchema');
    const selectionsSchema = schema('BrowserRuntimeSelectionsSchema');

    expect(artifactsSchema.safeParse([webgpuArtifact, wasmArtifact]).success).toBe(true);
    expect(artifactsSchema.safeParse([webgpuArtifact, webgpuArtifact]).success).toBe(false);
    expect(selectionsSchema.safeParse([webgpuSelection]).success).toBe(true);
    expect(selectionsSchema.safeParse([webgpuSelection, webgpuSelection]).success).toBe(false);
  });

  it('requires a closed five-field selection identity plus its digest', () => {
    const selectionSchema = schema('BrowserRuntimeSelectionSchema');

    expect(selectionSchema.safeParse(webgpuSelection).success).toBe(true);
    expect(selectionSchema.safeParse({ ...webgpuSelection, unexpected: true }).success).toBe(false);
    for (const field of [
      'id',
      'engineId',
      'backend',
      'assetSetId',
      'runtimeArtifactId',
      'selectionDigest',
    ] as const) {
      const candidate = { ...webgpuSelection } as Record<string, unknown>;
      delete candidate[field];
      expect(selectionSchema.safeParse(candidate).success, field).toBe(false);
    }
  });
});

const supertonicTransferredAssetIdentities = [
  {
    assetId: 'onnx-duration-predictor-onnx',
    sha256: 'sha256:c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db',
    byteLength: 3_700_147,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'onnx-text-encoder-onnx',
    sha256: 'sha256:c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff',
    byteLength: 36_416_150,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'onnx-tts-json',
    sha256: 'sha256:42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09',
    byteLength: 8_253,
    mediaType: 'application/json',
  },
  {
    assetId: 'onnx-unicode-indexer-json',
    sha256: 'sha256:9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f',
    byteLength: 277_676,
    mediaType: 'application/json',
  },
  {
    assetId: 'onnx-vector-estimator-onnx',
    sha256: 'sha256:883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c',
    byteLength: 256_534_781,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'onnx-vocoder-onnx',
    sha256: 'sha256:085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba',
    byteLength: 101_424_195,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'voice-styles-f1-json',
    sha256: 'sha256:bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2',
    byteLength: 292_046,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f2-json',
    sha256: 'sha256:7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6',
    byteLength: 292_423,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f3-json',
    sha256: 'sha256:12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab',
    byteLength: 290_794,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f4-json',
    sha256: 'sha256:c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b',
    byteLength: 291_808,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f5-json',
    sha256: 'sha256:45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d',
    byteLength: 291_479,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m1-json',
    sha256: 'sha256:e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b',
    byteLength: 291_748,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m2-json',
    sha256: 'sha256:b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50',
    byteLength: 292_055,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m3-json',
    sha256: 'sha256:ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b',
    byteLength: 290_198,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m4-json',
    sha256: 'sha256:ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303',
    byteLength: 291_522,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m5-json',
    sha256: 'sha256:dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2',
    byteLength: 291_469,
    mediaType: 'application/json',
  },
] as const;

const supertonicModelBuffers = supertonicTransferredAssetIdentities.map(
  ({ byteLength }) => new ArrayBuffer(byteLength),
);

function supertonicTransferredAssets() {
  return supertonicTransferredAssetIdentities.map((identity, index) => ({
    ...identity,
    bytes: supertonicModelBuffers[index]!,
  }));
}

const supertonicRuntimeIdentities = {
  webgpu: {
    artifactId: 'onnxruntime-web-webgpu-jsep-wasm',
    sha256: 'sha256:78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    byteLength: 26_827_543,
    mediaType: 'application/wasm',
    selectionId: 'supertonic-webgpu',
    selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
  },
  wasm: {
    artifactId: 'onnxruntime-web-wasm-runtime',
    sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    byteLength: 13_479_978,
    mediaType: 'application/wasm',
    selectionId: 'supertonic-wasm',
    selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
  },
} as const;

const supertonicRuntimeBuffers = {
  webgpu: new ArrayBuffer(supertonicRuntimeIdentities.webgpu.byteLength),
  wasm: new ArrayBuffer(supertonicRuntimeIdentities.wasm.byteLength),
};

function supertonicPrepare(backend: keyof typeof supertonicRuntimeIdentities = 'wasm') {
  const runtime = supertonicRuntimeIdentities[backend];
  return {
    command: 'prepare',
    operationId: 1,
    engineId: 'supertonic',
    voiceId: 'supertonic:F1',
    selectionId: runtime.selectionId,
    selectionDigest: runtime.selectionDigest,
    backend,
    assetSetId: 'supertonic-browser-assets',
    manifestDigest: 'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
    runtimeArtifactId: runtime.artifactId,
    assets: supertonicTransferredAssets(),
    runtimeArtifact: {
      artifactId: runtime.artifactId,
      sha256: runtime.sha256,
      byteLength: runtime.byteLength,
      mediaType: runtime.mediaType,
      bytes: supertonicRuntimeBuffers[backend],
    },
  };
}

describe('closed Supertonic Worker protocol', () => {
  it('accepts only the exact 16+1 WASM and WebGPU prepare closures', () => {
    const prepareSchema = schema('SupertonicPrepareWorkerCommandSchema');
    const commandSchema = schema('WorkerCommandSchema');

    expect(prepareSchema.safeParse(supertonicPrepare('wasm')).success).toBe(true);
    expect(prepareSchema.safeParse(supertonicPrepare('webgpu')).success).toBe(true);
    expect(commandSchema.safeParse(supertonicPrepare('wasm')).success).toBe(true);
    expect(
      commandSchema.safeParse({
        command: 'prepare',
        operationId: 1,
        engineId: 'supertonic',
        voiceId: 'supertonic:F1',
      }).success,
    ).toBe(false);
  });

  it('runtime-freezes every exported Supertonic schema trust anchor', () => {
    const runtimeIdentities = contracts.SUPERTONIC_RUNTIME_IDENTITIES;
    const mutableWasm = runtimeIdentities.wasm as unknown as {
      sha256: string;
      byteLength: number;
    };
    const originalSha256 = mutableWasm.sha256;
    const originalByteLength = mutableWasm.byteLength;
    let mutationRejected = false;
    try {
      mutableWasm.sha256 = `sha256:${'0'.repeat(64)}`;
      mutableWasm.byteLength = 1;
    } catch {
      mutationRejected = true;
    } finally {
      if (!mutationRejected) {
        mutableWasm.sha256 = originalSha256;
        mutableWasm.byteLength = originalByteLength;
      }
    }

    expect(mutationRejected).toBe(true);
    expect(Object.isFrozen(contracts.SUPERTONIC_VOICE_IDS)).toBe(true);
    expect(Object.isFrozen(contracts.SUPERTONIC_LANGUAGES)).toBe(true);
    expect(Object.isFrozen(contracts.SUPERTONIC_TRANSFERRED_ASSET_IDS)).toBe(true);
    expect(Object.isFrozen(contracts.SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES)).toBe(true);
    expect(contracts.SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(runtimeIdentities)).toBe(true);
    expect(Object.values(runtimeIdentities).every(Object.isFrozen)).toBe(true);
    expect(
      schema('SupertonicPrepareWorkerCommandSchema').safeParse(supertonicPrepare()).success,
    ).toBe(true);
  });

  it('rejects missing, extra, duplicate, reordered, malformed, detached, or aliased assets', () => {
    const commandSchema = schema('WorkerCommandSchema');
    const valid = supertonicPrepare();
    expect(commandSchema.safeParse(valid).success).toBe(true);
    const detached = new ArrayBuffer(supertonicTransferredAssetIdentities[2].byteLength);
    structuredClone(detached, { transfer: [detached] });
    const invalidAssets = [
      valid.assets.slice(0, -1),
      [...valid.assets, valid.assets[0]],
      [valid.assets[1], valid.assets[0], ...valid.assets.slice(2)],
      valid.assets.map((asset, index) =>
        index === 1 ? { ...asset, assetId: valid.assets[0]!.assetId } : asset,
      ),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, sha256: `sha256:${'0'.repeat(64)}` } : asset,
      ),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, byteLength: asset.byteLength + 1 } : asset,
      ),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, mediaType: 'application/json' } : asset,
      ),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, bytes: new ArrayBuffer(1) } : asset,
      ),
      valid.assets.map((asset, index) => (index === 2 ? { ...asset, bytes: detached } : asset)),
      valid.assets.map((asset, index) =>
        index === 1 ? { ...asset, bytes: valid.assets[0]!.bytes } : asset,
      ),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, bytes: new Uint8Array(asset.byteLength) } : asset,
      ),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, bytes: new SharedArrayBuffer(asset.byteLength) } : asset,
      ),
      valid.assets.map((asset, index) => (index === 0 ? { ...asset, bytes: new Blob() } : asset)),
      valid.assets.map((asset, index) =>
        index === 0 ? { ...asset, url: 'https://example.invalid/model.onnx' } : asset,
      ),
    ];

    for (const assets of invalidAssets) {
      expect(commandSchema.safeParse({ ...valid, assets }).success).toBe(false);
    }
    for (const forbidden of [
      { url: 'https://example.invalid/model.onnx' },
      { path: 'C:\\models\\model.onnx' },
      { cacheKey: 'runtime/model' },
      { handle: { kind: 'file' } },
      { registryName: 'onnxruntime-web' },
      { modelUrl: '/assets/model.onnx' },
      { upload: 'voice.wav' },
      { microphone: true },
      { referenceAudio: new ArrayBuffer(1) },
      { cloneFrom: 'speaker' },
    ]) {
      expect(commandSchema.safeParse({ ...valid, ...forbidden }).success).toBe(false);
    }
  });

  it('binds exact voices, selection digests, backend, asset set, manifest, and runtime artifact', () => {
    const commandSchema = schema('WorkerCommandSchema');
    const valid = supertonicPrepare('webgpu');
    const voiceIds = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map(
      (id) => `supertonic:${id}`,
    );
    for (const voiceId of voiceIds) {
      expect(commandSchema.safeParse({ ...valid, voiceId }).success).toBe(true);
    }
    for (const mutation of [
      { voiceId: 'supertonic:F6' },
      { voiceId: 'kokoro:af_heart' },
      { selectionId: 'supertonic-auto' },
      { selectionDigest: `sha256:${'0'.repeat(64)}` },
      { backend: 'wasm' },
      { assetSetId: 'supertonic-other-assets' },
      { manifestDigest: `sha256:${'0'.repeat(64)}` },
      { runtimeArtifactId: 'onnxruntime-web-wasm-runtime' },
      {
        runtimeArtifact: {
          ...valid.runtimeArtifact,
          artifactId: 'onnxruntime-web-wasm-runtime',
        },
      },
      { runtimeArtifact: { ...valid.runtimeArtifact, bytes: new ArrayBuffer(1) } },
      { runtimeArtifact: { ...valid.runtimeArtifact, unexpected: true } },
      { unexpected: true },
    ]) {
      expect(commandSchema.safeParse({ ...valid, ...mutation }).success).toBe(false);
    }
  });

  it('accepts exactly 31 languages and finite on-grid speed controls', () => {
    const synthesizeSchema = schema('SupertonicSynthesizeWorkerCommandSchema');
    const commandSchema = schema('WorkerCommandSchema');
    const languages = [
      'ar',
      'bg',
      'hr',
      'cs',
      'da',
      'nl',
      'en',
      'et',
      'fi',
      'fr',
      'de',
      'el',
      'hi',
      'hu',
      'id',
      'it',
      'ja',
      'ko',
      'lv',
      'lt',
      'pl',
      'pt',
      'ro',
      'ru',
      'sk',
      'sl',
      'es',
      'sv',
      'tr',
      'uk',
      'vi',
    ];
    const base = {
      command: 'synthesize',
      operationId: 2,
      engineId: 'supertonic',
      voiceId: 'supertonic:M5',
      text: 'A closed transferable selection.',
      controls: { language: 'en', speed: 1.05 },
    };

    for (const language of languages) {
      expect(
        synthesizeSchema.safeParse({ ...base, controls: { language, speed: 1.05 } }).success,
      ).toBe(true);
    }
    for (const speed of [0.75, 0.8, 0.95, 1, 1.05, 1.2, 1.25]) {
      expect(
        commandSchema.safeParse({ ...base, controls: { language: 'en', speed } }).success,
      ).toBe(true);
    }
    for (const controls of [
      { speed: 1.05 },
      { language: 'na', speed: 1.05 },
      { language: 'en-US', speed: 1.05 },
      { language: 'EN', speed: 1.05 },
      { language: 'en', speed: Number.NaN },
      { language: 'en', speed: Number.POSITIVE_INFINITY },
      { language: 'en', speed: 0.74 },
      { language: 'en', speed: 1.26 },
      { language: 'en', speed: 1.01 },
      { language: 'en', speed: 1.05000000001 },
      { language: 'en', speed: 1.05, extra: true },
    ]) {
      expect(commandSchema.safeParse({ ...base, controls }).success).toBe(false);
    }
    expect(commandSchema.safeParse({ ...base, unexpected: true }).success).toBe(false);
  });
});

describe('preset-only worker protocol', () => {
  it('accepts only same-engine catalog IDs and the exact advertised speed control', () => {
    const commandSchema = schema('WorkerCommandSchema');
    const synthesize = {
      command: 'synthesize',
      operationId: 7,
      engineId: 'kokoro',
      voiceId: 'kokoro:af_heart',
      text: 'A quiet signal crosses the morning air.',
      controls: { speed: 1 },
    };

    expect(commandSchema.safeParse(synthesize).success).toBe(true);
    expect(commandSchema.safeParse({ ...synthesize, voiceId: 'kitten:Bella' }).success).toBe(false);
    expect(
      commandSchema.safeParse({
        command: 'prepare',
        operationId: 6,
        engineId: 'kokoro',
        voiceId: 'kitten:Bella',
      }).success,
    ).toBe(false);
    for (const field of [
      { controls: { speed: 1, backend: 'wasm' } },
      { controls: { speed: 1, path: 'C:\\models\\voice.onnx' } },
      { controls: { speed: 1, modelUrl: 'https://untrusted.invalid/model.onnx' } },
      { controls: { speed: 1, commandLine: 'run model' } },
      { controls: { speed: 1, referenceAudio: 'data:audio/wav;base64,AA==' } },
      { controls: { speed: 1, upload: 'voice.wav' } },
      { controls: { speed: 1, cloneFrom: 'speaker' } },
      { controls: { speed: Number.NaN } },
      { controls: { speed: Number.POSITIVE_INFINITY } },
      { controls: { speed: 0.74 } },
      { controls: { speed: 1.26 } },
      { controls: {} },
    ]) {
      expect(commandSchema.safeParse({ ...synthesize, ...field }).success).toBe(false);
    }
    expect(commandSchema.safeParse({ ...synthesize, text: 'x'.repeat(2001) }).success).toBe(false);
    expect(commandSchema.safeParse({ ...synthesize, unexpected: true }).success).toBe(false);
  });

  it('strictly validates every worker response lifecycle message', () => {
    const responseSchema = schema('WorkerResponseSchema');
    const audio = new ArrayBuffer(4);

    expect(responseSchema.safeParse({ type: 'ready', operationId: 1 }).success).toBe(true);
    expect(
      responseSchema.safeParse({
        type: 'progress',
        operationId: 1,
        phase: 'synthesis',
        percent: 50,
      }).success,
    ).toBe(true);
    expect(
      responseSchema.safeParse({
        type: 'result',
        operationId: 1,
        audio,
        mimeType: 'audio/wav',
      }).success,
    ).toBe(true);
    expect(
      responseSchema.safeParse({ type: 'error', operationId: 1, message: 'failed' }).success,
    ).toBe(true);
    expect(responseSchema.safeParse({ type: 'cancelled', operationId: 1 }).success).toBe(true);

    for (const invalid of [
      { type: 'ready', operationId: 1, extra: true },
      { type: 'progress', operationId: 1, phase: 'x', percent: Number.NaN },
      { type: 'progress', operationId: 1, phase: 'x', percent: -1 },
      { type: 'progress', operationId: 1, phase: 'x', percent: 101 },
      { type: 'result', operationId: 1, audio: new Uint8Array(4), mimeType: 'audio/wav' },
      { type: 'result', operationId: 1, audio, mimeType: 'audio/mpeg' },
      { type: 'error', operationId: 1, message: '' },
      { type: 'unknown', operationId: 1 },
    ]) {
      expect(responseSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('uses narrow cancel and dispose messages without model inputs', () => {
    const commandSchema = schema('WorkerCommandSchema');

    expect(commandSchema.safeParse({ command: 'cancel', operationId: 7 }).success).toBe(true);
    expect(commandSchema.safeParse({ command: 'dispose', operationId: 8 }).success).toBe(true);
    expect(
      commandSchema.safeParse({ command: 'cancel', operationId: 7, url: 'https://example.com' })
        .success,
    ).toBe(false);
  });
});

describe('gallery and generated-media provenance contracts', () => {
  const candidate = {
    id: 'candidate-voxcpm2-neutral-v1',
    galleryId: 'voxcpm2',
    transcript: 'A quiet signal crosses the morning air, clear, steady, and entirely its own.',
    locale: 'en-US',
    modelRevision: '0123456789abcdef0123456789abcdef01234567',
    codeRevision: '89abcdef0123456789abcdef0123456789abcdef',
    parameters: { temperature: 0.8, guidance: 1.5 },
    seed: 42,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: [],
    readiness: 'ready-for-generation',
    readinessDetail: 'No reference audio is required; pinned code, model, and parameters are set.',
    runtimeEnvironment: {
      status: 'verified',
      pythonVersion: '3.11.9',
      packageVersions: { torch: '2.7.1', transformers: '4.53.2' },
      operatingSystem: 'Ubuntu 24.04',
      device: 'NVIDIA L4',
      dtype: 'bfloat16',
      accelerator: 'CUDA 12.8',
      dependencyLockSha256:
        'sha256:4444444444444444444444444444444444444444444444444444444444444444',
      runnerImageDigest: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    },
    sourceIds: ['voxcpm2-source'],
    licenseIds: ['voxcpm2-weights-license'],
    referenceLineage: null,
    watermarkRequirement: 'none',
  };

  it('keeps source-only galleries free of samples, generated media, and generation candidates', () => {
    const gallerySchema = schema('GalleryManifestSchema');

    expect(
      gallerySchema.safeParse({
        id: 'f5-tts',
        displayName: 'F5-TTS',
        mode: 'source-only',
        officialProjectUrl: 'https://huggingface.co/SWivid/F5-TTS',
        sourceIds: ['f5-tts-source'],
        licenseIds: ['f5-tts-weights-license'],
        candidateId: null,
        sampleIds: ['sample-f5-link-1'],
        generatedMediaIds: [],
        notice: 'Source-only while output rights remain unclear.',
      }).success,
    ).toBe(true);
    expect(
      gallerySchema.safeParse({
        id: 'f5-tts',
        displayName: 'F5-TTS',
        mode: 'source-only',
        officialProjectUrl: 'https://huggingface.co/SWivid/F5-TTS',
        sourceIds: ['f5-tts-source'],
        licenseIds: ['f5-tts-weights-license'],
        candidateId: null,
        sampleIds: [],
        generatedMediaIds: ['media-f5-unreviewed-1'],
        notice: 'Source-only.',
      }).success,
    ).toBe(false);
  });

  it('future-proofs official gallery samples without admitting unreviewed audio', () => {
    const officialSampleSchema = schema('OfficialSampleSchema');
    const reviewed = {
      id: 'sample-voxcpm2-official-1',
      galleryId: 'voxcpm2',
      transcript: 'A quiet signal crosses the morning air.',
      locale: 'en-US',
      officialSamplePageUrl: 'https://huggingface.co/spaces/example/voxcpm2',
      sourceIds: ['voxcpm2-sample-source'],
      licenseIds: ['voxcpm2-sample-license'],
      redistributionStatus: 'redistribution-cleared',
      corsStatus: 'verified-readable',
      audioUrl:
        'https://huggingface.co/datasets/example/assets/resolve/0123456789abcdef0123456789abcdef01234567/voxcpm2.wav',
      audioSha256: 'sha256:86f9d5647fcf84378b392ee5a4e21010e39d524cc21c29ce50ba5311c0d0032a',
      audioBytes: 12_345,
      rightsBasis: 'The rights holder permits redistribution of this exact reviewed file.',
      humanReview: {
        status: 'approved',
        reviewedAt: '2026-07-16T00:00:00.000Z',
        reviewer: 'project-maintainer',
      },
    };

    expect(officialSampleSchema.safeParse(reviewed).success).toBe(true);
    expect(officialSampleSchema.safeParse({ ...reviewed, audioSha256: null }).success).toBe(false);
    expect(
      officialSampleSchema.safeParse({
        ...reviewed,
        redistributionStatus: 'link-only',
      }).success,
    ).toBe(false);
    expect(
      officialSampleSchema.safeParse({
        ...reviewed,
        redistributionStatus: 'link-only',
        corsStatus: 'not-tested',
        audioUrl: null,
        audioSha256: null,
        audioBytes: null,
      }).success,
    ).toBe(true);
  });

  it('requires reproducible generation candidates without reference audio', () => {
    const candidateSchema = schema('GenerationCandidateSchema');

    expect(candidateSchema.safeParse(candidate).success).toBe(true);
    expect(candidateSchema.safeParse({ ...candidate, referenceAudio: 'sample.wav' }).success).toBe(
      false,
    );
    expect(candidateSchema.safeParse({ ...candidate, modelRevision: 'main' }).success).toBe(false);
  });

  it('preserves canonical transcript and reference prompt bytes without implicit trimming', () => {
    const candidateSchema = schema('GenerationCandidateSchema');
    const transcript = '  Exact leading and trailing whitespace.\n';
    const parsed = candidateSchema.parse({ ...candidate, transcript }) as typeof candidate;

    expect(parsed.transcript).toBe(transcript);
  });

  it('blocks a reference-dependent candidate until hashed, rights-reviewed lineage exists', () => {
    const candidateSchema = schema('GenerationCandidateSchema');
    const blocked = {
      ...candidate,
      id: 'candidate-cosyvoice3-neutral-v1',
      galleryId: 'cosyvoice3',
      readiness: 'blocked-pending-reference',
      readinessDetail: 'A project-generated reference is required before generation.',
      referenceLineage: {
        status: 'pending',
        generatorCandidateId: 'candidate-melotts-neutral-v1',
        promptText: candidate.transcript,
        audioSha256: null,
        transcriptSha256: null,
        rightsBasis: 'Planned project-authored transcript and project-generated reference.',
        humanReview: null,
      },
    };

    expect(candidateSchema.safeParse(blocked).success).toBe(true);
    expect(
      candidateSchema.safeParse({ ...blocked, readiness: 'ready-for-generation' }).success,
    ).toBe(false);
    expect(
      candidateSchema.safeParse({ ...blocked, referenceLineage: 'future MeloTTS audio' }).success,
    ).toBe(false);
  });

  it('requires complete reviewed output provenance before media can be published', () => {
    const generatedMediaSchema = schema('GeneratedMediaProvenanceSchema');
    const media = {
      id: 'media-voxcpm2-neutral-v1',
      candidateId: candidate.id,
      audioUrl:
        'https://huggingface.co/datasets/example/assets/resolve/0123456789abcdef0123456789abcdef01234567/voxcpm2.wav',
      audioSha256: 'sha256:86f9d5647fcf84378b392ee5a4e21010e39d524cc21c29ce50ba5311c0d0032a',
      audioBytes: 48_000,
      transcriptSha256: 'sha256:d7c0ad1ba3280f932b56704ca2b57f84677adcc7e658a148fd5107e18ddb9c75',
      generatedAt: '2026-07-16T00:00:00.000Z',
      generatorSourceId: 'voxcpm2-source',
      modelRevision: candidate.modelRevision,
      codeRevision: candidate.codeRevision,
      parameters: candidate.parameters,
      seed: candidate.seed,
      loadingStrategy: candidate.loadingStrategy,
      dependencyRevisions: candidate.dependencyRevisions,
      runtimeEnvironment: {
        status: 'verified',
        pythonVersion: '3.11.9',
        packageVersions: {
          torch: '2.7.1',
          transformers: '4.53.2',
        },
        operatingSystem: 'Ubuntu 24.04',
        device: 'NVIDIA L4',
        dtype: 'bfloat16',
        accelerator: 'CUDA 12.8',
        dependencyLockSha256:
          'sha256:4444444444444444444444444444444444444444444444444444444444444444',
        runnerImageDigest:
          'sha256:5555555555555555555555555555555555555555555555555555555555555555',
      },
      referenceLineage: null,
      watermark: 'none',
      rightsBasis: 'Project-authored neutral text and redistribution-cleared generated output.',
      humanReview: {
        status: 'approved',
        reviewedAt: '2026-07-16T00:00:00.000Z',
        reviewer: 'project-maintainer',
      },
      licenseIds: ['generated-media-cc0'],
      sourceIds: ['voxcpm2-source'],
    };

    expect(generatedMediaSchema.safeParse(media).success).toBe(true);
    expect(
      generatedMediaSchema.safeParse({ ...media, humanReview: { status: 'pending' } }).success,
    ).toBe(false);
    expect(generatedMediaSchema.safeParse({ ...media, audioSha256: undefined }).success).toBe(
      false,
    );
    expect(generatedMediaSchema.safeParse({ ...media, audioBytes: undefined }).success).toBe(false);
    expect(generatedMediaSchema.safeParse({ ...media, audioBytes: 0 }).success).toBe(false);
    expect(
      generatedMediaSchema.safeParse({
        ...media,
        runtimeEnvironment: { status: 'pending', requirements: ['Pin dependencies.'] },
      }).success,
    ).toBe(false);
  });
});

const pocketSelectors = [
  ['english', 'en'],
  ['english_2026-01', 'en'],
  ['english_2026-04', 'en'],
  ['french_24l', 'fr'],
  ['german', 'de'],
  ['german_24l', 'de'],
  ['italian', 'it'],
  ['italian_24l', 'it'],
  ['portuguese', 'pt'],
  ['portuguese_24l', 'pt'],
  ['spanish', 'es'],
  ['spanish_24l', 'es'],
] as const;

const pocketLabels = [
  'alba',
  'anna',
  'azelma',
  'bill_boerst',
  'caro_davy',
  'charles',
  'cosette',
  'eponine',
  'estelle',
  'eve',
  'fantine',
  'george',
  'giovanni',
  'jane',
  'javert',
  'jean',
  'juergen',
  'lola',
  'marius',
  'mary',
  'michael',
  'paul',
  'peter_yearsley',
  'rafael',
  'stuart_bell',
  'vera',
] as const;

const pocketVctkLabels = new Set([
  'anna',
  'vera',
  'fantine',
  'charles',
  'paul',
  'eponine',
  'azelma',
  'george',
  'mary',
  'jane',
  'michael',
  'eve',
]);
const pocketVoiceZeroLabels = new Set([
  'bill_boerst',
  'caro_davy',
  'peter_yearsley',
  'stuart_bell',
]);
const pocketDonationLabels = new Set(['marius', 'javert']);
const pocketProvenancePendingLabels = new Set(['giovanni', 'lola', 'juergen', 'rafael']);

function pocketRightsFor(label: (typeof pocketLabels)[number]) {
  if (label === 'alba') {
    return {
      rightsFamily: 'alba-mackenna',
      listingPolicy: 'catalog-only-runtime-candidate',
      runtimeExclusionReason: 'assets-not-release-pinned',
      licenseIds: ['pocket-alba-mackenna-dataset-license'],
    };
  }
  if (label === 'estelle') {
    return {
      rightsFamily: 'unmute-estelle',
      listingPolicy: 'catalog-only-runtime-candidate',
      runtimeExclusionReason: 'assets-not-release-pinned',
      licenseIds: ['pocket-unmute-prod-dataset-license'],
    };
  }
  if (pocketVctkLabels.has(label)) {
    return {
      rightsFamily: 'vctk',
      listingPolicy: 'catalog-only-runtime-candidate',
      runtimeExclusionReason: 'assets-not-release-pinned',
      licenseIds: ['pocket-vctk-dataset-license'],
    };
  }
  if (pocketVoiceZeroLabels.has(label)) {
    return {
      rightsFamily: 'voice-zero',
      listingPolicy: 'catalog-only-runtime-candidate',
      runtimeExclusionReason: 'assets-not-release-pinned',
      licenseIds: ['pocket-voice-zero-dataset-license'],
    };
  }
  if (pocketDonationLabels.has(label)) {
    return {
      rightsFamily: 'voice-donation',
      listingPolicy: 'catalog-only-runtime-candidate',
      runtimeExclusionReason: 'assets-not-release-pinned',
      licenseIds: ['pocket-donations-dataset-license'],
    };
  }
  if (label === 'cosette') {
    return {
      rightsFamily: 'expresso',
      listingPolicy: 'link-only-noncommercial',
      runtimeExclusionReason: 'noncommercial-source-terms',
      licenseIds: ['pocket-expresso-dataset-license'],
    };
  }
  if (label === 'jean') {
    return {
      rightsFamily: 'ears',
      listingPolicy: 'link-only-noncommercial',
      runtimeExclusionReason: 'noncommercial-source-terms',
      licenseIds: ['pocket-ears-dataset-license'],
    };
  }
  if (pocketProvenancePendingLabels.has(label)) {
    return {
      rightsFamily: 'repository-level-unclear',
      listingPolicy: 'link-only-provenance-pending',
      runtimeExclusionReason: 'per-clip-provenance-unresolved',
      licenseIds: ['pocket-unresolved-per-clip-provenance'],
    };
  }
  throw new Error(`Missing Pocket rights fixture for ${label}`);
}

const pocketVariants = pocketSelectors.flatMap(([selectorId, languageTag]) =>
  pocketLabels.map((label) => ({
    id: `pocket:${selectorId}.${label}`,
    engineId: 'pocket',
    upstreamId: `${selectorId}.${label}`,
    selectorId,
    label,
    upstreamPath: `languages/${selectorId}/embeddings/${label}.safetensors`,
    languageTag,
    countryCode: null,
    gender: 'unspecified',
    ...pocketRightsFor(label),
    sourceIds: ['pocket-code-source', 'pocket-weights-source', 'pocket-voice-source'],
    officialDemoId: 'pocket-official-live-demo',
  })),
);

const pocketVariant = pocketVariants.find(
  ({ selectorId, label }) => selectorId === 'german_24l' && label === 'alba',
)!;

const pocketOfficialLiveDemo = {
  id: 'pocket-official-live-demo',
  engineId: 'pocket',
  pageUrl: 'https://kyutai.org/tts',
  sourceIds: ['pocket-official-live-demo-source'],
  outputClipStatus: 'no-stable-official-generated-output-found',
  audioPublished: false,
  offlineAvailable: false,
  rightsBasis:
    'External live-generation page only; no conditioning audio or output is copied, proxied, cached, or redistributed.',
  reviewedAt: '2026-07-16T00:00:00.000Z',
};

const pocketCoverageManifest = {
  id: 'pocket-multilingual-coverage',
  engineId: 'pocket',
  revisionPins: {
    stableCode: '058886528d0b6f2f2d4022de2e244a5260729e6e',
    currentCodeAudit: 'd108410d23eef7e01db282f9442891162dbc3db6',
    fullModel: '4c8ad48f8a003909bc4f1122cbe88a4252124621',
    noCloningModel: 'e041936c75475d350b405bc870bcf7c22da4e9e6',
    voiceRepository: '323332d33f997de8394f24a193e1a76df720e01a',
    historicalPromptSnapshot: '64ab7d24c479d736a83b8cc666c4a776fca30fda',
  },
  inventorySha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  selectorCount: 12,
  labelCount: 26,
  totalEmbeddings: 312,
  languageCounts: { en: 78, fr: 26, de: 52, it: 52, pt: 52, es: 52 },
  rightsCounts: {
    catalogOnlyRuntimeCandidate: 240,
    linkOnlyNonCommercial: 24,
    linkOnlyProvenancePending: 48,
  },
  publishedOutputClipCount: 0,
  auditSourceIds: [
    'pocket-code-source',
    'pocket-current-code-audit-source',
    'pocket-full-model-source',
    'pocket-weights-source',
    'pocket-voice-source',
    'pocket-historical-prompt-source',
    'pocket-multilingual-announcement-source',
    'pocket-official-live-demo-source',
  ],
  variants: pocketVariants,
  officialDemo: pocketOfficialLiveDemo,
};

describe('Pocket multilingual coverage contracts', () => {
  it('exports the exact closed selector, label, rights-family, and listing-policy domains', () => {
    expect(api.POCKET_SELECTOR_IDS).toEqual(pocketSelectors.map(([selectorId]) => selectorId));
    expect(api.POCKET_LABELS).toEqual(pocketLabels);
    expect(api.POCKET_RIGHTS_FAMILIES).toEqual([
      'alba-mackenna',
      'unmute-estelle',
      'vctk',
      'voice-zero',
      'voice-donation',
      'expresso',
      'ears',
      'repository-level-unclear',
    ]);
    expect(api.POCKET_LISTING_POLICIES).toEqual([
      'catalog-only-runtime-candidate',
      'link-only-noncommercial',
      'link-only-provenance-pending',
    ]);
  });

  it('accepts a closed catalog-only variant with exact derived identity and evidence', () => {
    expect(schema('PocketPresetVariantSchema').safeParse(pocketVariant).success).toBe(true);
  });

  it('rejects a rogue standalone label with internally consistent derived identity and path', () => {
    const rogueVariant = {
      ...pocketVariant,
      id: 'pocket:german_24l.rogue_label',
      upstreamId: 'german_24l.rogue_label',
      label: 'rogue_label',
      upstreamPath: 'languages/german_24l/embeddings/rogue_label.safetensors',
    };

    expect(schema('PocketPresetVariantSchema').safeParse(rogueVariant).success).toBe(false);
  });

  it.each([
    ['ID', { id: 'pocket:german.alba' }],
    ['upstream ID', { upstreamId: 'german.alba' }],
    ['selector', { selectorId: 'german' }],
    ['label', { label: 'estelle' }],
    ['upstream path', { upstreamPath: 'languages/german/embeddings/alba.safetensors' }],
    ['engine', { engineId: 'supertonic' }],
    ['language domain', { languageTag: 'bg' }],
    ['selector language', { languageTag: 'fr' }],
    ['country inference', { countryCode: 'DE' }],
    ['gender inference', { gender: 'female' }],
    ['license evidence', { licenseIds: [] }],
    ['source evidence', { sourceIds: [] }],
    [
      'duplicate license evidence',
      {
        licenseIds: [
          'pocket-alba-mackenna-dataset-license',
          'pocket-alba-mackenna-dataset-license',
        ],
      },
    ],
    ['duplicate source evidence', { sourceIds: ['pocket-code-source', 'pocket-code-source'] }],
    ['official-demo join', { officialDemoId: 'another-demo' }],
    ['policy/reason pair', { runtimeExclusionReason: 'noncommercial-source-terms' }],
  ])('rejects a mismatched or unsupported %s', (_label, mutation) => {
    expect(
      schema('PocketPresetVariantSchema').safeParse({ ...pocketVariant, ...mutation }).success,
    ).toBe(false);
  });

  it('accepts only the exact exclusion reason paired with each listing policy', () => {
    const variantSchema = schema('PocketPresetVariantSchema');
    const cosette = pocketVariants.find(
      ({ selectorId, label }) => selectorId === 'french_24l' && label === 'cosette',
    )!;
    const giovanni = pocketVariants.find(
      ({ selectorId, label }) => selectorId === 'italian' && label === 'giovanni',
    )!;

    expect(variantSchema.safeParse(cosette).success).toBe(true);
    expect(variantSchema.safeParse(giovanni).success).toBe(true);
    expect(
      variantSchema.safeParse({
        ...cosette,
        runtimeExclusionReason: 'per-clip-provenance-unresolved',
      }).success,
    ).toBe(false);
    expect(
      variantSchema.safeParse({
        ...giovanni,
        runtimeExclusionReason: 'assets-not-release-pinned',
      }).success,
    ).toBe(false);
  });

  it.each([
    ['runtime mode', { runtimeModes: ['companion'] }],
    ['asset ID', { assetSetId: 'pocket-companion-pack' }],
    ['asset bytes', { bytes: 123 }],
    ['audio URL', { audioUrl: 'https://example.com/output.wav' }],
    ['transcript', { transcript: 'Not a generated sample.' }],
    ['reference audio', { referenceAudio: 'prompt.wav' }],
    ['cloning', { cloneFrom: 'speaker.wav' }],
    ['upload', { upload: 'speaker.wav' }],
    ['arbitrary URL', { modelUrl: 'https://example.com/model.safetensors' }],
    ['filesystem path', { modelPath: 'C:\\models\\pocket.safetensors' }],
    ['command', { commandLine: 'run pocket' }],
    ['inference', { inferenceEnabled: true }],
    ['unknown field', { unexpected: true }],
  ])('rejects forbidden %s fields from catalog-only variants', (_label, extra) => {
    expect(
      schema('PocketPresetVariantSchema').safeParse({ ...pocketVariant, ...extra }).success,
    ).toBe(false);
  });

  it('accepts the exact external live-demo record without claiming published audio or offline use', () => {
    expect(schema('PocketOfficialLiveDemoSchema').safeParse(pocketOfficialLiveDemo).success).toBe(
      true,
    );
  });

  it.each([
    ['changed ID', { id: 'another-demo' }],
    ['changed engine', { engineId: 'supertonic' }],
    ['changed page', { pageUrl: 'https://example.com/tts' }],
    ['published audio', { audioPublished: true }],
    ['offline use', { offlineAvailable: true }],
    ['audio URL', { audioUrl: 'https://example.com/output.wav' }],
    ['transcript', { transcript: 'Generated speech.' }],
    ['audio hash', { audioSha256: `sha256:${'a'.repeat(64)}` }],
    ['non-HTTP page', { pageUrl: 'file:///tmp/demo.html' }],
    ['missing source evidence', { sourceIds: [] }],
    ['changed source evidence', { sourceIds: ['another-source'] }],
    ['changed rights basis', { rightsBasis: 'No audio is included.' }],
    ['invalid reviewed timestamp', { reviewedAt: '2026-07-16' }],
    ['unknown field', { unexpected: true }],
  ])('rejects live-demo %s', (_label, mutation) => {
    expect(
      schema('PocketOfficialLiveDemoSchema').safeParse({
        ...pocketOfficialLiveDemo,
        ...mutation,
      }).success,
    ).toBe(false);
  });

  it('accepts the exact 312-variant manifest closure and one official demo', () => {
    expect(schema('PocketCoverageManifestSchema').safeParse(pocketCoverageManifest).success).toBe(
      true,
    );
  });

  it.each([
    ['stable code', { stableCode: 'a'.repeat(40) }],
    ['current code audit', { currentCodeAudit: 'a'.repeat(40) }],
    ['full model', { fullModel: 'a'.repeat(40) }],
    ['no-cloning model', { noCloningModel: 'a'.repeat(40) }],
    ['voice repository', { voiceRepository: 'a'.repeat(40) }],
    ['historical prompt snapshot', { historicalPromptSnapshot: 'a'.repeat(40) }],
  ])('rejects a changed %s pin', (_label, mutation) => {
    expect(
      schema('PocketCoverageManifestSchema').safeParse({
        ...pocketCoverageManifest,
        revisionPins: { ...pocketCoverageManifest.revisionPins, ...mutation },
      }).success,
    ).toBe(false);
  });

  it.each([
    ['coverage ID', { id: 'another-coverage' }],
    ['coverage engine', { engineId: 'supertonic' }],
    ['selector count', { selectorCount: 11 }],
    ['label count', { labelCount: 25 }],
    ['embedding count', { totalEmbeddings: 311 }],
    ['language count', { languageCounts: { ...pocketCoverageManifest.languageCounts, en: 77 } }],
    [
      'rights count',
      {
        rightsCounts: {
          ...pocketCoverageManifest.rightsCounts,
          catalogOnlyRuntimeCandidate: 239,
        },
      },
    ],
    ['published output count', { publishedOutputClipCount: 1 }],
  ])('rejects a changed %s', (_label, mutation) => {
    expect(
      schema('PocketCoverageManifestSchema').safeParse({
        ...pocketCoverageManifest,
        ...mutation,
      }).success,
    ).toBe(false);
  });

  it('rejects malformed inventory hashes and changed or reordered audit evidence', () => {
    const manifestSchema = schema('PocketCoverageManifestSchema');

    expect(
      manifestSchema.safeParse({
        ...pocketCoverageManifest,
        inventorySha256: `sha256:${'A'.repeat(64)}`,
      }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({
        ...pocketCoverageManifest,
        auditSourceIds: [...pocketCoverageManifest.auditSourceIds].reverse(),
      }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({
        ...pocketCoverageManifest,
        auditSourceIds: pocketCoverageManifest.auditSourceIds.slice(1),
      }).success,
    ).toBe(false);
  });

  it('rejects missing variants and duplicate stable IDs or upstream paths', () => {
    const manifestSchema = schema('PocketCoverageManifestSchema');
    const duplicateVariant = pocketVariants.map((variant, index) =>
      index === 1 ? { ...pocketVariants[0]! } : variant,
    );

    expect(
      manifestSchema.safeParse({
        ...pocketCoverageManifest,
        variants: pocketVariants.slice(0, -1),
      }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({ ...pocketCoverageManifest, variants: duplicateVariant }).success,
    ).toBe(false);
  });

  it('rejects replacing all 12 occurrences of one exact label with a consistent rogue label', () => {
    const rogueVariants = pocketVariants.map((variant) =>
      variant.label === 'alba'
        ? {
            ...variant,
            id: `pocket:${variant.selectorId}.rogue_label`,
            upstreamId: `${variant.selectorId}.rogue_label`,
            label: 'rogue_label',
            upstreamPath: `languages/${variant.selectorId}/embeddings/rogue_label.safetensors`,
          }
        : variant,
    );

    expect(rogueVariants).toHaveLength(312);
    expect(new Set(rogueVariants.map(({ id }) => id))).toHaveLength(312);
    expect(new Set(rogueVariants.map(({ upstreamPath }) => upstreamPath))).toHaveLength(312);
    expect(new Set(rogueVariants.map(({ label }) => label))).toHaveLength(26);
    expect(
      schema('PocketCoverageManifestSchema').safeParse({
        ...pocketCoverageManifest,
        variants: rogueVariants,
      }).success,
    ).toBe(false);
  });

  it('rejects variant records whose actual language or rights totals contradict the closure', () => {
    const manifestSchema = schema('PocketCoverageManifestSchema');
    const wrongLanguage = pocketVariants.map((variant, index) =>
      index === 0 ? { ...variant, languageTag: 'de' } : variant,
    );
    const wrongRights = pocketVariants.map((variant, index) =>
      index === 0
        ? {
            ...variant,
            rightsFamily: 'expresso',
            listingPolicy: 'link-only-noncommercial',
            runtimeExclusionReason: 'noncommercial-source-terms',
          }
        : variant,
    );

    expect(
      manifestSchema.safeParse({ ...pocketCoverageManifest, variants: wrongLanguage }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({ ...pocketCoverageManifest, variants: wrongRights }).success,
    ).toBe(false);
  });

  it('rejects unknown manifest fields and unknown nested fields', () => {
    const manifestSchema = schema('PocketCoverageManifestSchema');

    expect(
      manifestSchema.safeParse({ ...pocketCoverageManifest, runtimeModes: ['companion'] }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({
        ...pocketCoverageManifest,
        revisionPins: { ...pocketCoverageManifest.revisionPins, branch: 'main' },
      }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({
        ...pocketCoverageManifest,
        languageCounts: { ...pocketCoverageManifest.languageCounts, bg: 0 },
      }).success,
    ).toBe(false);
  });
});
