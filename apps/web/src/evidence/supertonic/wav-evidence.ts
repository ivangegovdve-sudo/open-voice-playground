export const SUPERTONIC_WAV_EVIDENCE_POLICY = Object.freeze({
  policyId: 'supertonic-pcm16-44100-evidence-v1',
  headerBytes: 44,
  audioFormat: 1,
  channelCount: 1,
  sampleRateHz: 44_100,
  byteRate: 88_200,
  blockAlignBytes: 2,
  bitsPerSample: 16,
  minimumSampleFrames: 15_435,
  maximumSampleFrames: 7_938_000,
  minimumNonZeroPpm: 10_000,
  minimumPeakPcm16: 328,
  minimumRmsPcm16: 33,
  clippedAbsoluteFloorPcm16: 32_735,
  maximumClippedPpm: 50_000,
  maximumAbsoluteDcOffsetPcm16: 1_638,
} as const);

export const SUPERTONIC_RUNTIME_WAV_POLICY = Object.freeze({
  policyId: 'supertonic-pcm16-44100-runtime-v1',
  minimumSampleFrames: 2_205,
  maximumSampleFrames: SUPERTONIC_WAV_EVIDENCE_POLICY.maximumSampleFrames,
  signalPolicyId: 'supertonic-pcm16-useful-signal-v1',
} as const);

export type SupertonicPromptDurationBand = {
  readonly minSampleFrames: number;
  readonly maxSampleFrames: number;
};

export type SupertonicWavValidationCode =
  | 'header-length'
  | 'duration-global'
  | 'riff-identity'
  | 'riff-size'
  | 'wave-identity'
  | 'fmt-identity'
  | 'fmt-size'
  | 'audio-format'
  | 'channel-count'
  | 'sample-rate'
  | 'byte-rate'
  | 'block-alignment'
  | 'bits-per-sample'
  | 'data-identity'
  | 'data-size'
  | 'prompt-units'
  | 'prompt-band'
  | 'duration-prompt'
  | 'nonfinite-sample'
  | 'numeric-overflow'
  | 'nonzero-signal'
  | 'peak-signal'
  | 'rms-signal'
  | 'clipping'
  | 'dc-offset'
  | 'sha256-unavailable';

export class SupertonicWavValidationError extends Error {
  constructor(readonly code: SupertonicWavValidationCode) {
    super(`Supertonic WAV validation failed: ${code}.`);
    this.name = 'SupertonicWavValidationError';
  }
}

export type SupertonicWavValidation = {
  readonly policyId: typeof SUPERTONIC_WAV_EVIDENCE_POLICY.policyId;
  readonly fileBytes: number;
  readonly header: {
    readonly riffChunkSizeBytes: number;
    readonly fmtChunkSizeBytes: 16;
    readonly audioFormat: 1;
    readonly channelCount: 1;
    readonly sampleRateHz: 44_100;
    readonly byteRate: 88_200;
    readonly blockAlignBytes: 2;
    readonly bitsPerSample: 16;
    readonly dataOffsetBytes: 44;
    readonly pcmBytes: number;
  };
  readonly sampleFrames: number;
  readonly durationMicrosFloor: number;
  readonly promptBand: SupertonicPromptDurationBand | null;
  readonly signal: {
    readonly minPcm16: number;
    readonly maxPcm16: number;
    readonly peakPcm16: number;
    readonly sampleSumPcm16: number;
    readonly sampleSquareSumPcm16: number;
    readonly nonZeroFrames: number;
    readonly nonZeroPpmFloor: number;
    readonly clippedFrames: number;
    readonly clippedPpmFloor: number;
    readonly rmsPcm16MilliFloor: number;
    readonly dcOffsetPcm16MilliTrunc: number;
  };
  readonly validation: 'passed';
};

export type SupertonicWavEvidence = SupertonicWavValidation & {
  readonly sha256: `sha256:${string}`;
};

type WavInput = ArrayBuffer | ArrayBufferView;

function fail(code: SupertonicWavValidationCode): never {
  throw new SupertonicWavValidationError(code);
}

function snapshotInput(input: WavInput): Uint8Array<ArrayBuffer> {
  const maximumFileBytes =
    SUPERTONIC_WAV_EVIDENCE_POLICY.headerBytes +
    SUPERTONIC_WAV_EVIDENCE_POLICY.maximumSampleFrames *
      SUPERTONIC_WAV_EVIDENCE_POLICY.blockAlignBytes;
  if (input.byteLength > maximumFileBytes) fail('duration-global');
  const source =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const snapshot = new Uint8Array(source.byteLength);
  snapshot.set(source);
  return snapshot;
}

function snapshotPromptBand(band: SupertonicPromptDurationBand): SupertonicPromptDurationBand {
  const snapshot = Object.freeze({
    minSampleFrames: band.minSampleFrames,
    maxSampleFrames: band.maxSampleFrames,
  });
  validatePromptBand(snapshot);
  return snapshot;
}

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function validatePromptBand(band: SupertonicPromptDurationBand): void {
  if (
    !Number.isSafeInteger(band.minSampleFrames) ||
    !Number.isSafeInteger(band.maxSampleFrames) ||
    band.minSampleFrames < SUPERTONIC_WAV_EVIDENCE_POLICY.minimumSampleFrames ||
    band.maxSampleFrames > SUPERTONIC_WAV_EVIDENCE_POLICY.maximumSampleFrames ||
    band.minSampleFrames > band.maxSampleFrames
  ) {
    fail('prompt-band');
  }
}

export function deriveSupertonicPromptDurationBand(
  reviewedSpeechUnitCount: number,
): SupertonicPromptDurationBand {
  if (
    !Number.isSafeInteger(reviewedSpeechUnitCount) ||
    reviewedSpeechUnitCount < 1 ||
    reviewedSpeechUnitCount > 1_080
  ) {
    fail('prompt-units');
  }
  const band = {
    minSampleFrames: Math.max(
      SUPERTONIC_WAV_EVIDENCE_POLICY.minimumSampleFrames,
      reviewedSpeechUnitCount * 7_350,
    ),
    maxSampleFrames: Math.min(
      SUPERTONIC_WAV_EVIDENCE_POLICY.maximumSampleFrames,
      88_200 + reviewedSpeechUnitCount * 58_800,
    ),
  };
  validatePromptBand(band);
  return band;
}

function validateSnapshot(
  bytes: Uint8Array<ArrayBuffer>,
  promptBand: SupertonicPromptDurationBand | null,
  minimumSampleFrames: number,
): SupertonicWavValidation {
  const policy = SUPERTONIC_WAV_EVIDENCE_POLICY;
  const maximumFileBytes = policy.headerBytes + policy.maximumSampleFrames * policy.blockAlignBytes;
  if (bytes.byteLength > maximumFileBytes) fail('duration-global');
  if (bytes.byteLength < policy.headerBytes) fail('header-length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (!hasAscii(bytes, 0, 'RIFF')) fail('riff-identity');
  const riffChunkSizeBytes = view.getUint32(4, true);
  if (riffChunkSizeBytes !== bytes.byteLength - 8) fail('riff-size');
  if (!hasAscii(bytes, 8, 'WAVE')) fail('wave-identity');
  if (!hasAscii(bytes, 12, 'fmt ')) fail('fmt-identity');
  if (view.getUint32(16, true) !== 16) fail('fmt-size');
  if (view.getUint16(20, true) !== policy.audioFormat) fail('audio-format');
  if (view.getUint16(22, true) !== policy.channelCount) fail('channel-count');
  if (view.getUint32(24, true) !== policy.sampleRateHz) fail('sample-rate');
  if (view.getUint32(28, true) !== policy.byteRate) fail('byte-rate');
  if (view.getUint16(32, true) !== policy.blockAlignBytes) fail('block-alignment');
  if (view.getUint16(34, true) !== policy.bitsPerSample) fail('bits-per-sample');
  if (!hasAscii(bytes, 36, 'data')) fail('data-identity');

  const pcmBytes = view.getUint32(40, true);
  if (pcmBytes === 0 || pcmBytes % policy.blockAlignBytes !== 0) fail('data-size');
  if (pcmBytes !== bytes.byteLength - policy.headerBytes) fail('data-size');
  const sampleFrames = pcmBytes / policy.blockAlignBytes;
  if (sampleFrames < minimumSampleFrames || sampleFrames > policy.maximumSampleFrames) {
    fail('duration-global');
  }
  if (promptBand !== null) {
    validatePromptBand(promptBand);
    if (sampleFrames < promptBand.minSampleFrames || sampleFrames > promptBand.maxSampleFrames) {
      fail('duration-prompt');
    }
  }

  let minPcm16 = 32_767;
  let maxPcm16 = -32_768;
  let peakPcm16 = 0;
  let sampleSumPcm16 = 0;
  let sampleSquareSumPcm16 = 0;
  let nonZeroFrames = 0;
  let clippedFrames = 0;
  for (let index = 0; index < sampleFrames; index += 1) {
    const sample = view.getInt16(policy.headerBytes + index * policy.blockAlignBytes, true);
    if (!Number.isFinite(sample)) fail('nonfinite-sample');
    minPcm16 = Math.min(minPcm16, sample);
    maxPcm16 = Math.max(maxPcm16, sample);
    const absolute = Math.abs(sample);
    peakPcm16 = Math.max(peakPcm16, absolute);
    sampleSumPcm16 += sample;
    sampleSquareSumPcm16 += sample * sample;
    if (sample !== 0) nonZeroFrames += 1;
    if (absolute >= policy.clippedAbsoluteFloorPcm16) clippedFrames += 1;
  }
  if (!Number.isSafeInteger(sampleSumPcm16) || !Number.isSafeInteger(sampleSquareSumPcm16)) {
    fail('numeric-overflow');
  }

  if (nonZeroFrames * 1_000_000 < policy.minimumNonZeroPpm * sampleFrames) {
    fail('nonzero-signal');
  }
  if (peakPcm16 < policy.minimumPeakPcm16) fail('peak-signal');
  if (sampleSquareSumPcm16 < policy.minimumRmsPcm16 * policy.minimumRmsPcm16 * sampleFrames) {
    fail('rms-signal');
  }
  if (clippedFrames * 1_000_000 > policy.maximumClippedPpm * sampleFrames) fail('clipping');
  if (Math.abs(sampleSumPcm16) > policy.maximumAbsoluteDcOffsetPcm16 * sampleFrames) {
    fail('dc-offset');
  }

  return {
    policyId: policy.policyId,
    fileBytes: bytes.byteLength,
    header: {
      riffChunkSizeBytes,
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
    durationMicrosFloor: Math.floor((sampleFrames * 1_000_000) / policy.sampleRateHz),
    promptBand,
    signal: {
      minPcm16,
      maxPcm16,
      peakPcm16,
      sampleSumPcm16,
      sampleSquareSumPcm16,
      nonZeroFrames,
      nonZeroPpmFloor: Math.floor((nonZeroFrames * 1_000_000) / sampleFrames),
      clippedFrames,
      clippedPpmFloor: Math.floor((clippedFrames * 1_000_000) / sampleFrames),
      rmsPcm16MilliFloor: Math.floor(Math.sqrt(sampleSquareSumPcm16 / sampleFrames) * 1_000),
      dcOffsetPcm16MilliTrunc: Math.trunc((sampleSumPcm16 * 1_000) / sampleFrames),
    },
    validation: 'passed',
  };
}

export function validateSupertonicWav(
  input: WavInput,
  promptBand: SupertonicPromptDurationBand | null = null,
): SupertonicWavValidation {
  const promptBandSnapshot = promptBand === null ? null : snapshotPromptBand(promptBand);
  return validateSnapshot(
    snapshotInput(input),
    promptBandSnapshot,
    SUPERTONIC_WAV_EVIDENCE_POLICY.minimumSampleFrames,
  );
}

export function assertSupertonicRuntimeWav(input: WavInput): void {
  validateSnapshot(snapshotInput(input), null, SUPERTONIC_RUNTIME_WAV_POLICY.minimumSampleFrames);
}

export async function createSupertonicWavEvidence(
  input: WavInput,
  promptBand: SupertonicPromptDurationBand,
): Promise<SupertonicWavEvidence> {
  const promptBandSnapshot = snapshotPromptBand(promptBand);
  const snapshot = snapshotInput(input);
  const validation = validateSnapshot(
    snapshot,
    promptBandSnapshot,
    SUPERTONIC_WAV_EVIDENCE_POLICY.minimumSampleFrames,
  );
  if (globalThis.crypto?.subtle === undefined) fail('sha256-unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', snapshot);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { ...validation, sha256: `sha256:${hex}` };
}
