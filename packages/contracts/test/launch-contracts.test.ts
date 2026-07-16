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

  it('validates a deterministic machine-readable browser S0 preparation evidence record', () => {
    const evidenceSchema = schema('BrowserRuntimeS0EvidenceSchema');
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
