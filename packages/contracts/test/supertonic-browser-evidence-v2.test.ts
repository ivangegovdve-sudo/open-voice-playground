import { describe, expect, it } from 'vitest';

import {
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
  SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES,
  SUPERTONIC_VOICE_IDS,
} from '../src/index.js';
import {
  SUPERTONIC_BROWSER_QUALIFICATION_FAILURE_CASE_IDS,
  SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER,
  SUPERTONIC_BROWSER_QUALIFICATION_LIFECYCLE_PLAN,
  SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2,
  SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID,
  SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES,
  SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256,
  SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN,
  SupertonicBrowserQualificationEvidenceV2Schema,
} from '../src/supertonic-browser-evidence-v2.js';

const AT = '2026-07-17T12:00:00.000Z';
const APP_ORIGIN = 'https://open-voice-task6-a1b2c3.vercel.app';
const TERMS_SHA256 = 'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f';

const MODEL_PATHS = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'voice_styles/F1.json',
  'voice_styles/F2.json',
  'voice_styles/F3.json',
  'voice_styles/F4.json',
  'voice_styles/F5.json',
  'voice_styles/M1.json',
  'voice_styles/M2.json',
  'voice_styles/M3.json',
  'voice_styles/M4.json',
  'voice_styles/M5.json',
] as const;

function sha256(value: number): `sha256:${string}` {
  return `sha256:${value.toString(16).padStart(64, '0')}`;
}

function artifact(path: string, mediaType: 'application/json' | 'image/png' | 'text/plain') {
  return { path, sha256: sha256(path.length), bytes: 100 + path.length, mediaType } as const;
}

function audioEvidence(
  index: number,
  filename: string,
  minimumSampleFrames: number,
  maximumSampleFrames: number,
) {
  const digest = sha256(1_000 + index);
  const sampleFrames = Math.max(88_200, minimumSampleFrames);
  const pcmBytes = sampleFrames * 2;
  const fileBytes = pcmBytes + 44;
  const sampleSquareSumPcm16 = sampleFrames * 40_000;
  return {
    mimeType: 'audio/wav',
    filename,
    workerResultSha256: digest,
    blobSha256: digest,
    playerSha256: digest,
    downloadSha256: digest,
    policyId: 'supertonic-pcm16-44100-evidence-v1',
    fileBytes,
    header: {
      riffChunkSizeBytes: fileBytes - 8,
      fmtChunkSizeBytes: 16,
      audioFormat: 1,
      channelCount: 1,
      sampleRateHz: 44_100,
      byteRate: 88_200,
      blockAlignBytes: 2,
      bitsPerSample: 16,
      dataOffsetBytes: 44,
      pcmBytes,
    },
    sampleFrames,
    durationMicrosFloor: Math.floor((sampleFrames * 1_000_000) / 44_100),
    promptBand: { minimumSampleFrames, maximumSampleFrames },
    signal: {
      minPcm16: -1_000,
      maxPcm16: 1_000,
      peakPcm16: 1_000,
      sampleSumPcm16: 0,
      sampleSquareSumPcm16,
      nonZeroFrames: sampleFrames / 2,
      nonZeroPpmFloor: 500_000,
      clippedFrames: 0,
      clippedPpmFloor: 0,
      rmsPcm16MilliFloor: 200_000,
      dcOffsetPcm16MilliTrunc: 0,
    },
    validation: 'passed',
    sha256: digest,
  } as const;
}

function runReview(language: string, styleDistinct: 'pass' | 'not-applicable') {
  return {
    reviewerId: `reviewer-${language}`,
    languageCompetence: 'fluent',
    playbackDevice: {
      kind: 'headphones',
      manufacturer: 'Evidence Audio',
      model: 'Reference One',
      connection: 'wired',
      outputSampleRateHz: 48_000,
    },
    reviewedAt: AT,
    intelligibility: 'pass',
    languageMatch: 'pass',
    skips: 'none',
    repeats: 'none',
    artifacts: 'none',
    clipping: 'none',
    styleDistinct,
    decision: 'pass',
  } as const;
}

function trace(name: string) {
  return artifact(
    `packages/contracts/evidence-assets/${name}-${'a'.repeat(64)}.json`,
    'application/json',
  );
}

function passingFailureCase(
  caseId: (typeof SUPERTONIC_BROWSER_QUALIFICATION_FAILURE_CASE_IDS)[number],
  ordinal: number,
) {
  const common = {
    caseId,
    ordinal,
    status: 'passed',
    startedAt: AT,
    finishedAt: AT,
    trace: trace(caseId),
  } as const;
  switch (caseId) {
    case 'cold-online':
      return {
        ...common,
        freshProfile: true,
        initialOpfsItemCount: 0,
        initialCacheMatchCount: 0,
        initialServiceWorkerRegistrationCount: 0,
        modelRequestCount: 16,
        runtimeRequestCount: 1,
        duplicateRequestCount: 0,
        downloadedClosureItemCount: 17,
      } as const;
    case 'warm-online':
      return {
        ...common,
        verifiedOpfsItemCount: 16,
        modelNetworkRequestCount: 0,
        runtimeNetworkRequestCount: 0,
        modelNetworkTransferBytes: 0,
        runtimeNetworkTransferBytes: 0,
        synthesisAudioSha256: sha256(2_001),
      } as const;
    case 'warm-offline-hard-reload':
      return {
        ...common,
        hardReload: true,
        offline: true,
        shellSource: 'browser-http-cache',
        verifiedOpfsItemCount: 16,
        modelNetworkTransferBytes: 0,
        runtimeNetworkTransferBytes: 0,
        synthesisAudioSha256: sha256(2_002),
      } as const;
    case 'cold-offline':
      return {
        ...common,
        offline: true,
        initialOpfsItemCount: 0,
        terminalErrorCode: 'offline-closure-unavailable',
        failureStage: 'before-worker-construction',
        workerCreatedCount: 0,
        sessionCreatedCount: 0,
        audioAcceptedCount: 0,
      } as const;
    case 'corrupt-model-entry':
      return {
        ...common,
        artifactId: 'onnx-vector-estimator-onnx',
        byteOffset: 0,
        originalByte: 0,
        corruptByte: 1,
        hashRejected: true,
        exactKeyEvictionCount: 1,
        modelRedownloadCount: 1,
        runtimeRedownloadCount: 0,
        otherArtifactRedownloadCount: 0,
        reverified: true,
      } as const;
    case 'corrupt-runtime-wasm':
      return {
        ...common,
        artifactId: 'onnxruntime-web-wasm-runtime',
        byteOffset: 0,
        originalByte: 0,
        corruptByte: 1,
        hashRejected: true,
        exactKeyEvictionCount: 1,
        modelRedownloadCount: 0,
        runtimeRedownloadCount: 1,
        otherArtifactRedownloadCount: 0,
        reverified: true,
      } as const;
    case 'quota-minus-one':
      return {
        ...common,
        requiredCapacityBytes: 692_029_340,
        forcedAvailableBytes: 692_029_339,
        terminalErrorCode: 'quota-exceeded',
        networkRequestCount: 0,
        workerCreatedCount: 0,
        sessionCreatedCount: 0,
      } as const;
    case 'cancel-download':
    case 'cancel-hash-store':
    case 'cancel-import-session':
    case 'cancel-synthesis':
      return {
        ...common,
        injectionStage: caseId.slice('cancel-'.length),
        terminalCancellationCount: 1,
        lateAcceptedEventCount: 0,
        lateAudioCount: 0,
        lateDownloadCount: 0,
        temporaryArtifactCountAfter: 0,
        recoveryWorkerGeneration: 101 + ordinal,
        recoveryAudioSha256: sha256(2_100 + ordinal),
      } as const;
    case 'restart-warm-offline':
      return {
        ...common,
        sameProfile: true,
        browserRestartCount: 1,
        offline: true,
        verifiedOpfsItemCount: 16,
        modelNetworkTransferBytes: 0,
        runtimeNetworkTransferBytes: 0,
        synthesisAudioSha256: sha256(2_200),
      } as const;
    case 'webgpu-device-loss':
      return {
        caseId,
        ordinal,
        status: 'not-applicable',
        reasonCode: 'wasm-backend-has-no-webgpu-device',
      } as const;
  }
}

function passingEvidence() {
  const runtime = SUPERTONIC_RUNTIME_IDENTITIES.wasm;
  const evidenceId = `stq2-${'2'.repeat(32)}`;
  const modelBytes = SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.reduce(
    (total, item) => total + item.byteLength,
    0,
  );
  const selectedBytes = modelBytes + runtime.byteLength;
  const promptSetId = SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID;
  const promptManifestSha256 = SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256;
  const operationalLedgerSha256 = sha256(11);
  const operationalLedgerBytes = 4_096;
  const preEnableEvidence = {
    evidenceId: `stq2-${'3'.repeat(32)}`,
    path: `packages/contracts/evidence-assets/pre-enable-${sha256(4).slice('sha256:'.length)}.json`,
    sha256: sha256(4),
    bytes: 10_000,
    tupleId: 'chrome-wasm',
    decision: 'passed',
  } as const;
  const operationalTuples = [
    {
      tupleId: 'chrome-webgpu',
      browserFamily: 'chrome',
      backend: 'webgpu',
      selectionId: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
      selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionDigest,
      operationalStatus: 'disabled',
      reasonCode: 'not-qualified-for-deployed-candidate',
      reviewedBrowserMajor: null,
      allowedVoiceIds: [],
      qualificationEvidenceId: null,
      preEnableEvidenceId: null,
    },
    {
      tupleId: 'chrome-wasm',
      browserFamily: 'chrome',
      backend: 'wasm',
      selectionId: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
      selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionDigest,
      operationalStatus: 'enabled',
      reasonCode: null,
      reviewedBrowserMajor: 150,
      allowedVoiceIds: [...SUPERTONIC_VOICE_IDS],
      qualificationEvidenceId: evidenceId,
      preEnableEvidenceId: preEnableEvidence.evidenceId,
    },
    {
      tupleId: 'edge-webgpu',
      browserFamily: 'edge',
      backend: 'webgpu',
      selectionId: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
      selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionDigest,
      operationalStatus: 'disabled',
      reasonCode: 'not-qualified-for-deployed-candidate',
      reviewedBrowserMajor: null,
      allowedVoiceIds: [],
      qualificationEvidenceId: null,
      preEnableEvidenceId: null,
    },
    {
      tupleId: 'edge-wasm',
      browserFamily: 'edge',
      backend: 'wasm',
      selectionId: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
      selectionDigest: SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionDigest,
      operationalStatus: 'disabled',
      reasonCode: 'not-qualified-for-deployed-candidate',
      reviewedBrowserMajor: null,
      allowedVoiceIds: [],
      qualificationEvidenceId: null,
      preEnableEvidenceId: null,
    },
  ] as const;
  const closureObservations = [
    ...SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.map((identity, index) => {
      const finalOrigin =
        identity.mediaType === 'application/onnx'
          ? 'https://cas-bridge.xethub.hf.co'
          : 'https://huggingface.co';
      return {
        result: 'passed',
        ordinal: index + 1,
        kind: 'model',
        artifactId: identity.assetId,
        cacheKey: `supertonic/${identity.assetId}/3cadd1ee6394adea1bd021217a0e650ede09a323/${identity.sha256.slice('sha256:'.length)}`,
        expectedBytes: identity.byteLength,
        observedBytes: identity.byteLength,
        expectedSha256: identity.sha256,
        observedSha256: identity.sha256,
        mediaType: identity.mediaType,
        requestUrl: `https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/${MODEL_PATHS[index]}?download=true`,
        finalOrigin,
        finalUrlRedacted: `${finalOrigin}/<redacted>`,
        finalUrlSha256: sha256(100 + index),
        responseType: 'cors',
        httpStatus: 200,
        networkTransferBytes: identity.byteLength,
        storage: 'opfs',
        opfsCommitted: true,
        signedQueryPersisted: false,
      } as const;
    }),
    {
      result: 'passed',
      ordinal: 17,
      kind: 'runtime',
      artifactId: runtime.artifactId,
      cacheKey: 'assets/ort-wasm-simd-threaded-Cpm-ox6i.wasm',
      expectedBytes: runtime.byteLength,
      observedBytes: runtime.byteLength,
      expectedSha256: runtime.sha256,
      observedSha256: runtime.sha256,
      mediaType: 'application/wasm',
      requestUrl: `${APP_ORIGIN}/assets/ort-wasm-simd-threaded-Cpm-ox6i.wasm`,
      finalOrigin: APP_ORIGIN,
      finalUrlRedacted: `${APP_ORIGIN}/<redacted>`,
      finalUrlSha256: sha256(117),
      responseType: 'basic',
      httpStatus: 200,
      networkTransferBytes: runtime.byteLength,
      storage: 'browser-http-cache',
      opfsCommitted: false,
      browserCacheObserved: true,
      signedQueryPersisted: false,
    } as const,
  ];
  const promptFixtures = SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN.map((plan) => {
    const languageIndex = SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER.indexOf(plan.language);
    return {
      ordinal: plan.ordinal,
      rowId: plan.promptRowId,
      voiceId: plan.voiceId,
      language: plan.language,
      path: `packages/contracts/evidence-assets/prompts/${plan.promptRowId}-${plan.promptTextSha256.slice('sha256:'.length)}.txt`,
      promptTextSha256: plan.promptTextSha256,
      utf8Bytes: 100 + languageIndex,
      codePointCount: 40 + languageIndex,
      speechUnitMethod: plan.speechUnitMethod,
      reviewedSpeechUnitCount: plan.reviewedSpeechUnitCount,
      minimumSampleFrames: plan.minimumSampleFrames,
      maximumSampleFrames: plan.maximumSampleFrames,
      projectAuthored: true,
      reviewedAt: AT,
      reviewerId: `reviewer-${plan.language}`,
    } as const;
  });
  const runs = SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN.map((plan, index) => ({
    ordinal: plan.ordinal,
    runId: plan.runId,
    voiceId: plan.voiceId,
    language: plan.language,
    promptRowId: plan.promptRowId,
    status: 'passed',
    promptTextSha256: promptFixtures[index]!.promptTextSha256,
    speed: 1,
    workerGeneration: index + 1,
    operationId: index + 1,
    startedAt: AT,
    finishedAt: AT,
    prepareMs: 10,
    synthesisMs: 100,
    totalMs: 110,
    audio: audioEvidence(
      index,
      `ai-generated-${plan.voiceId.replace(':', '-').toLowerCase()}-${plan.language}.wav`,
      promptFixtures[index]!.minimumSampleFrames,
      promptFixtures[index]!.maximumSampleFrames,
    ),
    review: runReview(
      plan.language,
      (plan.language === 'en' && plan.voiceId !== 'supertonic:M1') ||
        (plan.voiceId === 'supertonic:F1' && (plan.language === 'ja' || plan.language === 'ar'))
        ? 'pass'
        : 'not-applicable',
    ),
  }));

  return {
    schemaVersion: 2,
    kind: 'open-voice-supertonic-browser-qualification-evidence',
    evidenceId,
    qualificationPolicy: {
      ...SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2,
      policySha256: sha256(1),
    },
    candidate: {
      qualificationPhase: 'post-enable-enabled',
      operatorId: 'operator-qualification-host',
      gitCommit: 'a'.repeat(40),
      gitTree: 'b'.repeat(40),
      dirty: false,
      buildDigest: sha256(2),
      catalogSha256: sha256(3),
      deployment: {
        provider: 'vercel',
        deploymentId: 'dpl_open_voice_task6_a1b2c3',
        immutableUrl: APP_ORIGIN,
        deployedAt: AT,
        httpStatus: 200,
      },
      promptSetId,
      promptSetManifestSha256: promptManifestSha256,
      promptSetBytes: SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES,
      preEnableEvidence,
    },
    operationalLedger: {
      schemaVersion: 2,
      kind: 'open-voice-supertonic-browser-operational-ledger-binding',
      qualificationPhase: 'post-enable-enabled',
      artifact: {
        path: `packages/contracts/evidence-assets/operational-ledger-${operationalLedgerSha256.slice('sha256:'.length)}.json`,
        sha256: operationalLedgerSha256,
        bytes: operationalLedgerBytes,
        mediaType: 'application/json',
      },
      tuples: operationalTuples,
    },
    testedTuple: {
      tupleId: 'chrome-wasm',
      engineId: 'supertonic',
      browserFamily: 'chrome',
      browserBrand: 'Google Chrome',
      browserChannel: 'stable',
      browserVersion: '150.0.7871.128',
      browserMajor: 150,
      backend: 'wasm',
      selectionId: runtime.selectionId,
      selectionDigest: runtime.selectionDigest,
      runtimeArtifactId: runtime.artifactId,
      runtimeSha256: runtime.sha256,
      runtimeBytes: runtime.byteLength,
      assetSetId: 'supertonic-browser-assets',
      manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
      os: {
        family: 'windows',
        version: '11',
        build: '26100.4652',
        architecture: 'x86_64',
      },
    },
    environment: {
      status: 'passed',
      capturedAt: AT,
      pageOrigin: APP_ORIGIN,
      secureContext: true,
      crossOriginIsolated: true,
      browserFlags: {
        forcedGc: false,
        unsafeWebgpu: false,
        ignoreGpuBlocklist: false,
        otherNonDefaultCount: 0,
      },
      cpu: { model: 'AMD Ryzen 7 5700X', logicalProcessors: 16, architecture: 'x86_64' },
      ramBytes: 34_359_738_368,
      gpu: { vendor: 'NVIDIA', device: 'GeForce RTX 2060', driverVersion: '32.0.15.7680' },
      webgpu: { status: 'not-requested', reasonCode: 'wasm-backend' },
      runtime: {
        packageName: 'onnxruntime-web',
        packageVersion: '1.27.0',
        numThreads: 1,
        proxy: false,
        wasmBinaryTransferred: true,
        requestedExecutionProvider: 'wasm',
        observedExecutionProvider: 'wasm',
        selectedBackendImportCount: 1,
        unselectedBackendImportCount: 0,
        fallbackAttemptCount: 0,
      },
      failure: null,
    },
    consent: {
      status: 'passed',
      selectionId: runtime.selectionId,
      selectionDigest: runtime.selectionDigest,
      assetSetId: 'supertonic-browser-assets',
      manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
      requiredLicenseIds: ['supertone-weights-license'],
      acceptedLicenseIds: ['supertone-weights-license'],
      requiredTermsHashes: [TERMS_SHA256],
      acceptedTermsHashes: [TERMS_SHA256],
      disclosureSha256: sha256(5),
      receiptSha256: sha256(6),
      acceptedAt: AT,
      userGesture: true,
      failure: null,
    },
    preConsent: {
      status: 'passed',
      windowStartedAt: AT,
      windowEndedAt: AT,
      instrumentation: {
        pageInstalledBeforeFirstApplicationScript: true,
        workerInstalledBeforeResume: true,
        trace: trace('pre-consent'),
        eventCount: 2,
        droppedEventCount: 0,
      },
      allowed: { shellFetchCount: 1, catalogFetchCount: 1 },
      forbidden: {
        modelFetchCount: 0,
        runtimeFetchCount: 0,
        ortModuleImportCount: 0,
        workerCreateCount: 0,
        workerResumeCount: 0,
        opfsOperationCount: 0,
        cacheStorageInferenceOperationCount: 0,
        xhrInferenceRequestCount: 0,
        importScriptsInferenceRequestCount: 0,
        dynamicModuleInferenceRequestCount: 0,
        webgpuDeviceCreateCount: 0,
        sessionCreateCount: 0,
        inferenceExecuteCount: 0,
      },
      forbiddenInferenceEventCount: 0,
      firstForbiddenEvent: null,
      failure: null,
    },
    closure: {
      status: 'passed',
      mode: 'cold-online',
      modelBytes,
      runtimeBytes: runtime.byteLength,
      selectedBytes,
      observations: closureObservations,
      failure: null,
    },
    storage: {
      status: 'passed',
      selectedBytes,
      modelBytes,
      runtimeBytes: runtime.byteLength,
      largestAssetBytes: 256_534_781,
      safetyMarginBytes: 20_737_837,
      upperBoundBytes: 692_029_340,
      retainedModelBytes: 0,
      candidateModelBytes: modelBytes,
      candidateRuntimeCacheBytes: runtime.byteLength,
      largestTemporaryBytes: 256_534_781,
      additionalRequiredBytes: 692_029_340,
      requiredCapacityBytes: 692_029_340,
      availableBytesBefore: 2_000_000_000,
      before: {
        capturedAt: AT,
        quotaBytes: 2_000_000_000,
        usageBytes: 0,
        persistence: { state: 'observed', value: true, reasonCode: null },
        opfsItemCount: 0,
        opfsVerifiedBytes: 0,
        browserCachedRuntimeBytes: 0,
      },
      after: {
        capturedAt: AT,
        quotaBytes: 2_000_000_000,
        usageBytes: selectedBytes,
        persistence: { state: 'observed', value: true, reasonCode: null },
        opfsItemCount: 16,
        opfsVerifiedBytes: modelBytes,
        browserCachedRuntimeBytes: runtime.byteLength,
      },
      failure: null,
    },
    wasmSmoke: {
      status: 'passed',
      runId: 'smoke-m1-en',
      voiceId: 'supertonic:M1',
      language: 'en',
      promptRowId: 'supertonic-q07-m1-en',
      promptTextSha256: promptFixtures[6]!.promptTextSha256,
      startedAt: AT,
      finishedAt: AT,
      elapsedMs: 1_000,
      peakMemoryBytes: 1_000_000_000,
      timeoutMs: SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wasmSmokeTimeoutMs,
      audioSha256: sha256(7),
      failure: null,
    },
    runs: {
      status: 'passed',
      promptSet: {
        promptSetId,
        manifestSha256: promptManifestSha256,
        bytes: SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES,
        fixtures: promptFixtures,
      },
      rows: runs,
      plannedCount: 42,
      passedCount: 42,
      failedCount: 0,
      blockedCount: 0,
      failure: null,
    },
    failures: {
      status: 'passed',
      cases: SUPERTONIC_BROWSER_QUALIFICATION_FAILURE_CASE_IDS.map((caseId, index) =>
        passingFailureCase(caseId, index + 1),
      ),
      plannedCount: 13,
      passedCount: 12,
      notApplicableCount: 1,
      failedCount: 0,
      blockedCount: 0,
      failure: null,
    },
    lifecycle: {
      status: 'passed',
      cycles: SUPERTONIC_BROWSER_QUALIFICATION_LIFECYCLE_PLAN.map((terminal, index) => ({
        cycle: index + 1,
        status: 'passed',
        plannedTerminal: terminal,
        workerGeneration: 200 + index,
        prepareOperationId: 300 + index * 3,
        synthesisOperationId: 301 + index * 3,
        disposeOperationId: 302 + index * 3,
        workerCreatedAt: AT,
        terminalAt: AT,
        disposeAcknowledgedAt: AT,
        workerTerminatedAt: AT,
        terminalResponse: terminal,
        disposeAcknowledged: true,
        survivingWorkerCount: 0,
        survivingSessionCount: 0,
        opfsItemCount: 16,
        opfsVerifiedBytes: modelBytes,
        cdpMemory: {
          beforeBytes: 1_000_000_000,
          peakBytes: 1_100_000_000,
          settledBytes: 1_010_000_000,
        },
        userAgentSpecificMemory: {
          state: 'unavailable',
          bytes: null,
          reasonCode: 'api-not-exposed',
        },
        forcedGc: false,
        webgpuFlags: false,
      })),
      plannedCount: 5,
      passedCount: 5,
      failedCount: 0,
      blockedCount: 0,
      failure: null,
    },
    ui: {
      status: 'passed',
      preConsentWarning: {
        text: 'Nonconsensual impersonation is prohibited. Use preset voices responsibly.',
        visible: true,
        visibleAt: AT,
      },
      machineGeneratedDisclosure: {
        text: 'Machine-generated audio — not a human recording.',
        visible: true,
      },
      sharedDownloadDisclosure: {
        text: 'Shared copies need an AI-generated disclosure and applicable notices. Nonconsensual impersonation is prohibited.',
        visible: true,
      },
      filename: 'ai-generated-supertonic-m1-en.wav',
      accessibility: {
        audioName: 'Generated audio',
        downloadName: 'Download WAV',
        audioDescribedByIds: ['machine-generated-audio-notice', 'shared-audio-disclosure-notice'],
        downloadDescribedByIds: [
          'machine-generated-audio-notice',
          'shared-audio-disclosure-notice',
        ],
      },
      desktop: {
        viewportWidth: 1440,
        viewportHeight: 900,
        screenshot: artifact(
          `packages/contracts/evidence-assets/desktop-${'c'.repeat(64)}.png`,
          'image/png',
        ),
        accessibilitySnapshot: trace('desktop-a11y'),
      },
      mobile: {
        viewportWidth: 390,
        viewportHeight: 844,
        screenshot: artifact(
          `packages/contracts/evidence-assets/mobile-${'d'.repeat(64)}.png`,
          'image/png',
        ),
        accessibilitySnapshot: trace('mobile-a11y'),
      },
      failure: null,
    },
    build: {
      status: 'passed',
      sourceCommit: 'a'.repeat(40),
      sourceTree: 'b'.repeat(40),
      packageLockSha256: sha256(8),
      command: 'npm.cmd run build:web',
      nodeVersion: '22.13.0',
      npmVersion: '11.16.0',
      viteVersion: '8.1.4',
      emittedGraphSha256: sha256(2),
      emittedFiles: [
        {
          path: 'assets/index-Dt9CXc9S.js',
          role: 'initial-js',
          sha256: sha256(20),
          bytes: 495_075,
          gzipBytes: 145_300,
          mediaType: 'text/javascript',
        },
        {
          path: 'assets/supertonic.worker-DrBcIXtW.js',
          role: 'supertonic-worker',
          sha256: sha256(21),
          bytes: 127_421,
          gzipBytes: 40_000,
          mediaType: 'text/javascript',
        },
        {
          path: 'assets/ort-wasm-simd-threaded-Cpm-ox6i.wasm',
          role: 'selected-runtime-wasm',
          sha256: runtime.sha256,
          bytes: runtime.byteLength,
          gzipBytes: 3_498_230,
          mediaType: 'application/wasm',
        },
      ],
      initialJsGzipBytes: 145_300,
      initialJsGzipLimitBytes: 256_000,
      supertonicWorkerFileCount: 1,
      selectedRuntimeWasmFileCount: 1,
      modelFileCount: 0,
      shellPrecache: {
        entryCount: 2,
        workerEntryCount: 0,
        ortEntryCount: 0,
        wasmEntryCount: 0,
        onnxEntryCount: 0,
        modelEntryCount: 0,
      },
      fixtureScan: {
        testToneReferenceCount: 0,
        hz440ReferenceCount: 0,
        unverifiedBoundaryReferenceCount: 0,
        testSwitchReferenceCount: 0,
        fixtureAssetReferenceCount: 0,
        report: trace('fixture-scan'),
      },
      productionConsole: { errorCount: 0, warningCount: 0, unhandledRejectionCount: 0 },
      operationalLedgerSha256,
      operationalLedgerBytes,
      operationalTupleIds: ['chrome-wasm'],
      failure: null,
    },
    security: {
      status: 'passed',
      reportOnlyObservation: trace('csp-report-only'),
      csp: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        scriptSrcAttr: ["'none'"],
        workerSrc: ["'self'"],
        connectSrc: ["'self'", 'https://huggingface.co', 'https://cas-bridge.xethub.hf.co'],
        styleSrcElem: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
      },
      headers: {
        contentSecurityPolicyMode: 'enforced',
        crossOriginOpenerPolicy: 'same-origin',
        crossOriginEmbedderPolicy: 'require-corp',
        crossOriginResourcePolicy: 'same-origin',
        originAgentCluster: '?1',
        referrerPolicy: 'no-referrer',
        xContentTypeOptions: 'nosniff',
      },
      cachePolicy: {
        indexHtmlRevalidated: true,
        serviceWorkerRevalidated: true,
        catalogPointerRevalidated: true,
        hashedAssetMaxAgeSeconds: 31_536_000,
        hashedAssetsImmutable: true,
      },
      mime: {
        javascript: 'text/javascript',
        wasm: 'application/wasm',
      },
      observedOrigins: [APP_ORIGIN, 'https://huggingface.co', 'https://cas-bridge.xethub.hf.co'],
      cspViolationCount: 0,
      coopCoepViolationCount: 0,
      corsViolationCount: 0,
      mixedContentCount: 0,
      signedRedirectHygiene: {
        rawResponseUrlPersistedCount: 0,
        signedQueryInOpfsCount: 0,
        signedQueryInCacheStorageCount: 0,
        signedQueryInHarCount: 0,
        signedQueryInScreenshotsCount: 0,
        signedQueryInLogsCount: 0,
        signedQueryInGitCount: 0,
        harCaptured: false,
        scanReport: trace('signed-url-scan'),
      },
      failure: null,
    },
    humanReview: {
      status: 'approved',
      operatorId: 'operator-qualification-host',
      qualificationReviewerId: 'reviewer-qualification',
      independentReviewerId: 'reviewer-independent',
      reviewedAt: AT,
      exactDiff: {
        baseCommit: 'c'.repeat(40),
        headCommit: 'a'.repeat(40),
        diffSha256: sha256(9),
      },
      languageCoverage: SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER.map((language) => ({
        language,
        reviewerId: `reviewer-${language}`,
        competence: 'fluent',
      })),
      runReviewCount: 42,
      approvedRunReviewCount: 42,
      findingCount: 0,
      findings: [],
      decision: 'approved-for-exact-tuple',
    },
    decision: {
      status: 'passed',
      scope: 'final-enabled',
      concludedAt: AT,
      terminalFailure: null,
      operationalEnablement: {
        allowed: true,
        tupleId: 'chrome-wasm',
      },
    },
  };
}

function failedBuildEvidence() {
  const passing = passingEvidence();
  const terminalFailure = {
    failureId: 'failure-001',
    gateId: 'build',
    reasonCode: 'build-gate-failed',
    observedAt: AT,
    traceSequence: 0,
    messageSha256: sha256(4_000),
  } as const;
  return {
    schemaVersion: 2,
    kind: 'open-voice-supertonic-browser-qualification-evidence',
    evidenceId: `stq2-${'4'.repeat(32)}`,
    qualificationPolicy: passing.qualificationPolicy,
    candidate: passing.candidate,
    testedTuple: passing.testedTuple,
    attempt: {
      status: 'failed',
      startedAt: AT,
      stoppedAt: AT,
      completedGates: [],
      failedGate: {
        gateId: 'build',
        status: 'failed',
        failure: terminalFailure,
        evidence: trace('failed-build'),
      },
    },
    decision: {
      status: 'failed',
      scope: 'qualification-attempt',
      concludedAt: AT,
      terminalFailure,
      operationalEnablement: { allowed: false, tupleId: null },
    },
  } as const;
}

function expectQualificationRejected(evidence: unknown) {
  expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(evidence).success).toBe(false);
}

describe('Supertonic browser qualification evidence v2', () => {
  it('freezes the authoritative 42-run matrix in canonical order', () => {
    expect(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256).toBe(
      'sha256:1c94e0a39e61e5e13316a56a6c2cf9fdecd46225a30f8b65b5cb852c07e6d284',
    );
    expect(SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN[0]).toMatchObject({
      promptRowId: 'supertonic-q01-m1-ar',
      promptTextSha256: 'sha256:6e933e58d54a4fffaf730b06d75989f88594bc8f65db2389077b8f20e9d81941',
      reviewedSpeechUnitCount: 9,
      minimumSampleFrames: 66_150,
      maximumSampleFrames: 617_400,
    });
    expect(SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN).toHaveLength(42);
    expect(
      SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN.map(
        ({ ordinal, voiceId, language }) => `${ordinal}:${voiceId}:${language}`,
      ),
    ).toEqual([
      '1:supertonic:M1:ar',
      '2:supertonic:M1:bg',
      '3:supertonic:M1:cs',
      '4:supertonic:M1:da',
      '5:supertonic:M1:de',
      '6:supertonic:M1:el',
      '7:supertonic:M1:en',
      '8:supertonic:M1:es',
      '9:supertonic:M1:et',
      '10:supertonic:M1:fi',
      '11:supertonic:M1:fr',
      '12:supertonic:M1:hi',
      '13:supertonic:M1:hr',
      '14:supertonic:M1:hu',
      '15:supertonic:M1:id',
      '16:supertonic:M1:it',
      '17:supertonic:M1:ja',
      '18:supertonic:M1:ko',
      '19:supertonic:M1:lt',
      '20:supertonic:M1:lv',
      '21:supertonic:M1:nl',
      '22:supertonic:M1:pl',
      '23:supertonic:M1:pt',
      '24:supertonic:M1:ro',
      '25:supertonic:M1:ru',
      '26:supertonic:M1:sk',
      '27:supertonic:M1:sl',
      '28:supertonic:M1:sv',
      '29:supertonic:M1:tr',
      '30:supertonic:M1:uk',
      '31:supertonic:M1:vi',
      '32:supertonic:F1:en',
      '33:supertonic:F1:ja',
      '34:supertonic:F1:ar',
      '35:supertonic:F2:en',
      '36:supertonic:F3:en',
      '37:supertonic:F4:en',
      '38:supertonic:F5:en',
      '39:supertonic:M2:en',
      '40:supertonic:M3:en',
      '41:supertonic:M4:en',
      '42:supertonic:M5:en',
    ]);
  });

  it('accepts one complete final deployed qualification for an exact branded tuple', () => {
    const evidence = passingEvidence();
    const parsed = SupertonicBrowserQualificationEvidenceV2Schema.parse(evidence);

    expect('runs' in parsed).toBe(true);
    if (!('runs' in parsed)) throw new Error('Expected passing qualification evidence');

    expect(parsed.decision).toEqual({
      status: 'passed',
      scope: 'final-enabled',
      concludedAt: AT,
      terminalFailure: null,
      operationalEnablement: { allowed: true, tupleId: 'chrome-wasm' },
    });
    expect(parsed.runs.rows).toHaveLength(42);
    expect(parsed.failures.cases).toHaveLength(13);
    expect(parsed.lifecycle.cycles).toHaveLength(5);
  });

  it('binds the visible download and every run review to the reviewed prompt row', () => {
    const wrongFilename = structuredClone(passingEvidence());
    Object.assign(wrongFilename.ui, { filename: 'ai-generated-supertonic-f1-en.wav' });
    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(wrongFilename).success).toBe(
      false,
    );

    const wrongReviewer = structuredClone(passingEvidence());
    Object.assign(wrongReviewer.runs.rows[6]!.review, { reviewerId: 'reviewer-independent' });
    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(wrongReviewer).success).toBe(
      false,
    );
  });

  it('rejects an unhashed runtime output even when every reference is changed together', () => {
    const evidence = structuredClone(passingEvidence());
    const runtimeFile = evidence.build.emittedFiles[2]!;
    const runtimeObservation = evidence.closure.observations[16]!;
    Object.assign(runtimeFile, { path: 'assets/runtime.wasm' });
    Object.assign(runtimeObservation, {
      cacheKey: 'assets/runtime.wasm',
      requestUrl: `${APP_ORIGIN}/assets/runtime.wasm`,
    });

    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(evidence).success).toBe(false);
  });

  it('accepts truthful early-stop evidence but rejects a gate/reason mismatch', () => {
    const failed = failedBuildEvidence();
    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(failed).success).toBe(true);

    const wrongReason = structuredClone(failed);
    Object.assign(wrongReason.attempt.failedGate.failure, {
      reasonCode: 'security-gate-failed',
    });
    Object.assign(wrongReason.decision.terminalFailure, {
      reasonCode: 'security-gate-failed',
    });
    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(wrongReason).success).toBe(
      false,
    );
  });

  it('rejects reversed timing and hardware identity drift', () => {
    const reversedRun = structuredClone(passingEvidence());
    Object.assign(reversedRun.runs.rows[0]!, {
      startedAt: '2026-07-17T12:01:00.000Z',
      finishedAt: AT,
    });
    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(reversedRun).success).toBe(
      false,
    );

    const wrongArchitecture = structuredClone(passingEvidence());
    Object.assign(wrongArchitecture.environment.cpu, { architecture: 'arm64' });
    expect(
      SupertonicBrowserQualificationEvidenceV2Schema.safeParse(wrongArchitecture).success,
    ).toBe(false);
  });

  it('keeps every object closed and binds one exact branded backend identity', () => {
    const extraRoot = structuredClone(passingEvidence()) as ReturnType<typeof passingEvidence> & {
      unexpected?: boolean;
    };
    extraRoot.unexpected = true;
    expectQualificationRejected(extraRoot);

    const extraNested = structuredClone(passingEvidence()) as ReturnType<typeof passingEvidence> & {
      environment: ReturnType<typeof passingEvidence>['environment'] & { note?: string };
    };
    extraNested.environment.note = 'unreviewed';
    expectQualificationRejected(extraNested);

    const wrongTuple = structuredClone(passingEvidence());
    Object.assign(wrongTuple.testedTuple, { browserMajor: 149 });
    expectQualificationRejected(wrongTuple);

    const fallback = structuredClone(passingEvidence());
    Object.assign(fallback.environment.runtime, { fallbackAttemptCount: 1 });
    expectQualificationRejected(fallback);
  });

  it('rejects missing, reordered, ambiguous, or weakly reviewed positive runs', () => {
    const missing = structuredClone(passingEvidence());
    missing.runs.rows.pop();
    expectQualificationRejected(missing);

    const reordered = structuredClone(passingEvidence());
    reordered.runs.rows.reverse();
    expectQualificationRejected(reordered);

    const wrongPrompt = structuredClone(passingEvidence());
    Object.assign(wrongPrompt.runs.rows[0]!, {
      promptRowId: wrongPrompt.runs.rows[1]!.promptRowId,
      promptTextSha256: wrongPrompt.runs.rows[1]!.promptTextSha256,
    });
    expectQualificationRejected(wrongPrompt);

    const weakStyleReview = structuredClone(passingEvidence());
    Object.assign(weakStyleReview.runs.rows[34]!.review, { styleDistinct: 'not-applicable' });
    expectQualificationRejected(weakStyleReview);

    const duplicateStyleAudio = structuredClone(passingEvidence());
    const baselineHash = duplicateStyleAudio.runs.rows[6]!.audio.workerResultSha256;
    Object.assign(duplicateStyleAudio.runs.rows[31]!.audio, {
      workerResultSha256: baselineHash,
      blobSha256: baselineHash,
      playerSha256: baselineHash,
      downloadSha256: baselineHash,
      sha256: baselineHash,
    });
    expectQualificationRejected(duplicateStyleAudio);
  });

  it('enforces the canonical integer PCM16 policy and prompt band', () => {
    const floatingPolicy = structuredClone(passingEvidence()) as ReturnType<
      typeof passingEvidence
    > & {
      qualificationPolicy: ReturnType<typeof passingEvidence>['qualificationPolicy'] & {
        minRms?: number;
      };
    };
    floatingPolicy.qualificationPolicy.minRms = 0.005;
    expectQualificationRejected(floatingPolicy);

    const lowNonZero = structuredClone(passingEvidence());
    Object.assign(lowNonZero.runs.rows[0]!.audio.signal, {
      nonZeroFrames: 881,
      nonZeroPpmFloor: Math.floor((881 * 1_000_000) / 88_200),
    });
    expectQualificationRejected(lowNonZero);

    const lowRms = structuredClone(passingEvidence());
    const sampleFrames = lowRms.runs.rows[0]!.audio.sampleFrames;
    const sampleSquareSumPcm16 = 1_089 * sampleFrames - 1;
    Object.assign(lowRms.runs.rows[0]!.audio.signal, {
      sampleSquareSumPcm16,
      rmsPcm16MilliFloor: Math.floor(Math.sqrt(sampleSquareSumPcm16 / sampleFrames) * 1_000),
    });
    expectQualificationRejected(lowRms);

    const excessiveClip = structuredClone(passingEvidence());
    Object.assign(excessiveClip.runs.rows[0]!.audio.signal, {
      clippedFrames: 4_411,
      clippedPpmFloor: Math.floor((4_411 * 1_000_000) / 88_200),
    });
    expectQualificationRejected(excessiveClip);

    const wrongBand = structuredClone(passingEvidence());
    Object.assign(wrongBand.runs.rows[0]!.audio.promptBand, {
      minimumSampleFrames: 73_501,
    });
    expectQualificationRejected(wrongBand);
  });

  it('requires exact model OPFS and same-origin browser-cache runtime evidence', () => {
    const runtimeInOpfs = structuredClone(passingEvidence());
    Object.assign(runtimeInOpfs.closure.observations[16]!, {
      storage: 'opfs',
      opfsCommitted: true,
    });
    expectQualificationRejected(runtimeInOpfs);

    const modelOutsideOpfs = structuredClone(passingEvidence());
    Object.assign(modelOutsideOpfs.closure.observations[0]!, {
      storage: 'browser-http-cache',
      opfsCommitted: false,
    });
    expectQualificationRejected(modelOutsideOpfs);

    const wrongRuntimeHash = structuredClone(passingEvidence());
    Object.assign(wrongRuntimeHash.closure.observations[16]!, {
      observedSha256: sha256(9_999),
    });
    expectQualificationRejected(wrongRuntimeHash);

    const runtimeCountedInOpfs = structuredClone(passingEvidence());
    Object.assign(runtimeCountedInOpfs.storage.after, {
      opfsItemCount: 17,
      opfsVerifiedBytes: runtimeCountedInOpfs.storage.selectedBytes,
    });
    expectQualificationRejected(runtimeCountedInOpfs);
  });

  it('rejects incomplete negative/lifecycle gates and unsafe build or security evidence', () => {
    const missingNegative = structuredClone(passingEvidence());
    missingNegative.failures.cases.pop();
    expectQualificationRejected(missingNegative);

    const reorderedLifecycle = structuredClone(passingEvidence());
    reorderedLifecycle.lifecycle.cycles.reverse();
    expectQualificationRejected(reorderedLifecycle);

    const memoryLeak = structuredClone(passingEvidence());
    Object.assign(memoryLeak.lifecycle.cycles[0]!.cdpMemory, {
      settledBytes:
        memoryLeak.lifecycle.cycles[0]!.cdpMemory.beforeBytes +
        SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.maxSettledMemoryGrowthBytes +
        1,
      peakBytes:
        memoryLeak.lifecycle.cycles[0]!.cdpMemory.beforeBytes +
        SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.maxSettledMemoryGrowthBytes +
        1,
    });
    expectQualificationRejected(memoryLeak);

    const oversizedInitial = structuredClone(passingEvidence());
    Object.assign(oversizedInitial.build, { initialJsGzipBytes: 256_001 });
    Object.assign(oversizedInitial.build.emittedFiles[0]!, { gzipBytes: 256_001 });
    expectQualificationRejected(oversizedInitial);

    const signedLeak = structuredClone(passingEvidence());
    Object.assign(signedLeak.security.signedRedirectHygiene, {
      signedQueryInLogsCount: 1,
    });
    expectQualificationRejected(signedLeak);
  });

  it('allows pre-enable qualification only with enablement denied', () => {
    const preEnable = structuredClone(passingEvidence());
    Object.assign(preEnable.candidate, {
      qualificationPhase: 'pre-enable-disabled',
      preEnableEvidence: null,
    });
    Object.assign(preEnable.decision, {
      scope: 'pre-enable',
      operationalEnablement: { allowed: false, tupleId: null },
    });
    expect(SupertonicBrowserQualificationEvidenceV2Schema.safeParse(preEnable).success).toBe(true);

    const enabledWithoutPriorEvidence = structuredClone(passingEvidence());
    Object.assign(enabledWithoutPriorEvidence.candidate, { preEnableEvidence: null });
    expectQualificationRejected(enabledWithoutPriorEvidence);

    const priorEvidenceForAnotherTuple = structuredClone(passingEvidence());
    Object.assign(priorEvidenceForAnotherTuple.candidate.preEnableEvidence!, {
      tupleId: 'edge-wasm',
    });
    expectQualificationRejected(priorEvidenceForAnotherTuple);

    const failedButEnabled = structuredClone(failedBuildEvidence()) as ReturnType<
      typeof failedBuildEvidence
    > & {
      decision: ReturnType<typeof failedBuildEvidence>['decision'] & {
        operationalEnablement: { allowed: boolean; tupleId: string | null };
      };
    };
    Object.assign(failedButEnabled.decision.operationalEnablement, {
      allowed: true,
      tupleId: 'chrome-wasm',
    });
    expectQualificationRejected(failedButEnabled);
  });
});
