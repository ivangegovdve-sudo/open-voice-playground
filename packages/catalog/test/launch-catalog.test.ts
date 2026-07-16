import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildLaunchCatalog,
  computeEdgeSnapshotContentHash,
  countLaunchCatalog,
  stableStringifyLaunchCatalog,
  validateLaunchCatalogForRelease,
} from '../src/launch.js';
import { computeBrowserRuntimeSelectionDigest } from '../src/launch-runtime-artifacts.js';
import { countPocketCoverage } from '../src/pocket-multilingual.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const launchPath = join(packageRoot, 'data', 'launch-catalog.public.json');
const integrityPath = join(packageRoot, 'data', 'launch-catalog.integrity.json');

const KOKORO_IDS = [
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_heart',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
  'ef_dora',
  'em_alex',
  'em_santa',
  'ff_siwis',
  'hf_alpha',
  'hf_beta',
  'hm_omega',
  'hm_psi',
  'if_sara',
  'im_nicola',
  'jf_alpha',
  'jf_gongitsune',
  'jf_nezumi',
  'jf_tebukuro',
  'jm_kumo',
  'pf_dora',
  'pm_alex',
  'pm_santa',
  'zf_xiaobei',
  'zf_xiaoni',
  'zf_xiaoxiao',
  'zf_xiaoyi',
  'zm_yunjian',
  'zm_yunxi',
  'zm_yunxia',
  'zm_yunyang',
] as const;

const POCKET_IDS = [
  'alba',
  'estelle',
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
  'bill_boerst',
  'caro_davy',
  'peter_yearsley',
  'stuart_bell',
  'marius',
  'javert',
] as const;

const KITTEN_IDS = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'] as const;
const SUPERTONIC_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const;
const SUPERTONIC_LANGUAGES = [
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
] as const;
const PIPER_IDS = [
  'bg_BG-dimitar-medium',
  'de_DE-thorsten-medium',
  'es_ES-davefx-medium',
  'nl_NL-alex-medium',
  'pl_PL-gosia-medium',
  'pt_BR-cadu-medium',
  'ro_RO-mihai-medium',
  'ru_RU-dmitri-medium',
  'zh_CN-chaowen-medium',
  'en_GB-cori-medium',
  'fr_FR-siwis-medium',
  'uk_UA-lada-x_low',
] as const;

function upstreamIds(catalog: ReturnType<typeof buildLaunchCatalog>, engineId: string): string[] {
  return catalog.voices
    .filter((voice) => voice.engineId === engineId)
    .map((voice) => voice.upstreamId);
}

function recomputeManifestDigest(
  assetSet: ReturnType<typeof buildLaunchCatalog>['assetSets'][number],
): void {
  assetSet.manifestDigest = `sha256:${createHash('sha256')
    .update(JSON.stringify(assetSet.assets))
    .digest('hex')}`;
}

describe('deterministic launch catalog', () => {
  it('freezes the exact Supertonic model and ONNX Runtime Web closure', () => {
    const catalog = buildLaunchCatalog();
    const assetSet = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;

    expect(catalog.schemaVersion).toBe(4);
    expect(assetSet.assets).toHaveLength(16);
    expect(assetSet.assets.map(({ id }) => id)).toEqual([
      'onnx-duration-predictor-onnx',
      'onnx-text-encoder-onnx',
      'onnx-tts-json',
      'onnx-unicode-indexer-json',
      'onnx-vector-estimator-onnx',
      'onnx-vocoder-onnx',
      'voice-styles-f1-json',
      'voice-styles-f2-json',
      'voice-styles-f3-json',
      'voice-styles-f4-json',
      'voice-styles-f5-json',
      'voice-styles-m1-json',
      'voice-styles-m2-json',
      'voice-styles-m3-json',
      'voice-styles-m4-json',
      'voice-styles-m5-json',
    ]);
    expect(assetSet.assets.map(({ id }) => id)).not.toContain('config-json');
    expect(assetSet.totalBytes).toBe(401_276_744);
    expect(assetSet.manifestDigest).toBe(
      'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6',
    );
    expect(catalog.runtimeArtifacts).toEqual([
      {
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
      {
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
    ]);
    expect(catalog.runtimeSelections).toEqual([
      {
        id: 'supertonic-wasm',
        engineId: 'supertonic',
        backend: 'wasm',
        assetSetId: 'supertonic-browser-assets',
        runtimeArtifactId: 'onnxruntime-web-wasm-runtime',
        selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
      },
      {
        id: 'supertonic-webgpu',
        engineId: 'supertonic',
        backend: 'webgpu',
        assetSetId: 'supertonic-browser-assets',
        runtimeArtifactId: 'onnxruntime-web-webgpu-jsep-wasm',
        selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
      },
    ]);
    expect(Object.keys(catalog.runtimeArtifacts[0]!)).toEqual([
      'id',
      'backend',
      'packageName',
      'packageVersion',
      'tarballUrl',
      'tarballIntegrity',
      'tarballSha1',
      'packagePath',
      'sha256',
      'bytes',
      'mediaType',
      'cacheKey',
      'sourceIds',
      'licenseIds',
    ]);
    expect(assetSet.totalBytes + catalog.runtimeArtifacts[0]!.bytes).toBe(414_756_722);
    expect(assetSet.totalBytes + catalog.runtimeArtifacts[1]!.bytes).toBe(428_104_287);
  });

  it('binds every selection, asset-set anchor, and runtime artifact identity field', () => {
    const catalog = buildLaunchCatalog();
    const assetSet = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;
    const selection = catalog.runtimeSelections.find(({ id }) => id === 'supertonic-webgpu')!;
    const artifact = catalog.runtimeArtifacts.find(({ id }) => id === selection.runtimeArtifactId)!;
    const { selectionDigest: _selectionDigest, ...identity } = selection;
    const baseline = computeBrowserRuntimeSelectionDigest(identity, assetSet, artifact);

    expect(baseline).toBe(selection.selectionDigest);
    const identityMutations = {
      id: 'other-selection',
      engineId: 'other-engine',
      backend: 'wasm',
      assetSetId: 'other-assets',
      runtimeArtifactId: 'other-runtime',
    } as const;
    for (const [field, value] of Object.entries(identityMutations)) {
      expect(
        computeBrowserRuntimeSelectionDigest({ ...identity, [field]: value }, assetSet, artifact),
        field,
      ).not.toBe(baseline);
    }
    for (const [field, value] of [
      ['id', 'other-assets'],
      ['manifestDigest', `sha256:${'f'.repeat(64)}`],
    ] as const) {
      expect(
        computeBrowserRuntimeSelectionDigest(identity, { ...assetSet, [field]: value }, artifact),
        `assetSet.${field}`,
      ).not.toBe(baseline);
    }

    const scalarMutations: Record<string, unknown> = {
      id: 'other-runtime',
      backend: 'wasm',
      packageName: 'other-package',
      packageVersion: '1.27.1',
      tarballUrl: 'https://registry.npmjs.org/other/-/other-1.0.0.tgz',
      tarballIntegrity: 'sha512-other',
      tarballSha1: `sha1:${'f'.repeat(40)}`,
      packagePath: 'dist/other.wasm',
      sha256: `sha256:${'e'.repeat(64)}`,
      bytes: artifact.bytes + 1,
      mediaType: 'application/octet-stream',
      cacheKey: 'runtime/other/file',
    };
    for (const [field, value] of Object.entries(scalarMutations)) {
      expect(
        computeBrowserRuntimeSelectionDigest(identity, assetSet, {
          ...artifact,
          [field]: value,
        }),
        `artifact.${field}`,
      ).not.toBe(baseline);
    }
    expect(
      computeBrowserRuntimeSelectionDigest(identity, assetSet, {
        ...artifact,
        sourceIds: [...artifact.sourceIds, 'other-source'],
      }),
    ).not.toBe(baseline);
    expect(
      computeBrowserRuntimeSelectionDigest(identity, assetSet, {
        ...artifact,
        licenseIds: [...artifact.licenseIds, 'other-license'],
      }),
    ).not.toBe(baseline);
  });

  it('rejects detached or cross-backend runtime selections during release validation', () => {
    const mutations = [
      ['wrong engine', { engineId: 'kokoro' }],
      ['wrong backend', { backend: 'wasm' }],
      ['wrong asset set', { assetSetId: 'kitten-browser-assets' }],
      ['wrong artifact', { runtimeArtifactId: 'onnxruntime-web-wasm-runtime' }],
    ] as const;

    for (const [_label, mutation] of mutations) {
      const catalog = structuredClone(buildLaunchCatalog());
      const selection = catalog.runtimeSelections.find(({ id }) => id === 'supertonic-webgpu')!;
      Object.assign(selection, mutation);
      const assetSet = catalog.assetSets.find(({ id }) => id === selection.assetSetId)!;
      const artifact = catalog.runtimeArtifacts.find(
        ({ id }) => id === selection.runtimeArtifactId,
      )!;
      const { selectionDigest: _selectionDigest, ...identity } = selection;
      selection.selectionDigest = computeBrowserRuntimeSelectionDigest(
        identity,
        assetSet,
        artifact,
      );
      expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/detached engine/i);
    }

    const wrongDigest = structuredClone(buildLaunchCatalog());
    wrongDigest.runtimeSelections.find(({ id }) => id === 'supertonic-webgpu')!.selectionDigest =
      `sha256:${'0'.repeat(64)}`;
    expect(() => validateLaunchCatalogForRelease(wrongDigest)).toThrow(
      /runtime selection.*digest/i,
    );
  });

  it('pins separate code, runtime, and model terms to immutable sources', () => {
    const catalog = buildLaunchCatalog();
    expect(catalog.sources.find(({ id }) => id === 'onnxruntime-web-source')).toMatchObject({
      canonicalUrl:
        'https://github.com/microsoft/onnxruntime/tree/8f0278c77bf44b0cc83c098c6c722b92a36ac4b5',
      upstreamRevision: '8f0278c77bf44b0cc83c098c6c722b92a36ac4b5',
      sourceClass: 'official-repository',
    });
    expect(
      catalog.licenses.find(({ id }) => id === 'onnxruntime-web-runtime-license'),
    ).toMatchObject({
      scope: 'runtime',
      spdxId: 'MIT',
      evidenceUrl:
        'https://github.com/microsoft/onnxruntime/blob/8f0278c77bf44b0cc83c098c6c722b92a36ac4b5/LICENSE',
      attribution: 'Microsoft Corporation',
    });
    expect(catalog.sources.find(({ id }) => id === 'supertone-code-source')).toMatchObject({
      upstreamRevision: 'dff55dc00064c398736080c78195f577527832ae',
    });
    expect(catalog.sources.find(({ id }) => id === 'supertone-model-source')).toMatchObject({
      upstreamRevision: '3cadd1ee6394adea1bd021217a0e650ede09a323',
    });
    expect(catalog.licenses.find(({ id }) => id === 'supertone-code-license')?.scope).toBe('code');
    expect(catalog.licenses.find(({ id }) => id === 'supertone-weights-license')?.scope).toBe(
      'weights',
    );
  });

  it('retains complete immutable MIT notices separately from model terms', async () => {
    const notices = await readFile(join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

    expect(notices).toContain('Copyright (c) 2025 Supertone Inc.');
    expect(notices).toContain('Copyright (c) Microsoft Corporation');
    expect(notices).toContain('dff55dc00064c398736080c78195f577527832ae');
    expect(notices).toContain('8f0278c77bf44b0cc83c098c6c722b92a36ac4b5');
    expect(notices.match(/Permission is hereby granted, free of charge/g)).toHaveLength(2);
    expect(notices.match(/THE SOFTWARE IS PROVIDED "AS IS"/g)).toHaveLength(2);
    expect(notices).toMatch(/ONNX Runtime Web[\s\S]*npm tarball[\s\S]*MIT License/i);
    expect(notices).toMatch(/OpenRAIL-M[\s\S]*separate\s+from the MIT code and runtime notices/i);
  });

  it('contains exactly 426 source-backed presets with honest declared and enabled counts', () => {
    const catalog = buildLaunchCatalog();

    expect(catalog.voices).toHaveLength(426);
    expect(countLaunchCatalog(catalog)).toEqual({
      totalVoices: 426,
      byEngine: {
        edge: 322,
        kitten: 8,
        kokoro: 54,
        piper: 12,
        pocket: 20,
        supertonic: 10,
      },
      declaredByRuntime: { browser: 84, online: 322, companion: 20, 'sample-only': 0 },
      enabledByRuntime: { browser: 72, online: 0, companion: 20, 'sample-only': 0 },
      enabledVoices: 92,
      unavailableVoices: 334,
    });
  });

  it('publishes schema version 4 with exact Pocket coverage and no lost S1 fields', () => {
    const catalog = buildLaunchCatalog();

    expect(Object.keys(catalog).sort()).toEqual([
      'assetDeliveryEvidence',
      'assetSets',
      'catalogId',
      'engines',
      'featureFlags',
      'galleries',
      'generatedAt',
      'generatedMedia',
      'generationCandidates',
      'licenses',
      'pocketCoverage',
      'releaseAssetEvidence',
      'runtimeArtifacts',
      'runtimeSelections',
      'samples',
      'schemaVersion',
      'sources',
      'voices',
    ]);
    expect(countPocketCoverage(catalog.pocketCoverage)).toEqual({
      totalEmbeddings: 312,
      byLanguage: { de: 52, en: 78, es: 52, fr: 26, it: 52, pt: 52 },
      byPolicy: {
        'catalog-only-runtime-candidate': 240,
        'link-only-noncommercial': 24,
        'link-only-provenance-pending': 48,
      },
      publishedOutputClips: 0,
    });
  });

  it('preserves the exact legacy Pocket pack and accepted S1 runtime closure', () => {
    const catalog = buildLaunchCatalog();
    const pocketPack = {
      voices: catalog.voices.filter(({ engineId }) => engineId === 'pocket'),
      assetSet: catalog.assetSets.find(({ id }) => id === 'pocket-companion-pack'),
    };
    const runtime = {
      runtimeArtifacts: catalog.runtimeArtifacts,
      runtimeSelections: catalog.runtimeSelections,
    };

    expect(`sha256:${createHash('sha256').update(JSON.stringify(pocketPack)).digest('hex')}`).toBe(
      'sha256:3580aebe05db5335240673bacb225c23ab0643e7a598573fdfbb2f613548cff6',
    );
    expect(`sha256:${createHash('sha256').update(JSON.stringify(runtime)).digest('hex')}`).toBe(
      'sha256:1bcd0bcd241ffd1d5e0a07e30194a46cb9158210b433f7142ea5288d3bd8bb23',
    );
  });

  it('keeps all multilingual coverage outside runtime, assets, generation, and media', () => {
    const catalog = buildLaunchCatalog();
    const coverageIds = new Set(catalog.pocketCoverage.variants.map(({ id }) => id));
    const runtimeIds = [
      ...catalog.voices.map(({ id }) => id),
      ...catalog.assetSets.flatMap((assetSet) => [
        assetSet.id,
        ...assetSet.assets.map(({ id }) => id),
      ]),
      ...catalog.runtimeSelections.map(({ id }) => id),
      ...catalog.releaseAssetEvidence.flatMap(({ id, voiceId }) => [id, voiceId]),
      ...catalog.generationCandidates.map(({ id }) => id),
      ...catalog.generatedMedia.map(({ id }) => id),
    ];

    expect(catalog.voices).toHaveLength(426);
    expect(catalog.voices.filter(({ engineId }) => engineId === 'pocket')).toHaveLength(20);
    expect(runtimeIds.some((id) => coverageIds.has(id))).toBe(false);
    expect(catalog.samples).toEqual([]);
    expect(catalog.generatedMedia).toEqual([]);
    expect(catalog.featureFlags.find(({ id }) => id === 'future-azure-inference')).toEqual({
      id: 'future-azure-inference',
      enabled: false,
      serverOnlyCredentials: true,
      termsCleared: false,
      monthlyBudgetUsd: 0,
      hardStop: true,
      characterLimit: 0,
      spendLimitUsd: 0,
    });
  });

  it('publishes exact Pocket multilingual rights and audit evidence', () => {
    const catalog = buildLaunchCatalog();
    const licenses = new Map(catalog.licenses.map((record) => [record.id, record]));
    const sources = new Map(catalog.sources.map((record) => [record.id, record]));
    const pinnedVoiceEvidence =
      'https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md';

    expect(licenses.get('pocket-expresso-dataset-license')).toMatchObject({
      scope: 'dataset',
      spdxId: 'CC-BY-NC-4.0',
      evidenceUrl: pinnedVoiceEvidence,
      permitsRedistribution: true,
      permitsCommercialUse: false,
      reviewStatus: 'restricted',
    });
    expect(licenses.get('pocket-ears-dataset-license')).toMatchObject({
      scope: 'dataset',
      spdxId: 'CC-BY-NC-4.0',
      evidenceUrl: pinnedVoiceEvidence,
      permitsRedistribution: true,
      permitsCommercialUse: false,
      reviewStatus: 'restricted',
    });
    expect(licenses.get('pocket-unresolved-per-clip-provenance')).toMatchObject({
      scope: 'dataset',
      spdxId: 'CC-BY-4.0',
      evidenceUrl: pinnedVoiceEvidence,
      permitsRedistribution: false,
      permitsCommercialUse: false,
      reviewStatus: 'needs-review',
      exactUpstreamTerms: expect.stringMatching(/Giovanni.*Lola.*Juergen.*Rafael/),
    });

    expect(sources.get('pocket-current-code-audit-source')).toMatchObject({
      canonicalUrl:
        'https://github.com/kyutai-labs/pocket-tts/tree/d108410d23eef7e01db282f9442891162dbc3db6',
      sourceClass: 'official-repository',
      upstreamRevision: 'd108410d23eef7e01db282f9442891162dbc3db6',
    });
    expect(sources.get('pocket-full-model-source')).toMatchObject({
      canonicalUrl:
        'https://huggingface.co/kyutai/pocket-tts/tree/4c8ad48f8a003909bc4f1122cbe88a4252124621',
      sourceClass: 'model-card',
      upstreamRevision: '4c8ad48f8a003909bc4f1122cbe88a4252124621',
    });
    expect(sources.get('pocket-historical-prompt-source')).toMatchObject({
      canonicalUrl:
        'https://huggingface.co/kyutai/pocket-tts/tree/64ab7d24c479d736a83b8cc666c4a776fca30fda',
      sourceClass: 'model-card',
      upstreamRevision: '64ab7d24c479d736a83b8cc666c4a776fca30fda',
    });
    expect(sources.get('pocket-multilingual-announcement-source')).toMatchObject({
      canonicalUrl: 'https://kyutai.org/blog/2026-05-04-pocket-tts-multilingual/',
      sourceClass: 'official-documentation',
      upstreamRevision: 'published:2026-05-04;verified:2026-07-16',
    });
    expect(sources.get('pocket-official-live-demo-source')).toMatchObject({
      canonicalUrl: 'https://kyutai.org/tts',
      sourceClass: 'maintainer-demo',
      upstreamRevision: 'live-demo:verified:2026-07-16',
    });
  });

  it('release validation rejects Pocket coverage drift and runtime collisions', () => {
    const inventoryDrift = structuredClone(buildLaunchCatalog());
    inventoryDrift.pocketCoverage.inventorySha256 =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(() => validateLaunchCatalogForRelease(inventoryDrift)).toThrow(/inventory digest/i);

    const rightsDrift = structuredClone(buildLaunchCatalog());
    rightsDrift.pocketCoverage.variants[0]!.rightsFamily = 'vctk';
    rightsDrift.pocketCoverage.variants[0]!.licenseIds = ['pocket-vctk-dataset-license'];
    expect(() => validateLaunchCatalogForRelease(rightsDrift)).toThrow(/rights decision/i);

    const sourceDrift = structuredClone(buildLaunchCatalog());
    sourceDrift.pocketCoverage.variants[0]!.sourceIds.push('pocket-full-model-source');
    expect(() => validateLaunchCatalogForRelease(sourceDrift)).toThrow(/source closure/i);

    const missingAuditSource = structuredClone(buildLaunchCatalog());
    missingAuditSource.sources = missingAuditSource.sources.filter(
      ({ id }) => id !== 'pocket-full-model-source',
    );
    expect(() => validateLaunchCatalogForRelease(missingAuditSource)).toThrow(/audit source/i);

    const runtimeCollision = structuredClone(buildLaunchCatalog());
    const legacyAlba = runtimeCollision.voices.find(({ id }) => id === 'pocket:alba')!;
    legacyAlba.id = 'pocket:english.alba';
    legacyAlba.upstreamId = 'english.alba';
    expect(() => validateLaunchCatalogForRelease(runtimeCollision)).toThrow(/runtime voice/i);

    const provenanceLicenseDrift = structuredClone(buildLaunchCatalog());
    provenanceLicenseDrift.licenses.find(
      ({ id }) => id === 'pocket-unresolved-per-clip-provenance',
    )!.permitsCommercialUse = true;
    expect(() => validateLaunchCatalogForRelease(provenanceLicenseDrift)).toThrow(
      /Pocket.*license/i,
    );

    const demoReviewDrift = structuredClone(buildLaunchCatalog());
    demoReviewDrift.pocketCoverage.officialDemo.reviewedAt = '2026-07-17T00:00:00.000Z';
    expect(() => validateLaunchCatalogForRelease(demoReviewDrift)).toThrow(
      /Pocket.*coverage|live demo/i,
    );
  });

  it('uses only the exact reviewed non-Edge allowlists', () => {
    const catalog = buildLaunchCatalog();

    expect(upstreamIds(catalog, 'kokoro')).toEqual([...KOKORO_IDS].sort());
    expect(upstreamIds(catalog, 'pocket')).toEqual([...POCKET_IDS].sort());
    expect(upstreamIds(catalog, 'kitten')).toEqual([...KITTEN_IDS].sort());
    expect(upstreamIds(catalog, 'supertonic')).toEqual([...SUPERTONIC_IDS].sort());
    expect(upstreamIds(catalog, 'piper')).toEqual([...PIPER_IDS].sort());
    for (const excluded of ['cosette', 'jean', 'giovanni', 'lola', 'juergen', 'rafael']) {
      expect(upstreamIds(catalog, 'pocket')).not.toContain(excluded);
    }
  });

  it('represents multilingual Supertonic presets once with the exact 31-language list', () => {
    const catalog = buildLaunchCatalog();
    const voices = catalog.voices.filter((voice) => voice.engineId === 'supertonic');

    expect(voices).toHaveLength(10);
    for (const voice of voices) {
      expect(voice.locale).toBe('en');
      expect(voice.languageTags).toEqual(SUPERTONIC_LANGUAGES);
    }
  });

  it('locks Edge and every Piper voice without misrepresenting declared runtimes', () => {
    const catalog = buildLaunchCatalog();
    const edgeVoices = catalog.voices.filter((voice) => voice.engineId === 'edge');
    const dimitar = catalog.voices.find((voice) => voice.id === 'piper:bg_BG-dimitar-medium');
    const piperVoices = catalog.voices.filter((voice) => voice.engineId === 'piper');

    expect(edgeVoices).toHaveLength(322);
    expect(edgeVoices.every((voice) => voice.runtimeModes[0] === 'online')).toBe(true);
    expect(
      edgeVoices.every(
        (voice) =>
          voice.releaseGate.status === 'unavailable' &&
          voice.releaseGate.reason === 'terms-not-cleared' &&
          voice.assetSetId === null,
      ),
    ).toBe(true);
    expect(dimitar?.releaseGate).toMatchObject({
      status: 'unavailable',
      reason: 'asset-unavailable',
      detail:
        'No reviewed immutable browser asset has been located for this preset. No request is made.',
    });
    expect(dimitar?.assetSetId).toBeNull();
    expect(
      piperVoices.every(
        (voice) =>
          voice.releaseGate.reason === 'asset-unavailable' &&
          voice.assetSetId === null &&
          voice.declaredDownloadBytes === 0,
      ),
    ).toBe(true);
    expect(catalog.releaseAssetEvidence).toHaveLength(11);
    expect(catalog.releaseAssetEvidence.every(({ corsReadable }) => !corsReadable)).toBe(true);
    expect(
      piperVoices
        .filter(({ id }) => id !== 'piper:bg_BG-dimitar-medium')
        .every(({ releaseGate }) =>
          /official release-asset evidence.*cross-origin/i.test(releaseGate.detail),
        ),
    ).toBe(true);
    expect(computeEdgeSnapshotContentHash()).toBe(
      'sha256:678ecb02c9dbc75c1fb75ebea9848d4d954b1ef938fc62bc90e5fdb259d8adbb',
    );
    expect(
      catalog.sources.find((source) => source.id === 'edge-voices-snapshot')?.contentHash,
    ).toBe(computeEdgeSnapshotContentHash());
    expect(
      catalog.sources.find((source) => source.id === 'edge-client-source')?.upstreamRevision,
    ).toBe('4bdb8e4c6ea62f151a45a3fceb4cf6ff696bb89f');
  });

  it('preserves Pocket source-published language metadata and pinned voice provenance', () => {
    const catalog = buildLaunchCatalog();
    const estelle = catalog.voices.find(({ id }) => id === 'pocket:estelle');

    expect(estelle?.locale).toBe('fr');
    expect(estelle?.languageTags).toEqual(['fr']);
    expect(estelle?.sourceIds).toContain('pocket-voice-source');
    expect(catalog.sources.find(({ id }) => id === 'pocket-voice-source')?.upstreamRevision).toBe(
      '323332d33f997de8394f24a193e1a76df720e01a',
    );
  });

  it('assigns source-specific Pocket voice rights instead of a generic license', () => {
    const catalog = buildLaunchCatalog();
    const licenseFor = (id: string) =>
      catalog.voices.find((voice) => voice.id === `pocket:${id}`)?.licenseIds;

    expect(licenseFor('alba')).toEqual(['pocket-alba-mackenna-dataset-license']);
    expect(licenseFor('estelle')).toEqual(['pocket-unmute-prod-dataset-license']);
    expect(licenseFor('anna')).toEqual(['pocket-vctk-dataset-license']);
    expect(licenseFor('bill_boerst')).toEqual(['pocket-voice-zero-dataset-license']);
    expect(licenseFor('marius')).toEqual(['pocket-donations-dataset-license']);
    expect(catalog.licenses.some(({ id }) => id === 'pocket-voice-license')).toBe(false);
    expect(catalog.licenses.find(({ id }) => id === 'pocket-weights-license')).toMatchObject({
      permitsRedistribution: true,
      permitsCommercialUse: true,
      reviewStatus: 'restricted',
    });
    expect(catalog.licenses.find(({ id }) => id === 'pocket-vctk-dataset-license')).toMatchObject({
      attribution:
        'Christophe Veaux, Junichi Yamagishi, Kirsten MacDonald; CSTR, University of Edinburgh; DOI 10.7488/ds/2645',
      exactUpstreamTerms: expect.stringMatching(/Kyutai ai-coustics processing/),
    });
  });

  it('uses explicit source-published Kokoro and Supertonic demographic metadata', () => {
    const catalog = buildLaunchCatalog();
    const byId = new Map(catalog.voices.map((voice) => [voice.id, voice]));

    expect(byId.get('kokoro:af_heart')).toMatchObject({ locale: 'en-US', gender: 'female' });
    expect(byId.get('kokoro:jm_kumo')).toMatchObject({
      locale: 'ja-JP',
      gender: 'male',
      licenseIds: ['kokoro-koniwa-dataset-license'],
    });
    expect(byId.get('kokoro:ff_siwis')).toMatchObject({
      locale: 'fr-FR',
      gender: 'female',
      licenseIds: ['kokoro-siwis-dataset-license'],
    });
    expect(
      catalog.voices
        .filter(({ engineId }) => engineId === 'supertonic')
        .every(({ sourceIds }) => sourceIds.includes('supertone-preset-metadata-source')),
    ).toBe(true);
  });

  it('keeps every asset immutable, referentially complete, and outside the app bundle', () => {
    const catalog = buildLaunchCatalog();
    const assetSetIds = new Set(catalog.assetSets.map(({ id }) => id));

    for (const voice of catalog.voices) {
      if (voice.releaseGate.status === 'enabled') {
        expect(voice.assetSetId).not.toBeNull();
        expect(assetSetIds.has(voice.assetSetId!)).toBe(true);
      }
    }
    for (const set of catalog.assetSets) {
      expect(set.totalBytes).toBe(set.assets.reduce((total, asset) => total + asset.bytes, 0));
      expect(set.assets.every((asset) => asset.url.startsWith('https://'))).toBe(true);
      expect(set.assets.every((asset) => asset.sha256.startsWith('sha256:'))).toBe(true);
    }
    expect(
      catalog.assetSets
        .find(({ id }) => id === 'kokoro-jm-kumo')
        ?.assets.find(({ id }) => id === 'voices-jm-kumo-bin')?.licenseIds,
    ).toEqual(['kokoro-koniwa-dataset-license']);
    expect(
      catalog.assetSets
        .find(({ id }) => id === 'pocket-companion-pack')
        ?.assets.find(({ id }) => id === 'embeddings-v3-alba-safetensors')?.licenseIds,
    ).toEqual(['pocket-alba-mackenna-dataset-license']);
  });

  it('binds every asset to the exact observed final origins covered by its manifest digest', () => {
    const catalog = buildLaunchCatalog();
    const xetOrigin = 'https://cas-bridge.xethub.hf.co';
    const hubOrigin = 'https://huggingface.co';
    const supertonic = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;
    const directHubIds = new Set([
      'onnx-tts-json',
      'onnx-unicode-indexer-json',
      'voice-styles-f1-json',
      'voice-styles-f2-json',
      'voice-styles-f3-json',
      'voice-styles-f4-json',
      'voice-styles-f5-json',
      'voice-styles-m1-json',
      'voice-styles-m2-json',
      'voice-styles-m3-json',
      'voice-styles-m4-json',
      'voice-styles-m5-json',
    ]);

    for (const set of catalog.assetSets) {
      for (const asset of set.assets) {
        const expected =
          set.id === 'supertonic-browser-assets' && directHubIds.has(asset.id)
            ? [hubOrigin]
            : [xetOrigin];
        expect(
          (asset as typeof asset & { approvedFinalOrigins?: string[] }).approvedFinalOrigins,
          `${set.id}/${asset.id}`,
        ).toEqual(expected);
      }
    }

    const mutatedAssets = structuredClone(supertonic.assets);
    mutatedAssets[0]!.approvedFinalOrigins = [hubOrigin, xetOrigin];
    expect(
      `sha256:${createHash('sha256').update(JSON.stringify(mutatedAssets)).digest('hex')}`,
    ).not.toBe(supertonic.manifestDigest);
  });

  it('keeps exact acceptance terms bidirectionally attached to asset licenses and sets', () => {
    const catalog = buildLaunchCatalog();
    const supertonic = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;

    for (const asset of supertonic.assets) {
      expect(asset.requiredAcceptance?.licenseId).toBe('supertone-weights-license');
      expect(asset.licenseIds).toContain(asset.requiredAcceptance!.licenseId);
      expect(supertonic.requiredAcceptanceLicenseIds).toContain(
        asset.requiredAcceptance!.licenseId,
      );
    }

    const detachedAsset = structuredClone(catalog);
    const detachedSet = detachedAsset.assetSets.find(
      ({ id }) => id === 'supertonic-browser-assets',
    )!;
    detachedSet.assets[0]!.requiredAcceptance!.licenseId = 'kitten-weights-license';
    detachedSet.manifestDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify(detachedSet.assets))
      .digest('hex')}`;
    expect(() => validateLaunchCatalogForRelease(detachedAsset)).toThrow(
      /acceptance license.*attached/i,
    );

    const unusedSetAcceptance = structuredClone(catalog);
    unusedSetAcceptance.assetSets
      .find(({ id }) => id === 'supertonic-browser-assets')!
      .requiredAcceptanceLicenseIds.push('kitten-weights-license');
    expect(() => validateLaunchCatalogForRelease(unusedSetAcceptance)).toThrow(
      /unused acceptance license/i,
    );
  });

  it('records exact representative browser delivery evidence without widening runtime claims', () => {
    const catalog = buildLaunchCatalog();

    expect(catalog.assetDeliveryEvidence).toHaveLength(4);
    expect(
      catalog.assetDeliveryEvidence.every(
        ({ scope, result }) =>
          scope === 'representative-assets' && result === 'representative-pass',
      ),
    ).toBe(true);
    expect(
      catalog.assetDeliveryEvidence.find(({ engineId }) => engineId === 'kokoro'),
    ).toMatchObject({
      checkedAt: '2026-07-16T00:15:33.037Z',
      browser: 'Chromium 149.0.7827.55',
      origin: 'https://example.com',
      checkedAssetIds: ['onnx-model-q8f16-onnx', 'voices-af-heart-bin'],
    });

    const overstated = structuredClone(catalog);
    const supertonic = overstated.assetDeliveryEvidence.find(
      ({ engineId }) => engineId === 'supertonic',
    )!;
    supertonic.scope = 'all-required-assets';
    supertonic.result = 'all-required-pass';
    expect(() => validateLaunchCatalogForRelease(overstated)).toThrow(/delivery.*coverage/i);
  });

  it('publishes twelve honest galleries and no unreviewed generated media', () => {
    const catalog = buildLaunchCatalog();
    const generation = catalog.galleries.filter(({ mode }) => mode === 'generation-candidate');
    const sourceOnly = catalog.galleries.filter(({ mode }) => mode === 'source-only');

    expect(catalog.galleries.map(({ id }) => id)).toEqual([
      'bark',
      'chatterbox',
      'cosyvoice3',
      'dia',
      'f5-tts',
      'maskgct',
      'melotts',
      'omnivoice',
      'parler-tts',
      'qwen3-tts',
      'spark-tts',
      'voxcpm2',
    ]);
    expect(generation).toHaveLength(8);
    expect(sourceOnly).toHaveLength(4);
    expect(sourceOnly.every(({ generatedMediaIds }) => generatedMediaIds.length === 0)).toBe(true);
    expect(catalog.samples).toEqual([]);
    expect(catalog.generationCandidates).toHaveLength(8);
    expect(catalog.generatedMedia).toEqual([]);
    expect(
      catalog.generationCandidates.every(
        ({ sourceIds, licenseIds }) => sourceIds.length >= 2 && licenseIds.length >= 2,
      ),
    ).toBe(true);
    expect(
      catalog.generationCandidates.find(({ galleryId }) => galleryId === 'chatterbox')
        ?.watermarkRequirement,
    ).toBe('preserve-perth');
    expect(
      catalog.generationCandidates.find(({ galleryId }) => galleryId === 'cosyvoice3')
        ?.referenceLineage,
    ).toMatchObject({
      status: 'pending',
      generatorCandidateId: 'candidate-melotts-neutral-v1',
      audioSha256: null,
      humanReview: null,
    });
  });

  it('pins separate code/model provenance and real model-specific generation plans', () => {
    const catalog = buildLaunchCatalog();
    const candidate = (id: string) =>
      catalog.generationCandidates.find(({ galleryId }) => galleryId === id)!;

    for (const gallery of catalog.galleries) {
      expect(gallery.sourceIds).toContain(`${gallery.id}-code-source`);
      expect(gallery.sourceIds).toContain(`${gallery.id}-model-source`);
      expect(gallery.licenseIds).toContain(`${gallery.id}-code-license`);
      expect(gallery.licenseIds).toContain(`${gallery.id}-weights-license`);
    }
    expect(candidate('qwen3-tts')).toMatchObject({
      modelRevision: '85e237c12c027371202489a0ec509ded67b5e4b5',
      readiness: 'recipe-ready-runtime-pending',
      parameters: { speaker: 'Aiden', language: 'English' },
      loadingStrategy: 'pinned-local-snapshot',
      unresolvedDependencies: [],
    });
    expect(catalog.sources.find(({ id }) => id === 'qwen3-tts-model-source')).toMatchObject({
      upstreamRevision: '85e237c12c027371202489a0ec509ded67b5e4b5',
    });
    expect(candidate('voxcpm2').parameters).toHaveProperty('voice_design_prefix');
    expect(candidate('parler-tts').parameters).toHaveProperty('description');
    expect(candidate('dia')).toMatchObject({
      readiness: 'blocked-pending-dependency-pin',
      unresolvedDependencies: ['descript-audio-codec-dac'],
    });
    expect(candidate('dia').parameters).toHaveProperty('cfg_scale');
    expect(candidate('chatterbox').parameters).toHaveProperty('exaggeration');
    expect(candidate('cosyvoice3')).toMatchObject({ readiness: 'blocked-pending-reference' });
    expect(candidate('melotts')).toMatchObject({
      readiness: 'blocked-pending-dependency-pin',
      unresolvedDependencies: ['bert-base-uncased'],
      parameters: { speaker_id: 0, speed: 1 },
    });
    expect(candidate('bark')).toMatchObject({
      readiness: 'blocked-pending-dependency-pin',
      unresolvedDependencies: ['bert-base-multilingual-cased'],
    });
    expect(candidate('bark').parameters).toHaveProperty('history_prompt_omitted', true);
    expect(
      catalog.generationCandidates.every(
        ({ parameters }) => !('candidateVersion' in parameters) && parameters.preset !== 'neutral',
      ),
    ).toBe(true);
  });

  it('uses real source-only model pins and conservative non-commercial rights', () => {
    const catalog = buildLaunchCatalog();
    const expectedPins: Record<string, string> = {
      omnivoice: 'c5fdb5ccb189668d56333f77ba2629f4cd7535f4',
      'f5-tts': '84e5a410d9cead4de2f847e7c9369a6440bdfaca',
      'spark-tts': '642071559bfc6346c2359d19dcb6be3f9dd8a05d',
      maskgct: '265c6cef07625665d0c28d2faafb1415562379dc',
    };

    for (const [id, revision] of Object.entries(expectedPins)) {
      expect(catalog.sources.find((source) => source.id === `${id}-model-source`)).toMatchObject({
        upstreamRevision: revision,
      });
      expect(
        catalog.licenses.find((license) => license.id === `${id}-weights-license`),
      ).toMatchObject({ reviewStatus: 'restricted', permitsCommercialUse: false });
    }
    expect(catalog.galleries.find(({ id }) => id === 'f5-tts')?.officialProjectUrl).toBe(
      'https://swivid.github.io/F5-TTS/',
    );
    expect(catalog.licenses.find(({ id }) => id === 'edge-service-terms')?.scope).toBe('service');
    expect(catalog.licenses.find(({ id }) => id === 'generated-media-cc0')?.scope).toBe(
      'generated-output',
    );
  });

  it('keeps future Azure outside the 426 and at a zero-default hard stop', () => {
    const catalog = buildLaunchCatalog();

    expect(catalog.engines.some(({ id }) => id.includes('azure'))).toBe(false);
    expect(catalog.voices.some(({ engineId }) => engineId.includes('azure'))).toBe(false);
    expect(catalog.featureFlags).toContainEqual({
      id: 'future-azure-inference',
      enabled: false,
      serverOnlyCredentials: true,
      termsCleared: false,
      monthlyBudgetUsd: 0,
      hardStop: true,
      characterLimit: 0,
      spendLimitUsd: 0,
    });
  });

  it('rejects an extra enabled production feature flag', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    catalog.featureFlags.push({
      id: 'production-debug-adapter',
      enabled: true,
      serverOnlyCredentials: false,
      termsCleared: true,
      monthlyBudgetUsd: 100,
      hardStop: false,
      characterLimit: 2_000,
      spendLimitUsd: 100,
    });

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/feature flag|canonical/i);
  });

  it('passes launch schema, reference, gate, gallery, and count validation', () => {
    const result = validateLaunchCatalogForRelease(buildLaunchCatalog());

    expect(result.counts.totalVoices).toBe(426);
  });

  it.each([
    [
      'cross-engine voice assets',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        const voice = catalog.voices.find(({ engineId }) => engineId === 'kokoro')!;
        const kitten = catalog.assetSets.find(({ id }) => id === 'kitten-browser-assets')!;
        voice.assetSetId = kitten.id;
        voice.declaredDownloadBytes = kitten.totalBytes;
      },
    ],
    [
      'an extra empty engine',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.engines.push({
          id: 'empty-engine',
          displayName: 'Empty engine',
          classification: 'sample-only',
          runtimeModes: ['sample-only'],
          languageTags: ['en'],
          licenseIds: ['generated-media-cc0'],
          sourceIds: ['voxcpm2-code-source'],
          backend: 'none',
          releaseGate: {
            status: 'unavailable',
            reason: 'feature-disabled',
            detail: 'No launch presets.',
          },
          assetSetIds: [],
        });
      },
    ],
    [
      'an enabled record with needs-review rights',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.licenses.find(({ id }) => id === 'kitten-weights-license')!.reviewStatus =
          'needs-review';
      },
    ],
    [
      'mismatched declared bytes',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.voices.find(({ engineId }) => engineId === 'kitten')!.declaredDownloadBytes += 1;
      },
    ],
    [
      'a mismatched backend',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.voices.find(({ engineId }) => engineId === 'kitten')!.backend = 'webgpu-wasm';
      },
    ],
    [
      'a mismatched engine runtime mode',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.engines.find(({ id }) => id === 'kokoro')!.runtimeModes = ['online'];
      },
    ],
    [
      'a mismatched engine gate',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.engines.find(({ id }) => id === 'kokoro')!.releaseGate = {
          status: 'unavailable',
          reason: 'feature-disabled',
          detail: 'Mutated gate.',
        };
      },
    ],
    [
      'a detached asset set',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.engines.find(({ id }) => id === 'kitten')!.assetSetIds = [];
      },
    ],
    [
      'a wrong gallery and candidate ID',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        const gallery = catalog.galleries.find(({ id }) => id === 'voxcpm2')!;
        const candidate = catalog.generationCandidates.find(
          ({ galleryId }) => galleryId === 'voxcpm2',
        )!;
        gallery.id = 'wrong-gallery';
        gallery.candidateId = 'candidate-wrong-gallery';
        candidate.id = 'candidate-wrong-gallery';
        candidate.galleryId = 'wrong-gallery';
      },
    ],
    [
      'a cache-key collision with different immutable bytes',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        const kitten = catalog.assetSets.find(({ id }) => id === 'kitten-browser-assets')!;
        kitten.assets[1]!.cacheKey = kitten.assets[0]!.cacheKey;
        recomputeManifestDigest(kitten);
      },
    ],
  ])('rejects %s even when structural parsing and counts still pass', (_label, mutate) => {
    const catalog = structuredClone(buildLaunchCatalog());
    mutate(catalog);

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow();
  });

  it('requires every Piper release-evidence record to bind an exact non-Dimitar voice', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    delete (catalog.releaseAssetEvidence[0] as { voiceId?: string }).voiceId;

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/piper.*voice|voice.*binding/i);
  });

  it.each([
    [
      'wrong',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.releaseAssetEvidence[0]!.voiceId = 'piper:bg_BG-dimitar-medium';
      },
    ],
    [
      'duplicate',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        catalog.releaseAssetEvidence[1]!.voiceId = catalog.releaseAssetEvidence[0]!.voiceId;
      },
    ],
  ])('rejects a %s Piper release-evidence voice binding', (_label, mutate) => {
    const catalog = structuredClone(buildLaunchCatalog());
    mutate(catalog);

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/piper/i);
  });

  it('anchors every acceptance-bearing asset to the reviewed license evidence digest', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    const license = catalog.licenses.find(({ id }) => id === 'supertone-weights-license')!;
    delete license.evidenceSha256;

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(
      /acceptance.*evidence|evidence.*digest/i,
    );
  });

  it.each([
    [
      'wrong acceptance license',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        const set = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;
        for (const asset of set.assets) {
          asset.licenseIds = ['supertone-code-license'];
          asset.requiredAcceptance = {
            licenseId: 'supertone-code-license',
            termsHash: 'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f',
          };
        }
        set.requiredAcceptanceLicenseIds = ['supertone-code-license'];
        recomputeManifestDigest(set);
      },
    ],
    [
      'recomputed but unanchored terms hash',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        const set = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;
        for (const asset of set.assets) {
          asset.requiredAcceptance!.termsHash =
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        }
        recomputeManifestDigest(set);
      },
    ],
    [
      'missing set acceptance',
      (catalog: ReturnType<typeof buildLaunchCatalog>) => {
        const set = catalog.assetSets.find(({ id }) => id === 'supertonic-browser-assets')!;
        for (const asset of set.assets) asset.requiredAcceptance = null;
        set.requiredAcceptanceLicenseIds = [];
        recomputeManifestDigest(set);
      },
    ],
  ])('rejects %s after the manifest digest is recomputed', (_label, mutate) => {
    const catalog = structuredClone(buildLaunchCatalog());
    mutate(catalog);

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/acceptance|canonical/i);
  });

  it('rejects fabricated verified reference lineage without approved generated media', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    const candidate = catalog.generationCandidates.find(
      ({ galleryId }) => galleryId === 'cosyvoice3',
    )!;
    candidate.readiness = 'recipe-ready-runtime-pending';
    candidate.readinessDetail = 'Only the runtime environment remains pending.';
    candidate.referenceLineage = {
      status: 'verified',
      generatorCandidateId: 'candidate-melotts-neutral-v1',
      promptText: candidate.transcript,
      audioSha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      transcriptSha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      rightsBasis: 'Fabricated lineage.',
      humanReview: {
        status: 'approved',
        reviewedAt: '2026-07-16T00:00:00.000Z',
        reviewer: 'project-maintainer',
      },
    };

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(
      /reference lineage|generated media/i,
    );
  });

  it.each(['sourceIds', 'licenseIds'] as const)(
    'rejects a generation candidate with a missing canonical %s link',
    (field) => {
      const catalog = structuredClone(buildLaunchCatalog());
      catalog.generationCandidates[0]![field].pop();

      expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/candidate|canonical/i);
    },
  );

  it('rejects orphaned planned reference lineage', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    const cosy = catalog.generationCandidates.find(({ galleryId }) => galleryId === 'cosyvoice3')!;
    if (cosy.referenceLineage !== null) {
      cosy.referenceLineage.generatorCandidateId = 'candidate-missing-reference-v1';
    }

    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/reference candidate/i);
  });

  it('validates future official samples as gallery-owned link-only records', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    const gallery = catalog.galleries.find(({ id }) => id === 'f5-tts')!;
    catalog.licenses.push({
      id: 'f5-tts-official-sample-link-terms',
      scope: 'sample',
      name: 'External official sample link review',
      exactUpstreamTerms:
        'Link-only record. No upstream audio is copied, cached, proxied, or redistributed.',
      evidenceUrl: 'https://swivid.github.io/F5-TTS/',
      attribution: 'F5-TTS project contributors',
      permitsRedistribution: false,
      permitsCommercialUse: false,
      reviewedAt: '2026-07-16T00:00:00.000Z',
      reviewStatus: 'restricted',
    });
    const sample = {
      id: 'sample-f5-official-project-1',
      galleryId: gallery.id,
      transcript: 'A source-published sample with a verified transcript.',
      locale: 'en-US',
      officialSamplePageUrl: 'https://swivid.github.io/F5-TTS/',
      sourceIds: ['f5-tts-model-source'],
      licenseIds: ['f5-tts-official-sample-link-terms'],
      redistributionStatus: 'link-only' as const,
      corsStatus: 'not-tested' as const,
      audioUrl: null,
      audioSha256: null,
      audioBytes: null,
      rightsBasis: 'External link only; no upstream media is copied, cached, or redistributed.',
      humanReview: {
        status: 'approved' as const,
        reviewedAt: '2026-07-16T00:00:00.000Z',
        reviewer: 'project-maintainer',
      },
    };
    catalog.samples.push(sample);
    gallery.sampleIds.push(sample.id);

    expect(() => validateLaunchCatalogForRelease(catalog)).not.toThrow();
    sample.sourceIds = ['missing-source'];
    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/sample.*source/i);
    sample.sourceIds = ['f5-tts-model-source'];
    sample.licenseIds = ['f5-tts-weights-license'];
    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/sample rights/i);
  });

  it('requires future generated media to retain candidate rights and exact lineage', () => {
    const catalog = structuredClone(buildLaunchCatalog());
    const candidate = catalog.generationCandidates.find(
      ({ galleryId }) => galleryId === 'voxcpm2',
    )!;
    const gallery = catalog.galleries.find(({ id }) => id === candidate.galleryId)!;
    candidate.readiness = 'ready-for-generation';
    candidate.runtimeEnvironment = {
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
    };
    const media = {
      id: 'media-voxcpm2-neutral-v1',
      candidateId: candidate.id,
      audioUrl:
        'https://huggingface.co/datasets/example/assets/resolve/0123456789abcdef0123456789abcdef01234567/voxcpm2.wav',
      audioSha256: 'sha256:86f9d5647fcf84378b392ee5a4e21010e39d524cc21c29ce50ba5311c0d0032a',
      audioBytes: 48_000,
      transcriptSha256: 'sha256:00e6d3be43468620bd33712bc53108fe3a43e713a79165d364efc2df1a57da3a',
      generatedAt: '2026-07-16T00:00:00.000Z',
      generatorSourceId: candidate.sourceIds[0]!,
      modelRevision: candidate.modelRevision,
      codeRevision: candidate.codeRevision,
      parameters: candidate.parameters,
      seed: candidate.seed,
      loadingStrategy: candidate.loadingStrategy,
      dependencyRevisions: candidate.dependencyRevisions,
      runtimeEnvironment: candidate.runtimeEnvironment,
      referenceLineage: null,
      watermark: 'none' as const,
      rightsBasis:
        'Project-authored text and project-held output rights, subject to every upstream obligation.',
      humanReview: {
        status: 'approved' as const,
        reviewedAt: '2026-07-16T00:00:00.000Z',
        reviewer: 'project-maintainer',
      },
      licenseIds: [...candidate.licenseIds, 'generated-media-cc0'],
      sourceIds: [...candidate.sourceIds],
    };
    catalog.generatedMedia.push(media);
    gallery.generatedMediaIds.push(media.id);

    expect(() => validateLaunchCatalogForRelease(catalog)).not.toThrow();
    media.transcriptSha256 =
      'sha256:d7c0ad1ba3280f932b56704ca2b57f84677adcc7e658a148fd5107e18ddb9c75';
    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/transcript/i);
    media.transcriptSha256 =
      'sha256:00e6d3be43468620bd33712bc53108fe3a43e713a79165d364efc2df1a57da3a';
    media.licenseIds = ['generated-media-cc0'];
    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/candidate license/i);
    media.licenseIds = [...candidate.licenseIds, 'generated-media-cc0'];
    catalog.licenses.find(({ id }) => id === 'generated-media-cc0')!.permitsRedistribution = false;
    expect(() => validateLaunchCatalogForRelease(catalog)).toThrow(/generated-output rights/i);
  });

  it('matches the checked-in launch JSON byte for byte', async () => {
    const [checkedIn, integrityText] = await Promise.all([
      readFile(launchPath, 'utf8'),
      readFile(integrityPath, 'utf8'),
    ]);
    const integrity = JSON.parse(integrityText) as { sha256: string; bytes: number };

    expect(checkedIn).toBe(stableStringifyLaunchCatalog(buildLaunchCatalog()));
    expect(integrity.sha256).toBe(
      `sha256:${createHash('sha256').update(checkedIn, 'utf8').digest('hex')}`,
    );
    expect(integrity.bytes).toBe(Buffer.byteLength(checkedIn, 'utf8'));
  });

  it('contains no private repository fields, secrets, or machine paths', () => {
    const serialized = stableStringifyLaunchCatalog(buildLaunchCatalog());

    for (const forbidden of [
      'isPrivate',
      'visibility',
      'private-audit',
      'githubToken',
      'accessToken',
      'C:\\Users\\',
      'F:\\butcher\\',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

const repositoryScanIgnoredDirectories = new Set([
  '.git',
  'dist',
  'node_modules',
  'target',
  'test-results',
]);
const forbiddenRepositoryBinaryExtensions = new Set([
  '.bin',
  '.bz2',
  '.flac',
  '.gguf',
  '.mp3',
  '.npz',
  '.onnx',
  '.opus',
  '.safetensors',
  '.tar',
  '.wav',
  '.webm',
  '.zip',
]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !repositoryScanIgnoredDirectories.has(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
  );
  return files.flat();
}

function findForbiddenRepositoryBinaries(files: string[]): string[] {
  return files.filter((file) =>
    forbiddenRepositoryBinaryExtensions.has(extname(file).toLowerCase()),
  );
}

it('ignores generated build directories without hiding ordinary repository binaries', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'open-voice-repository-scan-'));
  try {
    await Promise.all([
      mkdir(join(fixtureRoot, 'assets'), { recursive: true }),
      mkdir(join(fixtureRoot, 'target'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(fixtureRoot, 'assets', 'model.bin'), 'ordinary repository binary'),
      writeFile(join(fixtureRoot, 'target', 'cache.bin'), 'generated build output'),
    ]);

    const binaries = findForbiddenRepositoryBinaries(await walk(fixtureRoot))
      .map((file) => relative(fixtureRoot, file))
      .sort();

    expect(binaries).toEqual([join('assets', 'model.bin')]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

it('does not commit inference or audio binaries', async () => {
  const files = await walk(repositoryRoot);

  expect(findForbiddenRepositoryBinaries(files)).toEqual([]);
});
