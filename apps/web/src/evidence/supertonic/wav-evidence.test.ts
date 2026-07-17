import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SUPERTONIC_WAV_EVIDENCE_POLICY,
  SUPERTONIC_RUNTIME_WAV_POLICY,
  SupertonicWavValidationError,
  assertSupertonicRuntimeWav,
  createSupertonicWavEvidence,
  deriveSupertonicPromptDurationBand,
  validateSupertonicWav,
} from './wav-evidence';

function pcm16Wav(samples: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.byteLength);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44_100, true);
  view.setUint32(28, 88_200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.byteLength, true);
  bytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44);
  return buffer;
}

function alternating(sampleFrames: number, amplitude: number): Int16Array {
  const samples = new Int16Array(sampleFrames);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? amplitude : -amplitude;
  }
  return samples;
}

function mutate(input: ArrayBuffer, mutation: (bytes: Uint8Array, view: DataView) => void) {
  const copy = input.slice(0);
  mutation(new Uint8Array(copy), new DataView(copy));
  return copy;
}

function expectCode(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SupertonicWavValidationError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected Supertonic WAV validation error ${code}.`);
}

describe('canonical Supertonic WAV evidence', () => {
  it('freezes the exact PCM16 policy and prompt-relative duration arithmetic', () => {
    expect(SUPERTONIC_WAV_EVIDENCE_POLICY).toEqual({
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
    });
    expect(deriveSupertonicPromptDurationBand(10)).toEqual({
      minSampleFrames: 73_500,
      maxSampleFrames: 676_200,
    });
  });

  it('parses a canonical offset view, hashes only its frozen bytes, and returns integer metrics', async () => {
    const wav = pcm16Wav(alternating(15_435, 1_000));
    const container = new Uint8Array(wav.byteLength + 9).fill(0xa5);
    container.set(new Uint8Array(wav), 4);
    const exactView = container.subarray(4, 4 + wav.byteLength);
    const band = deriveSupertonicPromptDurationBand(2);

    const report = await createSupertonicWavEvidence(exactView, band);

    expect(report).toMatchObject({
      policyId: 'supertonic-pcm16-44100-evidence-v1',
      sha256: `sha256:${createHash('sha256').update(new Uint8Array(wav)).digest('hex')}`,
      fileBytes: 30_914,
      header: {
        riffChunkSizeBytes: 30_906,
        fmtChunkSizeBytes: 16,
        audioFormat: 1,
        channelCount: 1,
        sampleRateHz: 44_100,
        byteRate: 88_200,
        blockAlignBytes: 2,
        bitsPerSample: 16,
        dataOffsetBytes: 44,
        pcmBytes: 30_870,
      },
      sampleFrames: 15_435,
      durationMicrosFloor: 350_000,
      promptBand: band,
      signal: {
        minPcm16: -1_000,
        maxPcm16: 1_000,
        peakPcm16: 1_000,
        sampleSumPcm16: 1_000,
        sampleSquareSumPcm16: 15_435_000_000,
        nonZeroFrames: 15_435,
        nonZeroPpmFloor: 1_000_000,
        clippedFrames: 0,
        clippedPpmFloor: 0,
        rmsPcm16MilliFloor: 1_000_000,
        dcOffsetPcm16MilliTrunc: 64,
      },
      validation: 'passed',
    });
    expect(container.subarray(0, 4)).toEqual(new Uint8Array(4).fill(0xa5));
    expect(container.subarray(4 + wav.byteLength)).toEqual(new Uint8Array(5).fill(0xa5));
  });

  it.each([
    ['short header', new ArrayBuffer(43), 'header-length'],
    [
      'RIFF identity',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (bytes) => (bytes[0] = 0)),
      'riff-identity',
    ],
    [
      'RIFF size',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) =>
        view.setUint32(4, view.getUint32(4, true) - 1, true),
      ),
      'riff-size',
    ],
    [
      'WAVE identity',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (bytes) => (bytes[8] = 0)),
      'wave-identity',
    ],
    [
      'fmt identity',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (bytes) => (bytes[12] = 0)),
      'fmt-identity',
    ],
    [
      'fmt size',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) => view.setUint32(16, 18, true)),
      'fmt-size',
    ],
    [
      'float format',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) => view.setUint16(20, 3, true)),
      'audio-format',
    ],
    [
      'stereo',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) => view.setUint16(22, 2, true)),
      'channel-count',
    ],
    [
      'sample rate',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) =>
        view.setUint32(24, 48_000, true),
      ),
      'sample-rate',
    ],
    [
      'byte rate',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) => view.setUint32(28, 1, true)),
      'byte-rate',
    ],
    [
      'block alignment',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) => view.setUint16(32, 1, true)),
      'block-alignment',
    ],
    [
      'bits per sample',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) => view.setUint16(34, 24, true)),
      'bits-per-sample',
    ],
    [
      'data identity',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (bytes) => (bytes[36] = 0)),
      'data-identity',
    ],
    [
      'data size',
      mutate(pcm16Wav(alternating(15_435, 1_000)), (_bytes, view) =>
        view.setUint32(40, view.getUint32(40, true) - 1, true),
      ),
      'data-size',
    ],
  ])('rejects noncanonical %s', (_label, wav, code) => {
    expectCode(() => validateSupertonicWav(wav), code);
  });

  it('enforces the inclusive global and prompt-relative duration bands', () => {
    expect(() => validateSupertonicWav(pcm16Wav(alternating(15_435, 1_000)))).not.toThrow();
    expectCode(
      () => validateSupertonicWav(pcm16Wav(alternating(15_434, 1_000))),
      'duration-global',
    );
    expectCode(() => validateSupertonicWav(new ArrayBuffer(44 + 7_938_001 * 2)), 'duration-global');
    expectCode(
      () =>
        validateSupertonicWav(pcm16Wav(alternating(73_499, 1_000)), {
          minSampleFrames: 73_500,
          maxSampleFrames: 676_200,
        }),
      'duration-prompt',
    );
  });

  it('separates the 50 ms runtime boundary from the 350 ms qualification gate', () => {
    const shortRuntimeWav = pcm16Wav(alternating(2_205, 1_000));

    expect(SUPERTONIC_RUNTIME_WAV_POLICY).toEqual({
      policyId: 'supertonic-pcm16-44100-runtime-v1',
      minimumSampleFrames: 2_205,
      maximumSampleFrames: 7_938_000,
      signalPolicyId: 'supertonic-pcm16-useful-signal-v1',
    });
    expect(assertSupertonicRuntimeWav(shortRuntimeWav)).toBeUndefined();
    expectCode(() => validateSupertonicWav(shortRuntimeWav), 'duration-global');
  });

  it('snapshots and freezes the prompt band before asynchronous hashing', async () => {
    const band = deriveSupertonicPromptDurationBand(2) as {
      minSampleFrames: number;
      maxSampleFrames: number;
    };
    const evidencePromise = createSupertonicWavEvidence(pcm16Wav(alternating(15_435, 1_000)), band);
    band.minSampleFrames = 1;
    band.maxSampleFrames = Number.MAX_SAFE_INTEGER;

    const evidence = await evidencePromise;

    expect(evidence.promptBand).toEqual({ minSampleFrames: 15_435, maxSampleFrames: 205_800 });
    expect(evidence.promptBand).not.toBe(band);
    expect(Object.isFrozen(evidence.promptBand)).toBe(true);
  });

  it('enforces nonzero, peak, and RMS floors at their integer boundaries', () => {
    const nonZeroFail = new Int16Array(100_000);
    nonZeroFail.fill(1_000, 0, 999);
    expectCode(() => validateSupertonicWav(pcm16Wav(nonZeroFail)), 'nonzero-signal');
    const nonZeroPass = new Int16Array(100_000);
    nonZeroPass.fill(1_000, 0, 1_000);
    expect(() => validateSupertonicWav(pcm16Wav(nonZeroPass))).not.toThrow();

    expectCode(() => validateSupertonicWav(pcm16Wav(alternating(15_435, 327))), 'peak-signal');
    expect(() => validateSupertonicWav(pcm16Wav(alternating(15_435, 328)))).not.toThrow();

    const rmsFail = new Int16Array(100_000);
    rmsFail.fill(329, 0, 1_000);
    expectCode(() => validateSupertonicWav(pcm16Wav(rmsFail)), 'rms-signal');
    const rmsPass = new Int16Array(100_000);
    rmsPass.fill(330, 0, 1_000);
    expect(() => validateSupertonicWav(pcm16Wav(rmsPass))).not.toThrow();
  });

  it('enforces near-clipping and DC limits at their integer boundaries', () => {
    const clippingPass = alternating(100_000, 1_000);
    clippingPass.set(alternating(5_000, 32_735));
    expect(() => validateSupertonicWav(pcm16Wav(clippingPass))).not.toThrow();
    const clippingFail = alternating(100_000, 1_000);
    clippingFail.set(alternating(5_001, 32_735));
    expectCode(() => validateSupertonicWav(pcm16Wav(clippingFail)), 'clipping');

    expect(() => validateSupertonicWav(pcm16Wav(new Int16Array(15_435).fill(1_638)))).not.toThrow();
    expectCode(
      () => validateSupertonicWav(pcm16Wav(new Int16Array(15_435).fill(1_639))),
      'dc-offset',
    );
  });
});
