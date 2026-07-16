import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildLaunchCatalog,
  computeEdgeSnapshotContentHash,
  countLaunchCatalog,
  stableStringifyLaunchCatalog,
  validateLaunchCatalogForRelease,
} from '../src/launch.js';

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

describe('deterministic launch catalog', () => {
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

  it('passes launch schema, reference, gate, gallery, and count validation', () => {
    const result = validateLaunchCatalogForRelease(buildLaunchCatalog());

    expect(result.counts.totalVoices).toBe(426);
  });

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
      transcriptSha256: 'sha256:d7c0ad1ba3280f932b56704ca2b57f84677adcc7e658a148fd5107e18ddb9c75',
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
    const integrity = JSON.parse(integrityText) as { sha256: string };

    expect(checkedIn).toBe(stableStringifyLaunchCatalog(buildLaunchCatalog()));
    expect(integrity.sha256).toBe(
      `sha256:${createHash('sha256').update(checkedIn, 'utf8').digest('hex')}`,
    );
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

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !['.git', 'node_modules', 'dist', 'test-results'].includes(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
  );
  return files.flat();
}

it('does not commit inference or audio binaries', async () => {
  const forbidden = new Set([
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
  const files = await walk(repositoryRoot);

  expect(files.filter((file) => forbidden.has(extname(file).toLowerCase()))).toEqual([]);
});
